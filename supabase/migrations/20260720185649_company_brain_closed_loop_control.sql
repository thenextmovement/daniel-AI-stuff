-- Closed-loop workflow attempts for Company Brain. Workflow audit and the
-- preview-delivery queue remain the event sources; the periodic scan only
-- detects missing terminal events and is not a recovery mechanism.

create table if not exists public.company_brain_workflow_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_key text not null unique,
  workflow_name text not null,
  workflow_id text,
  execution_id text,
  request_id text,
  trello_card_id text,
  offer_id text,
  correlation_id text,
  idempotency_key text,
  action text not null,
  stage text not null,
  state text not null,
  issue_code text,
  retry_safety text,
  safe_action_key text,
  attempt_number integer not null default 1,
  attempt_limit integer,
  source_audit_id uuid,
  queue_job_id uuid,
  started_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  terminal_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_brain_workflow_attempts_state_check check (
    state in ('queued','running','retry_scheduled','succeeded','failed','blocked','stale','cancelled')
  ),
  constraint company_brain_workflow_attempts_attempt_check check (
    attempt_number >= 0 and (attempt_limit is null or attempt_limit > 0)
  ),
  constraint company_brain_workflow_attempts_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists company_brain_workflow_attempts_request_idx
  on public.company_brain_workflow_attempts (request_id, last_event_at desc)
  where request_id is not null;
create index if not exists company_brain_workflow_attempts_card_idx
  on public.company_brain_workflow_attempts (trello_card_id, last_event_at desc)
  where trello_card_id is not null;
create index if not exists company_brain_workflow_attempts_active_idx
  on public.company_brain_workflow_attempts (state, last_event_at)
  where state in ('queued','running','retry_scheduled');

create or replace function public.reconcile_company_brain_workflow_attempt_from_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_ref text := coalesce(
    nullif(new.metadata->>'workflow_attempt_key',''),
    nullif(new.metadata->>'attempt_key',''),
    'workflow-audit:' || new.id::text
  );
  normalized_status text := lower(coalesce(new.status, ''));
  attempt_state text;
  request_ref text := coalesce(
    nullif(new.metadata->>'request_id',''),
    case when coalesce(new.document_id, '') !~ '^(trello|execution|correlation):' then nullif(new.document_id,'') end
  );
  card_ref text := coalesce(nullif(new.metadata->>'trello_card_id',''), nullif(new.metadata->>'card_id',''));
  offer_ref text := nullif(new.metadata->>'offer_id','');
  terminal_event boolean;
  attempt_row public.company_brain_workflow_attempts;
