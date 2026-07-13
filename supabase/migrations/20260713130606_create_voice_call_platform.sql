create table if not exists public.voice_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  version_number integer not null,
  mode text not null,
  instructions_template text not null,
  content_hash text not null,
  status text not null default 'review',
  authored_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_prompt_versions_key_version unique (prompt_key, version_number),
  constraint voice_prompt_versions_hash_key unique (prompt_key, content_hash),
  constraint voice_prompt_versions_mode_check check (mode in ('lead_qualification', 'follow_up')),
  constraint voice_prompt_versions_status_check check (status in ('review', 'approved', 'retired')),
  constraint voice_prompt_versions_approval_check check (
    status <> 'approved' or (approved_by is not null and approved_at is not null)
  ),
  constraint voice_prompt_versions_template_check check (char_length(instructions_template) between 100 and 20000)
);

create unique index if not exists voice_prompt_versions_one_approved_mode_idx
  on public.voice_prompt_versions (mode)
  where status = 'approved';

create table if not exists public.voice_model_releases (
  id uuid primary key default gen_random_uuid(),
  release_key text not null unique,
  provider text not null default 'openai',
  model_id text not null,
  api_version text not null default 'v1',
  transport text not null default 'sip',
  voice text not null,
  session_config jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  evaluated_prompt_manifest jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  lifecycle text not null default 'available',
  eval_status text not null default 'pending',
  eval_score numeric(6,3),
  approved_by text,
  approved_at timestamptz,
  release_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_model_releases_provider_check check (provider in ('openai')),
  constraint voice_model_releases_transport_check check (transport in ('sip', 'webrtc', 'websocket')),
  constraint voice_model_releases_lifecycle_check check (lifecycle in ('available', 'candidate', 'production', 'rollback', 'retired')),
  constraint voice_model_releases_eval_check check (eval_status in ('pending', 'contract_passed', 'passed', 'failed')),
  constraint voice_model_releases_score_check check (eval_score is null or (eval_score >= 0 and eval_score <= 100)),
  constraint voice_model_releases_config_check check (
    jsonb_typeof(session_config) = 'object' and jsonb_typeof(capabilities) = 'object'
    and jsonb_typeof(evaluated_prompt_manifest) = 'object'
  ),
  constraint voice_model_releases_production_check check (
    lifecycle <> 'production' or (
      eval_status = 'passed' and approved_by is not null and approved_at is not null
      and evaluated_prompt_manifest ? 'lead_qualification'
      and evaluated_prompt_manifest ? 'follow_up'
    )
  )
);

create unique index if not exists voice_model_releases_one_candidate_idx
  on public.voice_model_releases ((lifecycle)) where lifecycle = 'candidate';
create unique index if not exists voice_model_releases_one_production_idx
  on public.voice_model_releases ((lifecycle)) where lifecycle = 'production';
create unique index if not exists voice_model_releases_one_rollback_idx
  on public.voice_model_releases ((lifecycle)) where lifecycle = 'rollback';

create table if not exists public.voice_model_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_release_id uuid not null references public.voice_model_releases(id) on delete cascade,
  suite_version text not null,
  idempotency_key text not null unique,
  scenario_count integer not null,
  passed_count integer not null,
  safety_failure_count integer not null default 0,
  average_score numeric(6,3) not null,
  status text not null,
  report jsonb not null default '{}'::jsonb,
  prompt_manifest jsonb not null,
  evaluated_by text not null,
  evaluated_at timestamptz not null default now(),
  constraint voice_model_evaluations_count_check check (
    scenario_count >= 1 and passed_count >= 0 and passed_count <= scenario_count and safety_failure_count >= 0
  ),
  constraint voice_model_evaluations_score_check check (average_score >= 0 and average_score <= 100),
  constraint voice_model_evaluations_status_check check (status in ('passed', 'failed')),
  constraint voice_model_evaluations_report_check check (
    jsonb_typeof(report) = 'object' and jsonb_typeof(prompt_manifest) = 'object'
    and prompt_manifest ? 'lead_qualification' and prompt_manifest ? 'follow_up'
  )
);

create table if not exists public.voice_runtime_settings (
  singleton boolean primary key default true,
  global_enabled boolean not null default false,
  internal_test_calls_enabled boolean not null default false,
  customer_calls_enabled boolean not null default false,
  max_concurrent_calls integer not null default 1,
  default_timezone text not null default 'Europe/Berlin',
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now(),
  constraint voice_runtime_settings_singleton_check check (singleton),
  constraint voice_runtime_settings_concurrency_check check (max_concurrent_calls between 1 and 20)
);

