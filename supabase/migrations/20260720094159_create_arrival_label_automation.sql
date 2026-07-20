create table if not exists public.arrival_label_product_config (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  enabled boolean not null default false,
  standard_product_code text null,
  express_product_mapping jsonb not null default '{}'::jsonb,
  eu_product_mapping jsonb not null default '{}'::jsonb,
  pdf_layout_config jsonb not null default '{}'::jsonb,
  storage_bucket text not null default 'arrival-labels-private',
  printer_key text null,
  print_media text null,
  delivery_note_printer_key text null,
  delivery_note_print_media text null,
  approved_by text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_product_config_version_check check (version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  constraint arrival_label_product_config_eu_mapping_check check (jsonb_typeof(eu_product_mapping) = 'object'),
  constraint arrival_label_product_config_delivery_note_printer_check check (
    (delivery_note_printer_key is null and delivery_note_print_media is null)
    or (
      delivery_note_printer_key is not null
      and delivery_note_print_media is not null
      and delivery_note_printer_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and upper(delivery_note_print_media) = 'A4'
    )
  ),
  constraint arrival_label_product_config_enabled_check check (
    not enabled
    or (
      nullif(btrim(standard_product_code), '') is not null
      and jsonb_typeof(express_product_mapping) = 'object'
      and nullif(btrim(express_product_mapping ->> 'express'), '') is not null
      and nullif(btrim(express_product_mapping ->> 'express_09'), '') is not null
      and nullif(btrim(express_product_mapping ->> 'express_12'), '') is not null
      and nullif(btrim(express_product_mapping ->> 'urgent'), '') is not null
      and jsonb_typeof(pdf_layout_config) = 'object'
      and pdf_layout_config ? 'version'
      and pdf_layout_config ? 'safeArea'
      and pdf_layout_config ? 'protectedAreas'
      and nullif(btrim(printer_key), '') is not null
      and nullif(btrim(print_media), '') is not null
      and nullif(btrim(approved_by), '') is not null
      and approved_at is not null
    )
  )
);

create unique index if not exists arrival_label_product_config_one_enabled_idx
  on public.arrival_label_product_config (enabled)
  where enabled;

create table if not exists public.arrival_label_runs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  trigger_type text not null,
  mode text not null default 'dry_run',
  local_date date not null,
  timezone text not null default 'Europe/Berlin',
  config_version text null references public.arrival_label_product_config(version),
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb,
  error_code text null,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_runs_trigger_check check (trigger_type in ('manual_cli', 'manual_api', 'n8n_email', 'n8n_schedule', 'fixture_test')),
  constraint arrival_label_runs_mode_check check (mode in ('dry_run', 'execute')),
  constraint arrival_label_runs_timezone_check check (timezone = 'Europe/Berlin'),
  constraint arrival_label_runs_status_check check (status in ('running', 'completed', 'completed_with_review', 'failed'))
);

create index if not exists arrival_label_runs_date_idx
  on public.arrival_label_runs (local_date desc, started_at desc);

