create table if not exists public.email_agent_retry_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  message_id text,
  event_type text not null,
  attempt_count integer not null,
  worker_execution_id text,
  reason text,
  occurred_at timestamptz not null default now(),
  constraint email_agent_retry_events_event_type_check check (
    event_type in (
      'claimed',
      'recovered',
      'suppressed_existing_draft',
      'failed_retryable',
      'failed_final'
    )
  ),
  constraint email_agent_retry_events_attempt_count_check check (
    attempt_count >= 1 and attempt_count <= 20
  ),
  constraint email_agent_retry_events_reason_length_check check (
    reason is null or length(reason) <= 1500
  )
);

create index if not exists email_agent_retry_events_request_time_idx
  on public.email_agent_retry_events (request_id, occurred_at desc);

create index if not exists email_agent_retry_events_type_time_idx
  on public.email_agent_retry_events (event_type, occurred_at desc);

alter table public.email_agent_retry_events enable row level security;

drop policy if exists email_agent_retry_events_service_role_all
  on public.email_agent_retry_events;
create policy email_agent_retry_events_service_role_all
  on public.email_agent_retry_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.email_agent_retry_events from public, anon, authenticated;
grant select, insert on public.email_agent_retry_events to service_role;
grant usage, select on sequence public.email_agent_retry_events_id_seq to service_role;

create or replace function public.claim_due_email_agent_retry(
  p_worker_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  candidate public.email_locks%rowtype;
  lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 300), 1800);
begin
  if exists (
    select 1
    from public.email_agent_retry_events as claimed_event
    join public.email_locks as active_lock
      on active_lock.request_id = claimed_event.request_id
    where claimed_event.event_type = 'claimed'
      and active_lock.status = 'processing'
      and active_lock.lease_until > now()
      and not exists (
        select 1
        from public.email_agent_retry_events as later_event
        where later_event.request_id = claimed_event.request_id
          and later_event.id > claimed_event.id
      )
  ) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'retry_worker_busy',
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  update public.email_locks
  set status = 'failed_final',
      lease_until = null,
      next_retry_at = null,
      last_error = coalesce(last_error, 'Retry attempt limit reached'),
      updated_at = now()
  where status in ('failed_retryable', 'processing')
    and attempt_count >= 5
    and (
      (status = 'failed_retryable' and coalesce(next_retry_at, now()) <= now())
      or (status = 'processing' and coalesce(lease_until, '-infinity'::timestamptz) <= now())
    );

  select lock.*
  into candidate
  from public.email_locks as lock
  where lock.attempt_count < 5
    and (
      (
        lock.status = 'failed_retryable'
        and coalesce(lock.next_retry_at, now()) <= now()
      )
      or (
        lock.status = 'processing'
        and lock.lease_until is not null
        and lock.lease_until <= now()
      )
    )
  order by
    case when lock.status = 'failed_retryable' then 0 else 1 end,
    coalesce(lock.next_retry_at, lock.lease_until, lock.updated_at),
    lock.request_id
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no_due_retry',
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  update public.email_locks
  set status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      lease_until = now() + make_interval(secs => lease_seconds),
      next_retry_at = null,
      updated_at = now()
  where request_id = candidate.request_id
  returning * into candidate;

  insert into public.email_agent_retry_events (
    request_id,
    message_id,
    event_type,
    attempt_count,
    worker_execution_id,
    reason
  ) values (
    candidate.request_id,
    candidate.message_id,
    'claimed',
    candidate.attempt_count,
    nullif(btrim(p_worker_execution_id), ''),
    'database_backed_retry_claim'
  );

  return jsonb_build_object(
    'claimed', true,
    'reason', 'due_retry',
    'request_id', candidate.request_id,
    'message_id', candidate.message_id,
    'internet_message_id', candidate.internet_message_id,
    'conversation_id', candidate.conversation_id,
    'attempt_count', candidate.attempt_count,
    'worker_execution_id', nullif(btrim(p_worker_execution_id), ''),
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

create or replace function public.finalize_email_agent_retry_without_new_draft(
  p_request_id text,
  p_reason text,
  p_existing_draft_id text default null,
  p_worker_execution_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_lock public.email_locks%rowtype;
  existing_draft_id text := nullif(btrim(p_existing_draft_id), '');
  safe_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'retry_not_processable'), 1500);
  resulting_status text;
