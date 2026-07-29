-- Preview delivery v3: additive, DB-first stage orchestration and durable
-- recovery/projection foundation. The v2 queue remains untouched so rollout
-- and rollback can be performed with feature flags instead of data rewrites.

create table if not exists public.preview_delivery_cases_v3 (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  trello_card_id text not null,
  trello_card_url text,
  request_id text,
  source_event_id text not null,
  source_revision_hash text,
  status text not null default 'QUEUED' check (
    status in (
      'QUEUED',
      'VALIDATING',
      'VIDEO_SUBMIT_PENDING',
      'VIDEO_POLL_PENDING',
      'VIDEO_QC_PENDING',
      'OFFER_HANDOFF_PENDING',
      'DELIVERY_PREPARED',
      'DELIVERY_WAITING',
      'DELIVERY_PAUSED',
      'DELIVERED',
      'BLOCKED_INPUT',
      'BLOCKED_ASSET',
      'BLOCKED_VIDEO',
      'BLOCKED_OFFER',
      'RECONCILIATION_REQUIRED',
      'CANCELLED'
    )
  ),
  current_stage text not null default 'VALIDATE',
  case_version bigint not null default 1 check (case_version > 0),
  customer_communication_state text not null default 'NOT_STARTED' check (
    customer_communication_state in (
      'NOT_STARTED', 'PREPARED', 'UNKNOWN', 'DELIVERED', 'BOUNCED'
    )
  ),
  delivery_receipt jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists preview_delivery_cases_v3_card_idx
  on public.preview_delivery_cases_v3 (trello_card_id, created_at desc);
create index if not exists preview_delivery_cases_v3_status_idx
  on public.preview_delivery_cases_v3 (status, updated_at);
create index if not exists preview_delivery_cases_v3_request_idx
  on public.preview_delivery_cases_v3 (request_id)
  where request_id is not null;

create table if not exists public.preview_delivery_tasks_v3 (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.preview_delivery_cases_v3(id) on delete restrict,
  task_type text not null check (
    task_type in ('VALIDATE', 'VIDEO_SUBMIT', 'VIDEO_POLL', 'MEDIA_QC', 'OFFER_HANDOFF')
  ),
  generation integer not null default 1 check (generation > 0),
  status text not null default 'QUEUED' check (
    status in ('QUEUED', 'LEASED', 'RETRY', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'CANCELLED')
  ),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 120),
  defer_count integer not null default 0 check (defer_count >= 0),
  worker_id text,
  workflow_execution_id text,
  claim_token uuid,
  locked_at timestamptz,
  lease_until timestamptz,
  last_finish_token uuid,
  last_finish_execution_id text,
  idempotency_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists preview_delivery_tasks_v3_claim_idx
  on public.preview_delivery_tasks_v3 (task_type, status, available_at, created_at)
  where status in ('QUEUED', 'RETRY', 'LEASED');
create index if not exists preview_delivery_tasks_v3_case_idx
  on public.preview_delivery_tasks_v3 (case_id, created_at desc);
create index if not exists preview_delivery_tasks_v3_execution_idx
  on public.preview_delivery_tasks_v3 (workflow_execution_id)
  where workflow_execution_id is not null;

create table if not exists public.preview_delivery_events_v3 (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.preview_delivery_cases_v3(id) on delete restrict,
  task_id uuid references public.preview_delivery_tasks_v3(id) on delete restrict,
  event_key text not null unique,
  event_type text not null,
  stage text,
  workflow_id text,
  workflow_version_id text,
  workflow_execution_id text,
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists preview_delivery_events_v3_case_idx
  on public.preview_delivery_events_v3 (case_id, created_at desc);
create index if not exists preview_delivery_events_v3_type_idx
  on public.preview_delivery_events_v3 (event_type, created_at desc);

create table if not exists public.preview_delivery_failures_v3 (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.preview_delivery_cases_v3(id) on delete restrict,
  task_id uuid references public.preview_delivery_tasks_v3(id) on delete restrict,
  legacy_job_id uuid references public.preview_delivery_jobs(id) on delete restrict,
  error_version bigint not null check (error_version > 0),
  fingerprint text not null unique,
  category text not null check (
    category in ('DATA_BLOCKED', 'TRANSIENT', 'QUALITY', 'SYSTEM', 'SIDE_EFFECT', 'UNKNOWN')
  ),
  stage text not null,
  error_code text not null,
  user_message_de text not null,
  technical_message text,
  retry_policy text not null check (
    retry_policy in ('AUTO', 'AFTER_CORRECTION', 'RECONCILE_ONLY', 'NEVER', 'ENGINEERING')
  ),
  safe_action_key text not null,
  invalid_fields jsonb not null default '[]'::jsonb,
  provider text,
  http_status integer,
  attempt_number integer,
  attempt_limit integer,
  workflow_id text,
  workflow_version_id text,
  workflow_execution_id text,
  customer_communication_state text not null default 'NOT_STARTED',
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution jsonb,
  metadata jsonb not null default '{}'::jsonb,
  unique (case_id, error_version)
);

create index if not exists preview_delivery_failures_v3_open_idx
  on public.preview_delivery_failures_v3 (case_id, occurred_at desc)
  where resolved_at is null;
create index if not exists preview_delivery_failures_v3_code_idx
  on public.preview_delivery_failures_v3 (error_code, occurred_at desc);

create table if not exists public.preview_delivery_side_effects_v3 (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.preview_delivery_cases_v3(id) on delete restrict,
  task_id uuid references public.preview_delivery_tasks_v3(id) on delete restrict,
  effect_key text not null unique,
  effect_type text not null check (
    effect_type in ('VIDEO_PROVIDER_SUBMIT', 'STORAGE_WRITE', 'OFFER_HANDOFF', 'CUSTOMER_DELIVERY')
  ),
  status text not null check (
    status in ('INTENT_RECORDED', 'ACCEPTED', 'UNKNOWN', 'CONFIRMED', 'FAILED')
  ),
  request_fingerprint text not null,
  external_id text,
  request_payload jsonb not null default '{}'::jsonb,
  receipt jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists preview_delivery_side_effects_v3_case_idx
  on public.preview_delivery_side_effects_v3 (case_id, created_at desc);
create index if not exists preview_delivery_side_effects_v3_unknown_idx
  on public.preview_delivery_side_effects_v3 (effect_type, created_at)
  where status = 'UNKNOWN';

create table if not exists public.preview_delivery_projection_outbox_v3 (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.preview_delivery_cases_v3(id) on delete restrict,
  failure_id uuid references public.preview_delivery_failures_v3(id) on delete restrict,
  projection_key text not null unique,
  trello_card_id text not null,
  operation text not null check (
    operation in ('COMMENT_UPSERT', 'MOVE_CARD', 'ADD_LABEL', 'REMOVE_LABEL', 'ATTACH_MEDIA')
  ),
  payload jsonb not null,
  status text not null default 'QUEUED' check (
    status in ('QUEUED', 'LEASED', 'RETRY', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  worker_id text,
  workflow_execution_id text,
  claim_token uuid,
  locked_at timestamptz,
  lease_until timestamptz,
  last_finish_token uuid,
  last_finish_execution_id text,
  external_action_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists preview_delivery_projection_outbox_v3_claim_idx
  on public.preview_delivery_projection_outbox_v3 (status, available_at, created_at)
  where status in ('QUEUED', 'RETRY', 'LEASED');
create index if not exists preview_delivery_projection_outbox_v3_case_idx
  on public.preview_delivery_projection_outbox_v3 (case_id, created_at desc);

create table if not exists public.preview_provider_budgets_v3 (
  provider text not null,
  window_kind text not null check (window_kind in ('HOUR', 'DAY', 'IN_FLIGHT')),
  window_key text not null,
  used_count integer not null default 0 check (used_count >= 0),
  limit_count integer not null check (limit_count > 0),
  updated_at timestamptz not null default now(),
  primary key (provider, window_kind, window_key)
);

alter table public.preview_delivery_cases_v3 enable row level security;
alter table public.preview_delivery_tasks_v3 enable row level security;
alter table public.preview_delivery_events_v3 enable row level security;
alter table public.preview_delivery_failures_v3 enable row level security;
alter table public.preview_delivery_side_effects_v3 enable row level security;
alter table public.preview_delivery_projection_outbox_v3 enable row level security;
alter table public.preview_provider_budgets_v3 enable row level security;

revoke all on table
  public.preview_delivery_cases_v3,
  public.preview_delivery_tasks_v3,
  public.preview_delivery_events_v3,
  public.preview_delivery_failures_v3,
  public.preview_delivery_side_effects_v3,
  public.preview_delivery_projection_outbox_v3,
  public.preview_provider_budgets_v3
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.preview_delivery_cases_v3,
  public.preview_delivery_tasks_v3,
  public.preview_delivery_side_effects_v3,
  public.preview_delivery_failures_v3,
  public.preview_delivery_projection_outbox_v3,
  public.preview_provider_budgets_v3
to service_role;

grant select, insert on table public.preview_delivery_events_v3 to service_role;

create or replace function public.render_preview_delivery_failure_comment_v3(
  p_failure jsonb
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  invalid_field jsonb;
  field_lines text := '';
  communication_state text := upper(coalesce(nullif(p_failure->>'customer_communication_state', ''), 'NOT_STARTED'));
  communication_label text;
  retry_policy text := upper(coalesce(nullif(p_failure->>'retry_policy', ''), 'NEVER'));
  retry_label text;
  request_id text := nullif(btrim(p_failure->>'request_id'), '');
  company_brain_url text;
begin
  communication_label := case communication_state
    when 'DELIVERED' then 'Versand bestätigt'
    when 'UNKNOWN' then 'Versandstatus UNBEKANNT – nicht erneut senden'
    when 'PREPARED' then 'Kundenmail vorbereitet, aber nicht bestätigt'
    when 'BOUNCED' then 'Versand fehlgeschlagen / Bounce'
    else 'Kundenmail NICHT gestartet'
  end;

  if jsonb_typeof(coalesce(p_failure->'invalid_fields', '[]'::jsonb)) = 'array' then
    for invalid_field in
      select value from jsonb_array_elements(coalesce(p_failure->'invalid_fields', '[]'::jsonb))
    loop
      field_lines := field_lines || E'\n• ' ||
        coalesce(nullif(invalid_field->>'label', ''), nullif(invalid_field->>'field', ''), 'Feld') ||
        ': ' || case when coalesce(invalid_field->>'valid', 'false') = 'true' then '✅ ' else '❌ ' end ||
        case when nullif(invalid_field->>'value', '') is null then '' else '„' || left(invalid_field->>'value', 160) || '“ – ' end ||
        coalesce(nullif(invalid_field->>'reason', ''), 'ungültig');
    end loop;
  end if;

  retry_label := case retry_policy
    when 'AUTO' then 'Automatischer Retry ist eingeplant. Kein Eingriff nötig.'
    when 'AFTER_CORRECTION' then 'Nach der Korrektur in Company Brain „Retry prüfen“ wählen.'
    when 'RECONCILE_ONLY' then 'Nicht erneut starten. Zuerst den Versandausgang abgleichen.'
    when 'ENGINEERING' then 'Engineering-Prüfung erforderlich; kein Blind-Retry.'
    else 'Dieser Fehler darf nicht automatisch wiederholt werden.'
  end;

  company_brain_url := 'https://ops.neontrip.de/ops/company-brain?query=' ||
    replace(coalesce(request_id, p_failure->>'trello_card_id', ''), ' ', '%20') ||
    '&problemType=offer_not_sent&auto=1';

  return
    '❌ ANGEBOT NICHT VERSENDET' || E'\n\n' ||
    communication_label || E'\n\n' ||
    'Grund: ' || coalesce(nullif(p_failure->>'user_message_de', ''), 'Der Vorgang konnte nicht abgeschlossen werden.') ||
    field_lines || E'\n\n' ||
    'Was jetzt:' || E'\n' || retry_label || E'\n' ||
    'Fall öffnen: ' || company_brain_url || E'\n\n' ||
    'Fehlercode: ' || coalesce(nullif(p_failure->>'error_code', ''), 'unclassified_pipeline_failure') || E'\n' ||
    'Stufe: ' || coalesce(nullif(p_failure->>'stage', ''), 'UNKNOWN') || E'\n' ||
    'Ref: ' || coalesce(nullif(p_failure->>'fingerprint', ''), 'ohne-referenz') ||
    case when nullif(p_failure->>'workflow_execution_id', '') is null
      then ''
      else ' · Execution ' || (p_failure->>'workflow_execution_id')
    end;
end;
$$;

create or replace function public.enqueue_preview_delivery_case_v3(
  p_input jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_card_id text := lower(nullif(btrim(p_input->>'trello_card_id'), ''));
  safe_source_event_id text := left(nullif(btrim(p_input->>'source_event_id'), ''), 240);
  safe_request_id text := left(nullif(btrim(p_input->>'request_id'), ''), 240);
  safe_case_key text;
  inserted_case public.preview_delivery_cases_v3%rowtype;
  first_task public.preview_delivery_tasks_v3%rowtype;
begin
  if safe_card_id is null or safe_card_id !~ '^[0-9a-f]{24}$' then
    raise exception 'trello_card_id must be a 24-character hex id';
  end if;
  if safe_source_event_id is null then
    raise exception 'source_event_id is required';
  end if;

  safe_case_key := 'preview-case:' || safe_card_id || ':' || safe_source_event_id;

  insert into public.preview_delivery_cases_v3 (
    case_key, trello_card_id, trello_card_url, request_id, source_event_id,
    source_revision_hash, status, current_stage, context
  ) values (
    safe_case_key,
    safe_card_id,
    left(nullif(btrim(p_input->>'trello_card_url'), ''), 1000),
    safe_request_id,
    safe_source_event_id,
    left(nullif(btrim(p_input->>'source_revision_hash'), ''), 200),
    'QUEUED',
    'VALIDATE',
    coalesce(p_input->'context', '{}'::jsonb)
  )
  on conflict (case_key) do update
    set trello_card_url = coalesce(excluded.trello_card_url, public.preview_delivery_cases_v3.trello_card_url),
        request_id = coalesce(excluded.request_id, public.preview_delivery_cases_v3.request_id),
        context = public.preview_delivery_cases_v3.context || excluded.context,
        updated_at = now()
  returning * into inserted_case;

  insert into public.preview_delivery_tasks_v3 (
    case_id, task_type, generation, max_attempts, idempotency_key, input
  ) values (
    inserted_case.id,
    'VALIDATE',
    1,
    3,
    'preview-task:' || inserted_case.id::text || ':VALIDATE:1',
    jsonb_build_object(
      'schema_version', 3,
      'case_version', inserted_case.case_version,
      'source_revision_hash', inserted_case.source_revision_hash
    ) || inserted_case.context
  )
  on conflict (idempotency_key) do update
    set input = public.preview_delivery_tasks_v3.input || excluded.input,
        updated_at = now()
  returning * into first_task;

  insert into public.preview_delivery_events_v3 (
    case_id, task_id, event_key, event_type, stage, correlation_id, payload
  ) values (
    inserted_case.id,
    first_task.id,
    'preview-event:' || inserted_case.id::text || ':INTAKE',
    'CASE_ENQUEUED',
    'INTAKE',
    'preview:' || inserted_case.id::text,
    jsonb_build_object(
      'source_event_id', safe_source_event_id,
      'trello_card_id', safe_card_id,
      'request_id', safe_request_id
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'case', to_jsonb(inserted_case),
    'task', to_jsonb(first_task),
    'idempotent', first_task.attempts > 0 or first_task.created_at < now() - interval '1 second'
  );
end;
$$;

create or replace function public.claim_preview_delivery_task_v3(
  p_task_type text,
  p_worker_id text,
  p_workflow_execution_id text,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_task_type text := upper(nullif(btrim(p_task_type), ''));
  safe_worker_id text := left(nullif(btrim(p_worker_id), ''), 200);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 180), 60), 300);
  new_claim_token uuid := gen_random_uuid();
  claimed public.preview_delivery_tasks_v3%rowtype;
  claimed_case public.preview_delivery_cases_v3%rowtype;
begin
  if safe_task_type not in ('VALIDATE', 'VIDEO_SUBMIT', 'VIDEO_POLL', 'MEDIA_QC', 'OFFER_HANDOFF') then
    raise exception 'unsupported preview delivery task type: %', safe_task_type;
  end if;
  if safe_worker_id is null or safe_execution_id is null then
    raise exception 'worker_id and workflow_execution_id are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('preview-v3:' || safe_execution_id, 0));

  select * into claimed
  from public.preview_delivery_tasks_v3
  where task_type = safe_task_type
    and status = 'LEASED'
    and worker_id = safe_worker_id
    and workflow_execution_id = safe_execution_id
    and claim_token is not null
    and lease_until > now()
  order by locked_at desc
  limit 1;

  if found then
    select * into claimed_case from public.preview_delivery_cases_v3 where id = claimed.case_id;
    return jsonb_build_object(
      'ok', true,
      'reason', 'existing_execution_claim',
      'idempotent', true,
      'case', to_jsonb(claimed_case),
      'task', to_jsonb(claimed),
      'claim_token', claimed.claim_token
    );
  end if;

  with exhausted as (
    update public.preview_delivery_tasks_v3
    set status = 'FAILED',
        worker_id = null,
        workflow_execution_id = null,
        claim_token = null,
        locked_at = null,
        lease_until = null,
        completed_at = now(),
        last_error_code = coalesce(last_error_code, 'stale_lease_attempts_exhausted'),
        last_error_message = coalesce(last_error_message, 'Stage lease expired after all attempts were exhausted.'),
        updated_at = now()
    where task_type = safe_task_type
      and status = 'LEASED'
      and (lease_until is null or lease_until <= now())
      and attempts >= max_attempts
    returning case_id
  )
  update public.preview_delivery_cases_v3 as c
  set status = 'RECONCILIATION_REQUIRED',
      customer_communication_state = case
        when c.customer_communication_state = 'DELIVERED' then 'DELIVERED'
        else 'UNKNOWN'
      end,
      case_version = c.case_version + 1,
      updated_at = now()
  where c.id in (select case_id from exhausted);

  with candidate as (
    select id
    from public.preview_delivery_tasks_v3
    where task_type = safe_task_type
      and attempts < max_attempts
      and (
        (status in ('QUEUED', 'RETRY') and available_at <= now())
        or (status = 'LEASED' and (lease_until is null or lease_until <= now()))
      )
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.preview_delivery_tasks_v3 as task
  set status = 'LEASED',
      worker_id = safe_worker_id,
      workflow_execution_id = safe_execution_id,
      claim_token = new_claim_token,
      locked_at = now(),
      lease_until = now() + make_interval(secs => safe_lease_seconds),
      attempts = task.attempts + 1,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  from candidate
  where task.id = candidate.id
  returning task.* into claimed;

  if not found then
    return jsonb_build_object('ok', true, 'task', null, 'reason', 'queue_empty');
  end if;

  select * into claimed_case
  from public.preview_delivery_cases_v3
  where id = claimed.case_id
  for update;

  update public.preview_delivery_cases_v3
  set current_stage = safe_task_type,
      status = case safe_task_type
        when 'VALIDATE' then 'VALIDATING'
        when 'VIDEO_SUBMIT' then 'VIDEO_SUBMIT_PENDING'
        when 'VIDEO_POLL' then 'VIDEO_POLL_PENDING'
        when 'MEDIA_QC' then 'VIDEO_QC_PENDING'
        else 'OFFER_HANDOFF_PENDING'
      end,
      case_version = case_version + 1,
      updated_at = now()
  where id = claimed.case_id
  returning * into claimed_case;

  insert into public.preview_delivery_events_v3 (
    case_id, task_id, event_key, event_type, stage, workflow_execution_id,
    correlation_id, payload
  ) values (
    claimed.case_id,
    claimed.id,
    'preview-task:' || claimed.id::text || ':claim:' || claimed.claim_token::text,
    'TASK_CLAIMED',
    safe_task_type,
    safe_execution_id,
    'preview:' || claimed.case_id::text,
    jsonb_build_object(
      'worker_id', safe_worker_id,
      'attempt', claimed.attempts,
      'max_attempts', claimed.max_attempts,
      'lease_until', claimed.lease_until
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'case', to_jsonb(claimed_case),
    'task', to_jsonb(claimed),
    'claim_token', claimed.claim_token
  );
end;
$$;

create or replace function public.record_preview_delivery_failure_v3(
  p_failure jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested_case_id uuid;
  requested_task_id uuid;
  requested_legacy_job_id uuid;
  current_case public.preview_delivery_cases_v3%rowtype;
  current_task public.preview_delivery_tasks_v3%rowtype;
  legacy_job public.preview_delivery_jobs%rowtype;
  inserted_failure public.preview_delivery_failures_v3%rowtype;
  next_error_version bigint;
  safe_category text := upper(coalesce(nullif(btrim(p_failure->>'category'), ''), 'UNKNOWN'));
  safe_stage text := upper(coalesce(nullif(btrim(p_failure->>'stage'), ''), 'UNKNOWN'));
  safe_error_code text := lower(coalesce(nullif(btrim(p_failure->>'error_code'), ''), 'unclassified_pipeline_failure'));
  safe_retry_policy text := upper(coalesce(nullif(btrim(p_failure->>'retry_policy'), ''), 'ENGINEERING'));
  safe_fingerprint text;
  safe_card_id text := lower(nullif(btrim(p_failure->>'trello_card_id'), ''));
  safe_request_id text := left(nullif(btrim(p_failure->>'request_id'), ''), 240);
  case_status text;
  comment_text text;
begin
  begin requested_case_id := nullif(p_failure->>'case_id', '')::uuid; exception when others then requested_case_id := null; end;
  begin requested_task_id := nullif(p_failure->>'task_id', '')::uuid; exception when others then requested_task_id := null; end;
  begin requested_legacy_job_id := nullif(p_failure->>'legacy_job_id', '')::uuid; exception when others then requested_legacy_job_id := null; end;

  if safe_category not in ('DATA_BLOCKED', 'TRANSIENT', 'QUALITY', 'SYSTEM', 'SIDE_EFFECT', 'UNKNOWN') then
    safe_category := 'UNKNOWN';
  end if;
  if safe_retry_policy not in ('AUTO', 'AFTER_CORRECTION', 'RECONCILE_ONLY', 'NEVER', 'ENGINEERING') then
    safe_retry_policy := 'ENGINEERING';
  end if;

  if requested_case_id is not null then
    select * into current_case
    from public.preview_delivery_cases_v3
    where id = requested_case_id
    for update;
  end if;

  if not found and requested_legacy_job_id is not null then
    select * into legacy_job
    from public.preview_delivery_jobs
    where id = requested_legacy_job_id;

    if found then
      safe_card_id := coalesce(safe_card_id, legacy_job.trello_card_id);
      safe_request_id := coalesce(safe_request_id, legacy_job.request_id);
      insert into public.preview_delivery_cases_v3 (
        case_key, trello_card_id, trello_card_url, request_id, source_event_id,
        status, current_stage, customer_communication_state, context
      ) values (
        'legacy-v2-job:' || legacy_job.id::text,
        legacy_job.trello_card_id,
        legacy_job.trello_card_url,
        legacy_job.request_id,
        'legacy-v2-job:' || legacy_job.id::text,
        'BLOCKED_OFFER',
        safe_stage,
        upper(coalesce(nullif(p_failure->>'customer_communication_state', ''), 'NOT_STARTED')),
        jsonb_build_object(
          'legacy_job_id', legacy_job.id,
          'legacy_idempotency_key', legacy_job.idempotency_key
        )
      )
      on conflict (case_key) do update
        set request_id = coalesce(excluded.request_id, public.preview_delivery_cases_v3.request_id),
            current_stage = excluded.current_stage,
            updated_at = now()
      returning * into current_case;
    end if;
  end if;

  if current_case.id is null then
    if safe_card_id is null or safe_card_id !~ '^[0-9a-f]{24}$' then
      raise exception 'case_id, legacy_job_id, or a valid trello_card_id is required';
    end if;
    safe_fingerprint := left(coalesce(nullif(p_failure->>'fingerprint', ''), safe_error_code || ':' || coalesce(p_failure->>'workflow_execution_id', gen_random_uuid()::text)), 500);
    insert into public.preview_delivery_cases_v3 (
      case_key, trello_card_id, trello_card_url, request_id, source_event_id,
      status, current_stage, customer_communication_state, context
    ) values (
      'legacy-error:' || safe_card_id || ':' || safe_fingerprint,
      safe_card_id,
      left(nullif(btrim(p_failure->>'trello_card_url'), ''), 1000),
      safe_request_id,
      'legacy-error:' || safe_fingerprint,
      'BLOCKED_OFFER',
      safe_stage,
      upper(coalesce(nullif(p_failure->>'customer_communication_state', ''), 'NOT_STARTED')),
      '{}'::jsonb
    )
    on conflict (case_key) do update
      set updated_at = now()
    returning * into current_case;
  end if;

  if requested_task_id is not null then
    select * into current_task
    from public.preview_delivery_tasks_v3
    where id = requested_task_id
      and case_id = current_case.id;
    if not found then requested_task_id := null; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('preview-failure:' || current_case.id::text, 0));
  select coalesce(max(error_version), 0) + 1
  into next_error_version
  from public.preview_delivery_failures_v3
  where case_id = current_case.id;

  safe_fingerprint := left(
    coalesce(
      nullif(p_failure->>'fingerprint', ''),
      'preview-failure:' || current_case.id::text || ':' || safe_error_code || ':' ||
        coalesce(nullif(p_failure->>'workflow_execution_id', ''), next_error_version::text)
    ),
    500
  );

  insert into public.preview_delivery_failures_v3 (
    case_id, task_id, legacy_job_id, error_version, fingerprint, category, stage,
    error_code, user_message_de, technical_message, retry_policy, safe_action_key,
    invalid_fields, provider, http_status, attempt_number, attempt_limit,
    workflow_id, workflow_version_id, workflow_execution_id,
    customer_communication_state, metadata
  ) values (
    current_case.id,
    requested_task_id,
    requested_legacy_job_id,
    next_error_version,
    safe_fingerprint,
    safe_category,
    safe_stage,
    safe_error_code,
    left(coalesce(nullif(p_failure->>'user_message_de', ''), 'Der Vorgang konnte nicht abgeschlossen werden.'), 2000),
    left(nullif(p_failure->>'technical_message', ''), 8000),
    safe_retry_policy,
    left(coalesce(nullif(p_failure->>'safe_action_key', ''), 'inspect_n8n_run'), 160),
    case when jsonb_typeof(coalesce(p_failure->'invalid_fields', '[]'::jsonb)) = 'array'
      then coalesce(p_failure->'invalid_fields', '[]'::jsonb)
      else '[]'::jsonb
    end,
    left(nullif(p_failure->>'provider', ''), 160),
    nullif(p_failure->>'http_status', '')::integer,
    nullif(p_failure->>'attempt_number', '')::integer,
    nullif(p_failure->>'attempt_limit', '')::integer,
    left(nullif(p_failure->>'workflow_id', ''), 200),
    left(nullif(p_failure->>'workflow_version_id', ''), 200),
    left(nullif(p_failure->>'workflow_execution_id', ''), 200),
    upper(coalesce(nullif(p_failure->>'customer_communication_state', ''), 'NOT_STARTED')),
    coalesce(p_failure->'metadata', '{}'::jsonb)
  )
  on conflict (fingerprint) do update
    set technical_message = coalesce(excluded.technical_message, public.preview_delivery_failures_v3.technical_message),
        metadata = public.preview_delivery_failures_v3.metadata || excluded.metadata
  returning * into inserted_failure;

  case_status := case
    when safe_retry_policy = 'RECONCILE_ONLY' or upper(coalesce(p_failure->>'customer_communication_state', '')) = 'UNKNOWN'
      then 'RECONCILIATION_REQUIRED'
    when safe_category = 'DATA_BLOCKED' then 'BLOCKED_INPUT'
    when safe_category = 'QUALITY' then 'BLOCKED_VIDEO'
    when safe_stage in ('VIDEO_SUBMIT', 'VIDEO_POLL', 'MEDIA_QC') then 'BLOCKED_VIDEO'
    else 'BLOCKED_OFFER'
  end;

  update public.preview_delivery_cases_v3
  set status = case_status,
      current_stage = safe_stage,
      customer_communication_state = upper(coalesce(nullif(p_failure->>'customer_communication_state', ''), customer_communication_state)),
      case_version = case_version + 1,
      updated_at = now()
  where id = current_case.id
  returning * into current_case;

  comment_text := public.render_preview_delivery_failure_comment_v3(
    jsonb_build_object(
      'customer_communication_state', inserted_failure.customer_communication_state,
      'retry_policy', inserted_failure.retry_policy,
      'request_id', current_case.request_id,
      'trello_card_id', current_case.trello_card_id,
      'user_message_de', inserted_failure.user_message_de,
      'invalid_fields', inserted_failure.invalid_fields,
      'error_code', inserted_failure.error_code,
      'stage', inserted_failure.stage,
      'fingerprint', inserted_failure.fingerprint,
      'workflow_execution_id', inserted_failure.workflow_execution_id
    )
  );

  insert into public.preview_delivery_projection_outbox_v3 (
    case_id, failure_id, projection_key, trello_card_id, operation, payload
  ) values (
    current_case.id,
    inserted_failure.id,
    'preview-projection:failure:' || inserted_failure.id::text || ':open-comment:v1',
    current_case.trello_card_id,
    'COMMENT_UPSERT',
    jsonb_build_object(
      'marker', 'NT-EVENT:' || inserted_failure.fingerprint || ':OPEN',
      'text', comment_text || E'\n' || 'NT-EVENT:' || inserted_failure.fingerprint || ':OPEN',
      'failure_id', inserted_failure.id,
      'error_version', inserted_failure.error_version
    )
  ) on conflict (projection_key) do nothing;

  insert into public.preview_delivery_events_v3 (
    case_id, task_id, event_key, event_type, stage, workflow_id,
    workflow_version_id, workflow_execution_id, correlation_id, payload
  ) values (
    current_case.id,
    requested_task_id,
    'preview-event:failure:' || inserted_failure.id::text,
    'FAILURE_OPENED',
    inserted_failure.stage,
    inserted_failure.workflow_id,
    inserted_failure.workflow_version_id,
    inserted_failure.workflow_execution_id,
    'preview:' || current_case.id::text,
    jsonb_build_object(
      'failure_id', inserted_failure.id,
      'error_version', inserted_failure.error_version,
      'error_code', inserted_failure.error_code,
      'retry_policy', inserted_failure.retry_policy
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'case', to_jsonb(current_case),
    'failure', to_jsonb(inserted_failure),
    'projection_key', 'preview-projection:failure:' || inserted_failure.id::text || ':open-comment:v1'
  );
end;
$$;

create or replace function public.complete_preview_delivery_task_v3(
  p_task_id uuid,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_outcome text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_outcome text := upper(nullif(btrim(p_outcome), ''));
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  current_task public.preview_delivery_tasks_v3%rowtype;
  current_case public.preview_delivery_cases_v3%rowtype;
  next_task_type text := upper(nullif(btrim(safe_payload->>'next_task_type'), ''));
  expected_next_task_type text;
  next_task public.preview_delivery_tasks_v3%rowtype;
  next_status text;
  requested_delivery_state text := upper(nullif(btrim(safe_payload->>'delivery_state'), ''));
  next_generation integer;
  max_video_generations integer;
  delay_seconds integer;
  failure_result jsonb;
begin
  if p_task_id is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'task_id, claim_token and workflow_execution_id are required';
  end if;
  if safe_outcome not in ('SUCCEEDED', 'REGENERATE', 'DEFERRED', 'RETRY', 'BLOCKED', 'FAILED') then
    raise exception 'unsupported preview delivery task outcome: %', safe_outcome;
  end if;

  select * into current_task
  from public.preview_delivery_tasks_v3
  where id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'task_not_found');
  end if;

  if current_task.status <> 'LEASED'
     and current_task.last_finish_token = p_claim_token
     and current_task.last_finish_execution_id = safe_execution_id then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'reason', 'already_finished',
      'task', to_jsonb(current_task)
    );
  end if;

  if current_task.status <> 'LEASED'
     or current_task.claim_token is distinct from p_claim_token
     or current_task.workflow_execution_id is distinct from safe_execution_id then
    insert into public.preview_delivery_events_v3 (
      case_id, task_id, event_key, event_type, stage, workflow_execution_id,
      correlation_id, payload
    ) values (
      current_task.case_id,
      current_task.id,
      'preview-task:' || current_task.id::text || ':stale-finish:' || p_claim_token::text || ':' || safe_execution_id,
      'STALE_FINISH_REJECTED',
      current_task.task_type,
      safe_execution_id,
      'preview:' || current_task.case_id::text,
      jsonb_build_object('requested_outcome', safe_outcome, 'current_status', current_task.status)
    ) on conflict (event_key) do nothing;
    return jsonb_build_object('ok', false, 'error', 'stale_or_missing_claim');
  end if;

  select * into current_case
  from public.preview_delivery_cases_v3
  where id = current_task.case_id
  for update;

  if safe_outcome = 'REGENERATE' then
    if current_task.task_type <> 'MEDIA_QC' then
      return jsonb_build_object('ok', false, 'error', 'regenerate_only_allowed_for_media_qc');
    end if;
    max_video_generations := least(
      greatest(coalesce(nullif(safe_payload->>'max_video_generations', '')::integer, 3), 1),
      10
    );
    if current_task.generation >= max_video_generations then
      safe_outcome := 'FAILED';
      safe_payload := safe_payload || jsonb_build_object(
        'error_code', 'video_qc_regeneration_limit_reached',
        'category', 'QUALITY',
        'retry_policy', 'AFTER_CORRECTION',
        'safe_action_key', 'review_video_or_retry',
        'user_message_de', 'Das KI-Video hat die Qualitätsprüfung mehrfach nicht bestanden.'
      );
    end if;
  end if;

  if safe_outcome in ('SUCCEEDED', 'REGENERATE') then
    expected_next_task_type := case
      when safe_outcome = 'REGENERATE' then 'VIDEO_SUBMIT'
      when current_task.task_type = 'VALIDATE' then 'VIDEO_SUBMIT'
      when current_task.task_type = 'VIDEO_SUBMIT' then 'VIDEO_POLL'
      when current_task.task_type = 'VIDEO_POLL' then 'MEDIA_QC'
      when current_task.task_type = 'MEDIA_QC' then 'OFFER_HANDOFF'
      else null
    end;

    if expected_next_task_type is distinct from next_task_type then
      return jsonb_build_object(
        'ok', false,
        'error', 'invalid_stage_transition',
        'current_task_type', current_task.task_type,
        'expected_next_task_type', expected_next_task_type,
        'requested_next_task_type', next_task_type
      );
    end if;

    if current_task.task_type = 'OFFER_HANDOFF'
       and requested_delivery_state is not null
       and requested_delivery_state not in ('PREPARED', 'WAITING', 'PAUSED') then
      return jsonb_build_object(
        'ok', false,
        'error', 'invalid_offer_handoff_delivery_state',
        'requested_delivery_state', requested_delivery_state
      );
    end if;

    update public.preview_delivery_tasks_v3
    set status = 'SUCCEEDED',
        worker_id = null,
        claim_token = null,
        locked_at = null,
        lease_until = null,
        last_finish_token = p_claim_token,
        last_finish_execution_id = safe_execution_id,
        output = safe_payload,
        completed_at = now(),
        updated_at = now()
    where id = current_task.id
    returning * into current_task;

    if next_task_type is not null then
      next_generation := case
        when safe_outcome = 'REGENERATE' then current_task.generation + 1
        else current_task.generation
      end;
      insert into public.preview_delivery_tasks_v3 (
        case_id, task_type, generation, max_attempts, idempotency_key, input
      ) values (
        current_case.id,
        next_task_type,
        next_generation,
        case when next_task_type = 'VIDEO_POLL' then 120 else 3 end,
        'preview-task:' || current_case.id::text || ':' || next_task_type || ':' || next_generation::text,
        current_case.context || coalesce(safe_payload->'context', '{}'::jsonb)
      )
      on conflict (idempotency_key) do update
        set input = public.preview_delivery_tasks_v3.input || excluded.input,
            updated_at = now()
      returning * into next_task;
    end if;

    next_status := case
      when next_task_type = 'VIDEO_SUBMIT' then 'VIDEO_SUBMIT_PENDING'
      when next_task_type = 'VIDEO_POLL' then 'VIDEO_POLL_PENDING'
      when next_task_type = 'MEDIA_QC' then 'VIDEO_QC_PENDING'
      when next_task_type = 'OFFER_HANDOFF' then 'OFFER_HANDOFF_PENDING'
      when current_task.task_type = 'OFFER_HANDOFF' and requested_delivery_state = 'WAITING' then 'DELIVERY_WAITING'
      when current_task.task_type = 'OFFER_HANDOFF' and requested_delivery_state = 'PAUSED' then 'DELIVERY_PAUSED'
      else 'DELIVERY_PREPARED'
    end;

    update public.preview_delivery_cases_v3
    set status = next_status,
        current_stage = coalesce(next_task_type, 'DELIVERY'),
        customer_communication_state = case
          when next_status in ('DELIVERY_PREPARED', 'DELIVERY_WAITING', 'DELIVERY_PAUSED') then 'PREPARED'
          else customer_communication_state
        end,
        context = context || coalesce(safe_payload->'context', '{}'::jsonb),
        case_version = case_version + 1,
        updated_at = now()
    where id = current_case.id
    returning * into current_case;
  elsif safe_outcome = 'DEFERRED' then
    if current_task.task_type <> 'VIDEO_POLL' then
      return jsonb_build_object('ok', false, 'error', 'defer_only_allowed_for_video_poll');
    end if;
    delay_seconds := least(greatest(coalesce(nullif(safe_payload->>'delay_seconds', '')::integer, 15), 10), 300);
    if current_task.defer_count >= 120 then
      safe_outcome := 'FAILED';
      safe_payload := safe_payload || jsonb_build_object(
        'error_code', 'video_provider_deadline_exceeded',
        'category', 'TRANSIENT',
        'retry_policy', 'AFTER_CORRECTION',
        'safe_action_key', 'retry_media_pipeline',
        'user_message_de', 'Die Videoerstellung hat die maximale Wartezeit überschritten.'
      );
    else
      update public.preview_delivery_tasks_v3
      set status = 'QUEUED',
          available_at = now() + make_interval(secs => delay_seconds),
          attempts = greatest(attempts - 1, 0),
          defer_count = defer_count + 1,
          worker_id = null,
          claim_token = null,
          locked_at = null,
          lease_until = null,
          last_finish_token = p_claim_token,
          last_finish_execution_id = safe_execution_id,
          output = safe_payload,
          updated_at = now()
      where id = current_task.id
      returning * into current_task;
    end if;
  end if;

  if safe_outcome = 'RETRY' then
    if current_task.attempts >= current_task.max_attempts then
      safe_outcome := 'FAILED';
    else
      delay_seconds := least(3600, greatest(30, (2 ^ least(current_task.attempts, 6))::integer * 15));
      update public.preview_delivery_tasks_v3
      set status = 'RETRY',
          available_at = now() + make_interval(secs => delay_seconds),
          worker_id = null,
          claim_token = null,
          locked_at = null,
          lease_until = null,
          last_finish_token = p_claim_token,
          last_finish_execution_id = safe_execution_id,
          last_error_code = left(coalesce(safe_payload->>'error_code', 'transient_stage_failure'), 200),
          last_error_message = left(coalesce(safe_payload->>'technical_message', safe_payload->>'user_message_de'), 4000),
          output = safe_payload,
          updated_at = now()
      where id = current_task.id
      returning * into current_task;
    end if;
  end if;

  if safe_outcome in ('BLOCKED', 'FAILED') then
    update public.preview_delivery_tasks_v3
    set status = safe_outcome,
        worker_id = null,
        claim_token = null,
        locked_at = null,
        lease_until = null,
        last_finish_token = p_claim_token,
        last_finish_execution_id = safe_execution_id,
        last_error_code = left(coalesce(safe_payload->>'error_code', 'unclassified_pipeline_failure'), 200),
        last_error_message = left(coalesce(safe_payload->>'technical_message', safe_payload->>'user_message_de'), 4000),
        output = safe_payload,
        completed_at = now(),
        updated_at = now()
    where id = current_task.id
    returning * into current_task;

    failure_result := public.record_preview_delivery_failure_v3(
      safe_payload || jsonb_build_object(
        'case_id', current_case.id,
        'task_id', current_task.id,
        'trello_card_id', current_case.trello_card_id,
        'trello_card_url', current_case.trello_card_url,
        'request_id', current_case.request_id,
        'stage', current_task.task_type,
        'attempt_number', current_task.attempts,
        'attempt_limit', current_task.max_attempts,
        'workflow_execution_id', safe_execution_id,
        'customer_communication_state', current_case.customer_communication_state
      )
    );
  end if;

  insert into public.preview_delivery_events_v3 (
    case_id, task_id, event_key, event_type, stage, workflow_execution_id,
    correlation_id, payload
  ) values (
    current_task.case_id,
    current_task.id,
    'preview-task:' || current_task.id::text || ':finish:' || p_claim_token::text || ':' || safe_outcome,
    'TASK_' || safe_outcome,
    current_task.task_type,
    safe_execution_id,
    'preview:' || current_task.case_id::text,
    safe_payload
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'outcome', safe_outcome,
    'case', to_jsonb(current_case),
    'task', to_jsonb(current_task),
    'next_task', case when next_task.id is null then null else to_jsonb(next_task) end,
    'failure', failure_result
  );
end;
$$;

create or replace function public.claim_preview_delivery_projection_v3(
  p_worker_id text,
  p_workflow_execution_id text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_worker_id text := left(nullif(btrim(p_worker_id), ''), 200);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 120), 60), 300);
  new_claim_token uuid := gen_random_uuid();
  claimed public.preview_delivery_projection_outbox_v3%rowtype;
begin
  if safe_worker_id is null or safe_execution_id is null then
    raise exception 'worker_id and workflow_execution_id are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('preview-projection:' || safe_execution_id, 0));

  select * into claimed
  from public.preview_delivery_projection_outbox_v3
  where status = 'LEASED'
    and worker_id = safe_worker_id
    and workflow_execution_id = safe_execution_id
    and claim_token is not null
    and lease_until > now()
  order by locked_at desc
  limit 1;

  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'projection', to_jsonb(claimed), 'claim_token', claimed.claim_token);
  end if;

  update public.preview_delivery_projection_outbox_v3
  set status = 'FAILED',
      worker_id = null,
      workflow_execution_id = null,
      claim_token = null,
      locked_at = null,
      lease_until = null,
      completed_at = now(),
      last_error = coalesce(last_error, 'Projection lease expired after attempts were exhausted.'),
      updated_at = now()
  where status = 'LEASED'
    and (lease_until is null or lease_until <= now())
    and attempts >= max_attempts;

  with candidate as (
    select id
    from public.preview_delivery_projection_outbox_v3
    where attempts < max_attempts
      and (
        (status in ('QUEUED', 'RETRY') and available_at <= now())
        or (status = 'LEASED' and (lease_until is null or lease_until <= now()))
      )
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.preview_delivery_projection_outbox_v3 as projection
  set status = 'LEASED',
      worker_id = safe_worker_id,
      workflow_execution_id = safe_execution_id,
      claim_token = new_claim_token,
      locked_at = now(),
      lease_until = now() + make_interval(secs => safe_lease_seconds),
      attempts = projection.attempts + 1,
      updated_at = now()
  from candidate
  where projection.id = candidate.id
  returning projection.* into claimed;

  if not found then
    return jsonb_build_object('ok', true, 'projection', null, 'reason', 'queue_empty');
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false, 'projection', to_jsonb(claimed), 'claim_token', claimed.claim_token);
end;
$$;

create or replace function public.finish_preview_delivery_projection_v3(
  p_projection_id uuid,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_status text,
  p_external_action_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_status text := upper(nullif(btrim(p_status), ''));
  current_projection public.preview_delivery_projection_outbox_v3%rowtype;
  effective_status text;
  delay_seconds integer;
begin
  if safe_status not in ('SUCCEEDED', 'RETRY', 'FAILED') then
    raise exception 'unsupported projection finish status: %', safe_status;
  end if;

  select * into current_projection
  from public.preview_delivery_projection_outbox_v3
  where id = p_projection_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'error', 'projection_not_found'); end if;

  if current_projection.status <> 'LEASED'
     and current_projection.last_finish_token = p_claim_token
     and current_projection.last_finish_execution_id = safe_execution_id then
    return jsonb_build_object('ok', true, 'idempotent', true, 'projection', to_jsonb(current_projection));
  end if;

  if current_projection.status <> 'LEASED'
     or current_projection.claim_token is distinct from p_claim_token
     or current_projection.workflow_execution_id is distinct from safe_execution_id then
    return jsonb_build_object('ok', false, 'error', 'stale_or_missing_claim');
  end if;

  effective_status := safe_status;
  if safe_status = 'RETRY' and current_projection.attempts >= current_projection.max_attempts then
    effective_status := 'FAILED';
  end if;
  delay_seconds := least(1800, greatest(30, (2 ^ least(current_projection.attempts, 6))::integer * 15));

  update public.preview_delivery_projection_outbox_v3
  set status = effective_status,
      available_at = case when effective_status = 'RETRY' then now() + make_interval(secs => delay_seconds) else available_at end,
      worker_id = null,
      claim_token = null,
      locked_at = null,
      lease_until = null,
      last_finish_token = p_claim_token,
      last_finish_execution_id = safe_execution_id,
      external_action_id = coalesce(left(nullif(btrim(p_external_action_id), ''), 240), external_action_id),
      last_error = case when effective_status = 'SUCCEEDED' then null else left(p_error, 4000) end,
      completed_at = case when effective_status in ('SUCCEEDED', 'FAILED') then now() else completed_at end,
      updated_at = now()
  where id = current_projection.id
  returning * into current_projection;

  insert into public.preview_delivery_events_v3 (
    case_id, event_key, event_type, stage, workflow_execution_id, correlation_id, payload
  ) values (
    current_projection.case_id,
    'preview-projection:' || current_projection.id::text || ':finish:' || p_claim_token::text || ':' || effective_status,
    'PROJECTION_' || effective_status,
    'TRELLO_PROJECTION',
    safe_execution_id,
    'preview:' || current_projection.case_id::text,
    jsonb_build_object(
      'projection_id', current_projection.id,
      'operation', current_projection.operation,
      'external_action_id', current_projection.external_action_id,
      'error', current_projection.last_error
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'idempotent', false, 'projection', to_jsonb(current_projection));
end;
$$;

create or replace function public.request_preview_delivery_retry_v1(
  p_original_job_id uuid,
  p_failure_id uuid,
  p_action_run_id uuid,
  p_actor text,
  p_reason text,
  p_guard_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  original_job public.preview_delivery_jobs%rowtype;
  current_failure public.preview_delivery_failures_v3%rowtype;
  recovery_job public.preview_delivery_jobs%rowtype;
  safe_actor text := left(nullif(btrim(p_actor), ''), 200);
  safe_reason text := left(nullif(btrim(p_reason), ''), 2000);
  safe_guard jsonb := coalesce(p_guard_context, '{}'::jsonb);
  recovery_key text;
  recovery_cycle text;
begin
  if p_original_job_id is null or p_failure_id is null or p_action_run_id is null or safe_actor is null or safe_reason is null then
    raise exception 'original_job_id, failure_id, action_run_id, actor and reason are required';
  end if;

  select * into original_job
  from public.preview_delivery_jobs
  where id = p_original_job_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'original_job_not_found'); end if;

  select * into current_failure
  from public.preview_delivery_failures_v3
  where id = p_failure_id
    and legacy_job_id = original_job.id
    and resolved_at is null
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'current_failure_not_found'); end if;

  if original_job.status not in ('failed', 'blocked', 'abandoned') then
    return jsonb_build_object('ok', false, 'error', 'original_job_not_terminal', 'status', original_job.status);
  end if;
  if original_job.status = 'sent'
     or current_failure.retry_policy in ('RECONCILE_ONLY', 'NEVER', 'ENGINEERING')
     or current_failure.error_code in ('delivery_outcome_unknown', 'duplicate_delivery_guard') then
    return jsonb_build_object('ok', false, 'error', 'retry_not_safe_for_failure');
  end if;

  recovery_key := 'preview-retry:' || original_job.id::text || ':' || current_failure.id::text || ':' || p_action_run_id::text || ':v1';
  recovery_cycle := 'company_brain_recovery_' || current_failure.id::text;

  -- A repeated HTTP request or double click for the same approved action must
  -- return the already-created recovery row before the active-job guard runs.
  select * into recovery_job
  from public.preview_delivery_jobs
  where idempotency_key = recovery_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'recovery_job', to_jsonb(recovery_job),
      'failure', to_jsonb(current_failure)
    );
  end if;

  if lower(coalesce(safe_guard->>'delivery_proof_found', 'false')) = 'true' then
    return jsonb_build_object('ok', false, 'error', 'delivery_proof_already_exists');
  end if;
  if lower(coalesce(safe_guard->>'delivery_outcome_unknown', 'false')) = 'true' then
    return jsonb_build_object('ok', false, 'error', 'delivery_outcome_requires_reconciliation');
  end if;
  if current_failure.retry_policy = 'AFTER_CORRECTION'
     and lower(coalesce(safe_guard->>'source_changed_after_failure', 'false')) <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'source_not_changed_after_failure');
  end if;
  if exists (
    select 1
    from public.preview_delivery_jobs active_job
    where active_job.trello_card_id = original_job.trello_card_id
      and active_job.id <> original_job.id
      and active_job.status in ('pending', 'retry', 'leased', 'processing')
  ) then
    return jsonb_build_object('ok', false, 'error', 'active_job_exists');
  end if;
  if exists (
    select 1
    from public.preview_delivery_jobs sent_job
    where sent_job.trello_card_id = original_job.trello_card_id
      and sent_job.status = 'sent'
      and sent_job.sent_at >= coalesce(current_failure.occurred_at, original_job.failed_at, original_job.created_at)
  ) then
    return jsonb_build_object('ok', false, 'error', 'later_sent_job_exists');
  end if;

  insert into public.preview_delivery_jobs (
    trello_card_id, trello_card_url, request_id, master_request_uuid, card_name,
    source_list_id, priority, max_attempts, idempotency_key, metadata
  ) values (
    original_job.trello_card_id,
    original_job.trello_card_url,
    original_job.request_id,
    original_job.master_request_uuid,
    original_job.card_name,
    coalesce(original_job.source_list_id, 'company_brain_recovery'),
    200,
    1,
    recovery_key,
    original_job.metadata || jsonb_build_object(
      'delivery_cycle_key', recovery_cycle,
      'source', 'company_brain',
      'manual_recovery', true,
      'recovery_of_job_id', original_job.id,
      'recovery_failure_id', current_failure.id,
      'recovery_action_run_id', p_action_run_id,
      'recovery_actor', safe_actor,
      'recovery_reason', safe_reason,
      'offer_send_idempotency_key', coalesce(
        original_job.metadata->>'offer_send_idempotency_key',
        'offer-send:preview-job:' || original_job.id::text
      ),
      'customer_communication_sent', false
    )
  )
  on conflict (idempotency_key) do update
    set metadata = public.preview_delivery_jobs.metadata || excluded.metadata,
        updated_at = now()
  returning * into recovery_job;

  insert into public.preview_delivery_job_events (
    job_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    recovery_job.id,
    'preview-delivery-job:' || recovery_job.id::text || ':manual-retry-requested',
    'retry',
    null,
    jsonb_build_object(
      'manual', true,
      'original_job_id', original_job.id,
      'failure_id', current_failure.id,
      'action_run_id', p_action_run_id,
      'actor', safe_actor,
      'reason', safe_reason
    )
  ) on conflict (event_key) do nothing;

  insert into public.preview_delivery_events_v3 (
    case_id, event_key, event_type, stage, correlation_id, payload
  ) values (
    current_failure.case_id,
    'preview-event:failure:' || current_failure.id::text || ':retry:' || p_action_run_id::text,
    'MANUAL_RETRY_REQUESTED',
    current_failure.stage,
    'preview:' || current_failure.case_id::text,
    jsonb_build_object(
      'original_job_id', original_job.id,
      'recovery_job_id', recovery_job.id,
      'failure_id', current_failure.id,
      'action_run_id', p_action_run_id,
      'actor', safe_actor,
      'reason', safe_reason
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', recovery_job.created_at < now() - interval '1 second',
    'recovery_job', to_jsonb(recovery_job),
    'failure', to_jsonb(current_failure)
  );
end;
$$;

create or replace function public.reserve_preview_provider_capacity_v3(
  p_provider text,
  p_hour_limit integer,
  p_day_limit integer,
  p_in_flight_limit integer,
  p_units integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_provider text := lower(left(nullif(btrim(p_provider), ''), 120));
  safe_units integer := greatest(coalesce(p_units, 1), 1);
  hour_key text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24');
  day_key text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD');
  current_hour integer;
  current_day integer;
  current_in_flight integer;
begin
  if safe_provider is null then
    return jsonb_build_object('ok', false, 'error', 'provider_required');
  end if;
  if p_hour_limit < safe_units or p_day_limit < safe_units or p_in_flight_limit < safe_units then
    return jsonb_build_object('ok', false, 'error', 'invalid_provider_limits');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('preview-provider:' || safe_provider, 0));

  insert into public.preview_provider_budgets_v3 (
    provider, window_kind, window_key, used_count, limit_count
  ) values
    (safe_provider, 'HOUR', hour_key, 0, p_hour_limit),
    (safe_provider, 'DAY', day_key, 0, p_day_limit),
    (safe_provider, 'IN_FLIGHT', 'current', 0, p_in_flight_limit)
  on conflict (provider, window_kind, window_key) do update
    set limit_count = excluded.limit_count,
        updated_at = now();

  select used_count into current_hour
  from public.preview_provider_budgets_v3
  where provider = safe_provider and window_kind = 'HOUR' and window_key = hour_key
  for update;
  select used_count into current_day
  from public.preview_provider_budgets_v3
  where provider = safe_provider and window_kind = 'DAY' and window_key = day_key
  for update;
  select used_count into current_in_flight
  from public.preview_provider_budgets_v3
  where provider = safe_provider and window_kind = 'IN_FLIGHT' and window_key = 'current'
  for update;

  if current_hour + safe_units > p_hour_limit
     or current_day + safe_units > p_day_limit
     or current_in_flight + safe_units > p_in_flight_limit then
    return jsonb_build_object(
      'ok', true,
      'reserved', false,
      'reason', case
        when current_in_flight + safe_units > p_in_flight_limit then 'in_flight_limit'
        when current_hour + safe_units > p_hour_limit then 'hour_limit'
        else 'day_limit'
      end,
      'hour_used', current_hour,
      'day_used', current_day,
      'in_flight_used', current_in_flight
    );
  end if;

  update public.preview_provider_budgets_v3
  set used_count = used_count + safe_units,
      updated_at = now()
  where provider = safe_provider
    and (
      (window_kind = 'HOUR' and window_key = hour_key)
      or (window_kind = 'DAY' and window_key = day_key)
      or (window_kind = 'IN_FLIGHT' and window_key = 'current')
    );

  return jsonb_build_object(
    'ok', true,
    'reserved', true,
    'hour_used', current_hour + safe_units,
    'day_used', current_day + safe_units,
    'in_flight_used', current_in_flight + safe_units
  );
end;
$$;

create or replace function public.release_preview_provider_capacity_v3(
  p_provider text,
  p_units integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_provider text := lower(left(nullif(btrim(p_provider), ''), 120));
  safe_units integer := greatest(coalesce(p_units, 1), 1);
  remaining integer;
begin
  if safe_provider is null then
    return jsonb_build_object('ok', false, 'error', 'provider_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('preview-provider:' || safe_provider, 0));
  update public.preview_provider_budgets_v3
  set used_count = greatest(used_count - safe_units, 0),
      updated_at = now()
  where provider = safe_provider
    and window_kind = 'IN_FLIGHT'
    and window_key = 'current'
  returning used_count into remaining;

  return jsonb_build_object(
    'ok', true,
    'released', found,
    'in_flight_used', coalesce(remaining, 0)
  );
end;
$$;

create or replace function public.begin_preview_delivery_side_effect_v3(
  p_case_id uuid,
  p_task_id uuid,
  p_effect_type text,
  p_effect_key text,
  p_request_fingerprint text,
  p_request_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_effect_type text := upper(nullif(btrim(p_effect_type), ''));
  safe_effect_key text := left(nullif(btrim(p_effect_key), ''), 500);
  safe_fingerprint text := left(nullif(btrim(p_request_fingerprint), ''), 500);
  current_effect public.preview_delivery_side_effects_v3%rowtype;
  inserted_effect boolean := false;
begin
  if p_case_id is null or safe_effect_key is null or safe_fingerprint is null then
    return jsonb_build_object('ok', false, 'error', 'case_effect_key_and_fingerprint_required');
  end if;
  if safe_effect_type not in ('VIDEO_PROVIDER_SUBMIT', 'STORAGE_WRITE', 'OFFER_HANDOFF', 'CUSTOMER_DELIVERY') then
    return jsonb_build_object('ok', false, 'error', 'unsupported_side_effect_type');
  end if;
  if not exists (select 1 from public.preview_delivery_cases_v3 where id = p_case_id) then
    return jsonb_build_object('ok', false, 'error', 'case_not_found');
  end if;
  if p_task_id is not null and not exists (
    select 1 from public.preview_delivery_tasks_v3 where id = p_task_id and case_id = p_case_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'task_not_in_case');
  end if;

  insert into public.preview_delivery_side_effects_v3 (
    case_id, task_id, effect_key, effect_type, status,
    request_fingerprint, request_payload
  ) values (
    p_case_id, p_task_id, safe_effect_key, safe_effect_type, 'INTENT_RECORDED',
    safe_fingerprint, coalesce(p_request_payload, '{}'::jsonb)
  )
  on conflict (effect_key) do nothing
  returning true into inserted_effect;

  select * into current_effect
  from public.preview_delivery_side_effects_v3
  where effect_key = safe_effect_key
  for update;

  if current_effect.case_id <> p_case_id
     or current_effect.effect_type <> safe_effect_type
     or current_effect.request_fingerprint <> safe_fingerprint then
    return jsonb_build_object('ok', false, 'error', 'side_effect_key_conflict');
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', case
      when current_effect.status = 'INTENT_RECORDED' and inserted_effect then 'CALL_PROVIDER'
      when current_effect.status = 'INTENT_RECORDED' then 'RECONCILE'
      when current_effect.status = 'CONFIRMED' then 'SKIP_CONFIRMED'
      when current_effect.status = 'FAILED' then 'STOP_FAILED'
      else 'RECONCILE'
    end,
    'effect', to_jsonb(current_effect)
  );
end;
$$;

create or replace function public.finish_preview_delivery_side_effect_v3(
  p_effect_id uuid,
  p_status text,
  p_external_id text default null,
  p_receipt jsonb default null,
  p_last_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_status text := upper(nullif(btrim(p_status), ''));
  safe_external_id text := left(nullif(btrim(p_external_id), ''), 500);
  current_effect public.preview_delivery_side_effects_v3%rowtype;
begin
  if p_effect_id is null or safe_status not in ('ACCEPTED', 'UNKNOWN', 'CONFIRMED', 'FAILED') then
    return jsonb_build_object('ok', false, 'error', 'valid_effect_id_and_status_required');
  end if;

  select * into current_effect
  from public.preview_delivery_side_effects_v3
  where id = p_effect_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'side_effect_not_found'); end if;

  if current_effect.status = 'CONFIRMED' then
    if safe_status = 'CONFIRMED'
       and current_effect.external_id is not distinct from coalesce(safe_external_id, current_effect.external_id) then
      return jsonb_build_object('ok', true, 'idempotent', true, 'effect', to_jsonb(current_effect));
    end if;
    return jsonb_build_object('ok', false, 'error', 'confirmed_side_effect_is_terminal');
  end if;
  if current_effect.status = 'FAILED' and safe_status <> 'FAILED' then
    return jsonb_build_object('ok', false, 'error', 'failed_side_effect_requires_new_effect_key');
  end if;
  if current_effect.external_id is not null
     and safe_external_id is not null
     and current_effect.external_id <> safe_external_id then
    return jsonb_build_object('ok', false, 'error', 'conflicting_external_id');
  end if;

  update public.preview_delivery_side_effects_v3
  set status = safe_status,
      external_id = coalesce(safe_external_id, external_id),
      receipt = coalesce(p_receipt, receipt),
      last_error = left(nullif(btrim(p_last_error), ''), 4000),
      confirmed_at = case when safe_status = 'CONFIRMED' then now() else confirmed_at end,
      updated_at = now()
  where id = current_effect.id
  returning * into current_effect;

  insert into public.preview_delivery_events_v3 (
    case_id, task_id, event_key, event_type, stage, correlation_id, payload
  ) values (
    current_effect.case_id,
    current_effect.task_id,
    'preview-side-effect:' || current_effect.id::text || ':' || safe_status,
    'SIDE_EFFECT_' || safe_status,
    current_effect.effect_type,
    'preview:' || current_effect.case_id::text,
    jsonb_build_object(
      'effect_id', current_effect.id,
      'effect_type', current_effect.effect_type,
      'external_id', current_effect.external_id
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'idempotent', false, 'effect', to_jsonb(current_effect));
end;
$$;

create or replace function public.record_offer_delivery_receipt_v3(
  p_case_id uuid,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_case public.preview_delivery_cases_v3%rowtype;
  receipt_id text := left(nullif(btrim(p_receipt->>'receipt_id'), ''), 240);
  receipt_status text := upper(nullif(btrim(p_receipt->>'status'), ''));
begin
  if p_case_id is null or receipt_id is null or receipt_status <> 'DELIVERED' then
    return jsonb_build_object('ok', false, 'error', 'confirmed_delivery_receipt_required');
  end if;

  select * into current_case
  from public.preview_delivery_cases_v3
  where id = p_case_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'case_not_found'); end if;

  if current_case.status = 'DELIVERED' and current_case.delivery_receipt->>'receipt_id' = receipt_id then
    return jsonb_build_object('ok', true, 'idempotent', true, 'case', to_jsonb(current_case));
  end if;
  if current_case.status = 'DELIVERED' and current_case.delivery_receipt->>'receipt_id' is distinct from receipt_id then
    return jsonb_build_object('ok', false, 'error', 'conflicting_delivery_receipt');
  end if;

  update public.preview_delivery_cases_v3
  set status = 'DELIVERED',
      current_stage = 'DELIVERY',
      customer_communication_state = 'DELIVERED',
      delivery_receipt = p_receipt,
      case_version = case_version + 1,
      updated_at = now()
  where id = current_case.id
  returning * into current_case;

  insert into public.preview_delivery_events_v3 (
    case_id, event_key, event_type, stage, correlation_id, payload
  ) values (
    current_case.id,
    'preview-delivery-receipt:' || current_case.id::text || ':' || receipt_id,
    'DELIVERY_CONFIRMED',
    'DELIVERY',
    'preview:' || current_case.id::text,
    p_receipt
  ) on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'idempotent', false, 'case', to_jsonb(current_case));
end;
$$;

revoke all on function public.render_preview_delivery_failure_comment_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_preview_delivery_case_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_preview_delivery_task_v3(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_preview_delivery_task_v3(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_preview_delivery_failure_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_preview_delivery_projection_v3(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_preview_delivery_projection_v3(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.request_preview_delivery_retry_v1(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_preview_provider_capacity_v3(text, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_preview_provider_capacity_v3(text, integer)
  from public, anon, authenticated;
revoke all on function public.begin_preview_delivery_side_effect_v3(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.finish_preview_delivery_side_effect_v3(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.record_offer_delivery_receipt_v3(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.render_preview_delivery_failure_comment_v3(jsonb) to service_role;
grant execute on function public.enqueue_preview_delivery_case_v3(jsonb) to service_role;
grant execute on function public.claim_preview_delivery_task_v3(text, text, text, integer) to service_role;
grant execute on function public.complete_preview_delivery_task_v3(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.record_preview_delivery_failure_v3(jsonb) to service_role;
grant execute on function public.claim_preview_delivery_projection_v3(text, text, integer) to service_role;
grant execute on function public.finish_preview_delivery_projection_v3(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.request_preview_delivery_retry_v1(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.reserve_preview_provider_capacity_v3(text, integer, integer, integer, integer) to service_role;
grant execute on function public.release_preview_provider_capacity_v3(text, integer) to service_role;
grant execute on function public.begin_preview_delivery_side_effect_v3(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.finish_preview_delivery_side_effect_v3(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.record_offer_delivery_receipt_v3(uuid, jsonb) to service_role;

comment on function public.enqueue_preview_delivery_case_v3(jsonb) is
  'Creates one idempotent DB-owned preview-delivery case from a Trello intake event.';
comment on function public.claim_preview_delivery_task_v3(text, text, text, integer) is
  'Claims one short, token-bound v3 stage task. Provider waiting must be deferred in the DB.';
comment on function public.record_preview_delivery_failure_v3(jsonb) is
  'Records a canonical failure and durable Trello projection in one transaction.';
comment on function public.request_preview_delivery_retry_v1(uuid, uuid, uuid, text, text, jsonb) is
  'Creates one guarded recovery child job; never rewinds or mutates the failed original.';
comment on function public.reserve_preview_provider_capacity_v3(text, integer, integer, integer, integer) is
  'Atomically reserves hourly, daily and in-flight provider capacity in Postgres.';
comment on function public.begin_preview_delivery_side_effect_v3(uuid, uuid, text, text, text, jsonb) is
  'Persists side-effect intent before a provider call and returns a safe replay action.';
comment on function public.finish_preview_delivery_side_effect_v3(uuid, text, text, jsonb, text) is
  'Records the durable provider outcome; UNKNOWN must be reconciled instead of retried blindly.';
comment on function public.record_offer_delivery_receipt_v3(uuid, jsonb) is
  'Marks DELIVERED only from a confirmed Offers dispatcher receipt.';
