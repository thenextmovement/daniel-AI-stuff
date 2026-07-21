-- Restore the callable kind allowlist while preserving any already-created
-- ActiveCampaign draft evidence and the additive table constraint. Deactivate the
-- dependent n8n workflow before applying this rollback.

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

comment on function public.claim_customer_communication_draft(text, text, text, text, integer) is
  'Claims one design-reminder or win-back customer draft job atomically. ActiveCampaign auto-reply claims are disabled after rollback; retained rows remain audit evidence.';
