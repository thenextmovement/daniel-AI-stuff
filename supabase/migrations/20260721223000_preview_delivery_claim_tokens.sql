-- Token-bound preview delivery leases. A stale execution must never finish a
-- job after another worker has received a newer lease.

alter table public.preview_delivery_jobs
  add column if not exists claim_token uuid,
  add column if not exists last_finish_token uuid,
  add column if not exists last_finish_execution_id text;

create index if not exists preview_delivery_jobs_claim_token_idx
  on public.preview_delivery_jobs (claim_token)
  where claim_token is not null;

create table if not exists public.preview_delivery_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.preview_delivery_jobs(id) on delete restrict,
  claim_token uuid,
  event_key text not null unique,
  event_type text not null check (
    event_type in (
      'claimed', 'sent', 'retry', 'failed', 'blocked', 'abandoned',
      'stale_finish_rejected', 'delivery_receipt_rejected'
    )
  ),
  workflow_execution_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists preview_delivery_job_events_job_idx
  on public.preview_delivery_job_events (job_id, created_at desc);

alter table public.preview_delivery_job_events enable row level security;

revoke all on table public.preview_delivery_jobs
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.preview_delivery_jobs
  to service_role;

revoke all on table public.preview_delivery_job_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.preview_delivery_job_events
  to service_role;

create or replace function public.claim_next_preview_delivery_job_v2(
  p_worker_id text,
  p_workflow_execution_id text,
  p_lease_seconds integer default 7200,
  p_max_active integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_worker_id text := left(nullif(btrim(p_worker_id), ''), 200);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 7200), 60), 14400);
  max_active integer := least(greatest(coalesce(p_max_active, 3), 1), 10);
  new_claim_token uuid := gen_random_uuid();
  claimed public.preview_delivery_jobs%rowtype;
  active_leases integer;
  finalized_stale integer := 0;
