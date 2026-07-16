create table if not exists public.email_agent_decision_shadow (
  id bigint generated always as identity primary key,
  message_id text not null,
  internet_message_id text,
  conversation_id text,
  workflow_execution_id text not null,
  correlation_id text not null,
  received_at timestamptz,
  from_email text,
  subject text,
  message_source text not null default 'external_email',
  body_preview text,
  body_hash text,
  existing_should_process boolean not null,
  existing_skip_reason text,
  ai_decision text,
  final_decision text not null,
  confidence numeric(5,4) not null,
  requires_human_review boolean not null default true,
  reason_codes text[] not null default '{}'::text[],
  risk_flags text[] not null default '{}'::text[],
  summary text,
  validation_status text not null,
  classifier_version text not null,
  model_name text,
  shadow_only boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_agent_decision_shadow_message_unique unique (message_id),
  constraint email_agent_decision_shadow_message_id_check
    check (char_length(message_id) between 1 and 2000),
  constraint email_agent_decision_shadow_execution_id_check
    check (char_length(workflow_execution_id) between 1 and 200),
  constraint email_agent_decision_shadow_correlation_id_check
    check (char_length(correlation_id) between 1 and 500),
  constraint email_agent_decision_shadow_ai_decision_check
    check (ai_decision is null or ai_decision in ('draft', 'no_reply', 'human_review')),
  constraint email_agent_decision_shadow_final_decision_check
    check (final_decision in ('draft', 'no_reply', 'human_review')),
  constraint email_agent_decision_shadow_confidence_check
    check (confidence between 0 and 1),
  constraint email_agent_decision_shadow_validation_status_check
    check (validation_status in (
      'deterministic',
      'valid_ai',
      'fallback_invalid_ai',
      'fallback_low_confidence',
      'fallback_risk',
      'fallback_unsafe_no_reply'
    )),
  constraint email_agent_decision_shadow_shadow_only_check
    check (shadow_only = true)
);

create index if not exists email_agent_decision_shadow_decision_created_idx
  on public.email_agent_decision_shadow (final_decision, created_at desc);

create index if not exists email_agent_decision_shadow_human_review_idx
  on public.email_agent_decision_shadow (requires_human_review, created_at desc)
  where requires_human_review = true;

alter table public.email_agent_decision_shadow enable row level security;

revoke all on table public.email_agent_decision_shadow
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.email_agent_decision_shadow
  to service_role;

revoke all on sequence public.email_agent_decision_shadow_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.email_agent_decision_shadow_id_seq
  to service_role;

