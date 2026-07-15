-- Canonical Company Brain foundation. Operational systems remain the systems of
-- record; these tables provide governed identities, provenance and correlations.

create table if not exists public.company_source_registry (
  source_key text primary key,
  display_name text not null,
  source_kind text not null,
  authority text not null,
  owner_team text not null,
  criticality text not null default 'standard',
  expected_freshness interval,
  contains_personal_data boolean not null default false,
  active boolean not null default true,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_source_registry_key_check check (source_key ~ '^[a-z0-9][a-z0-9_]{1,79}$'),
  constraint company_source_registry_kind_check check (
    source_kind in ('database', 'api', 'automation', 'projection', 'document', 'manual')
  ),
  constraint company_source_registry_authority_check check (
    authority in ('authoritative', 'operational', 'evidence', 'projection', 'advisory')
  ),
  constraint company_source_registry_criticality_check check (
    criticality in ('standard', 'important', 'critical')
  ),
  constraint company_source_registry_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_workflow_registry (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.company_source_registry(source_key),
  external_workflow_id text not null,
  workflow_name text not null,
  lifecycle_status text not null default 'unreviewed',
  active boolean not null default false,
  owner_team text,
  business_purpose text,
  trigger_contract text,
  output_contract text,
  runbook_url text,
  current_version text,
  node_count integer,
  trigger_count integer,
  warning_count integer,
  max_allowed_nodes integer not null default 30,
  last_reviewed_at timestamptz,
  last_synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_workflow_registry_external_key unique (source_key, external_workflow_id),
  constraint company_workflow_registry_lifecycle_check check (
    lifecycle_status in ('unreviewed', 'draft', 'production', 'paused', 'deprecated', 'archived')
  ),
  constraint company_workflow_registry_count_check check (
    (node_count is null or node_count >= 0)
    and (trigger_count is null or trigger_count >= 0)
    and (warning_count is null or warning_count >= 0)
    and max_allowed_nodes between 1 and 200
  ),
  constraint company_workflow_registry_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_correlation_contracts (
  event_type text primary key,
  owner_team text not null,
  required_identifiers text[] not null,
  required_payload_fields text[] not null default '{}',
  schema_version text not null default 'v1',
  severity_when_incomplete text not null default 'warning',
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_correlation_contracts_event_check check (event_type ~ '^[a-z0-9][a-z0-9_.-]{2,119}$'),
  constraint company_correlation_contracts_identifiers_check check (cardinality(required_identifiers) > 0),
  constraint company_correlation_contracts_severity_check check (
    severity_when_incomplete in ('info', 'warning', 'critical')
  )
);

create table if not exists public.company_entity_registry (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  canonical_key text not null,
  display_label text,
  source_key text not null references public.company_source_registry(source_key),
  source_ref text,
  lifecycle_status text not null default 'active',
  sensitivity text not null default 'internal',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_entity_registry_canonical_key unique (entity_type, canonical_key),
  constraint company_entity_registry_type_check check (
    entity_type in (
      'organization', 'customer', 'request', 'offer', 'order', 'design_asset',
      'communication', 'workflow_run', 'task', 'incident', 'decision',
      'knowledge_article', 'metric', 'meeting'
    )
  ),
  constraint company_entity_registry_status_check check (
    lifecycle_status in ('active', 'merged', 'closed', 'retired')
  ),
  constraint company_entity_registry_sensitivity_check check (
    sensitivity in ('public', 'internal', 'personal', 'restricted')
  ),
  constraint company_entity_registry_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.company_entity_registry(id) on delete cascade,
  source_key text not null references public.company_source_registry(source_key),
  alias_type text not null,
  alias_value text not null,
  normalized_alias_value text generated always as (lower(btrim(alias_value))) stored,
  confidence numeric(5,4) not null default 1,
  resolution_method text not null,
  source_ref text,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_entity_aliases_source_value_key unique (
    source_key, alias_type, normalized_alias_value
  ),
  constraint company_entity_aliases_type_check check (alias_type ~ '^[a-z0-9][a-z0-9_]{1,79}$'),
  constraint company_entity_aliases_value_check check (char_length(btrim(alias_value)) between 1 and 500),
  constraint company_entity_aliases_confidence_check check (confidence between 0 and 1),
  constraint company_entity_aliases_method_check check (
    resolution_method in ('deterministic', 'manual', 'import', 'backfill', 'inferred')
  ),
  constraint company_entity_aliases_review_check check (
    resolution_method <> 'inferred' or confidence < 1 or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint company_entity_aliases_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_identity_resolution_log (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.company_source_registry(source_key),
  alias_type text not null,
  alias_value_hash text not null,
  resolved_entity_id uuid references public.company_entity_registry(id) on delete set null,
  outcome text not null,
  confidence numeric(5,4),
  candidate_entity_ids uuid[] not null default '{}',
  resolver_version text not null,
  correlation_id text,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint company_identity_resolution_outcome_check check (
    outcome in ('matched', 'unmatched', 'ambiguous', 'rejected')
  ),
  constraint company_identity_resolution_confidence_check check (
    confidence is null or confidence between 0 and 1
  ),
  constraint company_identity_resolution_result_check check (
    (outcome = 'matched' and resolved_entity_id is not null)
    or (outcome <> 'matched')
  ),
  constraint company_identity_resolution_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  entity_id uuid references public.company_entity_registry(id) on delete set null,
  request_id text,
  correlation_id text not null,
  causation_id text,
  source_key text not null references public.company_source_registry(source_key),
  source_ref text not null,
  schema_version text not null default 'v1',
  trust_class text not null default 'operational',
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint company_events_type_check check (event_type ~ '^[a-z0-9][a-z0-9_.-]{2,119}$'),
  constraint company_events_key_check check (char_length(event_key) between 3 and 300),
  constraint company_events_correlation_check check (char_length(correlation_id) between 2 and 300),
  constraint company_events_trust_check check (
    trust_class in ('authoritative', 'operational', 'evidence', 'projection', 'inferred')
  ),
  constraint company_events_payload_check check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.company_evidence (
  id uuid primary key default gen_random_uuid(),
  evidence_key text not null unique,
  evidence_type text not null,
  entity_id uuid references public.company_entity_registry(id) on delete set null,
  event_id uuid references public.company_events(id) on delete set null,
  source_key text not null references public.company_source_registry(source_key),
  source_ref text not null,
  title text not null,
  content_preview text,
  content_url text,
  content_hash text,
  confidence numeric(5,4) not null default 1,
  trust_class text not null default 'evidence',
  sensitivity text not null default 'internal',
  occurred_at timestamptz,
  captured_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint company_evidence_type_check check (evidence_type ~ '^[a-z0-9][a-z0-9_]{1,79}$'),
  constraint company_evidence_confidence_check check (confidence between 0 and 1),
  constraint company_evidence_trust_check check (
    trust_class in ('authoritative', 'operational', 'evidence', 'projection', 'inferred')
  ),
  constraint company_evidence_sensitivity_check check (
    sensitivity in ('public', 'internal', 'personal', 'restricted')
  ),
  constraint company_evidence_validity_check check (
    valid_until is null or valid_from is null or valid_until > valid_from
  ),
  constraint company_evidence_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_entity_relations (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references public.company_entity_registry(id) on delete cascade,
  to_entity_id uuid not null references public.company_entity_registry(id) on delete cascade,
  relation_type text not null,
  evidence_id uuid references public.company_evidence(id) on delete set null,
  confidence numeric(5,4) not null default 1,
  valid_from timestamptz,
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_entity_relations_distinct_check check (from_entity_id <> to_entity_id),
  constraint company_entity_relations_type_check check (
    relation_type in (
      'belongs_to', 'requested_by', 'generated_from', 'projected_to', 'caused_by',
      'supported_by', 'conflicts_with', 'supersedes', 'resolved_by', 'applies_to'
    )
  ),
  constraint company_entity_relations_confidence_check check (confidence between 0 and 1),
  constraint company_entity_relations_validity_check check (
    valid_until is null or valid_from is null or valid_until > valid_from
  ),
  constraint company_entity_relations_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_entity_state (
  entity_id uuid primary key references public.company_entity_registry(id) on delete cascade,
  state_key text not null,
  state jsonb not null,
  source_event_id uuid not null references public.company_events(id),
  state_version integer not null default 1,
  valid_at timestamptz not null,
  computed_at timestamptz not null default now(),
  constraint company_entity_state_version_check check (state_version > 0),
  constraint company_entity_state_payload_check check (jsonb_typeof(state) = 'object')
);

create table if not exists public.company_data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null unique,
  issue_type text not null,
  severity text not null,
  status text not null default 'open',
  entity_id uuid references public.company_entity_registry(id) on delete set null,
  source_key text references public.company_source_registry(source_key),
  title text not null,
  detail text not null,
  detected_by text not null,
  evidence_ids uuid[] not null default '{}',
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_data_quality_type_check check (issue_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint company_data_quality_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint company_data_quality_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  constraint company_data_quality_resolution_check check (
    status <> 'resolved' or (resolved_at is not null and resolved_by is not null)
  ),
  constraint company_data_quality_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.company_brain_evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  case_type text not null,
  input_query text not null,
  expected_entity_type text,
  expected_canonical_key text,
  expected_outcome jsonb not null,
  forbidden_outcomes jsonb not null default '[]'::jsonb,
  source_snapshot_refs jsonb not null default '[]'::jsonb,
  contains_personal_data boolean not null default false,
  status text not null default 'draft',
  owner_team text not null,
  authored_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_brain_eval_type_check check (
    case_type in ('entity_resolution', 'incident_explanation', 'decision_retrieval', 'temporal_conflict', 'action_safety')
  ),
  constraint company_brain_eval_status_check check (status in ('draft', 'approved', 'retired')),
  constraint company_brain_eval_review_check check (
    status <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint company_brain_eval_payload_check check (
    jsonb_typeof(expected_outcome) = 'object'
    and jsonb_typeof(forbidden_outcomes) = 'array'
    and jsonb_typeof(source_snapshot_refs) = 'array'
  )
);

create index if not exists company_workflow_registry_lifecycle_idx
  on public.company_workflow_registry (lifecycle_status, active, updated_at desc);
create index if not exists company_entity_registry_source_idx
  on public.company_entity_registry (source_key, source_ref);
create index if not exists company_entity_aliases_entity_idx
  on public.company_entity_aliases (entity_id, active, last_seen_at desc);
create index if not exists company_entity_aliases_lookup_idx
  on public.company_entity_aliases (alias_type, normalized_alias_value) where active;
create index if not exists company_identity_resolution_correlation_idx
  on public.company_identity_resolution_log (correlation_id, occurred_at desc);
create index if not exists company_events_entity_time_idx
  on public.company_events (entity_id, occurred_at desc);
create index if not exists company_events_request_time_idx
  on public.company_events (request_id, occurred_at desc) where request_id is not null;
create index if not exists company_events_correlation_time_idx
  on public.company_events (correlation_id, occurred_at desc);
create index if not exists company_events_type_time_idx
  on public.company_events (event_type, occurred_at desc);
create index if not exists company_evidence_entity_time_idx
  on public.company_evidence (entity_id, occurred_at desc nulls last);
create index if not exists company_evidence_source_ref_idx
  on public.company_evidence (source_key, source_ref);
create unique index if not exists company_entity_relations_active_key
  on public.company_entity_relations (from_entity_id, to_entity_id, relation_type)
  where valid_until is null;
create index if not exists company_data_quality_open_idx
  on public.company_data_quality_issues (severity, last_detected_at desc)
  where status in ('open', 'acknowledged');
create index if not exists company_brain_eval_status_type_idx
  on public.company_brain_evaluation_cases (status, case_type, updated_at desc);

create or replace function public.touch_company_brain_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  target_table text;
  trigger_name text;
begin
  foreach target_table in array array[
    'company_source_registry',
    'company_workflow_registry',
    'company_correlation_contracts',
    'company_entity_registry',
    'company_entity_aliases',
    'company_entity_relations',
    'company_data_quality_issues',
    'company_brain_evaluation_cases'
  ] loop
    trigger_name := 'trg_' || target_table || '_updated_at';
    execute format('drop trigger if exists %I on public.%I', trigger_name, target_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_company_brain_updated_at()',
      trigger_name,
      target_table
    );
  end loop;
end;
$$;

create or replace function public.resolve_company_entity_alias(
  p_source_key text,
  p_alias_type text,
  p_alias_value text
)
returns table (
  entity_id uuid,
  entity_type text,
  canonical_key text,
  display_label text,
  confidence numeric,
  resolution_method text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    entity.id,
    entity.entity_type,
    entity.canonical_key,
    entity.display_label,
    alias.confidence,
    alias.resolution_method
  from public.company_entity_aliases as alias
  join public.company_entity_registry as entity on entity.id = alias.entity_id
  where alias.source_key = lower(btrim(p_source_key))
    and alias.alias_type = lower(btrim(p_alias_type))
    and alias.normalized_alias_value = lower(btrim(p_alias_value))
    and alias.active
    and entity.lifecycle_status = 'active'
  order by alias.confidence desc, alias.reviewed_at desc nulls last, alias.updated_at desc
  limit 1;
$$;

insert into public.company_source_registry (
  source_key, display_name, source_kind, authority, owner_team, criticality,
  expected_freshness, contains_personal_data, description
)
values
  ('supabase', 'Supabase / Postgres', 'database', 'authoritative', 'engineering', 'critical', interval '5 minutes', true, 'Canonical operational database and Company Brain control plane.'),
  ('offers', 'NEONTRIP Offers', 'api', 'authoritative', 'sales', 'critical', interval '5 minutes', true, 'Offer content, status and send operations.'),
  ('outlook_mirror', 'Outlook Mirror', 'database', 'evidence', 'support', 'critical', interval '15 minutes', true, 'Read-only synchronized customer email evidence.'),
  ('outlook_graph', 'Microsoft Graph', 'api', 'evidence', 'support', 'critical', interval '5 minutes', true, 'Read-only live mailbox evidence when configured.'),
  ('n8n', 'n8n', 'automation', 'operational', 'engineering', 'critical', interval '5 minutes', true, 'Automation definitions, executions and structured audit events.'),
  ('trello', 'Trello', 'projection', 'projection', 'operations', 'important', interval '5 minutes', true, 'Operational board projection; never the business source of truth.'),
  ('shopify', 'Shopify', 'api', 'authoritative', 'commerce', 'critical', interval '15 minutes', true, 'Orders and commerce customer state.'),
  ('activecampaign', 'ActiveCampaign', 'api', 'operational', 'sales', 'important', interval '30 minutes', true, 'Sales pipeline and marketing automation state.'),
  ('pandadoc', 'PandaDoc', 'api', 'evidence', 'sales', 'important', interval '15 minutes', true, 'External quote document state and signatures.'),
  ('easybill', 'EasyBill', 'api', 'authoritative', 'finance', 'important', interval '1 hour', true, 'Invoice and accounting document state.'),
  ('qonto', 'Qonto', 'api', 'authoritative', 'finance', 'important', interval '1 hour', true, 'Banking transactions and payment evidence.'),
  ('seventeen_track', '17TRACK', 'api', 'operational', 'operations', 'important', interval '1 hour', true, 'Shipment tracking state.'),
  ('ops_manual', 'Ops Manual Entry', 'manual', 'advisory', 'operations', 'standard', null, true, 'Reviewed internal notes and manual corrections.')
on conflict (source_key) do nothing;

insert into public.company_correlation_contracts (
  event_type, owner_team, required_identifiers, required_payload_fields,
  schema_version, severity_when_incomplete, description
)
values
  ('offer.created', 'sales', array['request_id', 'offer_id'], array['status'], 'v1', 'critical', 'An offer was created for a canonical request.'),
  ('offer.send_requested', 'sales', array['request_id', 'offer_id', 'correlation_id'], array['recipient'], 'v1', 'critical', 'A customer-visible offer send was requested.'),
  ('offer.sent', 'sales', array['request_id', 'offer_id', 'execution_id', 'correlation_id'], array['recipient', 'provider_message_id'], 'v1', 'critical', 'The sending provider accepted the offer email.'),
  ('offer.delivery_failed', 'support', array['request_id', 'offer_id', 'correlation_id'], array['reason_code'], 'v1', 'critical', 'A post-send delivery failure or bounce was observed.'),
  ('workflow.failed', 'engineering', array['workflow_id', 'execution_id', 'correlation_id'], array['reason_code', 'failed_node'], 'v1', 'critical', 'An automation execution failed.'),
  ('workflow.completed', 'engineering', array['workflow_id', 'execution_id', 'correlation_id'], array['result'], 'v1', 'warning', 'An automation execution completed.'),
  ('communication.received', 'support', array['message_id', 'correlation_id'], array['mailbox'], 'v1', 'warning', 'A customer or supplier communication was received.'),
  ('decision.approved', 'management', array['decision_id', 'correlation_id'], array['scope_type', 'scope_key'], 'v1', 'critical', 'A governed company decision became active.')
on conflict (event_type) do nothing;

insert into public.company_data_quality_issues (
  issue_key, issue_type, severity, status, source_key, title, detail,
  detected_by, first_detected_at, last_detected_at, resolved_at, resolved_by, metadata
)
select
  'baseline:outlook_mirror:missing_entity_links',
  'missing_entity_link',
  case when count(*) filter (where linked_request_id is null and linked_customer_id is null) > 0 then 'critical' else 'info' end,
  case when count(*) filter (where linked_request_id is null and linked_customer_id is null) > 0 then 'open' else 'resolved' end,
  'outlook_mirror',
  'Outlook-Nachrichten ohne Kunden- oder Anfrageverknuepfung',
  format('%s von %s Nachrichten sind weder einer Anfrage noch einem Kunden zugeordnet.',
    count(*) filter (where linked_request_id is null and linked_customer_id is null), count(*)),
  'migration:20260715193000',
  now(),
  now(),
  case when count(*) filter (where linked_request_id is null and linked_customer_id is null) = 0 then now() else null end,
  case when count(*) filter (where linked_request_id is null and linked_customer_id is null) = 0 then 'migration:20260715193000' else null end,
  jsonb_build_object(
    'total', count(*),
    'unlinked', count(*) filter (where linked_request_id is null and linked_customer_id is null)
  )
from public.customer_email_messages
on conflict (issue_key) do update
set detail = excluded.detail,
    severity = excluded.severity,
    status = excluded.status,
    last_detected_at = excluded.last_detected_at,
    resolved_at = excluded.resolved_at,
    resolved_by = excluded.resolved_by,
    metadata = excluded.metadata;

insert into public.company_data_quality_issues (
  issue_key, issue_type, severity, status, source_key, title, detail,
  detected_by, first_detected_at, last_detected_at, resolved_at, resolved_by, metadata
)
select
  'baseline:supabase:requests_missing_trello_links',
  'missing_entity_alias',
  case when count(*) filter (where nullif(trello_card_id, '') is null) > 0 then 'warning' else 'info' end,
  case when count(*) filter (where nullif(trello_card_id, '') is null) > 0 then 'open' else 'resolved' end,
  'supabase',
  'Anfragen ohne Trello-Projektionsverknuepfung',
  format('%s von %s Anfragen haben keine Trello-ID.',
    count(*) filter (where nullif(trello_card_id, '') is null), count(*)),
  'migration:20260715193000',
  now(),
  now(),
  case when count(*) filter (where nullif(trello_card_id, '') is null) = 0 then now() else null end,
  case when count(*) filter (where nullif(trello_card_id, '') is null) = 0 then 'migration:20260715193000' else null end,
  jsonb_build_object(
    'total', count(*),
    'missing_trello_card_id', count(*) filter (where nullif(trello_card_id, '') is null)
  )
from public.master_requests
on conflict (issue_key) do update
set detail = excluded.detail,
    severity = excluded.severity,
    status = excluded.status,
    last_detected_at = excluded.last_detected_at,
    resolved_at = excluded.resolved_at,
    resolved_by = excluded.resolved_by,
    metadata = excluded.metadata;

insert into public.company_data_quality_issues (
  issue_key, issue_type, severity, status, source_key, title, detail,
  detected_by, first_detected_at, last_detected_at, resolved_at, resolved_by, metadata
)
select
  'baseline:n8n:audit_missing_execution_id',
  'missing_correlation_identifier',
  case when count(*) filter (where nullif(coalesce(
    metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
  ), '') is null) > 0 then 'critical' else 'info' end,
  case when count(*) filter (where nullif(coalesce(
    metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
  ), '') is null) > 0 then 'open' else 'resolved' end,
  'n8n',
  'Workflow-Audits ohne Execution-ID',
  format('%s von %s Workflow-Audits haben keine Execution-ID.',
    count(*) filter (where nullif(coalesce(
      metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
    ), '') is null), count(*)),
  'migration:20260715193000',
  now(),
  now(),
  case when count(*) filter (where nullif(coalesce(
    metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
  ), '') is null) = 0 then now() else null end,
  case when count(*) filter (where nullif(coalesce(
    metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
  ), '') is null) = 0 then 'migration:20260715193000' else null end,
  jsonb_build_object(
    'total', count(*),
    'missing_execution_id', count(*) filter (where nullif(coalesce(
      metadata ->> 'execution_id', metadata ->> 'n8n_execution_id', metadata ->> 'workflow_execution_id', ''
    ), '') is null)
  )
from public.workflow_audit_log
on conflict (issue_key) do update
set detail = excluded.detail,
    severity = excluded.severity,
    status = excluded.status,
    last_detected_at = excluded.last_detected_at,
    resolved_at = excluded.resolved_at,
    resolved_by = excluded.resolved_by,
    metadata = excluded.metadata;

comment on table public.company_source_registry is 'Governed catalog of Company Brain source systems, ownership and authority.';
comment on table public.company_workflow_registry is 'Lifecycle and ownership registry for automations; workflow definitions remain in n8n.';
comment on table public.company_correlation_contracts is 'Required identifiers and payload fields for operational event types.';
comment on table public.company_entity_registry is 'Canonical cross-system identities used by the Company Brain.';
comment on table public.company_entity_aliases is 'Deterministic and reviewed source identifiers mapped to canonical entities.';
comment on table public.company_identity_resolution_log is 'Append-only audit of identity resolver outcomes without storing raw personal identifiers.';
comment on table public.company_events is 'Append-only normalized business events with source provenance and correlation.';
comment on table public.company_evidence is 'Append-only evidence inventory; large or sensitive content remains in its governed source.';
comment on table public.company_entity_relations is 'Typed, temporal relationships between canonical Company Brain entities.';
comment on table public.company_entity_state is 'Current state projection derived from immutable Company Brain events.';
comment on table public.company_data_quality_issues is 'Actionable missing, conflicting or stale data detected by governed checks.';
comment on table public.company_brain_evaluation_cases is 'Reviewed, privacy-aware golden cases for deterministic Company Brain evaluation.';

alter table public.company_source_registry enable row level security;
alter table public.company_workflow_registry enable row level security;
alter table public.company_correlation_contracts enable row level security;
alter table public.company_entity_registry enable row level security;
alter table public.company_entity_aliases enable row level security;
alter table public.company_identity_resolution_log enable row level security;
alter table public.company_events enable row level security;
alter table public.company_evidence enable row level security;
alter table public.company_entity_relations enable row level security;
alter table public.company_entity_state enable row level security;
alter table public.company_data_quality_issues enable row level security;
alter table public.company_brain_evaluation_cases enable row level security;

revoke all on table public.company_source_registry from public, anon, authenticated;
revoke all on table public.company_workflow_registry from public, anon, authenticated;
revoke all on table public.company_correlation_contracts from public, anon, authenticated;
revoke all on table public.company_entity_registry from public, anon, authenticated;
revoke all on table public.company_entity_aliases from public, anon, authenticated;
revoke all on table public.company_identity_resolution_log from public, anon, authenticated;
revoke all on table public.company_events from public, anon, authenticated;
revoke all on table public.company_evidence from public, anon, authenticated;
revoke all on table public.company_entity_relations from public, anon, authenticated;
revoke all on table public.company_entity_state from public, anon, authenticated;
revoke all on table public.company_data_quality_issues from public, anon, authenticated;
revoke all on table public.company_brain_evaluation_cases from public, anon, authenticated;

grant select, insert, update, delete on table public.company_source_registry to service_role;
grant select, insert, update, delete on table public.company_workflow_registry to service_role;
grant select, insert, update, delete on table public.company_correlation_contracts to service_role;
grant select, insert, update, delete on table public.company_entity_registry to service_role;
grant select, insert, update, delete on table public.company_entity_aliases to service_role;
grant select, insert on table public.company_identity_resolution_log to service_role;
grant select, insert on table public.company_events to service_role;
grant select, insert on table public.company_evidence to service_role;
grant select, insert, update, delete on table public.company_entity_relations to service_role;
grant select, insert, update, delete on table public.company_entity_state to service_role;
grant select, insert, update, delete on table public.company_data_quality_issues to service_role;
grant select, insert, update, delete on table public.company_brain_evaluation_cases to service_role;

revoke all on function public.resolve_company_entity_alias(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_company_entity_alias(text, text, text) to service_role;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'company_source_registry', 'company_workflow_registry', 'company_correlation_contracts',
    'company_entity_registry', 'company_entity_aliases', 'company_identity_resolution_log',
    'company_events', 'company_evidence', 'company_entity_relations', 'company_entity_state',
    'company_data_quality_issues', 'company_brain_evaluation_cases'
  ] loop
    policy_name := target_table || '_service_role_all';
    execute format('drop policy if exists %I on public.%I', policy_name, target_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      policy_name,
      target_table
    );
  end loop;
end;
$$;
