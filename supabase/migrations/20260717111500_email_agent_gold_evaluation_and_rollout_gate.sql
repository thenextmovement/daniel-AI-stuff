create table if not exists public.email_agent_gold_cases (
  id bigint generated always as identity primary key,
  case_key text not null unique,
  message_id text not null unique,
  source_decision_id bigint not null references public.email_agent_decision_shadow(id) on delete restrict,
  reference_decision text not null,
  reference_basis text not null,
  case_fingerprint text not null,
  source_body_hash text,
  source_classifier_version text not null,
  reason_codes text[] not null default '{}'::text[],
  risk_flags text[] not null default '{}'::text[],
  frozen_by text not null,
  freeze_note text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint email_agent_gold_cases_reference_decision_check
    check (reference_decision in ('draft', 'no_reply', 'human_review')),
  constraint email_agent_gold_cases_reference_basis_check
    check (reference_basis in (
      'observed_human_sent_reply',
      'deterministic_safety_policy',
      'deterministic_safe_no_reply_policy'
    )),
  constraint email_agent_gold_cases_fingerprint_check
    check (case_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint email_agent_gold_cases_reviewer_check
    check (char_length(btrim(frozen_by)) between 2 and 200),
  constraint email_agent_gold_cases_note_check
    check (char_length(btrim(freeze_note)) between 8 and 2000),
  constraint email_agent_gold_cases_active_retired_check
    check ((active = true and retired_at is null) or active = false)
);

create index if not exists email_agent_gold_cases_active_decision_idx
  on public.email_agent_gold_cases (active, reference_decision, created_at desc);

alter table public.email_agent_gold_cases enable row level security;

create table if not exists public.email_agent_gold_predictions (
  id bigint generated always as identity primary key,
  gold_case_id bigint not null references public.email_agent_gold_cases(id) on delete restrict,
  evaluation_version text not null,
  predicted_decision text not null,
  confidence numeric(5,4) not null,
  requires_human_review boolean not null,
  validation_status text not null,
  prediction_source text not null,
  classifier_version text not null,
  model_name text,
  created_at timestamptz not null default now(),
  constraint email_agent_gold_predictions_case_version_key
    unique (gold_case_id, evaluation_version),
  constraint email_agent_gold_predictions_decision_check
    check (predicted_decision in ('draft', 'no_reply', 'human_review')),
  constraint email_agent_gold_predictions_confidence_check
    check (confidence between 0 and 1),
  constraint email_agent_gold_predictions_validation_check
    check (validation_status in (
      'deterministic',
      'valid_ai',
      'fallback_invalid_ai',
      'fallback_low_confidence',
      'fallback_risk',
      'fallback_unsafe_no_reply'
    )),
  constraint email_agent_gold_predictions_source_check
    check (prediction_source in ('shadow_baseline', 'offline_replay', 'production_shadow')),
  constraint email_agent_gold_predictions_version_check
    check (char_length(btrim(evaluation_version)) between 3 and 160),
  constraint email_agent_gold_predictions_classifier_check
    check (char_length(btrim(classifier_version)) between 3 and 120)
);

create index if not exists email_agent_gold_predictions_version_idx
  on public.email_agent_gold_predictions (evaluation_version, created_at desc);

alter table public.email_agent_gold_predictions enable row level security;

create table if not exists public.email_agent_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  evaluation_version text not null,
  evaluated_count integer not null,
  exact_match_count integer not null,
  routing_match_count integer not null,
  unsafe_no_reply_count integer not null,
  missed_safe_no_reply_count integer not null,
  actionable_recall numeric(7,6) not null,
  no_reply_precision numeric(7,6) not null,
  routing_accuracy numeric(7,6) not null,
  exact_accuracy numeric(7,6) not null,
  gate_passed boolean not null,
  metrics jsonb not null,
  triggered_by text not null,
  trigger_note text not null,
  created_at timestamptz not null default now(),
  constraint email_agent_evaluation_runs_counts_check check (
    evaluated_count >= 0
    and exact_match_count between 0 and evaluated_count
    and routing_match_count between 0 and evaluated_count
    and unsafe_no_reply_count between 0 and evaluated_count
    and missed_safe_no_reply_count between 0 and evaluated_count
  ),
  constraint email_agent_evaluation_runs_rates_check check (
    actionable_recall between 0 and 1
    and no_reply_precision between 0 and 1
    and routing_accuracy between 0 and 1
    and exact_accuracy between 0 and 1
  ),
  constraint email_agent_evaluation_runs_actor_check
    check (char_length(btrim(triggered_by)) between 2 and 200),
  constraint email_agent_evaluation_runs_note_check
    check (char_length(btrim(trigger_note)) between 8 and 2000)
);

