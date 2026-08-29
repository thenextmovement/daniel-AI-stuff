-- CM-2A: reconcile the buyer source without enabling or submitting uploads.
-- The migration is intentionally fail-closed and snapshots only hashed customer data.
-- Run through the transactional Supabase migration runner; do not execute statement-by-statement.

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('customer_match_v2:cm2a:20260829'));

lock table customer_match_v2.config in share row exclusive mode;
lock table customer_match_v2.batches in share row exclusive mode;
lock table customer_match_v2.batch_members in share row exclusive mode;
lock table customer_match_v2.memberships in share row exclusive mode;
lock table customer_match_v2.consent_receipts in share row exclusive mode;
lock table public.master_orders in share mode;
lock table public.master_customers in share mode;
lock table public.master_requests in share mode;
lock table public.shopify_orders in share mode;

do $preflight$
declare
  v_refresh_md5 text;
begin
  if exists (
    select 1
    from pg_catalog.pg_namespace
    where nspname = 'codex_backup_cm_20260829_cm2a'
  ) then
    raise exception 'CM-2A backup schema already exists';
  end if;

  if pg_catalog.to_regprocedure(
    'customer_match_v2.normalize_buyer_email(text)'
  ) is not null then
    raise exception 'CM-2A buyer normalizer already exists';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
  into v_refresh_md5
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'cm_v2_refresh_memberships'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  if v_refresh_md5 is distinct from '4defd8cda747696b6076d950641bbc5c' then
    raise exception 'CM-2A refresh function drift: %', v_refresh_md5;
  end if;

  if not exists (
    select 1
    from customer_match_v2.config
    where config_key = 'default'
      and uploads_enabled = false
      and privacy_gate_status = 'approved'
      and list_ids ->> 'buyers' = '9362105858'
  ) then
    raise exception 'CM-2A config precondition failed';
  end if;

  if exists (
    select 1
    from customer_match_v2.batches
    where state in ('prepared', 'submitted', 'processing')
  ) then
    raise exception 'CM-2A refuses to run with a nonterminal batch';
  end if;

  if exists (
    select 1
    from customer_match_v2.memberships
    where active_batch_id is not null
  ) then
    raise exception 'CM-2A refuses to run with claimed memberships';
  end if;

  if coalesce((select max(ingested_at) from public.shopify_orders), '-infinity'::timestamptz)
      < pg_catalog.clock_timestamp() - interval '2 hours' then
    raise exception 'CM-2A Shopify mirror is stale';
  end if;

  if (select count(*) from public.shopify_orders) < 2700
    or (
      select count(*)
      from public.shopify_orders
      where cancelled_at is null
        and pg_catalog.lower(coalesce(financial_status, ''))
          in ('paid', 'partially_paid')
    ) < 2400 then
    raise exception 'CM-2A Shopify mirror completeness floor failed';
  end if;
end;
$preflight$;

create schema codex_backup_cm_20260829_cm2a;
revoke all on schema codex_backup_cm_20260829_cm2a from public, anon, authenticated, service_role;

comment on schema codex_backup_cm_20260829_cm2a is
  'CM-2A rollback snapshot captured before the 2026-08-29 buyer reconciliation; customer identifiers are stored only as SHA-256 hashes.';

create table codex_backup_cm_20260829_cm2a.function_snapshot as
select
  pg_catalog.clock_timestamp() as captured_at,
  p.oid as function_oid,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.proacl as function_acl,
  p.prosecdef as security_definer,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as function_md5,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'cm_v2_refresh_memberships'
  and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

create table codex_backup_cm_20260829_cm2a.config_snapshot as
select * from customer_match_v2.config;

create table codex_backup_cm_20260829_cm2a.batches_snapshot as
select * from customer_match_v2.batches;

create table codex_backup_cm_20260829_cm2a.batch_members_snapshot as
select * from customer_match_v2.batch_members;