create table if not exists public.arrival_label_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.arrival_label_runs(id) on delete cascade,
  idempotency_key text not null unique,
  incoming_dhl_tracking_number text not null,
  incoming_dhl_last_six text generated always as (right(incoming_dhl_tracking_number, 6)) stored,
  expected_arrival_at timestamptz null,
  outlook_message_ids text[] not null default '{}'::text[],
  outlook_delivery_state text not null default 'due_today',
  trello_card_id text null,
  trello_card_name text null,
  trello_card_url text null,
  order_description text null,
  shopify_order_id text null,
  shopify_order_name text null,
  customer_name text null,
  shopify_note text null,
  shopify_note_hash text null,
  shipping_class text not null default 'unknown',
  destination_country_code text null,
  destination_class text not null default 'unknown',
  delivery_note_required boolean not null default false,
  delivery_note_status text not null default 'not_required',
  selected_dpd_product text null,
  existing_dpd_tracking text null,
  shopify_fulfillment_id text null,
  original_pdf_path text null,
  annotated_pdf_path text null,
  rendered_preview_path text null,
  status text not null default 'discovered',
  manual_review_reason text null,
  error_code text null,
  error_message text null,
  source_snapshot jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  lease_owner text null,
  lease_expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_cases_tracking_check check (incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'),
  constraint arrival_label_cases_outlook_state_check check (outlook_delivery_state in ('due_today', 'delivered_today', 'unknown')),
  constraint arrival_label_cases_shipping_class_check check (
    shipping_class in ('standard', 'express', 'express_09', 'express_12', 'express_18', 'urgent', 'special_case', 'unknown')
  ),
  constraint arrival_label_cases_destination_country_check check (destination_country_code is null or destination_country_code ~ '^[A-Z]{2}$'),
  constraint arrival_label_cases_destination_class_check check (
    destination_class in ('domestic_de', 'eu', 'switzerland', 'non_eu', 'special_territory', 'unknown')
  ),
  constraint arrival_label_cases_delivery_note_status_check check (
    delivery_note_status in ('not_required', 'planned', 'qa_approved', 'print_queued', 'printed', 'manual_review')
  ),
  constraint arrival_label_cases_delivery_note_requirement_check check (
    not delivery_note_required
    or (
      destination_class = 'eu'
      and destination_country_code is not null
      and destination_country_code <> 'DE'
      and delivery_note_status <> 'not_required'
    )
  ),
  constraint arrival_label_cases_status_check check (
    status in (
      'discovered',
      'trello_matched',
      'shopify_matched',
      'validated',
      'label_planned',
      'existing_label',
      'label_created',
      'pdf_processed',
      'completed',
      'manual_review',
      'missing_data',
      'ambiguous_match',
      'conflicting_instructions',
      'already_fulfilled',
      'label_error',
      'pdf_qa_failed',
      'special_case'
    )
  ),
  constraint arrival_label_cases_review_reason_check check (
    status not in ('manual_review', 'missing_data', 'ambiguous_match', 'conflicting_instructions', 'pdf_qa_failed')
    or nullif(btrim(manual_review_reason), '') is not null
  )
);

create unique index if not exists arrival_label_cases_order_inbound_unique_idx
  on public.arrival_label_cases (shopify_order_id, incoming_dhl_tracking_number)
  where shopify_order_id is not null;

create index if not exists arrival_label_cases_run_status_idx
  on public.arrival_label_cases (run_id, status, updated_at desc);

create index if not exists arrival_label_cases_lease_idx
  on public.arrival_label_cases (status, lease_expires_at)
  where status in ('validated', 'label_planned', 'label_created');

create table if not exists public.arrival_label_run_cases (
  run_id uuid not null references public.arrival_label_runs(id) on delete cascade,
  case_id uuid not null references public.arrival_label_cases(id) on delete cascade,
  decision_status text not null,
  decision_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, case_id)
);

create table if not exists public.arrival_label_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.arrival_label_runs(id) on delete cascade,
  case_id uuid null references public.arrival_label_cases(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  severity text not null default 'info',
  actor text not null default 'arrival-label-automation',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint arrival_label_events_severity_check check (severity in ('info', 'warning', 'error', 'critical'))
);

create index if not exists arrival_label_events_run_time_idx
  on public.arrival_label_events (run_id, created_at desc);

create index if not exists arrival_label_events_case_time_idx
  on public.arrival_label_events (case_id, created_at desc);

create table if not exists public.arrival_label_artifacts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.arrival_label_cases(id) on delete cascade,
  artifact_kind text not null,
  storage_bucket text not null,
  storage_key text not null,
  sha256 text not null,
  content_type text not null,
  byte_size bigint not null,
  page_width_points numeric null,
  page_height_points numeric null,
  qa_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint arrival_label_artifacts_kind_check check (artifact_kind in ('original_pdf', 'annotated_pdf', 'rendered_preview', 'delivery_note_pdf')),
  constraint arrival_label_artifacts_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint arrival_label_artifacts_byte_size_check check (byte_size > 0),
  constraint arrival_label_artifacts_storage_unique unique (storage_bucket, storage_key),
  constraint arrival_label_artifacts_case_kind_unique unique (case_id, artifact_kind)
);

create table if not exists public.arrival_label_print_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.arrival_label_cases(id) on delete cascade,
  artifact_id uuid not null unique references public.arrival_label_artifacts(id) on delete restrict,
  document_kind text not null,
  idempotency_key text not null unique,
  printer_key text not null,
  document_sha256 text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  cups_job_id text null,
  last_error text null,
  claimed_at timestamptz null,
  dispatching_at timestamptz null,
  submitted_at timestamptz null,
  printed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_print_jobs_idempotency_check check (length(idempotency_key) between 20 and 300),
  constraint arrival_label_print_jobs_document_kind_check check (document_kind in ('label', 'delivery_note')),
  constraint arrival_label_print_jobs_printer_check check (printer_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint arrival_label_print_jobs_sha256_check check (document_sha256 ~ '^[0-9a-f]{64}$'),
  constraint arrival_label_print_jobs_status_check check (
    status in ('queued', 'claimed', 'dispatching', 'submitted', 'printed', 'retryable_error', 'manual_review', 'cancelled')
  ),
  constraint arrival_label_print_jobs_attempts_check check (attempts >= 0 and max_attempts between 1 and 5)
);