begin
  if safe_worker_id is null or safe_execution_id is null then
    raise exception 'worker_id and workflow_execution_id are required';
  end if;

  -- HTTP claim retries for the same n8n execution must return the original
  -- lease rather than consume another queue row.
  perform pg_advisory_xact_lock(hashtextextended(safe_execution_id, 0));
  select * into claimed
  from public.preview_delivery_jobs
  where status in ('leased', 'processing')
    and n8n_execution_id = safe_execution_id
    and lock_owner = safe_worker_id
    and claim_token is not null
    and lease_until > now()
  order by locked_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'job', to_jsonb(claimed),
      'claim_token', claimed.claim_token,
      'reason', 'existing_execution_claim',
      'idempotent', true,
      'automatic_retry_allowed', false
    );
  end if;

  update public.preview_delivery_jobs
  set status = 'failed',
      failed_at = coalesce(failed_at, now()),
      lock_owner = null,
      locked_at = null,
      lease_until = null,
      claim_token = null,
      last_error_code = coalesce(last_error_code, 'preview_delivery_attempts_exhausted'),
      last_error_message = coalesce(
        nullif(last_error_message, ''),
        'Preview delivery lease expired after all attempts were exhausted.'
      ),
      metadata = metadata || jsonb_build_object('stale_exhausted_lease_finalized_at', now())
  where status in ('leased', 'processing')
    and (lease_until is null or lease_until <= now())
    and attempts >= max_attempts;

  get diagnostics finalized_stale = row_count;

  select count(*)::integer
  into active_leases
  from public.preview_delivery_jobs
  where status in ('leased', 'processing')
    and lease_until is not null
    and lease_until > now();

  if active_leases >= max_active then
    return jsonb_build_object(
      'ok', true,
      'job', null,
      'reason', 'worker_capacity_full',
      'active_leases', active_leases,
      'max_active', max_active,
      'finalized_stale_leases', finalized_stale
    );
  end if;

  with candidate as (
    select id
    from public.preview_delivery_jobs
    where attempts < max_attempts
      and (
        (status in ('pending', 'retry') and next_attempt_at <= now())
        or (status in ('leased', 'processing') and lease_until is not null and lease_until <= now())
      )
    order by priority desc, entered_at asc, queue_seq asc
    for update skip locked
    limit 1
  )
  update public.preview_delivery_jobs as job
  set status = 'leased',
      lock_owner = safe_worker_id,
      locked_at = now(),
      lease_until = now() + make_interval(secs => safe_lease_seconds),
      claim_token = new_claim_token,
      n8n_execution_id = safe_execution_id,
      attempts = job.attempts + 1,
      last_error_code = null,
      last_error_message = null
  from candidate
  where job.id = candidate.id
  returning job.* into claimed;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'job', null,
      'reason', 'queue_empty',
      'active_leases', active_leases,
      'max_active', max_active,
      'finalized_stale_leases', finalized_stale
    );
  end if;

  insert into public.preview_delivery_job_events (
    job_id, claim_token, event_key, event_type, workflow_execution_id, metadata
  ) values (
    claimed.id,
    claimed.claim_token,
    'preview-delivery-job:' || claimed.id::text || ':claim:' || claimed.claim_token::text,
    'claimed',
    safe_execution_id,
    jsonb_build_object(
      'worker_id', safe_worker_id,
      'lease_until', claimed.lease_until,
      'attempt', claimed.attempts,
      'max_attempts', claimed.max_attempts
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'job', to_jsonb(claimed),
    'claim_token', claimed.claim_token,
    'automatic_retry_allowed', false,
    'active_leases_before_claim', active_leases,
    'max_active', max_active,
    'finalized_stale_leases', finalized_stale
  );
end;
$$;

create or replace function public.finish_preview_delivery_job_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_workflow_execution_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  requested_status text := lower(nullif(btrim(p_status), ''));
  effective_status text;
  next_attempt timestamptz;
  current_job public.preview_delivery_jobs%rowtype;
  updated public.preview_delivery_jobs%rowtype;
  safe_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_job_id is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'job_id, claim_token and workflow_execution_id are required';
  end if;
  if requested_status not in ('retry', 'sent', 'failed', 'blocked', 'abandoned') then
    raise exception 'Unsupported preview delivery job finish status: %', requested_status;
  end if;

  select * into current_job
  from public.preview_delivery_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'job_not_found', 'job_id', p_job_id);
  end if;

  if current_job.status not in ('leased', 'processing')
     and current_job.last_finish_token = p_claim_token
     and current_job.last_finish_execution_id = safe_execution_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'reason', 'already_finished',
      'job', to_jsonb(current_job)
    );
  end if;

  if current_job.status not in ('leased', 'processing')
     or current_job.claim_token is distinct from p_claim_token then
    insert into public.preview_delivery_job_events (
      job_id, claim_token, event_key, event_type, workflow_execution_id, metadata
    ) values (
      current_job.id,
      p_claim_token,
      'preview-delivery-job:' || current_job.id::text || ':stale-finish:' ||
        p_claim_token::text || ':' || safe_execution_id,
      'stale_finish_rejected',
      safe_execution_id,
      jsonb_build_object(
        'current_status', current_job.status,
        'current_claim_token_matches', current_job.claim_token = p_claim_token,
        'requested_status', requested_status
      )
    ) on conflict (event_key) do nothing;

    return jsonb_build_object(
      'ok', false,
      'error', 'stale_or_missing_claim',
      'status', current_job.status,
      'automatic_retry_allowed', false
    );
  end if;

  if requested_status = 'sent'
     and lower(coalesce(safe_metadata->>'offer_delivery_handoff_accepted', 'false')) <> 'true' then
    insert into public.preview_delivery_job_events (
      job_id, claim_token, event_key, event_type, workflow_execution_id, metadata
    ) values (
      current_job.id,
      p_claim_token,
      'preview-delivery-job:' || current_job.id::text || ':receipt-rejected:' || p_claim_token::text,
      'delivery_receipt_rejected',
      safe_execution_id,
      jsonb_build_object('reason', 'missing_offer_delivery_handoff_receipt')
    ) on conflict (event_key) do nothing;

    return jsonb_build_object(
      'ok', false,
      'error', 'delivery_receipt_required',
      'automatic_retry_allowed', false
    );
  end if;

  effective_status := requested_status;
  if requested_status = 'retry' then
    if current_job.attempts >= current_job.max_attempts then
      effective_status := 'failed';
      next_attempt := current_job.next_attempt_at;
    else
      effective_status := 'retry';
      next_attempt := now() + make_interval(
        mins => least(60, greatest(2, (2 ^ least(current_job.attempts, 5))::integer))
      );
    end if;
  end if;

  update public.preview_delivery_jobs
  set status = effective_status,
      lock_owner = null,
      locked_at = null,
      lease_until = null,
      claim_token = null,
      last_finish_token = p_claim_token,
      last_finish_execution_id = safe_execution_id,
      next_attempt_at = case
        when effective_status = 'retry' then next_attempt
        else next_attempt_at
      end,
      last_error_code = case when effective_status = 'sent' then null else left(p_error_code, 200) end,
      last_error_message = case when effective_status = 'sent' then null else left(p_error_message, 4000) end,
      n8n_execution_id = safe_execution_id,
      sent_at = case when effective_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
      failed_at = case when effective_status in ('failed', 'blocked', 'abandoned') then now() else failed_at end,
      metadata = metadata || safe_metadata
  where id = p_job_id
  returning * into updated;

  insert into public.preview_delivery_job_events (
    job_id, claim_token, event_key, event_type, workflow_execution_id, metadata
  ) values (
    updated.id,
    p_claim_token,
    'preview-delivery-job:' || updated.id::text || ':finish:' ||
      p_claim_token::text || ':' || effective_status,
    effective_status,
    safe_execution_id,
    jsonb_build_object(
      'requested_status', requested_status,
      'effective_status', effective_status,
      'attempt', updated.attempts,
      'max_attempts', updated.max_attempts
    ) || safe_metadata
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'job', to_jsonb(updated),
    'requested_status', requested_status,
    'effective_status', effective_status,
    'automatic_retry_allowed', effective_status = 'retry'
  );
end;
$$;

revoke all on function public.claim_next_preview_delivery_job_v2(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_preview_delivery_job_v2(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_next_preview_delivery_job_v2(text, text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job_v2(uuid, uuid, text, text, text, text, jsonb)
  to service_role;

comment on function public.claim_next_preview_delivery_job_v2(text, text, integer, integer) is
  'Claims one preview-delivery job with a unique token bound to the n8n execution.';
comment on function public.finish_preview_delivery_job_v2(uuid, uuid, text, text, text, text, jsonb) is
  'Finishes only the matching preview-delivery claim; stale executions fail closed and are audited.';