insert into public.voice_runtime_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.voice_contact_consents (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  phone_e164 text not null,
  phone_hash text not null,
  purposes text[] not null,
  status text not null default 'granted',
  consent_wording text not null,
  form_version text not null,
  source text not null,
  source_ref text,
  evidence_hash text not null,
  granted_at timestamptz not null,
  withdrawn_at timestamptz,
  valid_until timestamptz,
  evidence_retain_until timestamptz not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_contact_consents_status_check check (status in ('granted', 'withdrawn', 'expired')),
  constraint voice_contact_consents_purpose_check check (
    cardinality(purposes) > 0 and purposes <@ array['lead_qualification', 'follow_up']::text[]
  ),
  constraint voice_contact_consents_phone_check check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  constraint voice_contact_consents_withdrawal_check check (
    (status = 'withdrawn' and withdrawn_at is not null) or (status <> 'withdrawn' and withdrawn_at is null)
  ),
  constraint voice_contact_consents_validity_check check (valid_until is null or valid_until > granted_at),
  constraint voice_contact_consents_retention_check check (evidence_retain_until >= granted_at + interval '5 years'),
  constraint voice_contact_consents_wording_check check (char_length(consent_wording) between 20 and 4000)
);

create index if not exists voice_contact_consents_request_idx
  on public.voice_contact_consents (request_id, granted_at desc);
create index if not exists voice_contact_consents_phone_idx
  on public.voice_contact_consents (phone_hash, granted_at desc);

create table if not exists public.voice_do_not_call (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  phone_hash text not null,
  active boolean not null default true,
  reason text not null,
  source text not null,
  idempotency_key text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_by text,
  revoked_at timestamptz,
  constraint voice_do_not_call_reason_check check (char_length(reason) between 3 and 1000),
  constraint voice_do_not_call_revoke_check check (
    active or (revoked_by is not null and revoked_at is not null)
  )
);

create index if not exists voice_do_not_call_active_phone_idx
  on public.voice_do_not_call (phone_hash) where active;

create table if not exists public.voice_test_allowlist (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_hash text not null unique,
  label text not null,
  enabled boolean not null default true,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_test_allowlist_phone_check check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$')
);

create table if not exists public.voice_call_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null,
  status text not null default 'draft',
  model_channel text not null default 'production',
  prompt_version_id uuid not null references public.voice_prompt_versions(id),
  allowlist_only boolean not null default true,
  timezone text not null default 'Europe/Berlin',
  contact_window_start time not null default '09:00',
  contact_window_end time not null default '17:00',
  allowed_weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  max_attempts integer not null default 3,
  retry_delay_minutes integer not null default 1440,
  created_by text not null,
  activated_by text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_campaigns_mode_check check (mode in ('lead_qualification', 'follow_up')),
  constraint voice_call_campaigns_status_check check (status in ('draft', 'paused', 'active', 'completed', 'cancelled')),
  constraint voice_call_campaigns_channel_check check (model_channel in ('candidate', 'production')),
  constraint voice_call_campaigns_window_check check (contact_window_start < contact_window_end),
  constraint voice_call_campaigns_weekdays_check check (
    cardinality(allowed_weekdays) > 0 and allowed_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint voice_call_campaigns_attempts_check check (max_attempts between 1 and 10),
  constraint voice_call_campaigns_retry_check check (retry_delay_minutes between 5 and 43200),
  constraint voice_call_campaigns_activation_check check (
    status <> 'active' or (activated_by is not null and activated_at is not null)
  )
);

create table if not exists public.voice_call_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voice_call_campaigns(id) on delete cascade,
  request_id text not null,
  offer_id text,
  consent_id uuid not null references public.voice_contact_consents(id),
  phone_e164 text not null,
  phone_hash text not null,
  contact_name text,
  company_name text,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_until timestamptz,
  last_error_code text,
  blocked_reason text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_targets_campaign_request_key unique (campaign_id, request_id),
  constraint voice_call_targets_status_check check (status in ('queued', 'claimed', 'dialing', 'live', 'retry', 'completed', 'failed', 'blocked', 'cancelled')),
  constraint voice_call_targets_phone_check check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  constraint voice_call_targets_attempt_check check (attempt_count >= 0),
  constraint voice_call_targets_claim_check check (
    (status = 'claimed' and claimed_by is not null and claimed_until is not null)
    or status <> 'claimed'
  )
);

create index if not exists voice_call_targets_claim_idx
  on public.voice_call_targets (status, next_attempt_at, created_at)
  where status in ('queued', 'retry', 'claimed');
create index if not exists voice_call_targets_request_idx
  on public.voice_call_targets (request_id, created_at desc);

