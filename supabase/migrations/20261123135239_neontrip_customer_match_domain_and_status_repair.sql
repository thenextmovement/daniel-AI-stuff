-- NEONTRIP only. Source: exact live functions captured 2026-11-23.
-- No uploads, membership refresh, state resets, schema additions or credential changes.
-- Apply within one transaction. Existing n8n schedules will use the repaired functions.
set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('neontrip:customer_match:repair:20261123'));
lock table customer_match_v2.config, customer_match_v2.batches,
  customer_match_v2.memberships, customer_match_v2.batch_members in share row exclusive mode;
do $guard$ begin
  if md5(pg_get_functiondef('public.cm_v2_get_due_statuses(integer)'::regprocedure)) <> '7913a525bfb0e90ca47c861acfeaf142' then raise exception 'Live function drift: cm_v2_get_due_statuses'; end if;
  if md5(pg_get_functiondef('public.cm_v2_record_status(uuid,text,jsonb)'::regprocedure)) <> '6edb114f3ab08a21815ea15541513bf1' then raise exception 'Live function drift: cm_v2_record_status'; end if;
  if md5(pg_get_functiondef('public.cm_v2_refresh_memberships()'::regprocedure)) <> 'd0a17b2cef5ce6a0fd272d57aca9ecd5' then raise exception 'Live function drift: cm_v2_refresh_memberships'; end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.cm_v2_get_due_statuses(p_limit integer DEFAULT 25)
 RETURNS TABLE(batch_id uuid, google_request_id text, audience_key text, action text, list_id text, status_attempts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'customer_match_v2'
AS $function$
  with due as (
    select b.batch_id
    from customer_match_v2.batches b
    where b.state in ('submitted','processing')
      and b.google_request_id is not null
      and coalesce(b.next_status_check_at, b.submitted_at) <= clock_timestamp()
    order by coalesce(b.next_status_check_at, b.submitted_at), b.created_at
    limit least(100, greatest(1, coalesce(p_limit, 25)))
    for update skip locked
  )
  update customer_match_v2.batches b
  set next_status_check_at = clock_timestamp() + interval '10 minutes'
  from due
  where b.batch_id = due.batch_id
  returning
    b.batch_id,
    b.google_request_id,
    b.audience_key,
    b.action,
    b.list_id,
    b.status_attempts;
$function$;

CREATE OR REPLACE FUNCTION public.cm_v2_record_status(p_batch_id uuid, p_request_status text, p_diagnostics jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'customer_match_v2'
AS $function$
declare
  v_batch customer_match_v2.batches%rowtype;
  v_status text := upper(btrim(coalesce(p_request_status, '')));
  v_delay_minutes integer;
begin
  select *
  into v_batch
  from customer_match_v2.batches b
  where b.batch_id = p_batch_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;

  if v_batch.state not in ('submitted','processing') then
    raise exception 'batch status is not recordable from state %', v_batch.state;
  end if;

  if nullif(btrim(v_batch.google_request_id), '') is null then
    raise exception 'batch has no google request id';
  end if;

  if v_status = 'PROCESSING' then
    -- Keep reconciling accepted provider requests; never resend their payload.
    -- Beyond 26 checks use daily reads and expose the unresolved status.
    v_delay_minutes := case when v_batch.status_attempts >= 25 then 1440 else least(
      55,
      greatest(30, round(30 * power(1.3, v_batch.status_attempts + 1))::integer)
    ) end;

    update customer_match_v2.batches b
    set
      state = 'processing',
      diagnostics = coalesce(p_diagnostics, '{}'::jsonb) || case
        when v_batch.status_attempts >= 25 then
          jsonb_build_object('status_review_required', true, 'automatic_upload_retry', false)
        else '{}'::jsonb
      end,
      status_attempts = b.status_attempts + 1,
      next_status_check_at = clock_timestamp() + make_interval(mins => v_delay_minutes)
    where b.batch_id = p_batch_id;

    update customer_match_v2.batch_members bm
    set status = 'processing', updated_at = clock_timestamp()
    where bm.batch_id = p_batch_id;

    update customer_match_v2.memberships m
    set sync_state = 'processing', updated_at = clock_timestamp()
    where m.active_batch_id = p_batch_id;

    return jsonb_build_object(
      'batch_id', p_batch_id,
      'state', 'processing',
      'next_check_minutes', v_delay_minutes
    );
  end if;

  if v_status = 'SUCCESS' then
    update customer_match_v2.batches b
    set
      state = 'success',
      diagnostics = coalesce(p_diagnostics, '{}'::jsonb),
      status_attempts = b.status_attempts + 1,
      next_status_check_at = null,
      terminal_at = clock_timestamp()
    where b.batch_id = p_batch_id;

    update customer_match_v2.batch_members bm
    set status = 'success', updated_at = clock_timestamp()
    where bm.batch_id = p_batch_id;

    update customer_match_v2.memberships m
    set
      google_state = case when v_batch.action = 'ingest' then 'present' else 'absent' end,
      active_batch_id = null,
      pending_action = case
        when v_batch.action = 'ingest' and not (m.desired_present and m.consent_eligible) then 'remove'
        when v_batch.action = 'remove' and m.desired_present and m.consent_eligible then 'ingest'
        else null
      end,
      sync_state = case
        when v_batch.action = 'ingest' and m.desired_present and m.consent_eligible then 'present'
        when v_batch.action = 'remove' and not (m.desired_present and m.consent_eligible) then 'absent'
        else 'pending'
      end,
      last_terminal_at = clock_timestamp(),
      last_error = null,
      updated_at = clock_timestamp()
    where m.active_batch_id = p_batch_id;

    return jsonb_build_object('batch_id', p_batch_id, 'state', 'success');
  end if;

  if v_status in ('PARTIAL_SUCCESS','FAILURE') then
    update customer_match_v2.batches b
    set
      state = lower(v_status),
      diagnostics = coalesce(p_diagnostics, '{}'::jsonb),
      status_attempts = b.status_attempts + 1,
      next_status_check_at = null,
      terminal_at = clock_timestamp()
    where b.batch_id = p_batch_id;

    update customer_match_v2.batch_members bm
    set
      status = case when v_status = 'PARTIAL_SUCCESS' then 'partial_unknown' else 'failure' end,
      error = coalesce(p_diagnostics, '{}'::jsonb),
      updated_at = clock_timestamp()
    where bm.batch_id = p_batch_id;

    update customer_match_v2.memberships m
    set
      active_batch_id = null,
      sync_state = case when v_status = 'PARTIAL_SUCCESS' then 'partial_unknown' else 'failure' end,
      last_terminal_at = clock_timestamp(),
      last_error = coalesce(p_diagnostics, '{}'::jsonb),
      updated_at = clock_timestamp()
    where m.active_batch_id = p_batch_id;

    return jsonb_build_object(
      'batch_id', p_batch_id,
      'state', lower(v_status),
      'retry_blocked', true
    );
  end if;

  raise exception 'unsupported request status: %', v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cm_v2_refresh_memberships()
 RETURNS TABLE(audience_key text, total_count bigint, consent_eligible_count bigint, blocked_count bigint, pending_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'customer_match_v2'
 SET statement_timeout TO '60s'
AS $function$
begin
  with cfg as materialized (
    select c.backfill_as_of
    from customer_match_v2.config c
    where c.config_key = 'default'
  ),
  request_emails as materialized (
    select
      mr.*,
      lower(btrim(mc.email)) as normalized_email,
      customer_match_v2.normalize_buyer_email(mc.email) as canonical_email,
      mc.source as customer_source
    from public.master_requests mr
    join public.master_customers mc on mc.id = mr.customer_id
    where public._cm_is_valid_email(mc.email)
  ),
  current_lp as materialized (
    select
      re.canonical_email as normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    where re.canonical_email is not null
      and re.form_id = 'landing-page-form'
      and (
        re.landing_page_url is null
        or btrim(re.landing_page_url) = ''
        or re.landing_page_url ilike '%anfrage.neontrip.de%'
        or re.landing_page_url ~* '^https?://(www\.)?neontrip\.de([/?#]|$)'
      )
      and coalesce(re.landing_page_url, '') not ilike '%neontrip-lp.pages.dev%'
    group by re.canonical_email
  ),
  legacy_nerdy as materialized (
    select
      re.canonical_email as normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    cross join cfg
    where re.canonical_email is not null
      and re.form_id = '2418'
      and re.created_at <= cfg.backfill_as_of
    group by re.canonical_email
  ),
  genuine_outlook as materialized (
    select
      re.canonical_email as normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    where re.canonical_email is not null
      and ((
        re.form_id = 'outlook_email'
        and coalesce(re.status, '') <> 'duplicate_closed'
        and (
          re.segment_status = 'accepted'
          or (
            re.segment_status is null
            and re.status in ('new', 'quoted', 'won')
            and (re.trello_card_id is not null or re.ac_deal_id is not null)
          )
        )
      )
      or (
        re.form_id is null
        and re.customer_source in ('email', 'outlook_email')
        and re.status in ('new', 'quoted', 'won')
        and (re.trello_card_id is not null or re.ac_deal_id is not null)
      )
      )
    group by re.canonical_email
  ),
  inquiry_sources as materialized (
    select lp.normalized_email, 'current_lp'::text as source_class,
      lp.first_seen_at, lp.last_seen_at
    from current_lp lp
    union all
    select ln.normalized_email, 'legacy_nerdy'::text,
      ln.first_seen_at, ln.last_seen_at
    from legacy_nerdy ln
    union all
    select go.normalized_email, 'outlook_email'::text,
      go.first_seen_at, go.last_seen_at
    from genuine_outlook go
  ),
  inquiries as materialized (
    select
      src.normalized_email,
      array_agg(distinct src.source_class order by src.source_class) as source_classes,
      min(src.first_seen_at) as first_seen_at,
      max(src.last_seen_at) as last_seen_at
    from inquiry_sources src
    group by src.normalized_email
  ),
  buyer_sources as materialized (
    select
      customer_match_v2.normalize_buyer_email(mc.email) as normalized_email,
      encode(
        extensions.digest(
          lower(regexp_replace(btrim(mc.email), E'\\s+', '', 'g')),
          'sha256'
        ),
        'hex'
      ) as raw_email_sha256,
      coalesce(mo.shopify_created_at, mo.created_at) as first_seen_at,
      coalesce(mo.shopify_created_at, mo.created_at) as last_seen_at
    from public.master_orders mo
    join public.master_customers mc on mc.id = mo.customer_id
    where mo.status in ('paid', 'partially_paid')
      and mo.cancelled_at is null
      and public._cm_is_valid_email(mc.email)
      and customer_match_v2.normalize_buyer_email(mc.email) is not null
    union all
    select
      customer_match_v2.normalize_buyer_email(chosen.buyer_email),
      encode(
        extensions.digest(
          lower(regexp_replace(btrim(chosen.buyer_email), E'\\s+', '', 'g')),
          'sha256'
        ),
        'hex'
      ),
      so.created_at,
      so.created_at
    from public.shopify_orders so
    cross join lateral (
      select case
        when public._cm_is_valid_email(nullif(btrim(so.kunde_email), ''))
          then so.kunde_email
        when public._cm_is_valid_email(nullif(btrim(so.email), ''))
          then so.email
        else null
      end as buyer_email
    ) chosen
    where so.cancelled_at is null
      and lower(coalesce(so.financial_status, '')) in ('paid', 'partially_paid')
      and chosen.buyer_email is not null
      and customer_match_v2.normalize_buyer_email(chosen.buyer_email) is not null
  ),
  buyers as materialized (
    select
      bs.normalized_email,
      min(bs.first_seen_at) as first_seen_at,
      max(bs.last_seen_at) as last_seen_at
    from buyer_sources bs
    group by bs.normalized_email
  ),
  consent_by_email as materialized (
    select
      re.normalized_email,
      max(re.consent_recorded_at) as consent_evidence_at,
      (array_agg(re.consent_source order by re.consent_recorded_at desc))[1]
        as consent_source,
      (array_agg(re.consent_policy_version order by re.consent_recorded_at desc))[1]
        as consent_policy_version
    from request_emails re
    cross join cfg
    where re.consent_ad_user_data = 'granted'
      and re.consent_ad_personalization = 'granted'
      and re.consent_recorded_at is not null
      and nullif(btrim(re.consent_source), '') is not null
      and nullif(btrim(re.consent_policy_version), '') is not null
      and (
        (
          re.form_id = 'landing-page-form'
          and (
            re.landing_page_url is null
            or btrim(re.landing_page_url) = ''
            or re.landing_page_url ilike '%anfrage.neontrip.de%'
            or re.landing_page_url ~* '^https?://(www\.)?neontrip\.de([/?#]|$)'
          )
          and coalesce(re.landing_page_url, '') not ilike '%neontrip-lp.pages.dev%'
        )
        or (
          re.form_id = 'outlook_email'
          and coalesce(re.status, '') <> 'duplicate_closed'
          and (
            re.segment_status = 'accepted'
            or (
              re.segment_status is null
              and re.status in ('new', 'quoted', 'won')
              and (re.trello_card_id is not null or re.ac_deal_id is not null)
            )
          )
        )
        or (
          re.form_id = '2418'
          and re.created_at <= cfg.backfill_as_of
        )
      )
    group by re.normalized_email
  ),
  buyer_consent_by_email as materialized (
    select
      customer_match_v2.normalize_buyer_email(c.normalized_email) as normalized_email,
      max(c.consent_evidence_at) as consent_evidence_at,
      (array_agg(c.consent_source order by c.consent_evidence_at desc))[1]
        as consent_source,
      (array_agg(c.consent_policy_version order by c.consent_evidence_at desc))[1]
        as consent_policy_version
    from consent_by_email c
    group by customer_match_v2.normalize_buyer_email(c.normalized_email)
  ),
  buyer_consent_events as materialized (
    select
      customer_match_v2.normalize_buyer_email(re.normalized_email)
        as normalized_email,
      re.consent_ad_user_data,
      re.consent_ad_personalization,
      re.consent_recorded_at,
      re.consent_source,
      re.consent_policy_version,
      re.created_at,
      re.id
    from request_emails re
    cross join cfg
    where re.consent_recorded_at is not null
      and (
        re.consent_ad_user_data = 'denied'
        or re.consent_ad_personalization = 'denied'
        or (
          re.consent_ad_user_data = 'granted'
          and re.consent_ad_personalization = 'granted'
          and nullif(btrim(re.consent_source), '') is not null
          and nullif(btrim(re.consent_policy_version), '') is not null
          and (
            (
              re.form_id = 'landing-page-form'
              and (
                re.landing_page_url is null
                or btrim(re.landing_page_url) = ''
                or re.landing_page_url ilike '%anfrage.neontrip.de%'
                or re.landing_page_url ~* '^https?://(www\.)?neontrip\.de([/?#]|$)'
              )
              and coalesce(re.landing_page_url, '')
                not ilike '%neontrip-lp.pages.dev%'
            )
            or (
              re.form_id = 'outlook_email'
              and coalesce(re.status, '') <> 'duplicate_closed'
              and (
                re.segment_status = 'accepted'
                or (
                  re.segment_status is null
                  and re.status in ('new', 'quoted', 'won')
                  and (
                    re.trello_card_id is not null
                    or re.ac_deal_id is not null
                  )
                )
              )
            )
            or (
              re.form_id = '2418'
              and re.created_at <= cfg.backfill_as_of
            )
          )
        )
      )
  ),
  buyer_latest_consent_by_email as materialized (
    select distinct on (e.normalized_email)
      e.normalized_email,
      e.consent_recorded_at as consent_evidence_at,
      e.consent_source,
      e.consent_policy_version,
      (
        e.consent_ad_user_data = 'denied'
        or e.consent_ad_personalization = 'denied'
      ) as consent_denied
    from buyer_consent_events e
    order by
      e.normalized_email,
      e.consent_recorded_at desc,
      e.created_at desc,
      e.id desc
  ),
  desired as materialized (
    select
      'current_lp'::text as audience_key,
      lp.normalized_email,
      array['current_lp']::text[] as source_classes,
      lp.first_seen_at,
      lp.last_seen_at
    from current_lp lp
    union all
    select
      'legacy_nerdy',
      ln.normalized_email,
      array['legacy_nerdy']::text[],
      ln.first_seen_at,
      ln.last_seen_at
    from legacy_nerdy ln
    union all
    select
      'all_inquiries',
      i.normalized_email,
      i.source_classes,
      i.first_seen_at,
      i.last_seen_at
    from inquiries i
    union all
    select
      'buyers',
      b.normalized_email,
      array['buyer']::text[],
      b.first_seen_at,
      b.last_seen_at
    from buyers b
    union all
    select
      'without_purchase',
      i.normalized_email,
      i.source_classes,
      i.first_seen_at,
      i.last_seen_at
    from inquiries i
    left join buyers b
      on b.normalized_email =
        customer_match_v2.normalize_buyer_email(i.normalized_email)
    where b.normalized_email is null
  ),
  receipt_consent_by_hash as materialized (
    select
      r.email_sha256,
      max(r.attested_at) as consent_evidence_at,
      (array_agg(r.consent_source order by r.attested_at desc, r.created_at desc))[1]
        as consent_source,
      (array_agg(
        r.consent_policy_version order by r.attested_at desc, r.created_at desc
      ))[1] as consent_policy_version,
      bool_and(
        coalesce(
          r.evidence ->> 'migration' =
            'customer_match_cm2a_buyer_reconciliation_20260829',
          false
        )
      ) as buyers_only
    from customer_match_v2.consent_receipts r
    where r.ad_user_data = 'granted'
      and r.ad_personalization = 'granted'
      and r.revoked_at is null
      and r.attested_at is not null
      and nullif(btrim(r.consent_source), '') is not null
      and nullif(btrim(r.consent_policy_version), '') is not null
    group by r.email_sha256
  ),
  receipt_latest_state_by_hash as materialized (
    select distinct on (r.email_sha256)
      r.email_sha256,
      (
        r.revoked_at is not null
        or r.ad_user_data = 'denied'
        or r.ad_personalization = 'denied'
      ) as consent_denied,
      coalesce(r.revoked_at, r.attested_at) as consent_evidence_at,
      r.consent_source,
      r.consent_policy_version,
      r.created_at,
      r.receipt_id
    from customer_match_v2.consent_receipts r
    where coalesce(r.revoked_at, r.attested_at) is not null
    order by
      r.email_sha256,
      coalesce(r.revoked_at, r.attested_at) desc,
      r.created_at desc,
      r.receipt_id desc
  ),
  buyer_receipt_latest_state_by_email as materialized (
    select distinct on (bs.normalized_email)
      bs.normalized_email,
      rl.consent_denied,
      rl.consent_evidence_at,
      rl.consent_source,
      rl.consent_policy_version
    from buyer_sources bs
    cross join lateral (
      select bs.raw_email_sha256 as email_sha256
      union
      select encode(extensions.digest(bs.normalized_email, 'sha256'), 'hex')
    ) buyer_hash
    join receipt_latest_state_by_hash rl
      on rl.email_sha256 = buyer_hash.email_sha256
    order by
      bs.normalized_email,
      rl.consent_evidence_at desc,
      rl.created_at desc,
      rl.receipt_id desc
  ),
  inquiry_email_hashes as materialized (
    -- Preserve the link to historical receipts while canonicalizing inquiry keys.
    select re.canonical_email as normalized_email,
      encode(extensions.digest(re.normalized_email, 'sha256'), 'hex') as email_sha256
    from request_emails re
    where re.canonical_email is not null
    union
    select re.canonical_email,
      encode(extensions.digest(re.canonical_email, 'sha256'), 'hex')
    from request_emails re
    where re.canonical_email is not null
  ),
  inquiry_receipt_consent_by_email as materialized (
    select h.normalized_email,
      max(r.consent_evidence_at) as consent_evidence_at,
      (array_agg(r.consent_source order by r.consent_evidence_at desc, r.email_sha256))[1]
        as consent_source,
      (array_agg(r.consent_policy_version order by r.consent_evidence_at desc, r.email_sha256))[1]
        as consent_policy_version
    from inquiry_email_hashes h
    join receipt_consent_by_hash r on r.email_sha256 = h.email_sha256
    where not r.buyers_only
    group by h.normalized_email
  ),
  inquiry_receipt_latest_state_by_email as materialized (
    select distinct on (h.normalized_email)
      h.normalized_email, rl.consent_denied, rl.consent_evidence_at,
      rl.consent_source, rl.consent_policy_version
    from inquiry_email_hashes h
    join receipt_latest_state_by_hash rl on rl.email_sha256 = h.email_sha256
    order by h.normalized_email, rl.consent_evidence_at desc,
      rl.created_at desc, rl.receipt_id desc
  ),
  desired_hashed as materialized (
    select
      d.*,
      encode(extensions.digest(d.normalized_email, 'sha256'), 'hex') as email_sha256
    from desired d
  ),
  desired_with_consent as materialized (
    select
      d.*,
      case
        when coalesce(bl.consent_denied, false)
          or coalesce(brl.consent_denied, false)
          or coalesce(irl.consent_denied, false)
          then false
        else (
          c.normalized_email is not null
          or bc.normalized_email is not null
          or r.email_sha256 is not null
          or ir.normalized_email is not null
        )
      end as consent_eligible,
      case
        when coalesce(bl.consent_denied, false)
          then bl.consent_evidence_at
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_evidence_at
        when coalesce(irl.consent_denied, false)
          then irl.consent_evidence_at
        else coalesce(
          bc.consent_evidence_at,
          c.consent_evidence_at,
          ir.consent_evidence_at,
          r.consent_evidence_at
        )
      end as consent_evidence_at,
      case
        when coalesce(bl.consent_denied, false)
          then bl.consent_source
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_source
        when coalesce(irl.consent_denied, false)
          then irl.consent_source
        else coalesce(bc.consent_source, c.consent_source, ir.consent_source, r.consent_source)
      end as consent_source,
      case
        when coalesce(bl.consent_denied, false)
          then bl.consent_policy_version
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_policy_version
        when coalesce(irl.consent_denied, false)
          then irl.consent_policy_version
        else coalesce(
          bc.consent_policy_version,
          c.consent_policy_version,
          ir.consent_policy_version,
          r.consent_policy_version
        )
      end as consent_policy_version,
      (
        coalesce(bl.consent_denied, false)
        or coalesce(brl.consent_denied, false)
        or coalesce(irl.consent_denied, false)
      ) as consent_denied
    from desired_hashed d
    left join consent_by_email c using (normalized_email)
    left join buyer_consent_by_email bc
      on bc.normalized_email = d.normalized_email
    left join buyer_latest_consent_by_email bl
      on bl.normalized_email = d.normalized_email
    left join receipt_consent_by_hash r
      on r.email_sha256 = d.email_sha256
     and (d.audience_key = 'buyers' or not r.buyers_only)
    left join buyer_receipt_latest_state_by_email brl
      on d.audience_key = 'buyers'
     and brl.normalized_email = d.normalized_email
    left join inquiry_receipt_consent_by_email ir
      on d.audience_key <> 'buyers'
     and ir.normalized_email = d.normalized_email
    left join inquiry_receipt_latest_state_by_email irl
      on d.audience_key <> 'buyers'
     and irl.normalized_email = d.normalized_email
  ),
  became_buyer_hashes as materialized (
    select
      encode(extensions.digest(i.normalized_email, 'sha256'), 'hex') as email_sha256
    from inquiries i
    join buyers b
      on b.normalized_email =
        customer_match_v2.normalize_buyer_email(i.normalized_email)
  ),
  upserted as (
    insert into customer_match_v2.memberships as existing (
      audience_key,
      email_sha256,
      source_classes,
      first_seen_at,
      last_seen_at,
      desired_present,
      consent_eligible,
      consent_evidence_at,
      consent_source,
      consent_policy_version,
      eligibility_reason,
      google_state,
      pending_action,
      sync_state,
      updated_at
    )
    select
      d.audience_key,
      d.email_sha256,
      d.source_classes,
      d.first_seen_at,
      d.last_seen_at,
      true,
      d.consent_eligible,
      d.consent_evidence_at,
      d.consent_source,
      d.consent_policy_version,
      case
        when d.consent_denied then 'explicit_consent_denied'
        when d.consent_eligible then 'eligible'
        else 'missing_recorded_consent'
      end,
      'absent',
      case when d.consent_eligible then 'ingest' else null end,
      case when d.consent_eligible then 'pending' else 'blocked_consent' end,
      clock_timestamp()
    from desired_with_consent d
    on conflict on constraint memberships_pkey do update
    set
      source_classes = excluded.source_classes,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      desired_present = true,
      consent_eligible = excluded.consent_eligible,
      consent_evidence_at = excluded.consent_evidence_at,
      consent_source = excluded.consent_source,
      consent_policy_version = excluded.consent_policy_version,
      eligibility_reason = excluded.eligibility_reason,
      pending_action = case
        when existing.active_batch_id is not null then existing.pending_action
        when excluded.consent_eligible and existing.google_state <> 'present' then 'ingest'
        when not excluded.consent_eligible and existing.google_state = 'present' then 'remove'
        else null
      end,
      sync_state = case
        when existing.active_batch_id is not null then existing.sync_state
        when existing.sync_state in ('failure', 'partial_unknown')
          and existing.pending_action = (
            case
              when excluded.consent_eligible and existing.google_state <> 'present'
                then 'ingest'
              when not excluded.consent_eligible and existing.google_state = 'present'
                then 'remove'
              else null
            end
          )
          then existing.sync_state
        when excluded.consent_eligible and existing.google_state <> 'present'
          then 'pending'
        when not excluded.consent_eligible and existing.google_state = 'present'
          then 'pending'
        when excluded.consent_eligible and existing.google_state = 'present'
          then 'present'
        else 'blocked_consent'
      end,
      updated_at = clock_timestamp()
    returning existing.audience_key, existing.email_sha256
  )
  update customer_match_v2.memberships m
  set
    desired_present = false,
    consent_eligible = false,
    consent_evidence_at = null,
    consent_source = null,
    consent_policy_version = null,
    eligibility_reason = case
      when m.audience_key = 'without_purchase'
        and exists (
          select 1
          from became_buyer_hashes b
          where b.email_sha256 = m.email_sha256
        )
        then 'became_buyer'
      else 'no_longer_desired'
    end,
    pending_action = case
      when m.active_batch_id is not null then m.pending_action
      when m.google_state = 'present' then 'remove'
      else null
    end,
    sync_state = case
      when m.active_batch_id is not null then m.sync_state
      when m.google_state = 'present' then 'pending'
      else 'absent'
    end,
    updated_at = clock_timestamp()
  where m.desired_present
    and not exists (
      select 1
      from desired_with_consent d
      where d.audience_key = m.audience_key
        and d.email_sha256 = m.email_sha256
    );

  return query
  select
    m.audience_key,
    count(*) filter (where m.desired_present)::bigint as total_count,
    count(*) filter (
      where m.desired_present and m.consent_eligible
    )::bigint as consent_eligible_count,
    count(*) filter (
      where m.desired_present and not m.consent_eligible
    )::bigint as blocked_count,
    count(*) filter (where m.pending_action is not null)::bigint as pending_count
  from customer_match_v2.memberships m
  group by m.audience_key
  order by m.audience_key;
end;
$function$;