begin
  attempt_state := case
    when normalized_status in ('queued','pending') then 'queued'
    when normalized_status in ('running','leased','processing') then 'running'
    when normalized_status in ('retry','retry_scheduled','waiting') then 'retry_scheduled'
    when normalized_status in ('success','sent','completed','duplicate','ok') then 'succeeded'
    when normalized_status in ('blocked','abandoned') then 'blocked'
    when normalized_status in ('cancelled','canceled') then 'cancelled'
    else 'failed'
  end;
  terminal_event := attempt_state in ('succeeded','failed','blocked','cancelled');

  insert into public.company_brain_workflow_attempts (
    attempt_key, workflow_name, workflow_id, execution_id,
    request_id, trello_card_id, offer_id, correlation_id, idempotency_key,
    action, stage, state, issue_code, retry_safety, safe_action_key,
    attempt_number, attempt_limit, source_audit_id,
    started_at, last_event_at, terminal_at, metadata
  ) values (
    attempt_ref,
    coalesce(nullif(new.workflow_name,''), 'unknown_workflow'),
    coalesce(nullif(new.metadata->>'workflow_id',''), nullif(new.metadata->>'n8n_workflow_id','')),
    coalesce(nullif(new.metadata->>'execution_id',''), nullif(new.metadata->>'n8n_execution_id','')),
    request_ref, card_ref, offer_ref,
    nullif(new.metadata->>'correlation_id',''),
    nullif(new.metadata->>'idempotency_key',''),
    coalesce(nullif(new.action,''), 'workflow_event'),
    coalesce(nullif(new.metadata->>'workflow_stage',''), nullif(new.metadata->>'stage',''), nullif(new.metadata->>'failed_node',''), new.action, 'unknown'),
    attempt_state,
    coalesce(nullif(new.metadata->>'automation_issue_key',''), nullif(new.metadata->>'failure_type',''), nullif(new.metadata->>'error_code','')),
    nullif(new.metadata->>'retry_safety',''),
    nullif(new.metadata->>'safe_action_key',''),
    greatest(coalesce(
      case when coalesce(new.metadata->>'attempt_number','') ~ '^[0-9]+$' then (new.metadata->>'attempt_number')::integer end,
      case when coalesce(new.metadata->>'current_attempt','') ~ '^[0-9]+$' then (new.metadata->>'current_attempt')::integer end,
      1
    ), 0),
    coalesce(
      case when coalesce(new.metadata->>'attempt_limit','') ~ '^[1-9][0-9]*$' then (new.metadata->>'attempt_limit')::integer end,
      case when coalesce(new.metadata->>'automatic_video_attempt_limit','') ~ '^[1-9][0-9]*$' then (new.metadata->>'automatic_video_attempt_limit')::integer end
    ),
    new.id,
    new.created_at,
    new.created_at,
    case when terminal_event then new.created_at else null end,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'workflow_audit_log',
      'audit_event_key', new.metadata->>'audit_event_key',
      'event_type', new.metadata->>'event_type',
      'contract_complete', new.metadata->'contract_complete',
      'contract_missing_fields', new.metadata->'contract_missing_fields',
      'error_message', new.error_message
    ))
  )
  on conflict (attempt_key) do update
  set workflow_name = excluded.workflow_name,
      workflow_id = coalesce(excluded.workflow_id, public.company_brain_workflow_attempts.workflow_id),
      execution_id = coalesce(excluded.execution_id, public.company_brain_workflow_attempts.execution_id),
      request_id = coalesce(excluded.request_id, public.company_brain_workflow_attempts.request_id),
      trello_card_id = coalesce(excluded.trello_card_id, public.company_brain_workflow_attempts.trello_card_id),
      offer_id = coalesce(excluded.offer_id, public.company_brain_workflow_attempts.offer_id),
      correlation_id = coalesce(excluded.correlation_id, public.company_brain_workflow_attempts.correlation_id),
      idempotency_key = coalesce(excluded.idempotency_key, public.company_brain_workflow_attempts.idempotency_key),
      action = excluded.action,
      stage = excluded.stage,
      state = case
        when public.company_brain_workflow_attempts.state = 'succeeded' and excluded.state <> 'succeeded'
          then public.company_brain_workflow_attempts.state
        else excluded.state
      end,
      issue_code = coalesce(excluded.issue_code, public.company_brain_workflow_attempts.issue_code),
      retry_safety = coalesce(excluded.retry_safety, public.company_brain_workflow_attempts.retry_safety),
      safe_action_key = coalesce(excluded.safe_action_key, public.company_brain_workflow_attempts.safe_action_key),
      attempt_number = greatest(public.company_brain_workflow_attempts.attempt_number, excluded.attempt_number),
      attempt_limit = coalesce(excluded.attempt_limit, public.company_brain_workflow_attempts.attempt_limit),
      source_audit_id = excluded.source_audit_id,
      last_event_at = greatest(public.company_brain_workflow_attempts.last_event_at, excluded.last_event_at),
      terminal_at = case
        when public.company_brain_workflow_attempts.state = 'succeeded' and excluded.state <> 'succeeded'
          then public.company_brain_workflow_attempts.terminal_at
        else coalesce(excluded.terminal_at, public.company_brain_workflow_attempts.terminal_at)
      end,
      metadata = public.company_brain_workflow_attempts.metadata || excluded.metadata
  returning * into attempt_row;

  return new;
end;
$$;

create or replace function public.reconcile_company_brain_workflow_attempt_from_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_state text;
  attempt_row public.company_brain_workflow_attempts;
  incident_row public.company_brain_operational_incidents;
  case_ref text;