create table if not exists public.voice_call_attempts (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.voice_call_targets(id) on delete cascade,
  attempt_number integer not null,
  idempotency_key text not null unique,
  model_release_id uuid not null references public.voice_model_releases(id),
  prompt_version_id uuid not null references public.voice_prompt_versions(id),
  provider text not null,
  provider_call_id text unique,
  openai_call_id text unique,
  status text not null default 'reserved',
  context_snapshot jsonb not null default '{}'::jsonb,
  model_snapshot jsonb not null default '{}'::jsonb,
  prompt_snapshot jsonb not null default '{}'::jsonb,
  recording_enabled boolean not null default false,
  transcript_storage_enabled boolean not null default false,
  reserved_at timestamptz not null default now(),
  dialing_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_attempts_target_number_key unique (target_id, attempt_number),
  constraint voice_call_attempts_number_check check (attempt_number >= 1),
  constraint voice_call_attempts_provider_check check (provider in ('twilio', 'generic_sip')),
  constraint voice_call_attempts_status_check check (status in ('reserved', 'dialing', 'ringing', 'live', 'completed', 'failed', 'cancelled', 'handed_off')),
  constraint voice_call_attempts_snapshot_check check (
    jsonb_typeof(context_snapshot) = 'object'
    and jsonb_typeof(model_snapshot) = 'object'
    and jsonb_typeof(prompt_snapshot) = 'object'
  ),
  constraint voice_call_attempts_recording_check check (recording_enabled = false),
  constraint voice_call_attempts_transcript_check check (transcript_storage_enabled = false)
);

create index if not exists voice_call_attempts_status_idx
  on public.voice_call_attempts (status, reserved_at desc);

create table if not exists public.voice_call_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.voice_call_attempts(id) on delete cascade,
  source text not null,
  event_type text not null,
  provider_event_id text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint voice_call_events_source_check check (source in ('runtime', 'openai', 'telephony', 'n8n', 'ops')),
  constraint voice_call_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint voice_call_events_type_check check (char_length(event_type) between 2 and 120)
);

create index if not exists voice_call_events_attempt_idx
  on public.voice_call_events (attempt_id, occurred_at asc);

create table if not exists public.voice_call_outcomes (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.voice_call_attempts(id) on delete cascade,
  outcome_code text not null,
  summary_for_human text not null,
  customer_intent text,
  product_interest text,
  objections text[] not null default '{}',
  callback_at timestamptz,
  human_handoff_requested boolean not null default false,
  human_handoff_completed boolean not null default false,
  customer_requested_stop boolean not null default false,
  unsafe_or_unsupported_request boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_outcomes_code_check check (outcome_code in (
    'qualified_lead', 'needs_human_followup', 'not_interested', 'callback_requested',
    'not_reached', 'wrong_number', 'do_not_call', 'no_clear_outcome', 'technical_failure'
  )),
  constraint voice_call_outcomes_summary_check check (char_length(summary_for_human) between 3 and 2000),
  constraint voice_call_outcomes_handoff_check check (not human_handoff_completed or human_handoff_requested)
);

create table if not exists public.voice_call_actions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.voice_call_attempts(id) on delete cascade,
  tool_call_id text not null,
  tool_name text not null,
  idempotency_key text not null unique,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  constraint voice_call_actions_attempt_tool_key unique (attempt_id, tool_call_id),
  constraint voice_call_actions_tool_check check (tool_name in (
    'get_customer_context', 'get_offer_summary', 'get_outlook_context',
    'search_approved_knowledge', 'schedule_callback', 'record_qualification', 'request_human_handoff'
  )),
  constraint voice_call_actions_status_check check (status in ('completed', 'rejected', 'failed')),
  constraint voice_call_actions_json_check check (jsonb_typeof(arguments) = 'object' and jsonb_typeof(result) = 'object')
);

create table if not exists public.voice_platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint voice_platform_audit_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.voice_model_releases (
  release_key, provider, model_id, api_version, transport, voice, session_config, capabilities,
  lifecycle, eval_status, release_notes
) values
  (
    'openai-gpt-realtime-2-1-sip-v1', 'openai', 'gpt-realtime-2.1', 'v1', 'sip', 'marin',
    '{"turn_detection":{"type":"server_vad"}}'::jsonb,
    '{"speech_to_speech":true,"function_tools":true,"sip":true,"sideband":true,"barge_in":true}'::jsonb,
    'candidate', 'contract_passed', 'Initial candidate; customer use still requires the full eval gate.'
  ),
  (
    'openai-gpt-realtime-1-5-sip-v1', 'openai', 'gpt-realtime-1.5', 'v1', 'sip', 'marin',
    '{"turn_detection":{"type":"server_vad"}}'::jsonb,
    '{"speech_to_speech":true,"function_tools":true,"sip":true,"sideband":true,"barge_in":true}'::jsonb,
    'available', 'pending', 'Naturalness comparison baseline.'
  )
on conflict (release_key) do nothing;

