-- NEONTRIP offer follow-up cadence and reply-aware delivery.
-- This migration changes no queue rows. It only installs a service-role-only
-- cadence contract and replaces the already active claim/completion RPCs.

do $followup_cadence_precondition$
declare
  claim_oid oid := to_regprocedure(
    'public.claim_followup_delivery_candidate(text,integer)'
  );
  complete_oid oid := to_regprocedure(
    'public.complete_followup_delivery(uuid,uuid,text,text,text,text)'
  );
begin
  if claim_oid is null
     or md5(pg_get_functiondef(claim_oid)) <> '953bbdd417ff10612c658e4ea93cc29c' then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_claim_function_drift';
  end if;

  if complete_oid is null
     or md5(pg_get_functiondef(complete_oid)) <> '98b3c9f0de63f59686e463d48bd242a5' then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_complete_function_drift';
  end if;

  if to_regprocedure(
       'public.neontrip_get_followup_queue_cadence_decision(uuid)'
     ) is not null
     or to_regprocedure(
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)'
     ) is not null then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_contract_already_exists';
  end if;

  if exists (
    select 1
    from public.followup_delivery_attempts
    where status = 'processing'
  ) then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_requires_idle_delivery_loop';
  end if;
end;
$followup_cadence_precondition$;

create function public.neontrip_followup_safe_timestamptz(
  p_value text,
  p_fallback timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
begin
  if nullif(btrim(p_value), '') is null then
    return p_fallback;
  end if;
  return p_value::timestamptz;
exception when others then
  return p_fallback;
end;
$function$;

create function public.neontrip_followup_business_slot(
  p_from timestamptz,
  p_business_days integer,
  p_seed text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
declare
  local_date date := (coalesce(p_from, now()) at time zone 'Europe/Berlin')::date;
  target_date date := local_date;
  remaining integer := greatest(coalesce(p_business_days, 0), 0);
  slot integer := (
    ('x' || substr(md5(coalesce(p_seed, 'neontrip-followup')), 1, 8))::bit(32)::bigint
    % 14
  )::integer;
begin
  while remaining > 0 loop
    target_date := target_date + 1;
    if extract(isodow from target_date) between 1 and 5 then
      remaining := remaining - 1;
    end if;
  end loop;

  while extract(isodow from target_date) not between 1 and 5 loop
    target_date := target_date + 1;
  end loop;

  return (
    target_date::timestamp
    + time '09:00'
    + make_interval(mins => slot * 30)
  ) at time zone 'Europe/Berlin';
end;
$function$;

create function public.neontrip_get_followup_queue_cadence_decision(
  p_followup_queue_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with queue_row as (
    select q.*
    from public.followup_queue q
    where q.id = p_followup_queue_id
    limit 1
  ),
  resolved_request as (
    select mr.*
    from queue_row q
    join lateral (
      select candidate.*
      from public.master_requests candidate
      where candidate.id::text = q.request_id
         or candidate.request_id = q.request_id
      order by (candidate.id::text = q.request_id) desc,
               candidate.created_at desc nulls last
      limit 1
    ) mr on true
  ),
  exact_contract as (
    select p.version, p.taxonomy_version, p.classifier_version, p.prompt_version
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q
      on q.version = p.quality_gate_version
     and q.taxonomy_version = p.taxonomy_version
     and q.classifier_version = p.classifier_version
     and q.prompt_version = p.prompt_version
    where p.version = 'nt_policy_v6_20260821_treatment_shadow'
      and p.active
      and p.mode = 'shadow'
      and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
      and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
      and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
      and q.active
      and (select count(*) from public.segment_policy_versions where active) = 1
      and (select count(*) from public.segment_quality_gate_versions where active) = 1
    limit 1
  ),
  request_state as (
    select
      mr.*,
      public.neontrip_compute_request_segment_input_hash(mr.id) as current_input_hash,
      (
        mr.segment_status = 'accepted'
        and mr.segment_source ~ '^manual_[a-z0-9_]+$'
        and mr.segment_taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and exists (
          select 1
          from public.segment_taxonomy_definitions d
          where d.taxonomy_version = mr.segment_taxonomy_version
            and d.segment = mr.segment
            and d.active
        )
      ) as manual_authoritative
    from resolved_request mr
  ),
  latest_current_classification as (
    select c.*
    from public.request_segment_classifications c
    join request_state rs
      on rs.id = c.request_id
     and rs.current_input_hash = c.input_hash
    join exact_contract ec
      on ec.version = c.policy_version
     and ec.taxonomy_version = c.taxonomy_version
     and ec.classifier_version = c.classifier_version
     and ec.prompt_version = c.prompt_version
    order by c.created_at desc, c.id desc
    limit 1
  ),
  authority as (
    select
      q.id as queue_id,
      q.document_id,
      q.request_id as queue_request_id,
      q.status as queue_status,
      q.sent_at,
      q.cancelled_at,
      q.followup_number,
      q.scheduled_for,
      q.enriched_context,
      rs.id as request_uuid,
      coalesce(rs.manual_authoritative, false) as manual_authoritative,
      rs.segment as manual_segment,
      rs.segment_organization_scale as manual_scale,
      c.id as classification_id,
      c.segment as classification_segment,
      c.organization_scale as classification_scale,
      coalesce(
        c.status = 'shadow'
        and c.segment is not null
        and c.confidence >= 0.80
        and c.mapping_integrity
        and c.classifier_json->>'validator_version' = 'n8n_cx8_validator_v4'
        and c.classifier_json->>'treatment_contract'
          = 'treatment_focus_v2_20260821_always_on'
        and c.classifier_json->>'effective_status' = 'shadow'
        and c.classifier_json->'effective_segment' = 'null'::jsonb
        and c.classifier_json->>'segment' = c.segment
        and c.classifier_json->'db_validation'->'contract_match' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'input_hash_current' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'mapping_integrity' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'context_tags_valid' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'organization_scale_valid' = 'true'::jsonb
        and (
          (
            c.segment = 'NT-8'
            and c.classifier_json->'db_validation'->'first_party_business_choice_valid'
              is distinct from 'true'::jsonb
          )
          or (
            c.organization_scale in ('solo', 'micro', 'small')
            and c.segment not in ('NT-4', 'NT-5', 'NT-6', 'NT-10')
            and c.classifier_json->'db_validation'->'first_party_private_choice_valid'
              is distinct from 'true'::jsonb
          )
        )
        and not (
          coalesce(c.risk_flags, '{}'::text[]) && array[
            'prompt_injection_seen',
            'conflicting_evidence',
            'low_confidence',
            'ambiguous_segment'
          ]::text[]
        ),
        false
      ) as classification_current_valid,
      public.neontrip_followup_safe_timestamptz(
        q.enriched_context->>'first_sent_at',
        coalesce(q.created_at, q.scheduled_for)
      ) as first_sent_at
    from queue_row q
    left join request_state rs on true
    left join latest_current_classification c on true
  ),
  resolved as (
    select
      a.*,
      case
        when manual_authoritative then manual_segment
        when classification_current_valid then classification_segment
        else null
      end as resolved_segment,
      case
        when manual_authoritative then manual_scale
        when classification_current_valid then classification_scale
        else null
      end as resolved_scale,
      case
        when manual_authoritative then 'manual'
        when classification_current_valid then 'ai_shadow'
        else 'none'
      end as source_authority
    from authority a
  ),
  cadence as (
    select
      r.*,
      case
        when source_authority = 'manual'
         and resolved_segment not in ('NT-4', 'NT-5', 'NT-6', 'NT-10')
         and coalesce(resolved_scale, '') not in ('medium', 'large', 'enterprise')
         and (
           resolved_segment in ('NT-8', 'NT-9')
           or resolved_scale in ('solo', 'micro', 'small')
         )
        then 'frequent'
        when source_authority = 'ai_shadow'
         and resolved_segment not in ('NT-4', 'NT-5', 'NT-6', 'NT-10')
         and coalesce(resolved_scale, '') not in ('medium', 'large', 'enterprise')
         and (
           resolved_segment = 'NT-8'
           or resolved_scale in ('solo', 'micro', 'small')
         )
        then 'frequent'
        else 'weekly'
      end as cadence_tier
    from resolved r
  ),
  decision as (
    select
      c.*,
      case when cadence_tier = 'frequent' then 6 else 3 end as max_followups,
      case when cadence_tier = 'frequent' then 2 else 5 end
        as first_delay_business_days,
      case when cadence_tier = 'frequent' then 3 else 5 end
        as next_delay_business_days,
      (
        queue_id is not null
        and request_uuid is not null
        and queue_status in ('pending', 'processing')
        and sent_at is null
        and cancelled_at is null
        and enriched_context->>'cadence_contract'
          = 'offer_followup_cadence_v1_20260824'
      ) as send_allowed
    from cadence c
  )
  select jsonb_build_object(
    'decision_contract_version', 'offer_followup_cadence_v1_20260824',
    'followup_queue_id', p_followup_queue_id,
    'generated_at', now(),
    'send_allowed', coalesce(send_allowed, false),
    'cadence_tier', coalesce(cadence_tier, 'weekly'),
    'max_followups', coalesce(max_followups, 3),
    'first_delay_business_days', coalesce(first_delay_business_days, 5),
    'next_delay_business_days', coalesce(next_delay_business_days, 5),
    'first_due_at', public.neontrip_followup_business_slot(
      coalesce(first_sent_at, now()),
      coalesce(first_delay_business_days, 5),
      coalesce(document_id, p_followup_queue_id::text) || ':first'
    ),
    'source_authority', coalesce(source_authority, 'none'),
    'segment', resolved_segment,
    'organization_scale', resolved_scale,
    'request_id', request_uuid,
    'classification_id', classification_id,
    'reason', case
      when queue_id is null then 'queue_not_found'
      when request_uuid is null then 'request_unresolved'
      when enriched_context->>'cadence_contract'
        <> 'offer_followup_cadence_v1_20260824' then 'queue_contract_mismatch'
      when source_authority = 'manual' and cadence_tier = 'frequent'
        then 'manual_private_or_small'
      when source_authority = 'manual' then 'manual_weekly'
      when source_authority = 'ai_shadow' and cadence_tier = 'frequent'
        then 'verified_private_or_small'
      when source_authority = 'ai_shadow' then 'verified_weekly'
      else 'safe_weekly_default'
    end
  )
  from decision
  union all
  select jsonb_build_object(
    'decision_contract_version', 'offer_followup_cadence_v1_20260824',
    'followup_queue_id', p_followup_queue_id,
    'generated_at', now(),
    'send_allowed', false,
    'cadence_tier', 'weekly',
    'max_followups', 3,
    'first_delay_business_days', 5,
    'next_delay_business_days', 5,
    'first_due_at', null,
    'source_authority', 'none',
    'segment', null,
    'organization_scale', null,
    'request_id', null,
    'classification_id', null,
    'reason', 'queue_not_found'
  )
  where not exists (select 1 from decision)
  limit 1;
$function$;

create or replace function public.claim_followup_delivery_candidate(
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
set search_path = 'public'
as $function$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 3600);
  candidate_id uuid;
  candidate public.followup_queue%rowtype;
  cadence jsonb;
  attempt public.followup_delivery_attempts%rowtype;
  stale record;
  new_claim_token uuid := gen_random_uuid();
  candidate_email text;
  local_now timestamp := now() at time zone 'Europe/Berlin';
  reusable_attempt boolean := false;
begin
  if safe_execution_id is null then
    raise exception 'workflow_execution_id is required';
  end if;

  if extract(isodow from local_now) not between 1 and 5
     or local_now::time < time '09:00'
     or local_now::time >= time '16:00' then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'outside_delivery_window',
      'automatic_retry_allowed', false
    );
  end if;

  for stale in
    update public.followup_delivery_attempts as existing
      set status = 'delivery_unknown',
          claim_token = null,
          lease_until = null,
          last_error_code = 'stale_processing_lease',
          updated_at = now()
    where existing.status = 'processing'
      and existing.lease_until <= now()
    returning existing.*
  loop
    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          last_error = 'A prior Outlook follow-up attempt lost confirmation; manual review is required.',
          last_error_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = 'stale_followup_delivery_lease'
    where id = stale.followup_queue_id
      and status = 'processing';

    insert into public.followup_delivery_events (
      attempt_id, event_key, event_type, workflow_execution_id, metadata
    ) values (
      stale.id,
      'followup-delivery:' || stale.id::text || ':delivery-unknown:stale-lease',
      'delivery_unknown',
      safe_execution_id,
      jsonb_build_object('reason', 'stale_processing_lease')
    ) on conflict (event_key) do nothing;
  end loop;

  select queued.id, decision.value
    into candidate_id, cadence
  from public.followup_queue as queued
  cross join lateral (
    select public.neontrip_get_followup_queue_cadence_decision(queued.id) as value
  ) decision
  where queued.status = 'pending'
    and queued.scheduled_for <= now()
    and queued.cancelled_at is null
    and queued.sent_at is null
    and queued.followup_type not like 'payment_reminder%'
    and queued.enriched_context->>'cadence_contract'
      = 'offer_followup_cadence_v1_20260824'
    and coalesce((decision.value->>'send_allowed')::boolean, false)
    and (
      coalesce(queued.followup_number, 1) <> 1
      or public.neontrip_followup_safe_timestamptz(
        decision.value->>'first_due_at',
        queued.scheduled_for
      ) <= now()
    )
    and coalesce(queued.email_context_delay_until, '-infinity'::timestamptz) <= now()
    and (
      not exists (
        select 1
        from public.followup_delivery_attempts existing
        where existing.followup_queue_id = queued.id
      )
      or exists (
        select 1
        from public.followup_delivery_attempts existing
        where existing.followup_queue_id = queued.id
          and existing.status = 'blocked'
          and existing.block_reason = 'customer_reply_snooze_7_days'
      )
    )
  order by coalesce(queued.is_urgent, false) desc,
           queued.scheduled_for asc,
           queued.id
  for update of queued skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'no_candidate',
      'automatic_retry_allowed', false
    );
  end if;

  select queued.* into strict candidate
  from public.followup_queue queued
  where queued.id = candidate_id;

  candidate_email := lower(btrim(coalesce(candidate.customer_email, '')));
  if candidate.request_id is null
     or candidate_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or candidate_email ~ '@(neontrip\.de|riesenobjekte\.de)$'
     or candidate_email ~ '@example\.'
     or candidate_email ~ '@neontrip\.test$' then
    select existing.* into attempt
    from public.followup_delivery_attempts existing
    where existing.followup_queue_id = candidate.id
    for update;

    if found then
      update public.followup_delivery_attempts
        set status = 'blocked',
            claim_token = null,
            lease_until = null,
            last_execution_id = safe_execution_id,
            block_reason = 'invalid_candidate_identity_or_recipient',
            updated_at = now()
      where id = attempt.id
      returning * into attempt;
    else
      insert into public.followup_delivery_attempts (
        followup_queue_id, status, claim_token, lease_until,
        last_execution_id, block_reason
      ) values (
        candidate.id, 'blocked', null, null,
        safe_execution_id, 'invalid_candidate_identity_or_recipient'
      ) returning * into attempt;
    end if;

    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          last_error = 'Follow-up candidate identity or recipient failed deterministic validation.',
          last_error_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = 'invalid_candidate_identity_or_recipient'
    where id = candidate.id;

    insert into public.followup_delivery_events (
      attempt_id, event_key, event_type, workflow_execution_id, metadata
    ) values (
      attempt.id,
      'followup-delivery:' || attempt.id::text || ':blocked:identity:' || safe_execution_id,
      'blocked',
      safe_execution_id,
      jsonb_build_object('reason', 'invalid_candidate_identity_or_recipient')
    ) on conflict (event_key) do nothing;

    return jsonb_build_object(
      'route', 'stop',
      'reason', 'candidate_blocked_for_review',
      'followup_queue_id', candidate.id,
      'automatic_send_allowed', false
    );
  end if;

  select existing.* into attempt
  from public.followup_delivery_attempts existing
  where existing.followup_queue_id = candidate.id
  for update;
  reusable_attempt := found;

  if reusable_attempt then
    update public.followup_delivery_attempts
      set status = 'processing',
          claim_token = new_claim_token,
          claimed_at = now(),
          lease_until = now() + make_interval(secs => safe_lease_seconds),
          last_execution_id = safe_execution_id,
          provider_message_id = null,
          sent_at = null,
          block_reason = null,
          last_error_code = null,
          updated_at = now()
    where id = attempt.id
      and status = 'blocked'
      and block_reason = 'customer_reply_snooze_7_days'
    returning * into attempt;
    if not found then
      raise exception 'Follow-up reusable claim state changed';
    end if;
  else
    insert into public.followup_delivery_attempts (
      followup_queue_id, status, claim_token, claimed_at,
      lease_until, last_execution_id
    ) values (
      candidate.id, 'processing', new_claim_token, now(),
      now() + make_interval(secs => safe_lease_seconds), safe_execution_id
    ) returning * into attempt;
  end if;

  update public.followup_queue
    set status = 'processing',
        processing_started_at = now(),
        last_error = null,
        email_context_delay_until = null
  where id = candidate.id;

  insert into public.followup_delivery_events (
    attempt_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':claimed:' || safe_execution_id,
    'claimed',
    safe_execution_id,
    jsonb_build_object(
      'lease_seconds', safe_lease_seconds,
      'copy_mode', 'deterministic',
      'ai_copy_allowed', false,
      'automatic_send_allowed', true,
      'reused_after_snooze', reusable_attempt,
      'cadence', cadence
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'route', 'process',
    'reason', 'claimed',
    'attempt_id', attempt.id,
    'claim_token', attempt.claim_token,
    'followup_queue_id', candidate.id,
    'candidate', to_jsonb(candidate),
    'cadence', cadence,
    'copy_mode', 'deterministic',
    'ai_copy_allowed', false,
    'automatic_send_allowed', true,
    'automatic_retry_allowed', false
  );
end;
$function$;

create or replace function public.complete_followup_delivery(
  p_followup_queue_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_workflow_execution_id text,
  p_email_subject text,
  p_email_body text
)
returns jsonb
language plpgsql
set search_path = 'public'
as $function$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_message_id text := left(nullif(btrim(p_provider_message_id), ''), 2000);
  safe_subject text := left(nullif(btrim(p_email_subject), ''), 250);
  safe_body text := left(nullif(p_email_body, ''), 10000);
  attempt public.followup_delivery_attempts%rowtype;
  source_row public.followup_queue%rowtype;
  cadence jsonb;
  next_number integer;
  max_followups integer;
  next_delay_business_days integer;
  next_scheduled_for timestamptz;
  next_inserted boolean := false;
begin
  if p_followup_queue_id is null or p_claim_token is null
     or safe_message_id is null or safe_execution_id is null
     or safe_subject is null or safe_body is null then
    raise exception 'queue id, claim token, provider message id, execution id, subject and body are required';
  end if;

  select existing.* into attempt
  from public.followup_delivery_attempts existing
  where existing.followup_queue_id = p_followup_queue_id;
  if attempt.status = 'sent'
     and attempt.provider_message_id = safe_message_id
     and attempt.last_execution_id = safe_execution_id then
    return jsonb_build_object(
      'completed', false,
      'reason', 'already_completed',
      'status', attempt.status
    );
  end if;

  cadence := public.neontrip_get_followup_queue_cadence_decision(
    p_followup_queue_id
  );
  if cadence->>'decision_contract_version'
       <> 'offer_followup_cadence_v1_20260824'
     or not coalesce((cadence->>'send_allowed')::boolean, false) then
    raise exception 'Follow-up completion cadence contract is unavailable';
  end if;

  update public.followup_delivery_attempts
    set status = 'sent',
        claim_token = null,
        lease_until = null,
        provider_message_id = safe_message_id,
        sent_at = now(),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        updated_at = now()
  where followup_queue_id = p_followup_queue_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into attempt;

  if not found then
    select existing.* into attempt
    from public.followup_delivery_attempts existing
    where existing.followup_queue_id = p_followup_queue_id;

    if attempt.status = 'sent'
       and attempt.provider_message_id = safe_message_id
       and attempt.last_execution_id = safe_execution_id then
      return jsonb_build_object(
        'completed', false,
        'reason', 'already_completed',
        'status', attempt.status
      );
    end if;
    raise exception 'Follow-up completion rejected because the claim is stale or missing';
  end if;

  update public.followup_queue
    set status = 'sent',
        sent_at = now(),
        email_subject = safe_subject,
        email_body = safe_body,
        processing_started_at = null,
        retry_count = coalesce(retry_count, 0),
        last_error = null,
        email_context_decision = 'sent_deterministic',
        email_context_reason = 'deterministic_preflight_passed',
        enriched_context = coalesce(enriched_context, '{}'::jsonb)
          || jsonb_build_object(
            'cadence_contract', 'offer_followup_cadence_v1_20260824',
            'last_followup_sent_at', now(),
            'last_cadence_tier', cadence->>'cadence_tier'
          ),
        context_updated_at = now()
  where id = p_followup_queue_id
  returning * into source_row;

  if not found then
    raise exception 'Follow-up queue source disappeared during completion';
  end if;

  next_number := coalesce(source_row.followup_number, 1) + 1;
  max_followups := least(greatest(
    coalesce((cadence->>'max_followups')::integer, 3), 3
  ), 6);
  next_delay_business_days := case
    when cadence->>'cadence_tier' = 'frequent' then 3
    else 5
  end;
  next_scheduled_for := public.neontrip_followup_business_slot(
    now(),
    next_delay_business_days,
    source_row.document_id || ':' || next_number::text
  );

  if next_number <= max_followups then
    insert into public.followup_queue (
      document_id, document_name, customer_name, customer_email,
      customer_company, segment, anrede, is_urgent, budget_tier,
      visual_style, decision_window_hours, value, currency,
      followup_type, followup_number, scheduled_for, status, retry_count,
      offer_public_url, mockup_url, mockup_url_2, mockup_url_3,
      request_id, enriched_context, context_updated_at
    ) values (
      source_row.document_id,
      source_row.document_name,
      source_row.customer_name,
      source_row.customer_email,
      source_row.customer_company,
      coalesce(cadence->>'segment', source_row.segment),
      source_row.anrede,
      source_row.is_urgent,
      source_row.budget_tier,
      source_row.visual_style,
      source_row.decision_window_hours,
      source_row.value,
      coalesce(source_row.currency, 'EUR'),
      'followup_' || next_number::text,
      next_number,
      next_scheduled_for,
      'pending',
      0,
      source_row.offer_public_url,
      source_row.mockup_url,
      source_row.mockup_url_2,
      source_row.mockup_url_3,
      source_row.request_id,
      source_row.enriched_context,
      now()
    ) on conflict (document_id, followup_number) do nothing;
    next_inserted := found;
  end if;

  insert into public.followup_delivery_events (
    attempt_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':sent',
    'sent',
    safe_execution_id,
    jsonb_build_object(
      'provider', 'outlook',
      'copy_mode', 'deterministic',
      'cadence_tier', cadence->>'cadence_tier',
      'max_followups', max_followups,
      'next_followup_number', case when next_inserted then next_number else null end,
      'next_scheduled_for', case when next_inserted then next_scheduled_for else null end
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'completed', true,
    'reason', 'sent',
    'status', attempt.status,
    'cadence_tier', cadence->>'cadence_tier',
    'max_followups', max_followups,
    'next_followup_inserted', next_inserted,
    'next_followup_number', case when next_inserted then next_number else null end,
    'next_scheduled_for', case when next_inserted then next_scheduled_for else null end,
    'automatic_retry_allowed', false
  );
end;
$function$;

create function public.apply_followup_reply_decision(
  p_followup_queue_id uuid,
  p_claim_token uuid,
  p_offer_id text,
  p_workflow_execution_id text,
  p_decision text,
  p_reason_code text,
  p_confidence numeric,
  p_evidence_quote text,
  p_reply_excerpt text,
  p_reply_message_id text,
  p_classifier_contract text
)
returns jsonb
language plpgsql
set search_path = 'public'
as $function$
declare
  safe_offer_id text := left(nullif(btrim(p_offer_id), ''), 200);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_decision text := upper(nullif(btrim(p_decision), ''));
  safe_reason text := lower(nullif(btrim(p_reason_code), ''));
  safe_quote text := left(nullif(btrim(p_evidence_quote), ''), 300);
  safe_excerpt text := left(nullif(btrim(p_reply_excerpt), ''), 2000);
  safe_message_id text := left(nullif(btrim(p_reply_message_id), ''), 1000);
  safe_contract text := nullif(btrim(p_classifier_contract), '');
  normalized_quote text;
  normalized_excerpt text;
  attempt public.followup_delivery_attempts%rowtype;
  source_row public.followup_queue%rowtype;
  reply_snapshot jsonb;
  snoozed_until timestamptz;
begin
  if p_followup_queue_id is null or p_claim_token is null
     or safe_offer_id is null or safe_execution_id is null
     or safe_decision not in ('DECLINED', 'SNOOZE_7_DAYS', 'MANUAL_REVIEW')
     or safe_reason is null or safe_quote is null or safe_excerpt is null
     or safe_message_id is null
     or safe_contract <> 'followup_reply_classifier_v1_20260824'
     or p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'Follow-up reply decision payload is invalid';
  end if;

  if safe_reason not in (
    'explicit_decline', 'bought_elsewhere', 'do_not_contact',
    'needs_time', 'waiting_for_customer', 'project_delayed',
    'question_or_change', 'positive_interest', 'auto_reply', 'ambiguous'
  ) then
    raise exception 'Follow-up reply reason code is invalid';
  end if;

  normalized_quote := lower(regexp_replace(safe_quote, '\s+', ' ', 'g'));
  normalized_excerpt := lower(regexp_replace(safe_excerpt, '\s+', ' ', 'g'));
  if position(normalized_quote in normalized_excerpt) = 0 then
    raise exception 'Follow-up reply evidence quote is not present in the reply';
  end if;

  if safe_decision = 'DECLINED' then
    if p_confidence < 0.90
       or safe_reason not in ('explicit_decline', 'bought_elsewhere', 'do_not_contact')
       or normalized_quote ~ '(noch|bisher)[[:space:]]+nicht[[:space:]]+(abgesagt|abgelehnt)'
       or normalized_quote ~ 'keine[[:space:]]+absage|nicht[[:space:]]+(abgesagt|abgelehnt)'
       or normalized_quote !~ (
         'kein(e[[:alpha:]]*)?[[:space:]]+(interesse|bedarf)'
         || '|hat[[:space:]]+(abgesagt|abgelehnt)'
         || '|(anderweitig|woanders).*(vergeben|bestellt|gekauft|beauftragt)'
         || '|bitte.*(keine|nicht).*(e-?mails?|nachrichten|kontakt)'
         || '|nicht[[:space:]]+mehr[[:space:]]+(kontaktieren|anschreiben|benötigt|benoetigt)'
         || '|do[[:space:]]+not[[:space:]]+contact|not[[:space:]]+interested'
         || '|will[[:space:]]+not[[:space:]]+proceed|won''t[[:space:]]+proceed'
         || '|went[[:space:]]+with[[:space:]]+another|cancelled|canceled|declined'
       ) then
      raise exception 'Automatic lost decision lacks deterministic decline evidence';
    end if;
  elsif safe_decision = 'SNOOZE_7_DAYS' then
    if p_confidence < 0.80
       or safe_reason not in ('needs_time', 'waiting_for_customer', 'project_delayed')
       or normalized_quote !~ (
         '(braucht|brauchen|benötigt|benoetigt).*(noch|mehr)?[[:space:]]*zeit'
         || '|(noch[[:space:]]+)?(keine|keinen)[[:space:]]+(rückmeldung|rueckmeldung|antwort|entscheidung)'
         || '|hat[[:space:]]+sich[[:space:]]+(noch[[:space:]]+)?nicht[[:space:]]+gemeldet'
         || '|(warten|warte|wartet).*(auf|rückmeldung|rueckmeldung)'
         || '|(nächste|naechste|kommende)[[:space:]]+woche'
         || '|(später|spaeter).*(melden|nachfragen)'
         || '|projekt.*(verschoben|verzögert|verzoegert|pausiert)'
       ) then
      raise exception 'Automatic snooze decision lacks deterministic timing evidence';
    end if;
  end if;

  select q.* into source_row
  from public.followup_queue q
  where q.id = p_followup_queue_id
    and q.document_id = safe_offer_id
  for update;
  if not found then
    raise exception 'Follow-up reply offer and queue do not match';
  end if;

  select existing.* into attempt
  from public.followup_delivery_attempts existing
  where existing.followup_queue_id = p_followup_queue_id
  for update;

  if attempt.id is null
     or attempt.status <> 'processing'
     or attempt.claim_token <> p_claim_token then
    if source_row.email_context_snapshot->>'reply_workflow_execution_id'
         = safe_execution_id
       and source_row.email_context_snapshot->>'decision' = safe_decision then
      return jsonb_build_object(
        'applied', false,
        'reason', 'already_applied',
        'decision', safe_decision,
        'queue_status', source_row.status
      );
    end if;
    raise exception 'Follow-up reply decision rejected because the claim is stale or missing';
  end if;

  reply_snapshot := jsonb_build_object(
    'classifier_contract', safe_contract,
    'decision', safe_decision,
    'reason_code', safe_reason,
    'confidence', p_confidence,
    'evidence_quote', safe_quote,
    'reply_message_id', safe_message_id,
    'reply_workflow_execution_id', safe_execution_id,
    'applied_at', now()
  );

  update public.followup_delivery_attempts
    set status = 'blocked',
        claim_token = null,
        lease_until = null,
        block_reason = 'customer_reply_' || lower(safe_decision),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        updated_at = now()
  where id = attempt.id
  returning * into attempt;

  if safe_decision = 'DECLINED' then
    update public.followup_queue
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = 'customer_declined',
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'customer_declined',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = null,
          last_error = null
    where document_id = source_row.document_id
      and followup_type not like 'payment_reminder%'
      and sent_at is null
      and status in ('pending', 'processing', 'human_review', 'error', 'retry', 'scheduled');
  elsif safe_decision = 'SNOOZE_7_DAYS' then
    snoozed_until := public.neontrip_followup_business_slot(
      now(),
      5,
      source_row.document_id || ':reply-snooze:' || safe_execution_id
    );
    update public.followup_queue
      set status = 'pending',
          scheduled_for = snoozed_until,
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'snoozed_7_days',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = snoozed_until,
          last_error = null
    where id = source_row.id;
  else
    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = null,
          last_error = 'Customer reply requires human handling before another follow-up.'
    where id = source_row.id;
  end if;

  insert into public.followup_delivery_events (
    attempt_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':reply:' || safe_execution_id,
    'blocked',
    safe_execution_id,
    reply_snapshot || jsonb_build_object(
      'snoozed_until', snoozed_until,
      'automatic_send_allowed', false
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'applied', true,
    'reason', 'reply_decision_applied',
    'decision', safe_decision,
    'queue_status', case
      when safe_decision = 'DECLINED' then 'cancelled'
      when safe_decision = 'SNOOZE_7_DAYS' then 'pending'
      else 'human_review'
    end,
    'snoozed_until', snoozed_until,
    'automatic_send_allowed', false
  );
end;
$function$;

comment on function public.neontrip_get_followup_queue_cadence_decision(uuid) is
  'Service-only NEONTRIP offer follow-up cadence: weekly x3 for agency/institution/large or uncertain, frequent x6 for verified private/small.';
comment on function public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text) is
  'Claim-bound reply action: explicit decline, seven-day snooze, or human review. AI output is revalidated deterministically.';
comment on function public.claim_followup_delivery_candidate(text,integer) is
  'Claims one due NEONTRIP offer follow-up only on weekdays 09:00-16:00 Europe/Berlin, including safe snooze reclaims.';
comment on function public.complete_followup_delivery(uuid,uuid,text,text,text,text) is
  'Completes one confirmed Outlook delivery and schedules the next cadence-bound business-day follow-up.';

revoke all on function public.neontrip_followup_safe_timestamptz(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.neontrip_followup_business_slot(timestamptz,integer,text)
  from public, anon, authenticated;
revoke all on function public.neontrip_get_followup_queue_cadence_decision(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.claim_followup_delivery_candidate(text,integer)
  from public, anon, authenticated;
revoke all on function public.complete_followup_delivery(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.neontrip_followup_safe_timestamptz(text,timestamptz)
  to service_role;
grant execute on function public.neontrip_followup_business_slot(timestamptz,integer,text)
  to service_role;
grant execute on function public.neontrip_get_followup_queue_cadence_decision(uuid)
  to service_role;
grant execute on function public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)
  to service_role;
grant execute on function public.claim_followup_delivery_candidate(text,integer)
  to service_role;
grant execute on function public.complete_followup_delivery(uuid,uuid,text,text,text,text)
  to service_role;

do $followup_cadence_postcondition$
begin
  if to_regprocedure(
       'public.neontrip_get_followup_queue_cadence_decision(uuid)'
     ) is null
     or to_regprocedure(
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_functions_missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     ) then
    raise exception using
      errcode = '55000',
      message = 'followup_reply_decision_acl_failed';
  end if;
end;
$followup_cadence_postcondition$;