create index if not exists email_agent_evaluation_runs_version_created_idx
  on public.email_agent_evaluation_runs (evaluation_version, created_at desc);

alter table public.email_agent_evaluation_runs enable row level security;

create table if not exists public.email_agent_rollout_control (
  control_key text primary key,
  requested_stage text not null,
  active_evaluation_version text,
  min_gold_cases integer not null default 50,
  min_routing_accuracy numeric(7,6) not null default 0.980000,
  min_actionable_recall numeric(7,6) not null default 0.980000,
  min_no_reply_precision numeric(7,6) not null default 0.980000,
  max_unsafe_no_reply integer not null default 0,
  min_current_draft_samples integer not null default 30,
  max_current_safety_correction_share numeric(7,6) not null default 0.020000,
  max_current_manual_rewrite_share numeric(7,6) not null default 0.250000,
  max_current_median_edit_ratio numeric(7,6) not null default 0.350000,
  automatic_send_allowed boolean not null default false,
  human_send_approval_required boolean not null default true,
  updated_by text not null,
  update_note text not null,
  updated_at timestamptz not null default now(),
  constraint email_agent_rollout_control_key_check check (control_key = 'email_draft_agent'),
  constraint email_agent_rollout_control_stage_check
    check (requested_stage in ('shadow', 'review_only', 'routing_gate')),
  constraint email_agent_rollout_control_gold_check check (min_gold_cases >= 50),
  constraint email_agent_rollout_control_thresholds_check check (
    min_routing_accuracy between 0 and 1
    and min_actionable_recall between 0 and 1
    and min_no_reply_precision between 0 and 1
    and max_unsafe_no_reply = 0
    and min_current_draft_samples >= 30
    and max_current_safety_correction_share between 0 and 1
    and max_current_manual_rewrite_share between 0 and 1
    and max_current_median_edit_ratio between 0 and 1
  ),
  constraint email_agent_rollout_control_no_auto_send_check
    check (automatic_send_allowed = false),
  constraint email_agent_rollout_control_human_send_check
    check (human_send_approval_required = true),
  constraint email_agent_rollout_control_actor_check
    check (char_length(btrim(updated_by)) between 2 and 200),
  constraint email_agent_rollout_control_note_check
    check (char_length(btrim(update_note)) between 8 and 2000)
);

alter table public.email_agent_rollout_control enable row level security;

insert into public.email_agent_rollout_control (
  control_key,
  requested_stage,
  updated_by,
  update_note
) values (
  'email_draft_agent',
  'review_only',
  'migration_safe_default',
  'Entwürfe bleiben verpflichtend durch Menschen geprüft; automatischer Versand ist technisch gesperrt.'
)
on conflict (control_key) do nothing;

create table if not exists public.email_agent_rollout_audit (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  event_type text not null,
  previous_stage text,
  requested_stage text,
  effective_stage text,
  evaluation_version text,
  actor text not null,
  note text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_agent_rollout_audit_event_check
    check (event_type in ('gold_seeded', 'evaluation_recorded', 'stage_requested')),
  constraint email_agent_rollout_audit_stage_check check (
    (previous_stage is null or previous_stage in ('shadow', 'review_only', 'routing_gate'))
    and (requested_stage is null or requested_stage in ('shadow', 'review_only', 'routing_gate'))
    and (effective_stage is null or effective_stage in ('shadow', 'review_only', 'routing_gate'))
  ),
  constraint email_agent_rollout_audit_actor_check
    check (char_length(btrim(actor)) between 2 and 200),
  constraint email_agent_rollout_audit_note_check
    check (char_length(btrim(note)) between 8 and 2000)
);

create index if not exists email_agent_rollout_audit_created_idx
  on public.email_agent_rollout_audit (created_at desc);

alter table public.email_agent_rollout_audit enable row level security;

revoke all on table
  public.email_agent_gold_cases,
  public.email_agent_gold_predictions,
  public.email_agent_evaluation_runs,
  public.email_agent_rollout_control,
  public.email_agent_rollout_audit
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.email_agent_gold_cases,
  public.email_agent_gold_predictions,
  public.email_agent_evaluation_runs,
  public.email_agent_rollout_control
to service_role;

grant select, insert on table public.email_agent_rollout_audit to service_role;

revoke all on sequence
  public.email_agent_gold_cases_id_seq,
  public.email_agent_gold_predictions_id_seq
