-- Roll back the NEONTRIP cadence/reply-aware database contract.
-- Operational order: first disable the Offers queue seeder and restore the
-- previous n8n workflow version, then apply this SQL. Existing pending rows are
-- retained for human review; no customer state or delivery history is deleted.

begin;

do $followup_cadence_rollback_precondition$
begin
  if exists (
    select 1
    from public.followup_delivery_attempts
    where status = 'processing'
  ) then
    raise exception using
      errcode = '55000',
      message = 'followup_cadence_rollback_requires_idle_delivery_loop';
  end if;
end;
$followup_cadence_rollback_precondition$;

update public.followup_queue
set status = 'human_review',
    processing_started_at = null,
    email_context_decision = 'human_review',
    email_context_reason = 'followup_cadence_rollback',
    last_error = 'Automatic follow-up paused by cadence rollback; manual review is required.',
    last_error_at = now()
where enriched_context->>'cadence_contract' = 'offer_followup_cadence_v1_20260824'
  and sent_at is null
  and cancelled_at is null
  and status in ('pending', 'processing', 'retry', 'error', 'scheduled');

create or replace function public.claim_followup_delivery_candidate(
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 3600);
  candidate public.followup_queue%rowtype;
  attempt public.followup_delivery_attempts%rowtype;
  stale record;
  new_claim_token uuid := gen_random_uuid();
  candidate_email text;
begin
  if safe_execution_id is null then
    raise exception 'workflow_execution_id is required';
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
      attempt_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      stale.id,
      'followup-delivery:' || stale.id::text || ':delivery-unknown:stale-lease',
      'delivery_unknown',
      safe_execution_id,
      jsonb_build_object('reason', 'stale_processing_lease')
    )
    on conflict (event_key) do nothing;
  end loop;

  select queued.*
    into candidate
  from public.followup_queue as queued
  where queued.status = 'pending'
    and queued.scheduled_for <= now()
    and queued.cancelled_at is null
    and queued.sent_at is null
    and queued.followup_type not like 'payment_reminder%'
    and not exists (
      select 1
      from public.followup_delivery_attempts as existing
      where existing.followup_queue_id = queued.id
    )
    and coalesce(
      (
        public.neontrip_get_followup_queue_segmentation_decision(queued.id)
        ->>'send_allowed'
      )::boolean,
      false
    )
  order by coalesce(queued.is_urgent, false) desc, queued.scheduled_for asc, queued.id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'no_candidate',
      'automatic_retry_allowed', false
    );
  end if;

  candidate_email := lower(btrim(coalesce(candidate.customer_email, '')));
  if candidate.request_id is null
     or candidate_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or candidate_email ~ '@(neontrip\.de|riesenobjekte\.de)$'
     or candidate_email ~ '@example\.'
     or candidate_email ~ '@neontrip\.test$' then
    insert into public.followup_delivery_attempts (
      followup_queue_id,
      status,
      claim_token,
      lease_until,
      last_execution_id,
      block_reason
    ) values (
      candidate.id,
      'blocked',
      null,
      null,
      safe_execution_id,
      'invalid_candidate_identity_or_recipient'
    )
    returning * into attempt;

    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          last_error = 'Follow-up candidate identity or recipient failed deterministic validation.',
          last_error_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = 'invalid_candidate_identity_or_recipient'
    where id = candidate.id;

    insert into public.followup_delivery_events (
      attempt_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      attempt.id,
      'followup-delivery:' || attempt.id::text || ':blocked',
      'blocked',
      safe_execution_id,
      jsonb_build_object('reason', 'invalid_candidate_identity_or_recipient')
    );

    return jsonb_build_object(
      'route', 'stop',
      'reason', 'candidate_blocked_for_review',
      'followup_queue_id', candidate.id,
      'automatic_send_allowed', false
    );
  end if;

  insert into public.followup_delivery_attempts (
    followup_queue_id,
    status,
    claim_token,
    claimed_at,
    lease_until,
    last_execution_id
  ) values (
    candidate.id,
    'processing',
    new_claim_token,
    now(),
    now() + make_interval(secs => safe_lease_seconds),
    safe_execution_id
  )
  returning * into attempt;

  update public.followup_queue
    set status = 'processing',
        processing_started_at = now(),
        last_error = null
  where id = candidate.id;

  insert into public.followup_delivery_events (
    attempt_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':claimed',
    'claimed',
    safe_execution_id,
    jsonb_build_object(
      'lease_seconds', safe_lease_seconds,
      'copy_mode', 'deterministic',
      'ai_copy_allowed', false,
      'automatic_send_allowed', true
    )
  );

  return jsonb_build_object(
    'route', 'process',
    'reason', 'claimed',
    'attempt_id', attempt.id,
    'claim_token', attempt.claim_token,
    'followup_queue_id', candidate.id,
    'candidate', to_jsonb(candidate),
    'copy_mode', 'deterministic',
    'ai_copy_allowed', false,
    'automatic_send_allowed', true,
    'automatic_retry_allowed', false
  );