create or replace function public.record_email_agent_decision_shadow_v1(
  p_record jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  message_value text;
  execution_value text;
  correlation_value text;
  ai_decision_value text;
  final_decision_value text;
  validation_value text;
  classifier_value text;
  confidence_value numeric;
  existing_should_process_value boolean;
  requires_review_value boolean;
  clean_reason_codes text[];
  clean_risk_flags text[];
  affected_id bigint;
begin
  if jsonb_typeof(coalesce(p_record, '{}'::jsonb)) <> 'object' then
    raise exception 'record must be a JSON object';
  end if;

  message_value := left(btrim(coalesce(p_record->>'message_id', '')), 2000);
  execution_value := left(btrim(coalesce(p_record->>'workflow_execution_id', '')), 200);
  correlation_value := left(btrim(coalesce(p_record->>'correlation_id', '')), 500);
  ai_decision_value := nullif(btrim(coalesce(p_record->>'ai_decision', '')), '');
  final_decision_value := btrim(coalesce(p_record->>'final_decision', ''));
  validation_value := btrim(coalesce(p_record->>'validation_status', ''));
  classifier_value := left(btrim(coalesce(p_record->>'classifier_version', '')), 120);

  if message_value = '' or execution_value = '' or correlation_value = '' then
    raise exception 'message_id, workflow_execution_id and correlation_id are required';
  end if;
  if classifier_value = '' then
    raise exception 'classifier_version is required';
  end if;
  if ai_decision_value is not null
    and ai_decision_value not in ('draft', 'no_reply', 'human_review') then
    raise exception 'invalid ai_decision';
  end if;
  if final_decision_value not in ('draft', 'no_reply', 'human_review') then
    raise exception 'invalid final_decision';
  end if;
  if validation_value not in (
    'deterministic',
    'valid_ai',
    'fallback_invalid_ai',
    'fallback_low_confidence',
    'fallback_risk',
    'fallback_unsafe_no_reply'
  ) then
    raise exception 'invalid validation_status';
  end if;

  begin
    confidence_value := (p_record->>'confidence')::numeric;
  exception when others then
    raise exception 'confidence must be numeric';
  end;
  if confidence_value < 0 or confidence_value > 1 then
    raise exception 'confidence must be between 0 and 1';
  end if;

  if jsonb_typeof(p_record->'existing_should_process') <> 'boolean' then
    raise exception 'existing_should_process must be boolean';
  end if;
  existing_should_process_value := (p_record->>'existing_should_process')::boolean;

  requires_review_value := case
    when final_decision_value = 'human_review' then true
    when jsonb_typeof(p_record->'requires_human_review') = 'boolean'
      then (p_record->>'requires_human_review')::boolean
    else false
  end;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into clean_reason_codes
  from (
    select distinct value
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'reason_codes') = 'array'
        then p_record->'reason_codes' else '[]'::jsonb end
    )
    where value in (
      'customer_question',
      'explicit_request',
      'missing_information',
      'complaint_or_risk',
      'acknowledgement_only',
      'conversation_closed',
      'automated_notification',
      'internal_or_duplicate',
      'older_than_processing_window',
      'invalid_metadata',
      'unclear_intent',
      'spam_or_marketing',
      'prompt_injection_suspected',
      'requires_system_lookup',
      'invalid_ai_output',
      'low_confidence',
      'unsafe_no_reply'
    )
    limit 20
  ) allowed_reasons;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into clean_risk_flags
  from (
    select distinct value
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'risk_flags') = 'array'
        then p_record->'risk_flags' else '[]'::jsonb end
    )
    where value in (
      'legal',
      'refund_discount',
      'complaint',
      'delivery_commitment',
      'price_or_invoice',
      'address_or_order_change',
      'prompt_injection',
      'identity_or_authority',
      'attachment_claim'
    )
    limit 20
  ) allowed_risks;

  insert into public.email_agent_decision_shadow (
    message_id,
    internet_message_id,
    conversation_id,
    workflow_execution_id,
    correlation_id,
    received_at,
    from_email,
    subject,
    message_source,
    body_preview,
    body_hash,
    existing_should_process,
    existing_skip_reason,
    ai_decision,
    final_decision,
    confidence,
    requires_human_review,
    reason_codes,
    risk_flags,
    summary,
    validation_status,
    classifier_version,
    model_name,
    shadow_only
  ) values (
    message_value,
    left(nullif(btrim(coalesce(p_record->>'internet_message_id', '')), ''), 2000),
    left(nullif(btrim(coalesce(p_record->>'conversation_id', '')), ''), 2000),
    execution_value,
    correlation_value,
    nullif(p_record->>'received_at', '')::timestamptz,
    lower(left(nullif(btrim(coalesce(p_record->>'from_email', '')), ''), 320)),
    left(nullif(coalesce(p_record->>'subject', ''), ''), 500),
    left(coalesce(nullif(btrim(p_record->>'message_source'), ''), 'external_email'), 80),
    left(nullif(coalesce(p_record->>'body_preview', ''), ''), 1000),
    left(nullif(btrim(coalesce(p_record->>'body_hash', '')), ''), 200),
    existing_should_process_value,
    left(nullif(btrim(coalesce(p_record->>'existing_skip_reason', '')), ''), 500),
    ai_decision_value,
    final_decision_value,
    confidence_value,
    requires_review_value,
    clean_reason_codes,
    clean_risk_flags,
    left(nullif(coalesce(p_record->>'summary', ''), ''), 500),
    validation_value,
    classifier_value,
    left(nullif(btrim(coalesce(p_record->>'model_name', '')), ''), 120),
    true
  )
  on conflict (message_id) do update
  set internet_message_id = coalesce(excluded.internet_message_id, email_agent_decision_shadow.internet_message_id),
      conversation_id = coalesce(excluded.conversation_id, email_agent_decision_shadow.conversation_id),
      workflow_execution_id = excluded.workflow_execution_id,
      correlation_id = excluded.correlation_id,
      received_at = coalesce(excluded.received_at, email_agent_decision_shadow.received_at),
      from_email = coalesce(excluded.from_email, email_agent_decision_shadow.from_email),
      subject = coalesce(excluded.subject, email_agent_decision_shadow.subject),
      message_source = excluded.message_source,
      body_preview = coalesce(excluded.body_preview, email_agent_decision_shadow.body_preview),
      body_hash = coalesce(excluded.body_hash, email_agent_decision_shadow.body_hash),
      existing_should_process = excluded.existing_should_process,
      existing_skip_reason = excluded.existing_skip_reason,
      ai_decision = excluded.ai_decision,
      final_decision = excluded.final_decision,
      confidence = excluded.confidence,
      requires_human_review = excluded.requires_human_review,
      reason_codes = excluded.reason_codes,
      risk_flags = excluded.risk_flags,
      summary = excluded.summary,
      validation_status = excluded.validation_status,
      classifier_version = excluded.classifier_version,
      model_name = excluded.model_name,
      shadow_only = true,
      updated_at = now()
  returning id into affected_id;

  return jsonb_build_object(
    'recorded', true,
    'shadow_only', true,
    'decision_id', affected_id,
    'message_id', message_value,
    'final_decision', final_decision_value,
    'validation_status', validation_value
  );