begin
  attempt_state := case
    when new.status = 'pending' then 'queued'
    when new.status in ('leased','processing') then 'running'
    when new.status = 'retry' then 'retry_scheduled'
    when new.status = 'sent' then 'succeeded'
    when new.status = 'blocked' then 'blocked'
    when new.status in ('failed','abandoned') then 'failed'
    else 'cancelled'
  end;

  insert into public.company_brain_workflow_attempts (
    attempt_key, workflow_name, workflow_id, execution_id,
    request_id, trello_card_id, correlation_id, idempotency_key,
    action, stage, state, issue_code, retry_safety, safe_action_key,
    attempt_number, attempt_limit, queue_job_id,
    started_at, last_event_at, terminal_at, metadata
  ) values (
    new.idempotency_key,
    coalesce(nullif(new.metadata->>'workflow_name',''), 'KI-Video Generator v1.0 - Neue Angebote schicken + KI-Video'),
    coalesce(nullif(new.metadata->>'workflow_id',''), '9FoJMH6OUdsi36FB'),
    new.n8n_execution_id,
    new.request_id,
    new.trello_card_id,
    nullif(new.metadata->>'correlation_id',''),
    new.idempotency_key,
    case when lower(coalesce(new.metadata->>'manual_recovery','false')) in ('true','1','yes') then 'retry_media_pipeline' else 'create_and_send_offer' end,
    case when attempt_state = 'queued' then 'queue' when attempt_state = 'running' then 'processing' else 'terminal' end,
    attempt_state,
    coalesce(new.last_error_code, nullif(new.metadata->>'original_issue_key','')),
    case when attempt_state in ('queued','running','retry_scheduled') then 'safe_after_review' else 'blocked' end,
    case when lower(coalesce(new.metadata->>'manual_recovery','false')) in ('true','1','yes') then 'retry_media_pipeline' else null end,
    new.attempts,
    new.max_attempts,
    new.id,
    new.created_at,
    new.updated_at,
    case when attempt_state in ('succeeded','failed','blocked','cancelled') then new.updated_at else null end,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'preview_delivery_jobs',
      'queue_status', new.status,
      'last_error_message', new.last_error_message,
      'delivery_cycle_key', new.metadata->>'delivery_cycle_key',
      'original_failure_audit_id', new.metadata->>'original_failure_audit_id'
    ))
  )
  on conflict (attempt_key) do update
  set execution_id = coalesce(excluded.execution_id, public.company_brain_workflow_attempts.execution_id),
      request_id = coalesce(excluded.request_id, public.company_brain_workflow_attempts.request_id),
      trello_card_id = coalesce(excluded.trello_card_id, public.company_brain_workflow_attempts.trello_card_id),
      state = case
        when public.company_brain_workflow_attempts.state = 'succeeded' and excluded.state <> 'succeeded'
          then public.company_brain_workflow_attempts.state
        else excluded.state
      end,
      stage = excluded.stage,
      issue_code = coalesce(excluded.issue_code, public.company_brain_workflow_attempts.issue_code),
      retry_safety = excluded.retry_safety,
      safe_action_key = coalesce(excluded.safe_action_key, public.company_brain_workflow_attempts.safe_action_key),
      attempt_number = greatest(public.company_brain_workflow_attempts.attempt_number, excluded.attempt_number),
      attempt_limit = excluded.attempt_limit,
      queue_job_id = excluded.queue_job_id,
      last_event_at = greatest(public.company_brain_workflow_attempts.last_event_at, excluded.last_event_at),
      terminal_at = case
        when public.company_brain_workflow_attempts.state = 'succeeded' and excluded.state <> 'succeeded'
          then public.company_brain_workflow_attempts.terminal_at
        else coalesce(excluded.terminal_at, public.company_brain_workflow_attempts.terminal_at)
      end,
      metadata = public.company_brain_workflow_attempts.metadata || excluded.metadata
  returning * into attempt_row;

  case_ref := coalesce(attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.attempt_key);
  if attempt_row.state in ('failed','blocked') then
    perform public.upsert_company_brain_incident(
      'workflow_failure:' || md5(case_ref || '|create_and_send_offer'),
      'workflow_failure',
      case when attempt_row.state = 'blocked' then 'warning' else 'critical' end,
      attempt_row.workflow_name || ': ' || attempt_row.action,
      left(coalesce(new.last_error_message, attempt_row.issue_code, 'Preview-Delivery-Queue ist fehlgeschlagen.'), 5000),
      coalesce(attempt_row.issue_code, 'workflow_hard_error'),
      case
        when attempt_row.issue_code in ('video_content_qc_failed','video_content_qc_inconclusive','video_content_qc_unavailable') then 'video_content_qc_failed'
        when attempt_row.issue_code in ('preview_media_invalid','asset_processing_failed') then 'asset_processing_failed'
        when attempt_row.issue_code in ('customer_email_missing','customer_email_invalid') then 'customer_email_invalid'
        else 'workflow_hard_error'
      end,
      1, null,
      coalesce('request:' || attempt_row.request_id, 'workflow:' || case_ref),
      attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.execution_id,
      'preview_delivery_queue', 'preview_delivery_job:' || new.id::text,
      jsonb_build_array('workflow_attempt:' || attempt_row.id::text, 'preview_delivery_job:' || new.id::text),
      case when coalesce(attempt_row.issue_code,'') ~ 'video|media|asset' then 'design' else 'engineering' end,
      jsonb_build_object('attempt_key', attempt_row.attempt_key, 'stage', attempt_row.stage, 'state', attempt_row.state),
      'company-brain-queue-trigger', true
    );
  elsif attempt_row.state = 'succeeded' then
    for incident_row in
      select * from public.company_brain_operational_incidents incident
      where incident.incident_type = 'workflow_failure'
        and incident.status in ('open','acknowledged')
        and (
          (attempt_row.request_id is not null and incident.request_id = attempt_row.request_id)
          or (attempt_row.trello_card_id is not null and incident.trello_card_id = attempt_row.trello_card_id)
          or (attempt_row.offer_id is not null and incident.offer_id = attempt_row.offer_id)
        )
        and incident.first_seen_at <= attempt_row.last_event_at
      for update
    loop
      perform public.transition_company_brain_incident(
        incident_row.id, 'resolved', 'company-brain-queue-trigger',
        'Die Preview-Delivery-Queue hat den Fall anschließend erfolgreich abgeschlossen.'
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.scan_company_brain_workflow_attempt_gaps()
returns table(stale_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.company_brain_workflow_attempts;
begin
  stale_count := 0;
  for attempt_row in
    update public.company_brain_workflow_attempts
    set state = 'stale',
        terminal_at = coalesce(terminal_at, now()),
        updated_at = now(),
        metadata = metadata || jsonb_build_object('stale_detected_at', now(), 'stale_reason', 'missing_terminal_event')
    where state in ('queued','running','retry_scheduled')
      and last_event_at < now() - interval '30 minutes'
    returning *
  loop
    stale_count := stale_count + 1;
    perform public.upsert_company_brain_incident(
      'workflow_failure:' || md5(coalesce(attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.attempt_key) || '|create_and_send_offer'),
      'workflow_failure', 'critical',
      attempt_row.workflow_name || ': Lauf ohne Abschluss',
      'Der Workflow-Versuch hat seit mehr als 30 Minuten kein Terminal-Ereignis geliefert. Kein automatischer Versand-Retry wurde ausgelöst.',
      'workflow_attempt_stale', 'workflow_hard_error', 1, null,
      coalesce('request:' || attempt_row.request_id, 'workflow-attempt:' || attempt_row.attempt_key),
      attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.execution_id,
      'workflow_attempt', 'workflow_attempt:' || attempt_row.id::text,
      jsonb_build_array('workflow_attempt:' || attempt_row.id::text),
      'engineering',
      jsonb_build_object('attempt_key', attempt_row.attempt_key, 'stage', attempt_row.stage, 'state', attempt_row.state),
      'company-brain-attempt-scanner', true
    );
  end loop;
  return next;
end;
$$;

drop trigger if exists trg_company_brain_workflow_attempt_from_audit on public.workflow_audit_log;
create trigger trg_company_brain_workflow_attempt_from_audit
after insert on public.workflow_audit_log
for each row execute function public.reconcile_company_brain_workflow_attempt_from_audit();

drop trigger if exists trg_company_brain_workflow_attempt_from_queue on public.preview_delivery_jobs;
create trigger trg_company_brain_workflow_attempt_from_queue
after insert or update on public.preview_delivery_jobs
for each row execute function public.reconcile_company_brain_workflow_attempt_from_queue();

drop trigger if exists trg_company_brain_workflow_attempts_updated_at on public.company_brain_workflow_attempts;
create trigger trg_company_brain_workflow_attempts_updated_at
before update on public.company_brain_workflow_attempts
for each row execute function public.touch_company_brain_updated_at();

insert into public.company_brain_action_policies (
  action_key, risk_level, minimum_role, approval_role,
  requires_four_eyes, customer_side_effect, description
) values (
  'retry_media_pipeline', 'critical', 'operator', 'approver', true, true,
  'Queues one governed idempotent preview-delivery recovery after fresh identity, duplicate, email, source-change and queue checks.'
)
on conflict (action_key) do update
set risk_level = excluded.risk_level,
    minimum_role = excluded.minimum_role,
    approval_role = excluded.approval_role,
    requires_four_eyes = excluded.requires_four_eyes,
    customer_side_effect = excluded.customer_side_effect,
    description = excluded.description,
    active = true,
    updated_at = now();

create or replace function public.approve_company_brain_action_run(
  p_action_run_id uuid,
  p_actor text,
  p_note text default null
)
returns public.company_brain_action_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  action_run public.company_brain_action_runs;
  normalized_actor text := lower(btrim(p_actor));
begin
  if normalized_actor = '' then raise exception 'company_brain_actor_required'; end if;

  select * into action_run
  from public.company_brain_action_runs
  where id = p_action_run_id
  for update;

  if action_run.id is null then raise exception 'company_brain_action_run_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(action_run.case_key, 0));

  if action_run.status <> 'awaiting_approval' then raise exception 'company_brain_action_run_not_open'; end if;
  if normalized_actor = action_run.proposed_by then raise exception 'company_brain_four_eyes_required'; end if;
  if not exists (
    select 1 from public.company_brain_actor_roles
    where actor_email = normalized_actor and active
      and (expires_at is null or expires_at > now())
      and role in ('approver', 'company_admin')
  ) then raise exception 'company_brain_approver_role_required'; end if;
  if exists (
    select 1 from public.company_brain_action_runs other
    where other.case_key = action_run.case_key
      and other.id <> action_run.id
      and other.status in ('executing','verifying')
  ) then raise exception 'company_brain_case_action_busy'; end if;

  insert into public.company_brain_action_approvals (action_run_id, decision, decided_by, note, input_hash)
  values (action_run.id, 'approved', normalized_actor, nullif(btrim(p_note), ''), action_run.input_hash);

  update public.company_brain_action_runs
  set status = 'executing', approved_by = normalized_actor, approved_at = now(), execution_started_at = now()
  where id = action_run.id returning * into action_run;
  return action_run;
end;
$$;

alter table public.company_brain_workflow_attempts enable row level security;
revoke all on table public.company_brain_workflow_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.company_brain_workflow_attempts to service_role;
drop policy if exists company_brain_workflow_attempts_service_role_all on public.company_brain_workflow_attempts;
create policy company_brain_workflow_attempts_service_role_all on public.company_brain_workflow_attempts
  for all to service_role using (true) with check (true);

revoke all on function public.reconcile_company_brain_workflow_attempt_from_audit() from public, anon, authenticated;
revoke all on function public.reconcile_company_brain_workflow_attempt_from_queue() from public, anon, authenticated;
revoke all on function public.scan_company_brain_workflow_attempt_gaps() from public, anon, authenticated;
revoke all on function public.approve_company_brain_action_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_company_brain_workflow_attempt_from_audit() to service_role;
grant execute on function public.reconcile_company_brain_workflow_attempt_from_queue() to service_role;
grant execute on function public.scan_company_brain_workflow_attempt_gaps() to service_role;
grant execute on function public.approve_company_brain_action_run(uuid, text, text) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'company-brain-workflow-attempt-scan';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'company-brain-workflow-attempt-scan',
    '*/5 * * * *',
    'select public.scan_company_brain_workflow_attempt_gaps();'
  );
end;
$$;

comment on table public.company_brain_workflow_attempts is
  'Canonical workflow-attempt state derived event-by-event from workflow_audit_log and preview_delivery_jobs.';