insert into public.voice_prompt_versions (
  prompt_key, version_number, mode, instructions_template, content_hash, status, authored_by
) values
  (
    'lead-qualification', 1, 'lead_qualification',
    'Begruesse die angefragte Person natuerlich als Nia von NEONTRIP, nenne den konkreten Anfragebezug und noch im ersten Sprechzug, dass du als digitaler Telefonassistent unterstuetzt. Frage dann, ob es gerade passt. Klaere Bedarf, Produkt, Einsatz, ungefaehre Groesse, Lichtwirkung und naechsten Schritt. Stelle nur eine Frage auf einmal. Nenne keine Preise oder Termine und uebergib unsichere oder sensible Fragen an einen Menschen.',
    'fc7e5b1e0dcf129be0ddd3d8b9299d3190d30fcb1cc2d7a6c7b22d8bfa31ef03', 'review', 'migration'
  ),
  (
    'offer-follow-up', 1, 'follow_up',
    'Begruesse die angefragte Person natuerlich als Nia von NEONTRIP, beziehe dich auf das konkrete Angebot und nenne noch im ersten Sprechzug, dass du als digitaler Telefonassistent unterstuetzt. Frage dann, ob es gerade passt. Klaere Interesse, offene Fragen, Einwaende und den gewuenschten naechsten Schritt. Stelle nur eine Frage auf einmal. Nenne keine neuen Preise oder Termine und uebergib Anpassungen oder sensible Fragen an einen Menschen.',
    'e9133bf3319fccf839fafb577a8ec5c5401a5de7b885824855f8b40d149a0dc4', 'review', 'migration'
  )
on conflict (prompt_key, version_number) do nothing;

create or replace function public.promote_voice_model_release(
  p_release_id uuid,
  p_approved_by text,
  p_idempotency_key text
)
returns table (release_id uuid, lifecycle text, previous_production_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_previous_production uuid;
  v_release public.voice_model_releases%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_promotion'));

  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    select id into v_previous_production from public.voice_model_releases where lifecycle = 'rollback' limit 1;
    return query select p_release_id, coalesce((select model.lifecycle from public.voice_model_releases model where model.id = p_release_id), 'retired'), v_previous_production;
    return;
  end if;

  select * into v_release
  from public.voice_model_releases
  where id = p_release_id
  for update;

  if v_release.id is null then raise exception 'voice model release not found'; end if;
  if not v_release.enabled then raise exception 'candidate model is disabled'; end if;
  if v_release.lifecycle <> 'candidate' then raise exception 'only the candidate model can be promoted'; end if;
  if v_release.eval_status <> 'passed' then raise exception 'candidate model has not passed evaluations'; end if;
  if not (v_release.evaluated_prompt_manifest ? 'lead_qualification' and v_release.evaluated_prompt_manifest ? 'follow_up') then
    raise exception 'candidate model has no complete evaluated prompt manifest';
  end if;

  update public.voice_model_releases set lifecycle = 'retired', updated_at = now()
  where lifecycle = 'rollback';

  select id into v_previous_production
  from public.voice_model_releases
  where lifecycle = 'production'
  for update;

  update public.voice_model_releases set lifecycle = 'rollback', updated_at = now()
  where id = v_previous_production;

  update public.voice_model_releases
  set lifecycle = 'production', approved_by = p_approved_by, approved_at = now(), updated_at = now()
  where id = p_release_id;

  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key, metadata)
  values (p_approved_by, 'model_promoted', 'voice_model_release', p_release_id::text, p_idempotency_key,
    jsonb_build_object('previous_production_id', v_previous_production));

  return query select p_release_id, 'production'::text, v_previous_production;
end;
$$;

