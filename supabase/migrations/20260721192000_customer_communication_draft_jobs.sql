-- Canonical fail-closed ledger for AI-assisted or heuristically selected
-- customer communication. Workflows may create an Outlook draft only; sending
-- always remains a human action outside these RPCs.

create table if not exists public.customer_communication_draft_jobs (
  id uuid primary key default gen_random_uuid(),
  communication_kind text not null
    check (communication_kind in ('design_reminder', 'winback')),
  source_id text not null,
  policy_version text not null,
  status text not null default 'processing'
    check (status in ('processing', 'draft_created', 'draft_unknown')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  claim_token uuid,
  claimed_at timestamptz not null default now(),
  lease_until timestamptz,
  draft_id text,
  draft_created_at timestamptz,
  last_execution_id text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_communication_draft_jobs_identity_key
    unique (communication_kind, source_id),
  constraint customer_communication_draft_jobs_state_shape
    check (
      (status = 'processing' and claim_token is not null and lease_until is not null and draft_id is null)
      or (status = 'draft_created' and claim_token is null and lease_until is null and draft_id is not null and draft_created_at is not null)
      or (status = 'draft_unknown' and claim_token is null and lease_until is null and draft_id is null)
    )
);

create index if not exists customer_communication_draft_jobs_status_idx
  on public.customer_communication_draft_jobs
  (communication_kind, status, updated_at desc);

create table if not exists public.customer_communication_draft_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
    references public.customer_communication_draft_jobs(id) on delete restrict,
  event_key text not null unique,
  event_type text not null
    check (event_type in ('claimed', 'draft_created', 'draft_unknown')),
  workflow_execution_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_communication_draft_events_job_idx
  on public.customer_communication_draft_events (job_id, created_at desc);

alter table public.customer_communication_draft_jobs enable row level security;
alter table public.customer_communication_draft_events enable row level security;

revoke all on table public.customer_communication_draft_jobs
  from public, anon, authenticated;
revoke all on table public.customer_communication_draft_events
  from public, anon, authenticated;
grant select, insert, update on table public.customer_communication_draft_jobs
  to service_role;
grant select, insert on table public.customer_communication_draft_events
  to service_role;

create or replace function public.claim_customer_communication_draft(
  p_communication_kind text,
  p_source_id text,
  p_policy_version text,
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_kind text := lower(nullif(btrim(p_communication_kind), ''));
  safe_source_id text := nullif(btrim(p_source_id), '');
  safe_policy_version text := left(nullif(btrim(p_policy_version), ''), 100);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 3600);
  new_claim_token uuid := gen_random_uuid();
  job public.customer_communication_draft_jobs%rowtype;
  inserted boolean := false;
begin
  if safe_kind not in ('design_reminder', 'winback') then
    raise exception 'Unsupported customer communication kind';
  end if;
  if safe_source_id is null or safe_policy_version is null or safe_execution_id is null then
    raise exception 'source_id, policy_version and workflow_execution_id are required';
  end if;
  if length(safe_source_id) > 2000 then
    raise exception 'Customer communication source identity exceeds safe length';
  end if;

  insert into public.customer_communication_draft_jobs (
    communication_kind,
    source_id,
    policy_version,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    lease_until,
    last_execution_id
  ) values (
    safe_kind,
    safe_source_id,
    safe_policy_version,
    'processing',
    1,
    new_claim_token,
    now(),
    now() + make_interval(secs => safe_lease_seconds),
    safe_execution_id
  )
  on conflict (communication_kind, source_id) do nothing
  returning * into job;

  inserted := found;

  if inserted then
    insert into public.customer_communication_draft_events (
      job_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      job.id,
      'customer-draft:' || job.id::text || ':claimed:1',
      'claimed',
      safe_execution_id,
      jsonb_build_object(
        'communication_kind', safe_kind,
        'policy_version', safe_policy_version,
        'lease_seconds', safe_lease_seconds,
        'automatic_send_allowed', false,
        'human_approval_required', true
      )
    );

    return jsonb_build_object(
      'route', 'draft',
      'claimed', true,
      'reason', 'new',
      'job_id', job.id,
      'communication_kind', job.communication_kind,
      'source_id', job.source_id,
      'claim_token', job.claim_token,
      'status', job.status,
      'automatic_send_allowed', false,
      'human_approval_required', true,
      'automatic_retry_allowed', false
    );
  end if;

  select existing.*
    into job
  from public.customer_communication_draft_jobs as existing
  where existing.communication_kind = safe_kind
    and existing.source_id = safe_source_id
  for update;

  if job.status = 'draft_created' then
    return jsonb_build_object(
      'route', 'continue',
      'claimed', false,
      'reason', 'draft_already_created',
      'job_id', job.id,
      'status', job.status,
      'automatic_send_allowed', false,
      'human_approval_required', true,
      'automatic_retry_allowed', false
    );
  end if;

  if job.status = 'draft_unknown' then
    return jsonb_build_object(
      'route', 'stop',
      'claimed', false,
      'reason', 'manual_review_required',
      'job_id', job.id,
      'status', job.status,
      'automatic_send_allowed', false,
      'human_approval_required', true,
      'automatic_retry_allowed', false
    );
  end if;

  if job.lease_until > now() then
    return jsonb_build_object(
      'route', 'stop',
      'claimed', false,
      'reason', 'active_lease',
      'job_id', job.id,
      'status', job.status,
      'automatic_send_allowed', false,
      'human_approval_required', true,
      'automatic_retry_allowed', false
    );
  end if;

  update public.customer_communication_draft_jobs
    set status = 'draft_unknown',
        claim_token = null,
        lease_until = null,
        last_execution_id = safe_execution_id,
        last_error_code = 'stale_processing_lease',
        last_error_message = 'A prior Outlook draft attempt lost its confirmation; manual review is required.',
        updated_at = now()
  where id = job.id
  returning * into job;

  insert into public.customer_communication_draft_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'customer-draft:' || job.id::text || ':draft-unknown:stale-lease',
    'draft_unknown',
    safe_execution_id,
    jsonb_build_object('reason', 'stale_processing_lease')
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'route', 'stop',
    'claimed', false,
    'reason', 'stale_lease_draft_unknown',
    'job_id', job.id,
    'status', job.status,
    'automatic_send_allowed', false,
    'human_approval_required', true,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.complete_customer_communication_draft(
  p_communication_kind text,
  p_source_id text,
  p_claim_token uuid,
  p_draft_id text,
  p_workflow_execution_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_kind text := lower(nullif(btrim(p_communication_kind), ''));
  safe_source_id text := nullif(btrim(p_source_id), '');
  safe_draft_id text := left(nullif(btrim(p_draft_id), ''), 2000);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  job public.customer_communication_draft_jobs%rowtype;
begin
  if safe_kind is null or safe_source_id is null or p_claim_token is null
     or safe_draft_id is null or safe_execution_id is null then
    raise exception 'kind, source_id, claim_token, draft_id and workflow_execution_id are required';
  end if;

  update public.customer_communication_draft_jobs
    set status = 'draft_created',
        claim_token = null,
        lease_until = null,
        draft_id = safe_draft_id,
        draft_created_at = now(),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
  where communication_kind = safe_kind
    and source_id = safe_source_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into job;

  if not found then
    select existing.*
      into job
    from public.customer_communication_draft_jobs as existing
    where existing.communication_kind = safe_kind
      and existing.source_id = safe_source_id;

    if job.status = 'draft_created'
       and job.last_execution_id = safe_execution_id
       and job.draft_id = safe_draft_id then
      return jsonb_build_object(
        'completed', false,
        'reason', 'already_completed',
        'job_id', job.id,
        'status', job.status,
        'automatic_send_allowed', false,
        'human_approval_required', true
      );
    end if;

    raise exception 'Customer draft completion rejected because the claim is stale or missing';
  end if;

  insert into public.customer_communication_draft_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'customer-draft:' || job.id::text || ':draft-created',
    'draft_created',
    safe_execution_id,
    jsonb_build_object(
      'provider', 'outlook',
      'automatic_send_allowed', false,
      'human_approval_required', true
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'completed', true,
    'reason', 'draft_created',
    'job_id', job.id,
    'status', job.status,
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

create or replace function public.mark_customer_communication_draft_unknown(
  p_communication_kind text,
  p_source_id text,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_error_code text default 'outlook_draft_failed'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_kind text := lower(nullif(btrim(p_communication_kind), ''));
  safe_source_id text := nullif(btrim(p_source_id), '');
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_error_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'outlook_draft_failed'), 100);
  job public.customer_communication_draft_jobs%rowtype;
begin
  if safe_kind is null or safe_source_id is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'kind, source_id, claim_token and workflow_execution_id are required';
  end if;

  update public.customer_communication_draft_jobs
    set status = 'draft_unknown',
        claim_token = null,
        lease_until = null,
        last_execution_id = safe_execution_id,
        last_error_code = safe_error_code,
        last_error_message = 'Outlook draft creation did not return a reliable confirmation; manual review is required.',
        updated_at = now()
  where communication_kind = safe_kind
    and source_id = safe_source_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into job;

  if not found then
    select existing.*
      into job
    from public.customer_communication_draft_jobs as existing
    where existing.communication_kind = safe_kind
      and existing.source_id = safe_source_id;

    if job.status = 'draft_unknown' and job.last_execution_id = safe_execution_id then
      return jsonb_build_object(
        'marked_unknown', false,
        'reason', 'already_marked_unknown',
        'job_id', job.id,
        'status', job.status,
        'automatic_retry_allowed', false
      );
    end if;

    raise exception 'Customer draft failure update rejected because the claim is stale or missing';
  end if;

  insert into public.customer_communication_draft_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'customer-draft:' || job.id::text || ':draft-unknown',
    'draft_unknown',
    safe_execution_id,
    jsonb_build_object('error_code', safe_error_code)
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'marked_unknown', true,
    'reason', 'draft_unknown',
    'job_id', job.id,
    'status', job.status,
    'automatic_send_allowed', false,
    'human_approval_required', true,
    'automatic_retry_allowed', false
  );
end;
$$;

revoke all on function public.claim_customer_communication_draft(text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_customer_communication_draft(text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_customer_communication_draft_unknown(text, text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_customer_communication_draft(text, text, text, text, integer)
  to service_role;
grant execute on function public.complete_customer_communication_draft(text, text, uuid, text, text)
  to service_role;
grant execute on function public.mark_customer_communication_draft_unknown(text, text, uuid, text, text)
  to service_role;

comment on table public.customer_communication_draft_jobs is
  'Canonical idempotency and outcome ledger for human-reviewed Outlook draft creation. It never authorizes automatic sending.';
comment on table public.customer_communication_draft_events is
  'Append-only audit for customer communication draft claim and outcome transitions.';