end;
$function$;

create or replace view public.email_agent_decision_shadow_overview
with (security_invoker = true)
as
select
  decision.*,
  log.id as email_log_id,
  log.draft_created as observed_draft_created,
  log.review_status as observed_review_status,
  case
    when log.draft_created is true then 'draft'
    when log.review_status = 'failed' then 'failed'
    when decision.existing_should_process is false then 'filtered_no_draft'
    else 'pending'
  end as observed_outcome,
  case
    when decision.final_decision = 'draft' and log.draft_created is true then true
    when decision.final_decision = 'no_reply' and decision.existing_should_process is false then true
    when decision.final_decision = 'draft' and decision.existing_should_process is false then false
    when decision.final_decision = 'no_reply' and log.draft_created is true then false
    else null
  end as matches_current_behavior
from public.email_agent_decision_shadow decision
left join lateral (
  select candidate.*
  from public.email_agent_log candidate
  where candidate.message_id = decision.message_id
  order by candidate.created_at desc
  limit 1
) log on true;

revoke all on table public.email_agent_decision_shadow_overview
  from public, anon, authenticated, service_role;
grant select on table public.email_agent_decision_shadow_overview
  to service_role;

create or replace function public.get_email_agent_decision_shadow_metrics_v1(
  p_since_days integer default 7
)
returns jsonb
language sql
stable
set search_path = public
as $function$
  with scoped as (
    select *
    from public.email_agent_decision_shadow_overview
    where created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_since_days, 7), 90)))
  ),
  decision_counts as (
    select coalesce(jsonb_object_agg(final_decision, count_value), '{}'::jsonb) as value
    from (
      select final_decision, count(*) as count_value
      from scoped
      group by final_decision
    ) grouped
  ),
  validation_counts as (
    select coalesce(jsonb_object_agg(validation_status, count_value), '{}'::jsonb) as value
    from (
      select validation_status, count(*) as count_value
      from scoped
      group by validation_status
    ) grouped
  )
  select jsonb_build_object(
    'version', 'email-decision-shadow-metrics-v1',
    'since_days', greatest(1, least(coalesce(p_since_days, 7), 90)),
    'total', (select count(*) from scoped),
    'by_decision', (select value from decision_counts),
    'by_validation', (select value from validation_counts),
    'matches_current_behavior', (select count(*) from scoped where matches_current_behavior is true),
    'disagrees_with_current_behavior', (select count(*) from scoped where matches_current_behavior is false),
    'no_reply_currently_drafted', (
      select count(*) from scoped
      where final_decision = 'no_reply' and observed_draft_created is true
    ),
    'human_review_currently_drafted', (
      select count(*) from scoped
      where final_decision = 'human_review' and observed_draft_created is true
    ),
    'pending_observation', (
      select count(*) from scoped
      where observed_outcome = 'pending'
    )
  );
$function$;

revoke all on function public.record_email_agent_decision_shadow_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_email_agent_decision_shadow_metrics_v1(integer)
  from public, anon, authenticated;

grant execute on function public.record_email_agent_decision_shadow_v1(jsonb)
  to service_role;
grant execute on function public.get_email_agent_decision_shadow_metrics_v1(integer)
  to service_role;

comment on table public.email_agent_decision_shadow is
  'Shadow-only draft/no_reply/human_review recommendations. These rows never authorize customer communication.';
comment on view public.email_agent_decision_shadow_overview is
  'Compares shadow recommendations with the current draft agent behavior without changing that behavior.';
comment on function public.record_email_agent_decision_shadow_v1(jsonb) is
  'Validates and idempotently stores a shadow-only email decision.';