create table codex_backup_cm_20260829_cm2a.memberships_snapshot as
select * from customer_match_v2.memberships;

create table codex_backup_cm_20260829_cm2a.consent_receipts_snapshot as
select * from customer_match_v2.consent_receipts;

create table codex_backup_cm_20260829_cm2a.status_snapshot as
select pg_catalog.clock_timestamp() as captured_at, s.*
from public.cm_v2_status_snapshot() s;

revoke all on all tables in schema codex_backup_cm_20260829_cm2a
from public, anon, authenticated, service_role;

create or replace function customer_match_v2.normalize_buyer_email(p_email text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  with cleaned as (
    select pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(p_email), E'\\s+', '', 'g')
    ) as email
  )
  select case
    when email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
      then null
    when email ~ '^[^@]+@(gmail[.]com|googlemail[.]com)$'
      then pg_catalog.replace(
        pg_catalog.regexp_replace(
          pg_catalog.split_part(email, '@', 1),
          E'\\+.*$',
          ''
        ),
        '.',
        ''
      ) || '@' || pg_catalog.split_part(email, '@', 2)
    else email
  end
  from cleaned;
$function$;

comment on function customer_match_v2.normalize_buyer_email(text) is
  'Google Data Manager buyer-email normalization: lowercase and remove whitespace; for gmail.com/googlemail.com only, remove local-part dots and plus suffixes. Domains remain unchanged.';

revoke all on function customer_match_v2.normalize_buyer_email(text)
from public, anon, authenticated, service_role;

create temporary table cm2a_buyer_source_raw on commit drop as
select
  customer_match_v2.normalize_buyer_email(mc.email) as canonical_email,
  pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(mc.email), E'\\s+', '', 'g')
  ) as raw_email,
  'master_orders'::text as source_name,
  coalesce(mo.shopify_created_at, mo.created_at) as seen_at
from public.master_orders mo
join public.master_customers mc on mc.id = mo.customer_id
where mo.status in ('paid', 'partially_paid')
  and mo.cancelled_at is null
  and public._cm_is_valid_email(mc.email)
  and customer_match_v2.normalize_buyer_email(mc.email) is not null
union all
select
  customer_match_v2.normalize_buyer_email(chosen.buyer_email),
  pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(chosen.buyer_email), E'\\s+', '', 'g')
  ),
  'shopify_orders'::text,
  so.created_at
from public.shopify_orders so
cross join lateral (
  select case
    when public._cm_is_valid_email(nullif(pg_catalog.btrim(so.kunde_email), ''))
      then so.kunde_email
    when public._cm_is_valid_email(nullif(pg_catalog.btrim(so.email), ''))
      then so.email
    else null
  end as buyer_email
) chosen
where so.cancelled_at is null
  and pg_catalog.lower(coalesce(so.financial_status, ''))
    in ('paid', 'partially_paid')
  and chosen.buyer_email is not null
  and customer_match_v2.normalize_buyer_email(chosen.buyer_email) is not null;

create temporary table cm2a_recognized_request_consent on commit drop as
with cfg as materialized (
  select c.backfill_as_of
  from customer_match_v2.config c
  where c.config_key = 'default'
),
request_emails as materialized (
  select
    mr.*,
    customer_match_v2.normalize_buyer_email(mc.email) as canonical_email
  from public.master_requests mr
  join public.master_customers mc on mc.id = mr.customer_id
  where public._cm_is_valid_email(mc.email)
)
select
  re.canonical_email,
  max(re.consent_recorded_at) as consent_evidence_at,
  (array_agg(re.consent_source order by re.consent_recorded_at desc))[1] as consent_source,
  (array_agg(re.consent_policy_version order by re.consent_recorded_at desc))[1]
    as consent_policy_version