begin
  select *
  into current_lock
  from public.email_locks
  where request_id = p_request_id
  for update;

  if not found then
    raise exception 'Unknown email retry request_id';
  end if;

  resulting_status := case when existing_draft_id is not null then 'draft_created' else 'failed_final' end;

  update public.email_locks
  set status = resulting_status,
      draft_id = coalesce(existing_draft_id, draft_id),
      lease_until = null,
      next_retry_at = null,
      last_error = case
        when existing_draft_id is not null then 'Retry suppressed because an Outlook draft already exists'
        else safe_reason
      end,
      updated_at = now()
  where request_id = p_request_id;

  update public.email_agent_log
  set draft_created = case when existing_draft_id is not null then true else draft_created end,
      draft_id = coalesce(existing_draft_id, draft_id),
      error_message = case
        when existing_draft_id is not null then 'RETRY_SUPPRESSED_EXISTING_DRAFT'
        else safe_reason
      end,
      review_status = case when existing_draft_id is not null then 'pending_review' else 'failed' end,
      context_snapshot = coalesce(context_snapshot, '{}'::jsonb) || jsonb_build_object(
        'retry_recovery',
        jsonb_build_object(
          'version', 'email-agent-retry-recovery-v1',
          'outcome', case when existing_draft_id is not null then 'suppressed_existing_draft' else 'failed_final' end,
          'attempt_count', current_lock.attempt_count,
          'worker_execution_id', nullif(btrim(p_worker_execution_id), ''),
          'automatic_send_allowed', false,
          'human_approval_required', true
        )
      ),
      updated_at = now()
  where request_id = p_request_id
     or message_id = current_lock.message_id;

  insert into public.email_agent_retry_events (
    request_id,
    message_id,
    event_type,
    attempt_count,
    worker_execution_id,
    reason
  ) values (
    current_lock.request_id,
    current_lock.message_id,
    case when existing_draft_id is not null then 'suppressed_existing_draft' else 'failed_final' end,
    current_lock.attempt_count,
    nullif(btrim(p_worker_execution_id), ''),
    safe_reason
  );

  return jsonb_build_object(
    'finalized', true,
    'status', resulting_status,
    'request_id', current_lock.request_id,
    'draft_id', existing_draft_id,
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

create or replace function public.complete_email_agent_retry_message(
  p_request_id text,
  p_record jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  attempt integer;
  worker_execution_id text;
begin
  select attempt_count
  into attempt
  from public.email_locks
  where request_id = p_request_id;

  worker_execution_id := nullif(
    btrim(p_record->'context_snapshot'->'retry_recovery'->>'worker_execution_id'),
    ''
  );

  result := public.complete_email_agent_message(p_request_id, p_record);

  insert into public.email_agent_retry_events (
    request_id,
    message_id,
    event_type,
    attempt_count,
    worker_execution_id,
    reason
  ) values (
    p_request_id,
    nullif(p_record->>'message_id', ''),
    'recovered',
    greatest(coalesce(attempt, 1), 1),
    worker_execution_id,
    'outlook_draft_created_human_review_required'
  );

  return result || jsonb_build_object(
    'retry_recovered', true,
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

create or replace function public.fail_email_agent_message(
  p_request_id text,
  p_record jsonb,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  attempt integer;
  final_status text;
  created_draft_id text := nullif(p_record->>'draft_id', '');
  draft_already_created boolean := coalesce((p_record->>'draft_created')::boolean, false)
    and created_draft_id is not null;
  retry_worker_execution_id text := nullif(
    btrim(p_record->'context_snapshot'->'retry_recovery'->>'worker_execution_id'),
    ''
  );
begin
  select attempt_count into attempt
  from public.email_locks
  where request_id = p_request_id
  for update;

  attempt := coalesce(attempt, 1);
  final_status := case
    when draft_already_created then 'draft_created'
    when p_retryable and attempt < 5 then 'failed_retryable'
    else 'failed_final'
  end;

  update public.email_locks
  set status = final_status,
      draft_id = coalesce(created_draft_id, draft_id),
      lease_until = null,
      next_retry_at = case
        when final_status = 'failed_retryable' then now() + make_interval(mins => least(30, greatest(2, attempt * 3)))
        else null
      end,
      last_error = left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
      updated_at = now()
  where request_id = p_request_id;

  insert into public.email_agent_log (
    message_id, conversation_id, from_email, from_name, subject, body_preview,
    category, confidence, order_found, order_count, draft_created, draft_id,
    draft_body_preview, error_message, processing_time_ms, request_id,
    internet_message_id, message_source, latest_message_fingerprint,
    reply_length_class, risk_level, validation_reasons, context_snapshot,
    review_status, updated_at
  ) values (
    p_record->>'message_id', nullif(p_record->>'conversation_id', ''), p_record->>'from_email',
    nullif(p_record->>'from_name', ''), nullif(p_record->>'subject', ''), nullif(p_record->>'body_preview', ''),
    coalesce(nullif(p_record->>'category', ''), 'general'), nullif(p_record->>'confidence', '')::double precision,
    coalesce((p_record->>'order_found')::boolean, false), coalesce((p_record->>'order_count')::integer, 0),
    coalesce((p_record->>'draft_created')::boolean, false), created_draft_id,
    nullif(p_record->>'draft_body_preview', ''), left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
    nullif(p_record->>'processing_time_ms', '')::integer, p_request_id,
    nullif(p_record->>'internet_message_id', ''), nullif(p_record->>'message_source', ''),
    nullif(p_record->>'latest_message_fingerprint', ''), nullif(p_record->>'reply_length_class', ''),
    nullif(p_record->>'risk_level', ''), '{}', coalesce(p_record->'context_snapshot', '{}'::jsonb),
    case when draft_already_created then 'pending_review' else 'failed' end, now()
  )
  on conflict (message_id) do update
  set draft_created = excluded.draft_created,
      draft_id = excluded.draft_id,
      draft_body_preview = excluded.draft_body_preview,
      error_message = excluded.error_message,
      processing_time_ms = excluded.processing_time_ms,
      request_id = excluded.request_id,
      internet_message_id = excluded.internet_message_id,
      message_source = excluded.message_source,
      latest_message_fingerprint = excluded.latest_message_fingerprint,
      reply_length_class = excluded.reply_length_class,
      risk_level = excluded.risk_level,
      context_snapshot = coalesce(email_agent_log.context_snapshot, '{}'::jsonb)
        || excluded.context_snapshot,
      review_status = excluded.review_status,
      updated_at = now();

  if retry_worker_execution_id is not null then
    insert into public.email_agent_retry_events (
      request_id,
      message_id,
      event_type,
      attempt_count,
      worker_execution_id,
      reason
    ) values (
      p_request_id,
      nullif(p_record->>'message_id', ''),
      case
        when final_status = 'draft_created' then 'suppressed_existing_draft'
        when final_status = 'failed_retryable' then 'failed_retryable'
        else 'failed_final'
      end,
      greatest(attempt, 1),
      retry_worker_execution_id,
      left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500)
    );
  end if;

  return jsonb_build_object(
    'failed', not draft_already_created,
    'reconciled_existing_created_draft', draft_already_created,
    'status', final_status,
    'attempt_count', attempt,
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

create or replace function public.get_email_agent_retry_health()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'version', 'email-agent-retry-health-v1',
    'due_retry_count', count(*) filter (
      where status = 'failed_retryable' and coalesce(next_retry_at, now()) <= now()
    ),
    'scheduled_retry_count', count(*) filter (
      where status = 'failed_retryable' and next_retry_at > now()
    ),
    'stale_processing_count', count(*) filter (
      where status = 'processing' and lease_until is not null and lease_until <= now()
    ),
    'failed_final_count', count(*) filter (where status = 'failed_final'),
    'oldest_due_at', min(coalesce(next_retry_at, lease_until)) filter (
      where (
        status = 'failed_retryable' and coalesce(next_retry_at, now()) <= now()
      ) or (
        status = 'processing' and lease_until is not null and lease_until <= now()
      )
    ),
    'recovered_24h', (
      select count(*)
      from public.email_agent_retry_events
      where event_type in ('recovered', 'suppressed_existing_draft')
        and occurred_at >= now() - interval '24 hours'
    ),
    'retry_failures_24h', (
      select count(*)
      from public.email_agent_retry_events
      where event_type in ('failed_retryable', 'failed_final')
        and occurred_at >= now() - interval '24 hours'
    ),
    'automatic_send_allowed', false,
    'human_approval_required', true
  )
  from public.email_locks;
$$;

revoke all on function public.claim_due_email_agent_retry(text, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_email_agent_retry_without_new_draft(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_email_agent_retry_message(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_email_agent_retry_health()
  from public, anon, authenticated;

grant execute on function public.claim_due_email_agent_retry(text, integer) to service_role;
grant execute on function public.finalize_email_agent_retry_without_new_draft(text, text, text, text) to service_role;
grant execute on function public.complete_email_agent_retry_message(text, jsonb) to service_role;
grant execute on function public.get_email_agent_retry_health() to service_role;

comment on function public.claim_due_email_agent_retry(text, integer) is
  'Atomically claims one due email-agent retry or expired processing lease. Draft-only; no send capability.';
comment on function public.finalize_email_agent_retry_without_new_draft(text, text, text, text) is
  'Stops a retry safely when the source is no longer processable or an Outlook draft already exists.';
comment on function public.complete_email_agent_retry_message(text, jsonb) is
  'Completes a recovered email-agent attempt and records an auditable retry outcome.';
comment on function public.get_email_agent_retry_health() is
  'Returns content-free retry health metrics for the operational dashboard.';