end;
$function$;

comment on function public.claim_followup_delivery_candidate(text, integer) is
  'Claims only segmentation-approved non-payment follow-ups; blocked candidates stay pending and unmutated while lease/idempotency behavior remains unchanged.';

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
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_message_id text := left(nullif(btrim(p_provider_message_id), ''), 2000);
  safe_subject text := left(nullif(btrim(p_email_subject), ''), 250);
  safe_body text := left(nullif(p_email_body, ''), 10000);
  attempt public.followup_delivery_attempts%rowtype;
  source_row public.followup_queue%rowtype;
  next_number integer;
  max_followups integer;
  next_inserted boolean := false;
begin
  if p_followup_queue_id is null or p_claim_token is null
     or safe_message_id is null or safe_execution_id is null
     or safe_subject is null or safe_body is null then
    raise exception 'queue id, claim token, provider message id, execution id, subject and body are required';
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
    from public.followup_delivery_attempts as existing
    where existing.followup_queue_id = p_followup_queue_id;

    if attempt.status = 'sent'
       and attempt.provider_message_id = safe_message_id
       and attempt.last_execution_id = safe_execution_id then
      return jsonb_build_object('completed', false, 'reason', 'already_completed', 'status', attempt.status);
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
        email_context_reason = 'deterministic_preflight_passed'
  where id = p_followup_queue_id
  returning * into source_row;

  if not found then
    raise exception 'Follow-up queue source disappeared during completion';
  end if;

  next_number := coalesce(source_row.followup_number, 1) + 1;
  max_followups := case
    when source_row.segment in ('NT-2', 'NT-8', 'NT-9', 'NT-12', 'NT-15', 'NT-17') then 4
    else 5
  end;

  if next_number <= max_followups then
    insert into public.followup_queue (
      document_id,
      document_name,
      customer_name,
      customer_email,
      customer_company,
      segment,
      anrede,
      is_urgent,
      budget_tier,
      visual_style,
      decision_window_hours,
      value,
      currency,
      followup_type,
      followup_number,
      scheduled_for,
      status,
      retry_count,
      offer_public_url,
      mockup_url,
      mockup_url_2,
      mockup_url_3,
      request_id
    ) values (
      source_row.document_id,
      source_row.document_name,
      source_row.customer_name,
      source_row.customer_email,
      source_row.customer_company,
      source_row.segment,
      source_row.anrede,
      source_row.is_urgent,
      source_row.budget_tier,
      source_row.visual_style,
      source_row.decision_window_hours,
      source_row.value,
      coalesce(source_row.currency, 'EUR'),
      'followup_' || next_number::text,
      next_number,
      now() + interval '72 hours',
      'pending',
      0,
      source_row.offer_public_url,
      source_row.mockup_url,
      source_row.mockup_url_2,
      source_row.mockup_url_3,
      source_row.request_id
    )
    on conflict (document_id, followup_number) do nothing;
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
      'next_followup_number', case when next_inserted then next_number else null end
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'completed', true,
    'reason', 'sent',
    'status', attempt.status,
    'next_followup_inserted', next_inserted,
    'next_followup_number', case when next_inserted then next_number else null end,
    'automatic_retry_allowed', false
  );
end;
$$;

drop function if exists public.apply_followup_reply_decision(
  uuid, uuid, text, text, text, text, numeric, text, text, text, text
);
drop function if exists public.neontrip_get_followup_queue_cadence_decision(uuid);
drop function if exists public.neontrip_followup_business_slot(timestamptz, integer, text);
drop function if exists public.neontrip_followup_safe_timestamptz(text, timestamptz);

revoke all on function public.claim_followup_delivery_candidate(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_followup_delivery_candidate(text, integer)
  to service_role;
grant execute on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  to service_role;

commit;