from request_emails re
cross join cfg
where re.consent_ad_user_data = 'granted'
  and re.consent_ad_personalization = 'granted'
  and re.consent_recorded_at is not null
  and nullif(pg_catalog.btrim(re.consent_source), '') is not null
  and nullif(pg_catalog.btrim(re.consent_policy_version), '') is not null
  and (
    (
      re.form_id = 'landing-page-form'
      and (
        re.landing_page_url is null
        or pg_catalog.btrim(re.landing_page_url) = ''
        or re.landing_page_url ilike '%anfrage.neontrip.de%'
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
          and (re.trello_card_id is not null or re.ac_deal_id is not null)
        )
      )
    )
    or (
      re.form_id = '2418'
      and re.created_at <= cfg.backfill_as_of
    )
  )
group by re.canonical_email;

create temporary table cm2a_buyer_opt_outs on commit drop as
with cfg as materialized (
  select c.backfill_as_of
  from customer_match_v2.config c
  where c.config_key = 'default'
),
request_emails as materialized (
  select
    mr.*,
    customer_match_v2.normalize_buyer_email(mc.email) as canonical_email
  from public.master_requests mr
  join public.master_customers mc on mc.id = mr.customer_id
  where public._cm_is_valid_email(mc.email)
),
consent_events as materialized (
  select re.*
  from request_emails re
  cross join cfg
  where re.consent_recorded_at is not null
    and (
      re.consent_ad_user_data = 'denied'
      or re.consent_ad_personalization = 'denied'
      or (
        re.consent_ad_user_data = 'granted'
        and re.consent_ad_personalization = 'granted'
        and nullif(pg_catalog.btrim(re.consent_source), '') is not null
        and nullif(pg_catalog.btrim(re.consent_policy_version), '') is not null
        and (
          (
            re.form_id = 'landing-page-form'
            and (
              re.landing_page_url is null
              or pg_catalog.btrim(re.landing_page_url) = ''
              or re.landing_page_url ilike '%anfrage.neontrip.de%'
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
                and (re.trello_card_id is not null or re.ac_deal_id is not null)
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
latest as materialized (
  select distinct on (ce.canonical_email)
    ce.canonical_email,
    ce.consent_recorded_at,
    ce.consent_source,
    ce.consent_policy_version,
    (
      ce.consent_ad_user_data = 'denied'
      or ce.consent_ad_personalization = 'denied'
    ) as is_opt_out
  from consent_events ce
  order by
    ce.canonical_email,
    ce.consent_recorded_at desc,
    ce.created_at desc,
    ce.id desc
)
select *
from latest
where is_opt_out;

create temporary table cm2a_receipt_latest_states on commit drop as
with receipt_events as materialized (
  select
    r.email_sha256,
    coalesce(r.revoked_at, r.attested_at) as event_at,
    (
      r.revoked_at is not null
      or r.ad_user_data = 'denied'
      or r.ad_personalization = 'denied'
    ) as is_opt_out,
    r.created_at,
    r.receipt_id
  from customer_match_v2.consent_receipts r
  where coalesce(r.revoked_at, r.attested_at) is not null
),
latest as materialized (
  select distinct on (re.email_sha256)
    re.email_sha256,
    re.event_at,
    re.is_opt_out,
    re.created_at,
    re.receipt_id
  from receipt_events re
  order by re.email_sha256, re.event_at desc, re.created_at desc, re.receipt_id desc
)
select * from latest;

create table codex_backup_cm_20260829_cm2a.buyer_source_hash_snapshot as
select
  pg_catalog.encode(extensions.digest(raw_email, 'sha256'), 'hex') as raw_email_sha256,
  pg_catalog.encode(extensions.digest(canonical_email, 'sha256'), 'hex')
    as canonical_email_sha256,
  source_name,
  min(seen_at) as first_seen_at,
  max(seen_at) as last_seen_at
from cm2a_buyer_source_raw
group by raw_email, canonical_email, source_name;

create table codex_backup_cm_20260829_cm2a.buyer_target_snapshot as
with buyers as materialized (
  select
    canonical_email,
    min(seen_at) as first_seen_at,
    max(seen_at) as last_seen_at,
    bool_or(source_name = 'master_orders') as from_master_orders,
    bool_or(source_name = 'shopify_orders') as from_shopify_orders
  from cm2a_buyer_source_raw
  group by canonical_email
)
select
  pg_catalog.encode(extensions.digest(b.canonical_email, 'sha256'), 'hex')
    as email_sha256,
  b.first_seen_at,
  b.last_seen_at,
  b.from_master_orders,
  b.from_shopify_orders,
  rc.canonical_email is not null as has_recognized_request_consent,
  oo.canonical_email is not null as has_explicit_request_opt_out,
  coalesce(receipt_state.is_opt_out, false) as has_receipt_opt_out,
  exists (
    select 1
    from customer_match_v2.consent_receipts r
    where r.email_sha256 = pg_catalog.encode(
        extensions.digest(b.canonical_email, 'sha256'),
        'hex'
      )
      and r.ad_user_data = 'granted'
      and r.ad_personalization = 'granted'
      and r.revoked_at is null
  ) as has_active_direct_receipt
from buyers b
left join cm2a_recognized_request_consent rc
  on rc.canonical_email = b.canonical_email
left join cm2a_buyer_opt_outs oo
  on oo.canonical_email = b.canonical_email
left join lateral (
  select rs.is_opt_out
  from codex_backup_cm_20260829_cm2a.buyer_source_hash_snapshot s
  join cm2a_receipt_latest_states rs
    on rs.email_sha256 in (
      s.raw_email_sha256,
      s.canonical_email_sha256
    )
  where s.canonical_email_sha256 = pg_catalog.encode(
    extensions.digest(b.canonical_email, 'sha256'),
    'hex'
  )
  order by rs.event_at desc, rs.created_at desc, rs.receipt_id desc
  limit 1
) receipt_state on true;

alter table codex_backup_cm_20260829_cm2a.buyer_target_snapshot
  add primary key (email_sha256);

create table codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot as
with shopify_only as (
  select t.email_sha256, 'shopify_reconciliation'::text as reason
  from codex_backup_cm_20260829_cm2a.buyer_target_snapshot t
  where t.from_shopify_orders
    and not t.from_master_orders
    and not t.has_recognized_request_consent
    and not t.has_active_direct_receipt
    and not t.has_explicit_request_opt_out
    and not t.has_receipt_opt_out
),
gmail_alias as (
  select distinct
    s.canonical_email_sha256 as email_sha256,
    'gmail_canonical_alias'::text as reason
  from codex_backup_cm_20260829_cm2a.buyer_source_hash_snapshot s
  join codex_backup_cm_20260829_cm2a.buyer_target_snapshot t
    on t.email_sha256 = s.canonical_email_sha256
  where s.raw_email_sha256 <> s.canonical_email_sha256
    and not t.has_explicit_request_opt_out
    and not t.has_receipt_opt_out
    and exists (
      select 1
      from customer_match_v2.consent_receipts r
      where r.email_sha256 = s.raw_email_sha256
        and r.ad_user_data = 'granted'
        and r.ad_personalization = 'granted'
        and r.revoked_at is null
        and r.consent_source =
          'account_owner_attested_legacy_checkout_marketing_recovery'
        and r.consent_policy_version =
          'nt_customer_match_legacy_checkout_operator_attestation_v1_20260818'
    )
    and not exists (
      select 1
      from customer_match_v2.consent_receipts r
      where r.email_sha256 = s.canonical_email_sha256
        and r.ad_user_data = 'granted'
        and r.ad_personalization = 'granted'
        and r.revoked_at is null
    )
)
select
  candidate.email_sha256,
  array_agg(distinct candidate.reason order by candidate.reason) as reasons
from (
  select * from shopify_only
  union all
  select * from gmail_alias
) candidate
group by candidate.email_sha256;

alter table codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot
  add primary key (email_sha256);

do $candidate_preflight$
begin
  if not exists (
    select 1
    from codex_backup_cm_20260829_cm2a.buyer_target_snapshot
  ) then
    raise exception 'CM-2A produced an empty buyer target';
  end if;

  if exists (
    select 1
    from codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot c
    join customer_match_v2.consent_receipts r
      on r.email_sha256 = c.email_sha256
     and r.consent_source =
       'account_owner_attested_legacy_checkout_marketing_recovery'
     and r.consent_policy_version =
       'nt_customer_match_legacy_checkout_operator_attestation_v1_20260818'
  ) then
    raise exception 'CM-2A candidate conflicts with an existing legacy receipt key';
  end if;
end;
$candidate_preflight$;

create temporary table cm2a_inserted_receipts on commit drop as
with inserted as (
  insert into customer_match_v2.consent_receipts (
    email_sha256,
    audience_basis,
    ad_user_data,
    ad_personalization,
    attested_at,
    original_consent_at,
    consent_source,
    consent_policy_version,
    evidence
  )
  select
    c.email_sha256,
    'buyer',
    'granted',
    'granted',
    pg_catalog.statement_timestamp(),
    null,
    'account_owner_attested_legacy_checkout_marketing_recovery',
    'nt_customer_match_legacy_checkout_operator_attestation_v1_20260818',
    pg_catalog.jsonb_build_object(
      'attestation_basis', 'account_owner_operator_statement',
      'attestation_statement',
        'Every included buyer completed an ordering path that required consent; an integration failure prevented the consent receipt from being propagated into the current Shopify/customer ledger.',
      'legacy_system', 'pre_offer_ordering_software',
      'shopify_transfer_failed', true,
      'original_receipt_available', false,
      'original_consent_time_available', false,
      'recovery_scope',
        'paid_or_partially_paid_shopify_buyers_missing_recognized_consent_and_canonical_gmail_aliases',
      'recorded_by', 'codex_on_explicit_account_owner_instruction',
      'recorded_date', '2026-08-29',
      'migration', 'customer_match_cm2a_buyer_reconciliation_20260829',
      'candidate_reasons', pg_catalog.to_jsonb(c.reasons),
      'upload_authorized', false
    )
  from codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot c
  on conflict (email_sha256, consent_source, consent_policy_version) do nothing
  returning *
)
select * from inserted;

do $receipt_guard$
declare
  v_candidates bigint;
  v_inserted bigint;
begin
  select count(*) into v_candidates
  from codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot;

  select count(*) into v_inserted
  from cm2a_inserted_receipts;

  if v_inserted <> v_candidates then
    raise exception 'CM-2A receipt insert mismatch: candidates %, inserted %',
      v_candidates, v_inserted;
  end if;
end;
$receipt_guard$;

create or replace function public.cm_v2_refresh_memberships()
returns table(
  audience_key text,
  total_count bigint,
  consent_eligible_count bigint,
  blocked_count bigint,
  pending_count bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'customer_match_v2'
as $function$
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
      mc.source as customer_source
    from public.master_requests mr
    join public.master_customers mc on mc.id = mr.customer_id
    where public._cm_is_valid_email(mc.email)
  ),
  current_lp as materialized (
    select
      re.normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    where re.form_id = 'landing-page-form'
      and (
        re.landing_page_url is null
        or btrim(re.landing_page_url) = ''
        or re.landing_page_url ilike '%anfrage.neontrip.de%'
      )
      and coalesce(re.landing_page_url, '') not ilike '%neontrip-lp.pages.dev%'
    group by re.normalized_email
  ),
  legacy_nerdy as materialized (
    select
      re.normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    cross join cfg
    where re.form_id = '2418'
      and re.created_at <= cfg.backfill_as_of
    group by re.normalized_email
  ),
  genuine_outlook as materialized (
    select
      re.normalized_email,
      min(re.created_at) as first_seen_at,
      max(re.created_at) as last_seen_at
    from request_emails re
    where (
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
    group by re.normalized_email
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
    join receipt_latest_state_by_hash rl
      on rl.email_sha256 in (
        bs.raw_email_sha256,
        encode(extensions.digest(bs.normalized_email, 'sha256'), 'hex')
      )
    order by
      bs.normalized_email,
      rl.consent_evidence_at desc,
      rl.created_at desc,
      rl.receipt_id desc
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
        when d.audience_key = 'buyers'
          and (
            coalesce(bl.consent_denied, false)
            or coalesce(brl.consent_denied, false)
          )
          then false
        else (
          c.normalized_email is not null
          or bc.normalized_email is not null
          or r.email_sha256 is not null
        )
      end as consent_eligible,
      case
        when d.audience_key = 'buyers'
          and coalesce(bl.consent_denied, false)
          then bl.consent_evidence_at
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_evidence_at
        else coalesce(
          bc.consent_evidence_at,
          c.consent_evidence_at,
          r.consent_evidence_at
        )
      end as consent_evidence_at,
      case
        when d.audience_key = 'buyers'
          and coalesce(bl.consent_denied, false)
          then bl.consent_source
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_source
        else coalesce(bc.consent_source, c.consent_source, r.consent_source)
      end as consent_source,
      case
        when d.audience_key = 'buyers'
          and coalesce(bl.consent_denied, false)
          then bl.consent_policy_version
        when d.audience_key = 'buyers'
          and coalesce(brl.consent_denied, false)
          then brl.consent_policy_version
        else coalesce(
          bc.consent_policy_version,
          c.consent_policy_version,
          r.consent_policy_version
        )
      end as consent_policy_version,
      (
        d.audience_key = 'buyers'
        and (
          coalesce(bl.consent_denied, false)
          or coalesce(brl.consent_denied, false)
        )
      ) as consent_denied
    from desired_hashed d
    left join consent_by_email c using (normalized_email)
    left join buyer_consent_by_email bc
      on d.audience_key = 'buyers'
     and bc.normalized_email = d.normalized_email
    left join buyer_latest_consent_by_email bl
      on d.audience_key = 'buyers'
     and bl.normalized_email = d.normalized_email
    left join receipt_consent_by_hash r
      on r.email_sha256 = d.email_sha256
     and (d.audience_key = 'buyers' or not r.buyers_only)
    left join buyer_receipt_latest_state_by_email brl
      on d.audience_key = 'buyers'
     and brl.normalized_email = d.normalized_email
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

alter function public.cm_v2_refresh_memberships() owner to postgres;
revoke all on function public.cm_v2_refresh_memberships()
from public, anon, authenticated;
grant execute on function public.cm_v2_refresh_memberships() to service_role;

create temporary table cm2a_refresh_result on commit drop as
select * from public.cm_v2_refresh_memberships();

-- CM-2A owns only buyers and the derived without-purchase audience. Preserve the
-- three inquiry audiences byte-for-byte even if their normal scheduled refresh
-- has source drift while this migration runs.
update customer_match_v2.memberships m
set
  source_classes = b.source_classes,
  first_seen_at = b.first_seen_at,
  last_seen_at = b.last_seen_at,
  desired_present = b.desired_present,
  consent_eligible = b.consent_eligible,
  consent_evidence_at = b.consent_evidence_at,
  consent_source = b.consent_source,
  consent_policy_version = b.consent_policy_version,
  eligibility_reason = b.eligibility_reason,
  google_state = b.google_state,
  pending_action = b.pending_action,
  sync_state = b.sync_state,
  active_batch_id = b.active_batch_id,
  last_google_request_id = b.last_google_request_id,
  last_terminal_at = b.last_terminal_at,
  last_error = b.last_error,
  created_at = b.created_at,
  updated_at = b.updated_at
from codex_backup_cm_20260829_cm2a.memberships_snapshot b
where b.audience_key in ('all_inquiries', 'current_lp', 'legacy_nerdy')
  and m.audience_key = b.audience_key
  and m.email_sha256 = b.email_sha256;

insert into customer_match_v2.memberships (
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
  active_batch_id,
  last_google_request_id,
  last_terminal_at,
  last_error,
  created_at,
  updated_at
)
select
  b.audience_key,
  b.email_sha256,
  b.source_classes,
  b.first_seen_at,
  b.last_seen_at,
  b.desired_present,
  b.consent_eligible,
  b.consent_evidence_at,
  b.consent_source,
  b.consent_policy_version,
  b.eligibility_reason,
  b.google_state,
  b.pending_action,
  b.sync_state,
  b.active_batch_id,
  b.last_google_request_id,
  b.last_terminal_at,
  b.last_error,
  b.created_at,
  b.updated_at
from codex_backup_cm_20260829_cm2a.memberships_snapshot b
where b.audience_key in ('all_inquiries', 'current_lp', 'legacy_nerdy')
  and not exists (
    select 1
    from customer_match_v2.memberships m
    where m.audience_key = b.audience_key
      and m.email_sha256 = b.email_sha256
  );

delete from customer_match_v2.memberships m
where m.audience_key in ('all_inquiries', 'current_lp', 'legacy_nerdy')
  and not exists (
    select 1
    from codex_backup_cm_20260829_cm2a.memberships_snapshot b
    where b.audience_key = m.audience_key
      and b.email_sha256 = m.email_sha256
  )
  and not exists (
    select 1
    from customer_match_v2.batch_members bm
    where bm.audience_key = m.audience_key
      and bm.email_sha256 = m.email_sha256
  );

do $postconditions$
declare
  v_expected_total bigint;
  v_expected_eligible bigint;
  v_actual_total bigint;
  v_actual_eligible bigint;
  v_actual_blocked bigint;
  v_before_fixed text;
  v_after_fixed text;
  v_before_present bigint;
  v_after_present bigint;
begin
  select
    count(*),
    count(*) filter (
      where not t.has_explicit_request_opt_out
        and not t.has_receipt_opt_out
        and (
          t.has_recognized_request_consent
          or t.has_active_direct_receipt
          or c.email_sha256 is not null
        )
    )
  into v_expected_total, v_expected_eligible
  from codex_backup_cm_20260829_cm2a.buyer_target_snapshot t
  left join codex_backup_cm_20260829_cm2a.receipt_candidate_snapshot c
    using (email_sha256);

  select
    count(*) filter (where desired_present),
    count(*) filter (where desired_present and consent_eligible),
    count(*) filter (where desired_present and not consent_eligible)
  into v_actual_total, v_actual_eligible, v_actual_blocked
  from customer_match_v2.memberships
  where audience_key = 'buyers';

  if v_actual_total <> v_expected_total
    or v_actual_eligible <> v_expected_eligible
    or v_actual_blocked <> v_expected_total - v_expected_eligible then
    raise exception
      'CM-2A buyer postcondition failed: expected %/% eligible, got %/% with % blocked',
      v_expected_total, v_expected_eligible,
      v_actual_total, v_actual_eligible, v_actual_blocked;
  end if;

  if exists (
    select 1
    from codex_backup_cm_20260829_cm2a.buyer_target_snapshot t
    join customer_match_v2.memberships m
      on m.audience_key = 'buyers'
     and m.email_sha256 = t.email_sha256
    where (t.has_explicit_request_opt_out or t.has_receipt_opt_out)
      and (
        m.consent_eligible
        or m.eligibility_reason <> 'explicit_consent_denied'
      )
  ) then
    raise exception 'CM-2A failed to preserve an explicit buyer opt-out';
  end if;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    (pg_catalog.to_jsonb(m) - 'updated_at')::text,
    ',' order by m.audience_key, m.email_sha256
  ), ''))
  into v_before_fixed
  from codex_backup_cm_20260829_cm2a.memberships_snapshot m
  where m.audience_key in ('all_inquiries', 'current_lp', 'legacy_nerdy');

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    (pg_catalog.to_jsonb(m) - 'updated_at')::text,
    ',' order by m.audience_key, m.email_sha256
  ), ''))
  into v_after_fixed
  from customer_match_v2.memberships m
  where m.audience_key in ('all_inquiries', 'current_lp', 'legacy_nerdy');

  if v_before_fixed is distinct from v_after_fixed then
    raise exception 'CM-2A changed a fixed non-buyer audience';
  end if;

  select count(*) filter (where google_state = 'present')
  into v_before_present
  from codex_backup_cm_20260829_cm2a.memberships_snapshot
  where audience_key = 'buyers';

  select count(*) filter (where google_state = 'present')
  into v_after_present
  from customer_match_v2.memberships
  where audience_key = 'buyers';

  if v_before_present <> v_after_present then
    raise exception 'CM-2A changed Google present state: before %, after %',
      v_before_present, v_after_present;
  end if;

  if exists (
    select 1
    from customer_match_v2.config
    where config_key = 'default'
      and uploads_enabled
  ) then
    raise exception 'CM-2A unexpectedly enabled uploads';
  end if;

  if exists (
    select *
    from customer_match_v2.batches
    except
    select *
    from codex_backup_cm_20260829_cm2a.batches_snapshot
  ) or exists (
    select *
    from codex_backup_cm_20260829_cm2a.batches_snapshot
    except
    select *
    from customer_match_v2.batches
  ) then
    raise exception 'CM-2A changed the Google batch ledger';
  end if;

  if exists (
    select *
    from customer_match_v2.batch_members
    except
    select *
    from codex_backup_cm_20260829_cm2a.batch_members_snapshot
  ) or exists (
    select *
    from codex_backup_cm_20260829_cm2a.batch_members_snapshot
    except
    select *
    from customer_match_v2.batch_members
  ) then
    raise exception 'CM-2A changed the Google batch-member ledger';
  end if;

  if exists (
    select *
    from customer_match_v2.config
    except
    select *
    from codex_backup_cm_20260829_cm2a.config_snapshot
  ) or exists (
    select *
    from codex_backup_cm_20260829_cm2a.config_snapshot
    except
    select *
    from customer_match_v2.config
  ) then
    raise exception 'CM-2A changed Customer Match config';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cm_v2_refresh_memberships'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig = array[
        'search_path=pg_catalog, public, extensions, customer_match_v2'
      ]::text[]
      and pg_catalog.has_function_privilege(
        'service_role', p.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege(
        'authenticated', p.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'CM-2A function security contract failed';
  end if;
end;
$postconditions$;

create table codex_backup_cm_20260829_cm2a.inserted_receipts_snapshot as
select * from cm2a_inserted_receipts;

create table codex_backup_cm_20260829_cm2a.post_function_snapshot as
select
  pg_catalog.clock_timestamp() as captured_at,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.proacl as function_acl,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as function_md5,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'cm_v2_refresh_memberships'
  and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

create table codex_backup_cm_20260829_cm2a.post_config_snapshot as
select * from customer_match_v2.config;

create table codex_backup_cm_20260829_cm2a.post_batches_snapshot as
select * from customer_match_v2.batches;

create table codex_backup_cm_20260829_cm2a.post_batch_members_snapshot as
select * from customer_match_v2.batch_members;

create table codex_backup_cm_20260829_cm2a.post_memberships_snapshot as
select * from customer_match_v2.memberships;

create table codex_backup_cm_20260829_cm2a.post_consent_receipts_snapshot as
select * from customer_match_v2.consent_receipts;

create table codex_backup_cm_20260829_cm2a.post_status_snapshot as
select pg_catalog.clock_timestamp() as captured_at, s.*
from public.cm_v2_status_snapshot() s;

revoke all on all tables in schema codex_backup_cm_20260829_cm2a
from public, anon, authenticated, service_role;