create index if not exists arrival_label_print_jobs_claim_idx
  on public.arrival_label_print_jobs (printer_key, status, created_at)
  where status in ('queued', 'claimed', 'retryable_error');

create index if not exists arrival_label_print_jobs_reconcile_idx
  on public.arrival_label_print_jobs (printer_key, status, updated_at)
  where status in ('dispatching', 'submitted', 'manual_review');

create or replace function public.arrival_labels_require_delivery_note_before_label_creation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.delivery_note_required and new.status in ('label_created', 'pdf_processed', 'completed') then
    if new.delivery_note_status <> 'printed' or not exists (
      select 1
      from public.arrival_label_artifacts a
      join public.arrival_label_print_jobs j on j.artifact_id = a.id
      where a.case_id = new.id
        and a.artifact_kind = 'delivery_note_pdf'
        and a.content_type = 'application/pdf'
        and coalesce(a.qa_result ->> 'ok', 'false') = 'true'
        and j.document_kind = 'delivery_note'
        and j.status = 'printed'
    ) then
      raise exception 'EU label purchase is blocked until a QA-approved delivery note is confirmed printed';
    end if;
  end if;
  return new;
end;
$$;

create trigger arrival_label_cases_delivery_note_purchase_gate
before insert or update of status, delivery_note_status on public.arrival_label_cases
for each row execute function public.arrival_labels_require_delivery_note_before_label_creation();

revoke execute on function public.arrival_labels_require_delivery_note_before_label_creation() from public, anon, authenticated;
grant execute on function public.arrival_labels_require_delivery_note_before_label_creation() to service_role;

create table if not exists public.arrival_label_review_notifications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.arrival_label_cases(id) on delete cascade,
  notification_key text not null unique,
  recipient_email text not null default 'info@neontrip.de',
  subject text not null,
  body_text text not null,
  shopify_order_url text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  dispatch_receipt_id text null,
  last_error text null,
  claimed_at timestamptz null,
  dispatching_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_review_notifications_key_check check (notification_key ~ '^arrival-review:[0-9a-f]{64}$'),
  constraint arrival_label_review_notifications_recipient_check check (recipient_email = 'info@neontrip.de'),
  constraint arrival_label_review_notifications_subject_check check (length(subject) between 20 and 200 and subject !~ E'[\\r\\n]'),
  constraint arrival_label_review_notifications_body_check check (length(body_text) between 50 and 4000),
  constraint arrival_label_review_notifications_shopify_url_check check (
    shopify_order_url is null or shopify_order_url ~ '^https://[A-Za-z0-9-]+[.]myshopify[.]com/admin/orders/[0-9]+$'
  ),
  constraint arrival_label_review_notifications_status_check check (
    status in ('pending', 'claimed', 'dispatching', 'sent', 'retryable_error', 'manual_review', 'cancelled')
  ),
  constraint arrival_label_review_notifications_attempts_check check (attempts >= 0 and max_attempts between 1 and 5)
);

create index if not exists arrival_label_review_notifications_claim_idx
  on public.arrival_label_review_notifications (status, created_at)
  where status in ('pending', 'claimed', 'retryable_error');

create index if not exists arrival_label_review_notifications_reconcile_idx
  on public.arrival_label_review_notifications (status, updated_at)
  where status in ('dispatching', 'manual_review');

alter table public.arrival_label_product_config enable row level security;
alter table public.arrival_label_runs enable row level security;
alter table public.arrival_label_cases enable row level security;
alter table public.arrival_label_run_cases enable row level security;
alter table public.arrival_label_events enable row level security;
alter table public.arrival_label_artifacts enable row level security;
alter table public.arrival_label_print_jobs enable row level security;
alter table public.arrival_label_review_notifications enable row level security;

revoke all on table public.arrival_label_product_config from anon, authenticated;
revoke all on table public.arrival_label_runs from anon, authenticated;
revoke all on table public.arrival_label_cases from anon, authenticated;
revoke all on table public.arrival_label_run_cases from anon, authenticated;
revoke all on table public.arrival_label_events from anon, authenticated;
revoke all on table public.arrival_label_artifacts from anon, authenticated;
revoke all on table public.arrival_label_print_jobs from anon, authenticated;
revoke all on table public.arrival_label_review_notifications from anon, authenticated;