create or replace function public.select_voice_model_candidate(
  p_release_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (release_id uuid, lifecycle text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_candidate'));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select p_release_id, coalesce((select model.lifecycle from public.voice_model_releases model where model.id = p_release_id), 'retired');
    return;
  end if;
  if not exists (select 1 from public.voice_model_releases where id = p_release_id and lifecycle in ('available', 'candidate')) then
    raise exception 'model release cannot become candidate';
  end if;
  update public.voice_model_releases set lifecycle = 'available', updated_at = now() where lifecycle = 'candidate';
  update public.voice_model_releases set lifecycle = 'candidate', updated_at = now() where id = p_release_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key)
  values (p_actor, 'model_candidate_selected', 'voice_model_release', p_release_id::text, p_idempotency_key);
  return query select p_release_id, 'candidate'::text;
end;
$$;

create or replace function public.approve_voice_model_sandbox(
  p_release_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (release_id uuid, eval_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_release public.voice_model_releases%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_sandbox:' || p_release_id::text));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select p_release_id, coalesce((select model.eval_status from public.voice_model_releases model where model.id = p_release_id), 'pending');
    return;
  end if;
  select * into v_release from public.voice_model_releases where id = p_release_id for update;
  if v_release.id is null or v_release.lifecycle not in ('available', 'candidate') then
    raise exception 'model release cannot be approved for sandbox';
  end if;
  if v_release.eval_status not in ('pending', 'contract_passed') then
    raise exception 'failed or production-evaluated release needs a new immutable release';
  end if;
  if v_release.provider <> 'openai' or v_release.transport <> 'sip'
     or coalesce((v_release.capabilities ->> 'speech_to_speech')::boolean, false) is not true
     or coalesce((v_release.capabilities ->> 'function_tools')::boolean, false) is not true
     or coalesce((v_release.capabilities ->> 'sideband')::boolean, false) is not true then
    raise exception 'required sandbox capabilities are missing';
  end if;
  update public.voice_model_releases
  set eval_status = 'contract_passed', updated_at = now()
  where id = p_release_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key, metadata)
  values (p_actor, 'model_sandbox_contract_approved', 'voice_model_release', p_release_id::text, p_idempotency_key,
    jsonb_build_object('provider', v_release.provider, 'model_id', v_release.model_id, 'transport', v_release.transport));
  return query select p_release_id, 'contract_passed'::text;
end;
$$;

create or replace function public.rollback_voice_model_release(
  p_actor text,
  p_idempotency_key text
)
returns table (production_id uuid, rollback_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_production_id uuid;
  v_rollback_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_promotion'));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select
      (select id from public.voice_model_releases where lifecycle = 'production' limit 1),
      (select id from public.voice_model_releases where lifecycle = 'rollback' limit 1);
    return;
  end if;
  select id into v_production_id from public.voice_model_releases where lifecycle = 'production' for update;
  select id into v_rollback_id from public.voice_model_releases
  where lifecycle = 'rollback' and enabled and eval_status = 'passed' and approved_by is not null and approved_at is not null
  for update;
  if v_production_id is null or v_rollback_id is null then raise exception 'production rollback pair is unavailable'; end if;
  update public.voice_model_releases set lifecycle = 'available', updated_at = now() where id = v_production_id;
  update public.voice_model_releases set lifecycle = 'production', updated_at = now() where id = v_rollback_id;
  update public.voice_model_releases set lifecycle = 'rollback', updated_at = now() where id = v_production_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key, metadata)
  values (p_actor, 'model_rolled_back', 'voice_model_release', v_rollback_id::text, p_idempotency_key,
    jsonb_build_object('previous_production_id', v_production_id));
  return query select v_rollback_id, v_production_id;
end;
$$;

create or replace function public.record_voice_model_evaluation(
  p_release_id uuid,
  p_suite_version text,
  p_idempotency_key text,
  p_scenario_count integer,
  p_passed_count integer,
  p_safety_failure_count integer,
  p_average_score numeric,
  p_status text,
  p_report jsonb,
  p_prompt_manifest jsonb,
  p_evaluated_by text
)
returns table (evaluation_id uuid, eval_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_evaluation_id uuid;
  v_eval_status text;
begin
  select id into v_evaluation_id from public.voice_model_evaluations where idempotency_key = p_idempotency_key;
  if v_evaluation_id is not null then
    return query select v_evaluation_id, (select model.eval_status from public.voice_model_releases model where model.id = p_release_id);
    return;
  end if;
  if p_status not in ('passed', 'failed') then raise exception 'invalid evaluation status'; end if;
  if jsonb_typeof(p_prompt_manifest) <> 'object'
     or not (p_prompt_manifest ? 'lead_qualification' and p_prompt_manifest ? 'follow_up') then
    raise exception 'complete prompt manifest is required';
  end if;
  v_eval_status := case when p_status = 'passed' and p_safety_failure_count = 0 and p_passed_count = p_scenario_count then 'passed' else 'failed' end;
  insert into public.voice_model_evaluations (
    model_release_id, suite_version, idempotency_key, scenario_count, passed_count,
    safety_failure_count, average_score, status, report, prompt_manifest, evaluated_by
  ) values (
    p_release_id, p_suite_version, p_idempotency_key, p_scenario_count, p_passed_count,
    p_safety_failure_count, p_average_score, v_eval_status, coalesce(p_report, '{}'::jsonb), p_prompt_manifest, p_evaluated_by
  ) returning id into v_evaluation_id;
  update public.voice_model_releases
  set eval_status = v_eval_status, eval_score = p_average_score,
      evaluated_prompt_manifest = p_prompt_manifest, updated_at = now()
  where id = p_release_id;
  return query select v_evaluation_id, v_eval_status;
end;
$$;

create or replace function public.approve_voice_prompt_version(
  p_prompt_version_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (prompt_version_id uuid, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
begin
  perform pg_advisory_xact_lock(hashtext('voice_prompt_approval'));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select p_prompt_version_id, coalesce((select prompt.status from public.voice_prompt_versions prompt where prompt.id = p_prompt_version_id), 'retired');
    return;
  end if;
  select mode into v_mode from public.voice_prompt_versions where id = p_prompt_version_id for update;
  if v_mode is null then raise exception 'voice prompt version not found'; end if;
  update public.voice_prompt_versions set status = 'retired', updated_at = now()
  where mode = v_mode and status = 'approved' and id <> p_prompt_version_id;
  update public.voice_prompt_versions
  set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
  where id = p_prompt_version_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key)
  values (p_actor, 'prompt_approved', 'voice_prompt_version', p_prompt_version_id::text, p_idempotency_key);
  return query select p_prompt_version_id, 'approved'::text;
end;
$$;

create or replace function public.claim_next_voice_call(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  attempt_id uuid,
  target_id uuid,
  campaign_id uuid,
  request_id text,
  offer_id text,
  phone_e164 text,
  contact_name text,
  company_name text,
  mode text,
  model_release_id uuid,
  model_id text,
  voice text,
  session_config jsonb,
  capabilities jsonb,
  prompt_version_id uuid,
  instructions_template text,
  attempt_number integer,
  allowlist_only boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target public.voice_call_targets%rowtype;
  v_campaign public.voice_call_campaigns%rowtype;
  v_model public.voice_model_releases%rowtype;
  v_prompt public.voice_prompt_versions%rowtype;
  v_settings public.voice_runtime_settings%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
begin
  if char_length(trim(coalesce(p_worker_id, ''))) < 3 then raise exception 'worker id is required'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'invalid lease duration'; end if;

  select * into v_settings from public.voice_runtime_settings where singleton for update;
  if v_settings.singleton is null or not v_settings.global_enabled then return; end if;
  if (
    select count(*) from public.voice_call_attempts attempt
    where attempt.status in ('reserved', 'dialing', 'ringing', 'live')
  ) >= v_settings.max_concurrent_calls then return; end if;

  select target.* into v_target
  from public.voice_call_targets target
  join public.voice_call_campaigns campaign on campaign.id = target.campaign_id
  join public.voice_contact_consents consent on consent.id = target.consent_id
  where campaign.status = 'active'
    and target.status in ('queued', 'retry', 'claimed')
    and target.next_attempt_at <= now()
    and target.attempt_count < campaign.max_attempts
    and (target.status <> 'claimed' or target.claimed_until < now())
    and consent.status = 'granted'
    and consent.request_id = target.request_id
    and consent.phone_hash = target.phone_hash
    and campaign.mode = any(consent.purposes)
    and (consent.valid_until is null or consent.valid_until > now())
    and not exists (
      select 1 from public.voice_do_not_call dnc
      where dnc.active and (dnc.phone_hash = target.phone_hash or dnc.request_id = target.request_id)
    )
    and (
      (campaign.allowlist_only and v_settings.internal_test_calls_enabled and exists (
        select 1 from public.voice_test_allowlist allowlist
        where allowlist.enabled and allowlist.phone_hash = target.phone_hash
      ))
      or (not campaign.allowlist_only and v_settings.customer_calls_enabled)
    )
    and extract(isodow from timezone(campaign.timezone, now()))::smallint = any(campaign.allowed_weekdays)
    and timezone(campaign.timezone, now())::time >= campaign.contact_window_start
    and timezone(campaign.timezone, now())::time < campaign.contact_window_end
  order by target.next_attempt_at asc, target.created_at asc
  for update of target skip locked
  limit 1;

  if v_target.id is null then return; end if;
  select * into v_campaign
  from public.voice_call_campaigns campaign
  where campaign.id = v_target.campaign_id;
  if v_campaign.id is null then raise exception 'voice call campaign not found'; end if;

  select * into v_model
  from public.voice_model_releases model
  where model.lifecycle = v_campaign.model_channel
    and model.enabled
    and (
      (v_campaign.allowlist_only and model.eval_status in ('contract_passed', 'passed'))
      or (
        not v_campaign.allowlist_only
        and model.eval_status = 'passed'
        and model.approved_by is not null
        and model.approved_at is not null
        and model.evaluated_prompt_manifest @> jsonb_build_object(
          v_campaign.mode,
          jsonb_build_object('id', v_campaign.prompt_version_id::text)
        )
      )
    )
  limit 1;
  if v_model.id is null then return; end if;

  select * into v_prompt
  from public.voice_prompt_versions prompt
  where prompt.id = v_campaign.prompt_version_id
    and prompt.mode = v_campaign.mode
    and prompt.status = 'approved';
  if v_prompt.id is null then return; end if;

  v_attempt_number := v_target.attempt_count + 1;
  update public.voice_call_targets
  set status = 'claimed', claimed_by = p_worker_id,
      claimed_until = now() + make_interval(secs => p_lease_seconds),
      attempt_count = v_attempt_number, updated_at = now()
  where id = v_target.id;

  insert into public.voice_call_attempts (
    target_id, attempt_number, idempotency_key, model_release_id, prompt_version_id,
    provider, status, context_snapshot, model_snapshot, prompt_snapshot
  ) values (
    v_target.id, v_attempt_number, 'voice-attempt:' || v_target.id::text || ':' || v_attempt_number::text,
    v_model.id, v_prompt.id, 'twilio', 'reserved',
    jsonb_build_object('request_id', v_target.request_id, 'offer_id', v_target.offer_id),
    jsonb_build_object('release_key', v_model.release_key, 'model_id', v_model.model_id, 'voice', v_model.voice,
      'api_version', v_model.api_version, 'transport', v_model.transport, 'session_config', v_model.session_config,
      'capabilities', v_model.capabilities),
    jsonb_build_object('prompt_key', v_prompt.prompt_key, 'version_number', v_prompt.version_number,
      'instructions_template', v_prompt.instructions_template, 'content_hash', v_prompt.content_hash)
  ) returning id into v_attempt_id;

  return query select
    v_attempt_id, v_target.id, v_campaign.id, v_target.request_id, v_target.offer_id,
    v_target.phone_e164, v_target.contact_name, v_target.company_name, v_campaign.mode,
    v_model.id, v_model.model_id, v_model.voice, v_model.session_config, v_model.capabilities,
    v_prompt.id, v_prompt.instructions_template, v_attempt_number, v_campaign.allowlist_only;
end;
$$;

create or replace function public.schedule_voice_callback(
  p_attempt_id uuid,
  p_tool_call_id text,
  p_callback_at timestamptz,
  p_reason text,
  p_idempotency_key text
)
returns table (action_id uuid, callback_at timestamptz, duplicate boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action_id uuid;
  v_target_id uuid;
begin
  if p_callback_at <= now() or p_callback_at > now() + interval '90 days' then raise exception 'callback time is outside allowed range'; end if;
  select id into v_action_id from public.voice_call_actions where idempotency_key = p_idempotency_key;
  if v_action_id is not null then return query select v_action_id, p_callback_at, true; return; end if;
  select target_id into v_target_id from public.voice_call_attempts where id = p_attempt_id for update;
  if v_target_id is null then raise exception 'voice call attempt not found'; end if;
  insert into public.voice_call_actions (
    attempt_id, tool_call_id, tool_name, idempotency_key, arguments, result, status
  ) values (
    p_attempt_id, p_tool_call_id, 'schedule_callback', p_idempotency_key,
    jsonb_build_object('callback_at', p_callback_at, 'reason', left(p_reason, 500)),
    jsonb_build_object('scheduled', true, 'callback_at', p_callback_at), 'completed'
  ) returning id into v_action_id;
  update public.voice_call_targets set next_attempt_at = p_callback_at, updated_at = now() where id = v_target_id;
  return query select v_action_id, p_callback_at, false;
end;
$$;

create or replace function public.record_voice_call_event(
  p_attempt_id uuid,
  p_source text,
  p_event_type text,
  p_idempotency_key text,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns table (event_id uuid, duplicate boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  select id into v_event_id from public.voice_call_events where idempotency_key = p_idempotency_key;
  if v_event_id is not null then
    return query select v_event_id, true;
    return;
  end if;

  insert into public.voice_call_events (
    attempt_id, source, event_type, provider_event_id, idempotency_key, payload, occurred_at
  ) values (
    p_attempt_id, p_source, p_event_type, p_provider_event_id, p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred_at, now())
  ) returning id into v_event_id;

  return query select v_event_id, false;
end;
$$;

create or replace function public.finalize_voice_call_attempt(
  p_attempt_id uuid,
  p_terminal_status text,
  p_outcome_code text,
  p_summary_for_human text,
  p_customer_intent text default null,
  p_product_interest text default null,
  p_objections text[] default '{}',
  p_callback_at timestamptz default null,
  p_handoff_requested boolean default false,
  p_handoff_completed boolean default false,
  p_customer_requested_stop boolean default false,
  p_unsafe_or_unsupported_request boolean default false,
  p_failure_code text default null,
  p_failure_detail text default null
)
returns table (attempt_id uuid, target_status text, duplicate boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempt public.voice_call_attempts%rowtype;
  v_target public.voice_call_targets%rowtype;
  v_campaign public.voice_call_campaigns%rowtype;
  v_target_status text;
begin
  if p_terminal_status not in ('completed', 'failed', 'cancelled', 'handed_off') then
    raise exception 'invalid terminal status';
  end if;

  select * into v_attempt from public.voice_call_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'voice call attempt not found'; end if;

  select * into v_target from public.voice_call_targets where id = v_attempt.target_id for update;
  select campaign.* into v_campaign from public.voice_call_campaigns campaign where campaign.id = v_target.campaign_id;

  if v_attempt.status in ('completed', 'failed', 'cancelled', 'handed_off') then
    return query select p_attempt_id, v_target.status, true;
    return;
  end if;

  update public.voice_call_attempts
  set status = p_terminal_status, ended_at = now(), failure_code = p_failure_code,
      failure_detail = left(p_failure_detail, 1000), updated_at = now()
  where id = p_attempt_id;

  insert into public.voice_call_outcomes (
    attempt_id, outcome_code, summary_for_human, customer_intent, product_interest, objections,
    callback_at, human_handoff_requested, human_handoff_completed, customer_requested_stop,
    unsafe_or_unsupported_request
  ) values (
    p_attempt_id, p_outcome_code, left(p_summary_for_human, 2000), left(p_customer_intent, 1000),
    left(p_product_interest, 1000), coalesce(p_objections, '{}'), p_callback_at,
    p_handoff_requested, p_handoff_completed, p_customer_requested_stop, p_unsafe_or_unsupported_request
  ) on conflict on constraint voice_call_outcomes_attempt_id_key do nothing;

  if p_customer_requested_stop or p_outcome_code = 'do_not_call' then
    v_target_status := 'blocked';
    insert into public.voice_do_not_call (
      request_id, phone_hash, active, reason, source, idempotency_key, created_by
    ) values (
      v_target.request_id, v_target.phone_hash, true, 'Customer requested no further AI voice calls',
      'voice_call', 'voice-dnc:' || v_target.id::text, 'voice-runtime'
    ) on conflict (idempotency_key) do nothing;
  elsif p_outcome_code = 'callback_requested' and p_callback_at is not null then
    v_target_status := 'retry';
  elsif p_terminal_status in ('completed', 'handed_off') then
    v_target_status := 'completed';
  elsif p_terminal_status = 'failed' and v_target.attempt_count < v_campaign.max_attempts then
    v_target_status := 'retry';
  elsif p_terminal_status = 'cancelled' then
    v_target_status := 'cancelled';
  else
    v_target_status := 'failed';
  end if;

  update public.voice_call_targets
  set status = v_target_status,
      next_attempt_at = case
        when v_target_status = 'retry' then now() + make_interval(mins => v_campaign.retry_delay_minutes)
        when p_callback_at is not null then p_callback_at
        else next_attempt_at
      end,
      claimed_by = null, claimed_until = null,
      last_error_code = p_failure_code,
      blocked_reason = case when v_target_status = 'blocked' then 'customer_requested_stop' else blocked_reason end,
      updated_at = now()
  where id = v_target.id;

  return query select p_attempt_id, v_target_status, false;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'voice_prompt_versions', 'voice_model_releases', 'voice_model_evaluations',
    'voice_runtime_settings', 'voice_contact_consents', 'voice_do_not_call',
    'voice_test_allowlist', 'voice_call_campaigns', 'voice_call_targets',
    'voice_call_attempts', 'voice_call_events', 'voice_call_outcomes',
    'voice_call_actions', 'voice_platform_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;
end;
$$;

revoke all on function public.promote_voice_model_release(uuid, text, text) from public, anon, authenticated;
revoke all on function public.select_voice_model_candidate(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_voice_model_sandbox(uuid, text, text) from public, anon, authenticated;
revoke all on function public.rollback_voice_model_release(text, text) from public, anon, authenticated;
revoke all on function public.record_voice_model_evaluation(uuid, text, text, integer, integer, integer, numeric, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.approve_voice_prompt_version(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_next_voice_call(text, integer) from public, anon, authenticated;
revoke all on function public.schedule_voice_callback(uuid, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.record_voice_call_event(uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_voice_call_attempt(uuid, text, text, text, text, text, text[], timestamptz, boolean, boolean, boolean, boolean, text, text) from public, anon, authenticated;

grant execute on function public.promote_voice_model_release(uuid, text, text) to service_role;
grant execute on function public.select_voice_model_candidate(uuid, text, text) to service_role;
grant execute on function public.approve_voice_model_sandbox(uuid, text, text) to service_role;
grant execute on function public.rollback_voice_model_release(text, text) to service_role;
grant execute on function public.record_voice_model_evaluation(uuid, text, text, integer, integer, integer, numeric, text, jsonb, jsonb, text) to service_role;
grant execute on function public.approve_voice_prompt_version(uuid, text, text) to service_role;
grant execute on function public.claim_next_voice_call(text, integer) to service_role;
grant execute on function public.schedule_voice_callback(uuid, text, timestamptz, text, text) to service_role;
grant execute on function public.record_voice_call_event(uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.finalize_voice_call_attempt(uuid, text, text, text, text, text, text[], timestamptz, boolean, boolean, boolean, boolean, text, text) to service_role;

comment on table public.voice_runtime_settings is
  'Fail-closed global Voice Platform switches. All outbound call paths require these gates.';
comment on table public.voice_contact_consents is
  'Exact, request-bound evidence for AI voice contact permission. A customer inquiry alone is not used as consent.';
comment on table public.voice_call_targets is
  'Postgres-backed call queue. n8n and runtimes claim work atomically; they are never the source of truth.';
comment on table public.voice_call_attempts is
  'Immutable model, prompt and context snapshots for each outbound attempt. Raw audio and transcripts remain disabled.';
comment on function public.claim_next_voice_call(text, integer) is
  'Atomically reserves one eligible call after kill-switch, consent, DNC, allowlist, schedule, prompt and model gates.';