from public, anon, authenticated, service_role;

grant usage, select on sequence
  public.email_agent_gold_cases_id_seq,
  public.email_agent_gold_predictions_id_seq
to service_role;

create or replace function public.seed_email_agent_gold_cases_v1(
  p_target_count integer,
  p_frozen_by text,
  p_freeze_note text,
  p_evaluation_version text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  target_count integer := greatest(50, least(coalesce(p_target_count, 50), 250));
  clean_actor text := left(btrim(coalesce(p_frozen_by, '')), 200);
  clean_note text := left(btrim(coalesce(p_freeze_note, '')), 2000);
  clean_version text := left(btrim(coalesce(p_evaluation_version, '')), 160);
  existing_audit public.email_agent_rollout_audit%rowtype;
  inserted_count integer;
begin
  if char_length(clean_actor) < 2 then
    raise exception 'frozen_by must contain at least 2 characters';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'freeze_note must contain at least 8 characters';
  end if;
  if char_length(clean_version) < 3 then
    raise exception 'evaluation_version must contain at least 3 characters';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('email-agent-gold-seed-v1'));

  select * into existing_audit
  from public.email_agent_rollout_audit
  where idempotency_key = p_idempotency_key;

  if found then
    return existing_audit.snapshot || jsonb_build_object('idempotent_replay', true);
  end if;

  if exists (select 1 from public.email_agent_gold_cases where active = true) then
    raise exception 'an active gold set already exists and is immutable';
  end if;

  with candidate_base as (
    select
      decision.*,
      case
        when exists (
          select 1
          from public.email_agent_feedback feedback
          where feedback.source_message_id = decision.message_id
            and feedback.is_valid = true
            and nullif(btrim(coalesce(feedback.sent_body_text, '')), '') is not null
        ) then 'draft'
        when cardinality(decision.risk_flags) > 0
          or decision.reason_codes && array[
            'requires_system_lookup',
            'prompt_injection_suspected',
            'missing_information',
            'complaint_or_risk',
            'unclear_intent',
            'invalid_ai_output',
            'low_confidence',
            'unsafe_no_reply'
          ]::text[] then 'human_review'
        when decision.final_decision = 'no_reply'
          and decision.validation_status in ('deterministic', 'valid_ai')
          and cardinality(decision.risk_flags) = 0
          and cardinality(decision.reason_codes) > 0
          and decision.reason_codes <@ array[
            'automated_notification',
            'acknowledgement_only',
            'conversation_closed',
            'spam_or_marketing'
          ]::text[] then 'no_reply'
        else null
      end as reference_decision_value,
      case
        when exists (
          select 1
          from public.email_agent_feedback feedback
          where feedback.source_message_id = decision.message_id
            and feedback.is_valid = true
            and nullif(btrim(coalesce(feedback.sent_body_text, '')), '') is not null
        ) then 'observed_human_sent_reply'
        when cardinality(decision.risk_flags) > 0
          or decision.reason_codes && array[
            'requires_system_lookup',
            'prompt_injection_suspected',
            'missing_information',
            'complaint_or_risk',
            'unclear_intent',
            'invalid_ai_output',
            'low_confidence',
            'unsafe_no_reply'
          ]::text[] then 'deterministic_safety_policy'
        when decision.final_decision = 'no_reply'
          and decision.validation_status in ('deterministic', 'valid_ai')
          and cardinality(decision.risk_flags) = 0
          and cardinality(decision.reason_codes) > 0
          and decision.reason_codes <@ array[
            'automated_notification',
            'acknowledgement_only',
            'conversation_closed',
            'spam_or_marketing'
          ]::text[] then 'deterministic_safe_no_reply_policy'
        else null
      end as reference_basis_value
    from public.email_agent_decision_shadow decision
  ), ranked as (
    select
      candidate.*,
      row_number() over (
        partition by candidate.reference_decision_value
        order by candidate.created_at desc, md5(candidate.message_id)
      ) as decision_rank
    from candidate_base candidate
    where candidate.reference_decision_value is not null
  ), preferred as (
    select ranked.*
    from ranked
    where (reference_decision_value = 'draft' and decision_rank <= 5)
       or (reference_decision_value = 'human_review' and decision_rank <= 20)
       or (reference_decision_value = 'no_reply' and decision_rank <= 25)
  ), selected as (
    select preferred.*, 0 as selection_priority
    from preferred
    union all
    select ranked.*, 1 as selection_priority
    from ranked
    where not exists (
      select 1 from preferred where preferred.id = ranked.id
    )
  ), final_selection as (
    select *
    from selected
    order by selection_priority, md5(message_id)
    limit target_count
  )
  insert into public.email_agent_gold_cases (
    case_key,
    message_id,
    source_decision_id,
    reference_decision,
    reference_basis,
    case_fingerprint,
    source_body_hash,
    source_classifier_version,
    reason_codes,
    risk_flags,
    frozen_by,
    freeze_note
  )
  select
    'email-gold-v1:' || md5(message_id),
    message_id,
    id,
    reference_decision_value,
    reference_basis_value,
    md5(concat_ws('|', message_id, coalesce(body_hash, ''), reference_decision_value, reference_basis_value)),
    body_hash,
    classifier_version,
    reason_codes,
    risk_flags,
    clean_actor,
    clean_note
  from final_selection;

  get diagnostics inserted_count = row_count;

  if inserted_count <> target_count then
    raise exception 'gold set requires exactly % eligible cases, only % were selected', target_count, inserted_count;
  end if;

  insert into public.email_agent_gold_predictions (
    gold_case_id,
    evaluation_version,
    predicted_decision,
    confidence,
    requires_human_review,
    validation_status,
    prediction_source,
    classifier_version,
    model_name
  )
  select
    gold.id,
    clean_version,
    decision.final_decision,
    decision.confidence,
    decision.requires_human_review,
    decision.validation_status,
    'shadow_baseline',
    decision.classifier_version,
    decision.model_name
  from public.email_agent_gold_cases gold
  join public.email_agent_decision_shadow decision on decision.id = gold.source_decision_id
  where gold.active = true;

  insert into public.email_agent_rollout_audit (
    idempotency_key,
    event_type,
    requested_stage,
    effective_stage,
    evaluation_version,
    actor,
    note,
    snapshot
  ) values (
    p_idempotency_key,
    'gold_seeded',
    'review_only',
    'review_only',
    clean_version,
    clean_actor,
    clean_note,
    jsonb_build_object(
      'version', 'email-agent-gold-seed-v1',
      'seeded_count', inserted_count,
      'evaluation_version', clean_version,
      'customer_content_stored', false,
      'automatic_send_allowed', false,
      'idempotent_replay', false
    )
  );

  return jsonb_build_object(
    'version', 'email-agent-gold-seed-v1',
    'seeded_count', inserted_count,
    'evaluation_version', clean_version,
    'customer_content_stored', false,
    'automatic_send_allowed', false,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function public.record_email_agent_gold_prediction_v1(
  p_case_key text,
  p_evaluation_version text,
  p_predicted_decision text,
  p_confidence numeric,
  p_requires_human_review boolean,
  p_validation_status text,
  p_prediction_source text,
  p_classifier_version text,
  p_model_name text default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  gold_case public.email_agent_gold_cases%rowtype;
  existing_prediction public.email_agent_gold_predictions%rowtype;
  prediction_id bigint;
  clean_version text := left(btrim(coalesce(p_evaluation_version, '')), 160);
  clean_classifier text := left(btrim(coalesce(p_classifier_version, '')), 120);
begin
  select * into gold_case
  from public.email_agent_gold_cases
  where case_key = btrim(coalesce(p_case_key, ''))
    and active = true;

  if not found then
    raise exception 'active gold case was not found';
  end if;
  if char_length(clean_version) < 3 or char_length(clean_classifier) < 3 then
    raise exception 'evaluation_version and classifier_version are required';
  end if;
  if p_predicted_decision not in ('draft', 'no_reply', 'human_review') then
    raise exception 'invalid predicted_decision';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'confidence must be between 0 and 1';
  end if;
  if p_requires_human_review is null then
    raise exception 'requires_human_review is required';
  end if;
  if p_validation_status not in (
    'deterministic', 'valid_ai', 'fallback_invalid_ai', 'fallback_low_confidence',
    'fallback_risk', 'fallback_unsafe_no_reply'
  ) then
    raise exception 'invalid validation_status';
  end if;
  if p_prediction_source not in ('shadow_baseline', 'offline_replay', 'production_shadow') then
    raise exception 'invalid prediction_source';
  end if;

  perform pg_advisory_xact_lock(hashtext('email-gold-prediction:' || gold_case.id::text || ':' || clean_version));

  select * into existing_prediction
  from public.email_agent_gold_predictions
  where gold_case_id = gold_case.id
    and evaluation_version = clean_version;

  if found then
    if existing_prediction.predicted_decision <> p_predicted_decision
      or existing_prediction.confidence <> p_confidence
      or existing_prediction.validation_status <> p_validation_status
      or existing_prediction.classifier_version <> clean_classifier then
      raise exception 'evaluation version is immutable and already has a different prediction';
    end if;
    return jsonb_build_object(
      'recorded', true,
      'idempotent_replay', true,
      'prediction_id', existing_prediction.id,
      'case_key', gold_case.case_key,
      'evaluation_version', clean_version
    );
  end if;

  insert into public.email_agent_gold_predictions (
    gold_case_id,
    evaluation_version,
    predicted_decision,
    confidence,
    requires_human_review,
    validation_status,
    prediction_source,
    classifier_version,
    model_name
  ) values (
    gold_case.id,
    clean_version,
    p_predicted_decision,
    p_confidence,
    p_requires_human_review,
    p_validation_status,
    p_prediction_source,
    clean_classifier,
    left(nullif(btrim(coalesce(p_model_name, '')), ''), 120)
  ) returning id into prediction_id;

  return jsonb_build_object(
    'recorded', true,
    'idempotent_replay', false,
    'prediction_id', prediction_id,
    'case_key', gold_case.case_key,
    'evaluation_version', clean_version
  );
end;
$function$;

create or replace function public.run_email_agent_evaluation_v1(
  p_evaluation_version text,
  p_triggered_by text,
  p_trigger_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  clean_version text := left(btrim(coalesce(p_evaluation_version, '')), 160);
  clean_actor text := left(btrim(coalesce(p_triggered_by, '')), 200);
  clean_note text := left(btrim(coalesce(p_trigger_note, '')), 2000);
  control_row public.email_agent_rollout_control%rowtype;
  existing_audit public.email_agent_rollout_audit%rowtype;
  evaluated_count_value integer;
  exact_match_count_value integer;
  routing_match_count_value integer;
  unsafe_no_reply_count_value integer;
  missed_safe_no_reply_count_value integer;
  actionable_count_value integer;
  predicted_no_reply_count_value integer;
  actionable_recall_value numeric;
  no_reply_precision_value numeric;
  routing_accuracy_value numeric;
  exact_accuracy_value numeric;
  gate_passed_value boolean;
  metrics_value jsonb;
  run_id uuid;
begin
  if char_length(clean_version) < 3 then
    raise exception 'evaluation_version must contain at least 3 characters';
  end if;
  if char_length(clean_actor) < 2 then
    raise exception 'triggered_by must contain at least 2 characters';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'trigger_note must contain at least 8 characters';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('email-agent-evaluation:' || clean_version));

  select * into existing_audit
  from public.email_agent_rollout_audit
  where idempotency_key = p_idempotency_key;

  if found then
    return existing_audit.snapshot || jsonb_build_object('idempotent_replay', true);
  end if;

  select * into control_row
  from public.email_agent_rollout_control
  where control_key = 'email_draft_agent'
  for update;

  with evaluated as (
    select
      gold.reference_decision,
      prediction.predicted_decision,
      (gold.reference_decision = prediction.predicted_decision) as exact_match,
      ((gold.reference_decision = 'no_reply') = (prediction.predicted_decision = 'no_reply')) as routing_match
    from public.email_agent_gold_cases gold
    join public.email_agent_gold_predictions prediction on prediction.gold_case_id = gold.id
    where gold.active = true
      and prediction.evaluation_version = clean_version
  )
  select
    count(*)::integer,
    count(*) filter (where exact_match)::integer,
    count(*) filter (where routing_match)::integer,
    count(*) filter (
      where reference_decision <> 'no_reply' and predicted_decision = 'no_reply'
    )::integer,
    count(*) filter (
      where reference_decision = 'no_reply' and predicted_decision <> 'no_reply'
    )::integer,
    count(*) filter (where reference_decision <> 'no_reply')::integer,
    count(*) filter (where predicted_decision = 'no_reply')::integer
  into
    evaluated_count_value,
    exact_match_count_value,
    routing_match_count_value,
    unsafe_no_reply_count_value,
    missed_safe_no_reply_count_value,
    actionable_count_value,
    predicted_no_reply_count_value
  from evaluated;

  actionable_recall_value := case when actionable_count_value = 0 then 0
    else round((actionable_count_value - unsafe_no_reply_count_value)::numeric / actionable_count_value, 6) end;
  no_reply_precision_value := case when predicted_no_reply_count_value = 0 then 0
    else round((predicted_no_reply_count_value - unsafe_no_reply_count_value)::numeric / predicted_no_reply_count_value, 6) end;
  routing_accuracy_value := case when evaluated_count_value = 0 then 0
    else round(routing_match_count_value::numeric / evaluated_count_value, 6) end;
  exact_accuracy_value := case when evaluated_count_value = 0 then 0
    else round(exact_match_count_value::numeric / evaluated_count_value, 6) end;

  gate_passed_value := evaluated_count_value >= control_row.min_gold_cases
    and unsafe_no_reply_count_value <= control_row.max_unsafe_no_reply
    and actionable_recall_value >= control_row.min_actionable_recall
    and no_reply_precision_value >= control_row.min_no_reply_precision
    and routing_accuracy_value >= control_row.min_routing_accuracy;

  metrics_value := jsonb_build_object(
    'version', 'email-agent-gold-evaluation-v1',
    'evaluation_version', clean_version,
    'evaluated_count', evaluated_count_value,
    'gold_minimum', control_row.min_gold_cases,
    'exact_match_count', exact_match_count_value,
    'routing_match_count', routing_match_count_value,
    'unsafe_no_reply_count', unsafe_no_reply_count_value,
    'missed_safe_no_reply_count', missed_safe_no_reply_count_value,
    'actionable_recall', actionable_recall_value,
    'no_reply_precision', no_reply_precision_value,
    'routing_accuracy', routing_accuracy_value,
    'exact_accuracy', exact_accuracy_value,
    'thresholds', jsonb_build_object(
      'max_unsafe_no_reply', control_row.max_unsafe_no_reply,
      'min_actionable_recall', control_row.min_actionable_recall,
      'min_no_reply_precision', control_row.min_no_reply_precision,
      'min_routing_accuracy', control_row.min_routing_accuracy
    ),
    'gate_passed', gate_passed_value,
    'automatic_send_allowed', false,
    'human_send_approval_required', true,
    'idempotent_replay', false
  );

  insert into public.email_agent_evaluation_runs (
    evaluation_version,
    evaluated_count,
    exact_match_count,
    routing_match_count,
    unsafe_no_reply_count,
    missed_safe_no_reply_count,
    actionable_recall,
    no_reply_precision,
    routing_accuracy,
    exact_accuracy,
    gate_passed,
    metrics,
    triggered_by,
    trigger_note
  ) values (
    clean_version,
    evaluated_count_value,
    exact_match_count_value,
    routing_match_count_value,
    unsafe_no_reply_count_value,
    missed_safe_no_reply_count_value,
    actionable_recall_value,
    no_reply_precision_value,
    routing_accuracy_value,
    exact_accuracy_value,
    gate_passed_value,
    metrics_value,
    clean_actor,
    clean_note
  ) returning id into run_id;

  update public.email_agent_rollout_control
  set active_evaluation_version = clean_version,
      updated_by = clean_actor,
      update_note = clean_note,
      updated_at = now()
  where control_key = 'email_draft_agent';

  metrics_value := metrics_value || jsonb_build_object('run_id', run_id);

  insert into public.email_agent_rollout_audit (
    idempotency_key,
    event_type,
    requested_stage,
    effective_stage,
    evaluation_version,
    actor,
    note,
    snapshot
  ) values (
    p_idempotency_key,
    'evaluation_recorded',
    control_row.requested_stage,
    case
      when control_row.requested_stage = 'shadow' then 'shadow'
      when control_row.requested_stage = 'routing_gate' and gate_passed_value then 'routing_gate'
      else 'review_only'
    end,
    clean_version,
    clean_actor,
    clean_note,
    metrics_value
  );

  return metrics_value;
end;
$function$;

create or replace function public.get_email_agent_rollout_gate_v1()
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  control_row public.email_agent_rollout_control%rowtype;
  evaluation_row public.email_agent_evaluation_runs%rowtype;
  historical_total integer;
  historical_safety_corrections integer;
  historical_manual_rewrites integer;
  historical_median_edit numeric;
  current_total integer;
  current_safety_corrections integer;
  current_manual_rewrites integer;
  current_median_edit numeric;
  current_safety_share numeric;
  current_rewrite_share numeric;
  decision_gate_passed boolean := false;
  draft_quality_status text;
  draft_quality_passed boolean := false;
  effective_stage text;
begin
  select * into control_row
  from public.email_agent_rollout_control
  where control_key = 'email_draft_agent';

  if control_row.active_evaluation_version is not null then
    select * into evaluation_row
    from public.email_agent_evaluation_runs
    where evaluation_version = control_row.active_evaluation_version
    order by created_at desc
    limit 1;
    decision_gate_passed := coalesce(evaluation_row.gate_passed, false);
  end if;

  with feedback_scope as (
    select feedback.*, log.context_snapshot
    from public.email_agent_feedback feedback
    join public.email_agent_log log on log.message_id = feedback.source_message_id
    where feedback.is_valid = true
      and feedback.collected_at >= now() - interval '90 days'
  )
  select
    count(*)::integer,
    count(*) filter (where edit_labels && array[
      'amount_changed', 'date_changed', 'attachment_reference_changed',
      'commitment_changed', 'internal_detail_removed', 'factual_correction'
    ]::text[])::integer,
    count(*) filter (where edit_labels && array['manual_rewrite']::text[])::integer,
    coalesce(round(percentile_disc(0.5) within group (order by edit_ratio)::numeric, 6), 0)
  into historical_total, historical_safety_corrections, historical_manual_rewrites, historical_median_edit
  from feedback_scope;

  with feedback_scope as (
    select feedback.*, log.context_snapshot
    from public.email_agent_feedback feedback
    join public.email_agent_log log on log.message_id = feedback.source_message_id
    where feedback.is_valid = true
      and feedback.collected_at >= now() - interval '90 days'
      and log.context_snapshot#>>'{evidence_card,version}' = 'email-evidence-card-v2'
      and coalesce(
        log.context_snapshot#>>'{evidence_card,facts_package_version}',
        log.context_snapshot#>>'{facts_package,version}'
      ) = 'email-facts-package-v1'
  )
  select
    count(*)::integer,
    count(*) filter (where edit_labels && array[
      'amount_changed', 'date_changed', 'attachment_reference_changed',
      'commitment_changed', 'internal_detail_removed', 'factual_correction'
    ]::text[])::integer,
    count(*) filter (where edit_labels && array['manual_rewrite']::text[])::integer,
    coalesce(round(percentile_disc(0.5) within group (order by edit_ratio)::numeric, 6), 0)
  into current_total, current_safety_corrections, current_manual_rewrites, current_median_edit
  from feedback_scope;

  current_safety_share := case when current_total = 0 then 0
    else round(current_safety_corrections::numeric / current_total, 6) end;
  current_rewrite_share := case when current_total = 0 then 0
    else round(current_manual_rewrites::numeric / current_total, 6) end;

  draft_quality_passed := current_total >= control_row.min_current_draft_samples
    and current_safety_share <= control_row.max_current_safety_correction_share
    and current_rewrite_share <= control_row.max_current_manual_rewrite_share
    and current_median_edit <= control_row.max_current_median_edit_ratio;
  draft_quality_status := case
    when current_total < control_row.min_current_draft_samples then 'observing'
    when draft_quality_passed then 'passed'
    else 'blocked'
  end;

  effective_stage := case
    when control_row.requested_stage = 'shadow' then 'shadow'
    when control_row.requested_stage = 'routing_gate'
      and decision_gate_passed
      and draft_quality_passed then 'routing_gate'
    else 'review_only'
  end;

  return jsonb_build_object(
    'version', 'email-agent-rollout-gate-v1',
    'requested_stage', control_row.requested_stage,
    'effective_stage', effective_stage,
    'active_evaluation_version', control_row.active_evaluation_version,
    'decision_gate', jsonb_build_object(
      'passed', decision_gate_passed,
      'evaluated_count', coalesce(evaluation_row.evaluated_count, 0),
      'unsafe_no_reply_count', coalesce(evaluation_row.unsafe_no_reply_count, 0),
      'actionable_recall', coalesce(evaluation_row.actionable_recall, 0),
      'no_reply_precision', coalesce(evaluation_row.no_reply_precision, 0),
      'routing_accuracy', coalesce(evaluation_row.routing_accuracy, 0),
      'exact_accuracy', coalesce(evaluation_row.exact_accuracy, 0),
      'run_id', evaluation_row.id,
      'created_at', evaluation_row.created_at
    ),
    'draft_quality_gate', jsonb_build_object(
      'status', draft_quality_status,
      'passed', draft_quality_passed,
      'current_version', 'email-facts-package-v1',
      'current_samples', current_total,
      'minimum_samples', control_row.min_current_draft_samples,
      'safety_correction_count', current_safety_corrections,
      'safety_correction_share', current_safety_share,
      'manual_rewrite_count', current_manual_rewrites,
      'manual_rewrite_share', current_rewrite_share,
      'median_edit_ratio', current_median_edit,
      'thresholds', jsonb_build_object(
        'max_safety_correction_share', control_row.max_current_safety_correction_share,
        'max_manual_rewrite_share', control_row.max_current_manual_rewrite_share,
        'max_median_edit_ratio', control_row.max_current_median_edit_ratio
      )
    ),
    'historical_feedback', jsonb_build_object(
      'samples', historical_total,
      'safety_correction_count', historical_safety_corrections,
      'manual_rewrite_count', historical_manual_rewrites,
      'median_edit_ratio', historical_median_edit
    ),
    'allow_action_driving_no_reply', effective_stage = 'routing_gate',
    'create_human_review_drafts', effective_stage in ('review_only', 'routing_gate'),
    'automatic_send_allowed', false,
    'human_send_approval_required', true,
    'rollout_ready', decision_gate_passed and draft_quality_passed
  );
end;
$function$;

create or replace function public.set_email_agent_rollout_stage_v1(
  p_requested_stage text,
  p_actor text,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  clean_stage text := btrim(coalesce(p_requested_stage, ''));
  clean_actor text := left(btrim(coalesce(p_actor, '')), 200);
  clean_note text := left(btrim(coalesce(p_note, '')), 2000);
  control_row public.email_agent_rollout_control%rowtype;
  existing_audit public.email_agent_rollout_audit%rowtype;
  gate jsonb;
begin
  if clean_stage not in ('shadow', 'review_only', 'routing_gate') then
    raise exception 'invalid requested_stage';
  end if;
  if char_length(clean_actor) < 2 then
    raise exception 'actor must contain at least 2 characters';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'note must contain at least 8 characters';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('email-agent-rollout-stage-v1'));

  select * into existing_audit
  from public.email_agent_rollout_audit
  where idempotency_key = p_idempotency_key;

  if found then
    return existing_audit.snapshot || jsonb_build_object('idempotent_replay', true);
  end if;

  select * into control_row
  from public.email_agent_rollout_control
  where control_key = 'email_draft_agent'
  for update;

  if clean_stage = 'routing_gate' then
    gate := public.get_email_agent_rollout_gate_v1();
    if coalesce((gate#>>'{decision_gate,passed}')::boolean, false) is not true
      or coalesce((gate#>>'{draft_quality_gate,passed}')::boolean, false) is not true then
      raise exception 'routing_gate is blocked until both decision and current-version draft quality gates pass';
    end if;
  end if;

  update public.email_agent_rollout_control
  set requested_stage = clean_stage,
      updated_by = clean_actor,
      update_note = clean_note,
      updated_at = now()
  where control_key = 'email_draft_agent';

  gate := public.get_email_agent_rollout_gate_v1();

  insert into public.email_agent_rollout_audit (
    idempotency_key,
    event_type,
    previous_stage,
    requested_stage,
    effective_stage,
    evaluation_version,
    actor,
    note,
    snapshot
  ) values (
    p_idempotency_key,
    'stage_requested',
    control_row.requested_stage,
    clean_stage,
    gate->>'effective_stage',
    gate->>'active_evaluation_version',
    clean_actor,
    clean_note,
    gate || jsonb_build_object('idempotent_replay', false)
  );

  return gate || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.seed_email_agent_gold_cases_v1(integer, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_email_agent_gold_prediction_v1(text, text, text, numeric, boolean, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.run_email_agent_evaluation_v1(text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_email_agent_rollout_gate_v1()
  from public, anon, authenticated;
revoke all on function public.set_email_agent_rollout_stage_v1(text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.seed_email_agent_gold_cases_v1(integer, text, text, text, uuid)
  to service_role;
grant execute on function public.record_email_agent_gold_prediction_v1(text, text, text, numeric, boolean, text, text, text, text)
  to service_role;
grant execute on function public.run_email_agent_evaluation_v1(text, text, text, uuid)
  to service_role;
grant execute on function public.get_email_agent_rollout_gate_v1()
  to service_role;
grant execute on function public.set_email_agent_rollout_stage_v1(text, text, text, uuid)
  to service_role;

comment on table public.email_agent_gold_cases is
  'Immutable, metadata-only 50-case reference set for draft/no-reply/human-review routing. Customer message bodies are never copied here.';
comment on table public.email_agent_gold_predictions is
  'Immutable per-version predictions for the email routing gold set.';
comment on table public.email_agent_evaluation_runs is
  'Audited snapshots of email routing quality. A run never authorizes customer communication.';
comment on table public.email_agent_rollout_control is
  'Fail-closed rollout control. Automatic sending is prohibited by database constraints.';
comment on function public.get_email_agent_rollout_gate_v1() is
  'Returns the effective rollout stage plus decision and current Facts Package quality gates. No side effects.';