grant select, insert, update, delete on table public.arrival_label_product_config to service_role;
grant select, insert, update, delete on table public.arrival_label_runs to service_role;
grant select, insert, update, delete on table public.arrival_label_cases to service_role;
grant select, insert on table public.arrival_label_run_cases to service_role;
grant select, insert on table public.arrival_label_events to service_role;
grant select, insert on table public.arrival_label_artifacts to service_role;
grant select, insert, update on table public.arrival_label_print_jobs to service_role;
grant select, insert, update on table public.arrival_label_review_notifications to service_role;

create or replace function public.arrival_labels_claim_case(
  p_case_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 300,
  p_now timestamptz default now()
)
returns setof public.arrival_label_cases
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.arrival_label_cases%rowtype;
begin
  if nullif(btrim(coalesce(p_lease_owner, '')), '') is null then
    raise exception 'lease owner is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'lease seconds must be between 30 and 1800';
  end if;

  select *
  into v_case
  from public.arrival_label_cases
  where id = p_case_id
    and status in ('validated', 'label_planned', 'label_created')
    and (lease_expires_at is null or lease_expires_at <= p_now or lease_owner = p_lease_owner)
  for update skip locked;

  if not found then
    return;
  end if;

  update public.arrival_label_cases
  set lease_owner = p_lease_owner,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      updated_at = p_now
  where id = p_case_id
  returning * into v_case;

  return next v_case;
end;
$$;

