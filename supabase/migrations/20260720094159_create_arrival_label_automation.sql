create table if not exists public.arrival_label_product_config (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  enabled boolean not null default false,
  standard_product_code text null,
  express_product_mapping jsonb not null default '{}'::jsonb,
  pdf_layout_config jsonb not null default '{}'::jsonb,
  storage_bucket text not null default 'arrival-labels-private',
  approved_by text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_product_config_version_check check (version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  constraint arrival_label_product_config_enabled_check check (
    not enabled
    or (
      nullif(btrim(standard_product_code), '') is not null
      and jsonb_typeof(express_product_mapping) = 'object'
      and nullif(btrim(express_product_mapping ->> 'express'), '') is not null
      and nullif(btrim(express_product_mapping ->> 'urgent'), '') is not null
      and jsonb_typeof(pdf_layout_config) = 'object'
      and pdf_layout_config ? 'version'
      and pdf_layout_config ? 'safeArea'
      and pdf_layout_config ? 'protectedAreas'
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
  constraint arrival_label_runs_trigger_check check (trigger_type in ('manual_cli', 'manual_api', 'n8n_schedule', 'fixture_test')),
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
  incoming_dhl_last_four text generated always as (right(incoming_dhl_tracking_number, 4)) stored,
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
  constraint arrival_label_cases_shipping_class_check check (shipping_class in ('standard', 'express', 'urgent', 'special_case', 'unknown')),
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
  constraint arrival_label_artifacts_kind_check check (artifact_kind in ('original_pdf', 'annotated_pdf', 'rendered_preview')),
  constraint arrival_label_artifacts_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint arrival_label_artifacts_byte_size_check check (byte_size > 0),
  constraint arrival_label_artifacts_storage_unique unique (storage_bucket, storage_key),
  constraint arrival_label_artifacts_case_kind_unique unique (case_id, artifact_kind)
);

alter table public.arrival_label_product_config enable row level security;
alter table public.arrival_label_runs enable row level security;
alter table public.arrival_label_cases enable row level security;
alter table public.arrival_label_run_cases enable row level security;
alter table public.arrival_label_events enable row level security;
alter table public.arrival_label_artifacts enable row level security;

revoke all on table public.arrival_label_product_config from anon, authenticated;
revoke all on table public.arrival_label_runs from anon, authenticated;
revoke all on table public.arrival_label_cases from anon, authenticated;
revoke all on table public.arrival_label_run_cases from anon, authenticated;
revoke all on table public.arrival_label_events from anon, authenticated;
revoke all on table public.arrival_label_artifacts from anon, authenticated;

grant select, insert, update, delete on table public.arrival_label_product_config to service_role;
grant select, insert, update, delete on table public.arrival_label_runs to service_role;
grant select, insert, update, delete on table public.arrival_label_cases to service_role;
grant select, insert on table public.arrival_label_run_cases to service_role;
grant select, insert on table public.arrival_label_events to service_role;
grant select, insert on table public.arrival_label_artifacts to service_role;

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

comment on table public.arrival_label_runs is 'Audited runs for DHL arrival to DPD label automation. Dry-run is the default and does not authorize side effects.';
comment on table public.arrival_label_cases is 'Postgres source of truth for one Shopify order plus inbound DHL shipment idempotency boundary.';
comment on table public.arrival_label_run_cases is 'Immutable per-run projection of each case decision; arrival_label_cases holds the latest known case state.';
comment on table public.arrival_label_product_config is 'Versioned, human-approved EasyDPD product and PDF layout mapping. No active default is seeded.';
comment on table public.arrival_label_events is 'Append-only operational audit trail without secret values or raw PDF bodies.';