revoke execute on function public.arrival_labels_claim_case(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_claim_case(uuid, text, integer, timestamptz) to service_role;

create or replace function public.arrival_labels_enqueue_print_job(
  p_case_id uuid,
  p_artifact_id uuid,
  p_printer_key text,
  p_idempotency_key text
)
returns setof public.arrival_label_print_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_artifact public.arrival_label_artifacts%rowtype;
  v_case public.arrival_label_cases%rowtype;
  v_config public.arrival_label_product_config%rowtype;
  v_job public.arrival_label_print_jobs%rowtype;
  v_document_kind text;
begin
  if coalesce(p_printer_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'invalid printer key';
  end if;
  if length(coalesce(p_idempotency_key, '')) not between 20 and 300 then
    raise exception 'invalid print idempotency key';
  end if;

  select * into v_artifact
  from public.arrival_label_artifacts
  where id = p_artifact_id and case_id = p_case_id
  for share;

  if not found
    or v_artifact.artifact_kind not in ('annotated_pdf', 'delivery_note_pdf')
    or v_artifact.content_type <> 'application/pdf'
    or coalesce(v_artifact.qa_result ->> 'ok', 'false') <> 'true' then
    raise exception 'only a QA-approved label or delivery-note PDF can be printed';
  end if;

  select * into v_case from public.arrival_label_cases where id = p_case_id for update;
  if not found then raise exception 'arrival-label case not found'; end if;
  select * into v_config from public.arrival_label_product_config where enabled is true for share;
  if not found then raise exception 'active product configuration not found'; end if;

  if v_artifact.artifact_kind = 'annotated_pdf' then
    v_document_kind := 'label';
    if v_case.status not in ('pdf_processed', 'completed') or p_printer_key <> v_config.printer_key then
      raise exception 'case or printer is not ready for label printing';
    end if;
  else
    v_document_kind := 'delivery_note';
    if not v_case.delivery_note_required
      or v_case.delivery_note_status not in ('qa_approved', 'print_queued')
      or v_case.status not in ('label_planned', 'existing_label')
      or p_printer_key <> v_config.delivery_note_printer_key
      or upper(coalesce(v_config.delivery_note_print_media, '')) <> 'A4' then
      raise exception 'case or printer is not ready for delivery-note printing';
    end if;
  end if;

  insert into public.arrival_label_print_jobs (
    case_id, artifact_id, document_kind, idempotency_key, printer_key, document_sha256
  ) values (
    p_case_id, p_artifact_id, v_document_kind, p_idempotency_key, p_printer_key, v_artifact.sha256
  )
  on conflict (idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job
    from public.arrival_label_print_jobs
    where idempotency_key = p_idempotency_key;
    if v_job.case_id <> p_case_id or v_job.artifact_id <> p_artifact_id or v_job.printer_key <> p_printer_key or v_job.document_kind <> v_document_kind then
      raise exception 'print idempotency key belongs to different input';
    end if;
  end if;

  if v_document_kind = 'delivery_note' and v_case.delivery_note_status = 'qa_approved' then
    update public.arrival_label_cases
    set delivery_note_status = 'print_queued', updated_at = now()
    where id = p_case_id;
  end if;

  return next v_job;
end;
$$;

create or replace function public.arrival_labels_claim_print_job(
  p_worker_id text,
  p_printer_key text,
  p_lease_seconds integer default 180,
  p_now timestamptz default now()
)
returns setof public.arrival_label_print_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_print_jobs%rowtype;
  v_exhausted_case_ids uuid[];
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid print worker id';
  end if;
  if coalesce(p_printer_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'invalid printer key';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'print lease seconds must be between 60 and 900';
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where lease_owner = p_worker_id
    and printer_key = p_printer_key
    and status = 'claimed'
    and lease_expires_at > p_now
  order by claimed_at desc
  limit 1
  for update skip locked;

  if found then
    return next v_job;
    return;
  end if;

  with exhausted as (
    update public.arrival_label_print_jobs
    set status = 'manual_review',
        lease_owner = null,
        lease_expires_at = null,
        last_error = 'Print worker stopped before dispatch and exhausted safe retry attempts.',
        updated_at = p_now
    where printer_key = p_printer_key
      and status in ('claimed', 'retryable_error')
      and attempts >= max_attempts
      and (lease_expires_at is null or lease_expires_at <= p_now)
    returning id, case_id
  )
  select coalesce(array_agg(case_id), array[]::uuid[])
  into v_exhausted_case_ids
  from exhausted;

  if cardinality(v_exhausted_case_ids) > 0 then
    update public.arrival_label_cases
    set status = 'manual_review',
        delivery_note_status = case
          when exists (
            select 1 from public.arrival_label_print_jobs j
            where j.case_id = arrival_label_cases.id and j.document_kind = 'delivery_note' and j.status = 'manual_review'
          ) then 'manual_review'
          else delivery_note_status
        end,
        manual_review_reason = 'Druck fehlgeschlagen; maximale Anzahl sicherer Vorab-Versuche erreicht.',
        updated_at = p_now
    where id = any(v_exhausted_case_ids);

    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      j.case_id,
      'print:' || j.id::text || ':retry_exhausted',
      'print_retry_exhausted',
      'warning',
      'arrival-label-print-queue',
      jsonb_build_object('printJobId', j.id, 'printerKey', j.printer_key, 'attempts', j.attempts)
    from public.arrival_label_print_jobs j
    join public.arrival_label_cases c on c.id = j.case_id
    where j.case_id = any(v_exhausted_case_ids) and j.status = 'manual_review'
    on conflict (event_key) do nothing;
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where printer_key = p_printer_key
    and status in ('queued', 'claimed', 'retryable_error')
    and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at <= p_now)
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then return; end if;

  update public.arrival_label_print_jobs
  set status = 'claimed',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      claimed_at = p_now,
      last_error = null,
      updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.arrival_labels_update_print_job(
  p_job_id uuid,
  p_worker_id text,
  p_result text,
  p_cups_job_id text default null,
  p_error text default null,
  p_now timestamptz default now()
)
returns setof public.arrival_label_print_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_print_jobs%rowtype;
  v_next_status text;
  v_retry_exhausted boolean;
begin
  if p_result not in ('dispatching', 'submitted', 'printed', 'retryable_error', 'uncertain') then
    raise exception 'invalid print result';
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where id = p_job_id and lease_owner = p_worker_id
  for update;
  if not found then raise exception 'print job not owned by worker'; end if;

  if p_result in ('submitted', 'printed')
    and coalesce(nullif(btrim(p_cups_job_id), ''), v_job.cups_job_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}-[0-9]+$' then
    raise exception 'valid CUPS job id is required';
  end if;

  if p_result = 'dispatching' and v_job.status not in ('claimed', 'dispatching') then
    raise exception 'invalid transition to dispatching';
  elsif p_result = 'submitted' and v_job.status not in ('dispatching', 'submitted') then
    raise exception 'invalid transition to submitted';
  elsif p_result = 'printed' and v_job.status not in ('dispatching', 'submitted', 'printed') then
    raise exception 'invalid transition to printed';
  elsif p_result = 'retryable_error'
    and v_job.status not in ('claimed', 'retryable_error', 'manual_review') then
    raise exception 'retry is safe only before print dispatch';
  elsif p_result = 'uncertain' and v_job.status not in ('dispatching', 'submitted', 'manual_review') then
    raise exception 'uncertain is valid only after print dispatch';
  end if;

  v_retry_exhausted := p_result = 'retryable_error' and v_job.attempts >= v_job.max_attempts;
  if p_result = 'retryable_error' and v_job.status = 'manual_review' and not v_retry_exhausted then
    raise exception 'manual review cannot return to automatic retry';
  end if;

  v_next_status := case
    when p_result = 'uncertain' or v_retry_exhausted then 'manual_review'
    else p_result
  end;
  update public.arrival_label_print_jobs
  set status = v_next_status,
      cups_job_id = coalesce(nullif(btrim(p_cups_job_id), ''), cups_job_id),
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      dispatching_at = case when p_result = 'dispatching' then coalesce(dispatching_at, p_now) else dispatching_at end,
      submitted_at = case when p_result = 'submitted' then coalesce(submitted_at, p_now) else submitted_at end,
      printed_at = case when p_result = 'printed' then coalesce(printed_at, p_now) else printed_at end,
      lease_expires_at = case
        when p_result in ('printed', 'uncertain') or v_retry_exhausted then null
        else lease_expires_at
      end,
      updated_at = p_now
  where id = p_job_id
  returning * into v_job;

  if p_result = 'printed' then
    if v_job.document_kind = 'delivery_note' then
      update public.arrival_label_cases
      set delivery_note_status = 'printed', updated_at = p_now
      where id = v_job.case_id;
    else
      update public.arrival_label_cases
      set status = 'completed',
          manual_review_reason = null,
          updated_at = p_now
      where id = v_job.case_id;
    end if;
  elsif p_result = 'uncertain' or v_retry_exhausted then
    update public.arrival_label_cases
    set status = 'manual_review',
        delivery_note_status = case when v_job.document_kind = 'delivery_note' then 'manual_review' else delivery_note_status end,
        manual_review_reason = case
          when p_result = 'uncertain'
            then 'Druckstatus ist unklar; physisch pruefen und nicht automatisch erneut drucken.'
          else 'Druck fehlgeschlagen; maximale Anzahl sicherer Vorab-Versuche erreicht.'
        end,
        updated_at = p_now
    where id = v_job.case_id;
  end if;

  insert into public.arrival_label_events (
    run_id, case_id, event_key, event_type, severity, actor, payload
  )
  select
    c.run_id,
    c.id,
    'print:' || v_job.id::text || ':' || p_result,
    'print_' || p_result,
    case when p_result in ('retryable_error', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-print-worker:' || left(p_worker_id, 96),
    jsonb_build_object(
      'printJobId', v_job.id,
      'documentKind', v_job.document_kind,
      'printerKey', v_job.printer_key,
      'cupsJobId', v_job.cups_job_id,
      'attempts', v_job.attempts,
      'retryExhausted', v_retry_exhausted
    )
  from public.arrival_label_cases c
  where c.id = v_job.case_id
  on conflict (event_key) do nothing;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_enqueue_print_job(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.arrival_labels_claim_print_job(text, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_update_print_job(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_print_job(uuid, uuid, text, text) to service_role;
grant execute on function public.arrival_labels_claim_print_job(text, text, integer, timestamptz) to service_role;
grant execute on function public.arrival_labels_update_print_job(uuid, text, text, text, text, timestamptz) to service_role;

create or replace function public.arrival_labels_enqueue_review_notification(
  p_case_id uuid,
  p_notification_key text,
  p_recipient_email text,
  p_subject text,
  p_body_text text,
  p_shopify_order_url text default null
)
returns setof public.arrival_label_review_notifications
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.arrival_label_cases%rowtype;
  v_notification public.arrival_label_review_notifications%rowtype;
begin
  select * into v_case
  from public.arrival_label_cases
  where id = p_case_id
  for share;
  if not found then raise exception 'arrival label case not found'; end if;
  if v_case.status not in ('manual_review', 'missing_data', 'ambiguous_match', 'conflicting_instructions', 'special_case')
    or v_case.selected_dpd_product is not null then
    raise exception 'only a blocked case without DPD product can enqueue a review notification';
  end if;
  if coalesce(p_notification_key, '') !~ '^arrival-review:[0-9a-f]{64}$' then raise exception 'invalid notification key'; end if;
  if p_recipient_email <> 'info@neontrip.de' then raise exception 'review recipient is not allowlisted'; end if;
  if length(coalesce(p_subject, '')) not between 20 and 200 or p_subject ~ E'[\\r\\n]' then raise exception 'invalid review subject'; end if;
  if length(coalesce(p_body_text, '')) not between 50 and 4000 then raise exception 'invalid review body'; end if;
  if p_shopify_order_url is not null
    and p_shopify_order_url !~ '^https://[A-Za-z0-9-]+[.]myshopify[.]com/admin/orders/[0-9]+$' then
    raise exception 'invalid Shopify order URL';
  end if;

  insert into public.arrival_label_review_notifications (
    case_id, notification_key, recipient_email, subject, body_text, shopify_order_url
  ) values (
    p_case_id, p_notification_key, p_recipient_email, p_subject, p_body_text, p_shopify_order_url
  )
  on conflict (notification_key) do nothing
  returning * into v_notification;

  if not found then
    select * into v_notification
    from public.arrival_label_review_notifications
    where notification_key = p_notification_key;
    if v_notification.case_id <> p_case_id
      or v_notification.recipient_email <> p_recipient_email
      or v_notification.subject <> p_subject
      or v_notification.body_text <> p_body_text
      or v_notification.shopify_order_url is distinct from p_shopify_order_url then
      raise exception 'review notification idempotency key belongs to different input';
    end if;
  end if;

  insert into public.arrival_label_events (
    run_id, case_id, event_key, event_type, severity, actor, payload
  ) values (
    v_case.run_id,
    v_case.id,
    'review:' || v_notification.id::text || ':queued',
    'review_notification_queued',
    'warning',
    'arrival-label-review-outbox',
    jsonb_build_object('notificationId', v_notification.id, 'recipient', v_notification.recipient_email)
  ) on conflict (event_key) do nothing;

  return next v_notification;
end;
$$;

create or replace function public.arrival_labels_claim_review_notification(
  p_worker_id text,
  p_lease_seconds integer default 180,
  p_now timestamptz default now()
)
returns setof public.arrival_label_review_notifications
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_notification public.arrival_label_review_notifications%rowtype;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then raise exception 'invalid review worker id'; end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then raise exception 'review lease seconds must be between 60 and 900'; end if;

  select * into v_notification
  from public.arrival_label_review_notifications
  where lease_owner = p_worker_id and status = 'claimed' and lease_expires_at > p_now
  order by claimed_at desc limit 1 for update skip locked;
  if found then return next v_notification; return; end if;

  with uncertain as (
    update public.arrival_label_review_notifications
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Mail dispatch began but completion is unknown; do not automatically resend.', updated_at = p_now
    where status = 'dispatching' and lease_expires_at <= p_now
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, u.case_id, 'review:' || u.id::text || ':uncertain', 'review_notification_uncertain', 'warning',
         'arrival-label-review-outbox', jsonb_build_object('notificationId', u.id, 'automaticResend', false)
  from uncertain u join public.arrival_label_cases c on c.id = u.case_id
  on conflict (event_key) do nothing;

  with exhausted as (
    update public.arrival_label_review_notifications
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Review notification exhausted safe retries before dispatch.', updated_at = p_now
    where status in ('claimed', 'retryable_error') and attempts >= max_attempts
      and (lease_expires_at is null or lease_expires_at <= p_now)
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, e.case_id, 'review:' || e.id::text || ':retry_exhausted', 'review_notification_retry_exhausted', 'warning',
         'arrival-label-review-outbox', jsonb_build_object('notificationId', e.id)
  from exhausted e join public.arrival_label_cases c on c.id = e.case_id
  on conflict (event_key) do nothing;

  select * into v_notification
  from public.arrival_label_review_notifications
  where status in ('pending', 'claimed', 'retryable_error') and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at <= p_now)
  order by created_at asc limit 1 for update skip locked;
  if not found then return; end if;

  update public.arrival_label_review_notifications
  set status = 'claimed', attempts = attempts + 1, lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds), claimed_at = p_now,
      last_error = null, updated_at = p_now
  where id = v_notification.id
  returning * into v_notification;
  return next v_notification;
end;
$$;

create or replace function public.arrival_labels_update_review_notification(
  p_notification_id uuid,
  p_worker_id text,
  p_result text,
  p_dispatch_receipt_id text default null,
  p_error text default null,
  p_now timestamptz default now()
)
returns setof public.arrival_label_review_notifications
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_notification public.arrival_label_review_notifications%rowtype;
  v_next_status text;
  v_retry_exhausted boolean;
  v_run_id uuid;
begin
  if p_result not in ('dispatching', 'sent', 'retryable_error', 'uncertain') then raise exception 'invalid review result'; end if;
  select * into v_notification
  from public.arrival_label_review_notifications
  where id = p_notification_id
    and (
      lease_owner = p_worker_id
      or (
        status = 'sent'
        and p_result = 'sent'
        and (
          nullif(btrim(p_dispatch_receipt_id), '') is null
          or dispatch_receipt_id = nullif(btrim(p_dispatch_receipt_id), '')
        )
      )
    )
  for update;
  if not found then raise exception 'review notification not owned by worker'; end if;
  if p_result = 'sent' and coalesce(nullif(btrim(p_dispatch_receipt_id), ''), v_notification.dispatch_receipt_id, '') !~ '^[^[:cntrl:]]{1,500}$' then
    raise exception 'dispatch receipt id is required';
  end if;
  if p_result = 'dispatching' and v_notification.status not in ('claimed', 'dispatching') then
    raise exception 'invalid transition to review dispatching';
  elsif p_result = 'sent' and v_notification.status not in ('dispatching', 'sent') then
    raise exception 'invalid transition to review sent';
  elsif p_result = 'retryable_error' and v_notification.status not in ('claimed', 'retryable_error', 'manual_review') then
    raise exception 'review retry is safe only before mail dispatch';
  elsif p_result = 'uncertain' and v_notification.status not in ('dispatching', 'manual_review') then
    raise exception 'review uncertainty is valid only after mail dispatch';
  end if;
  v_retry_exhausted := p_result = 'retryable_error' and v_notification.attempts >= v_notification.max_attempts;
  if p_result = 'retryable_error' and v_notification.status = 'manual_review' and not v_retry_exhausted then
    raise exception 'review manual state cannot return to automatic retry';
  end if;
  v_next_status := case when p_result = 'uncertain' or v_retry_exhausted then 'manual_review' else p_result end;
  update public.arrival_label_review_notifications
  set status = v_next_status,
      dispatch_receipt_id = coalesce(nullif(btrim(p_dispatch_receipt_id), ''), dispatch_receipt_id),
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      dispatching_at = case when p_result = 'dispatching' then coalesce(dispatching_at, p_now) else dispatching_at end,
      sent_at = case when p_result = 'sent' then coalesce(sent_at, p_now) else sent_at end,
      lease_expires_at = case when p_result in ('sent', 'retryable_error', 'uncertain') or v_retry_exhausted then null else lease_expires_at end,
      lease_owner = case when p_result in ('sent', 'retryable_error', 'uncertain') or v_retry_exhausted then null else lease_owner end,
      updated_at = p_now
  where id = p_notification_id
  returning * into v_notification;

  select run_id into v_run_id from public.arrival_label_cases where id = v_notification.case_id;
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  values (
    v_run_id, v_notification.case_id, 'review:' || v_notification.id::text || ':' || p_result,
    'review_notification_' || p_result,
    case when p_result in ('retryable_error', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-review-worker:' || left(p_worker_id, 96),
    jsonb_build_object(
      'notificationId', v_notification.id,
      'dispatchReceiptId', v_notification.dispatch_receipt_id,
      'attempts', v_notification.attempts,
      'retryExhausted', v_retry_exhausted
    )
  ) on conflict (event_key) do nothing;
  return next v_notification;
end;
$$;

revoke execute on function public.arrival_labels_enqueue_review_notification(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.arrival_labels_claim_review_notification(text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_update_review_notification(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_review_notification(uuid, text, text, text, text, text) to service_role;
grant execute on function public.arrival_labels_claim_review_notification(text, integer, timestamptz) to service_role;
grant execute on function public.arrival_labels_update_review_notification(uuid, text, text, text, text, timestamptz) to service_role;

comment on table public.arrival_label_runs is 'Audited runs for DHL arrival to DPD label automation. Dry-run is the default and does not authorize side effects.';
comment on table public.arrival_label_cases is 'Postgres source of truth for one Shopify order plus inbound DHL shipment idempotency boundary.';
comment on table public.arrival_label_run_cases is 'Immutable per-run projection of each case decision; arrival_label_cases holds the latest known case state.';
comment on table public.arrival_label_product_config is 'Versioned, human-approved EasyDPD product and PDF layout mapping. No active default is seeded.';
comment on table public.arrival_label_events is 'Append-only operational audit trail without secret values or raw PDF bodies.';
comment on table public.arrival_label_print_jobs is 'Exactly-once-oriented local print spool. Dispatch uncertainty requires manual review and is never auto-reprinted.';
comment on table public.arrival_label_review_notifications is 'Idempotent internal review-mail outbox. A dispatch uncertainty requires manual review and is never auto-resent.';
