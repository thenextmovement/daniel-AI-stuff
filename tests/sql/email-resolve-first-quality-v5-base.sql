create role service_role;
create role anon;
create role authenticated;

create table public.email_agent_log (
  id uuid primary key,
  message_id text not null,
  draft_created boolean not null default false,
  draft_body_text text,
  category text,
  message_source text,
  risk_level text,
  reply_length_class text,
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.email_agent_feedback (
  id bigint generated always as identity primary key,
  source_message_id text not null,
  sent_message_id text not null unique,
  sent_body_text text,
  edit_ratio numeric,
  edit_summary jsonb not null default '{}'::jsonb,
  edit_labels text[] not null default '{}'::text[],
  change_profile jsonb not null default '{}'::jsonb,
  review_priority text not null default 'normal',
  learning_status text not null default 'pending',
  is_valid boolean not null default true,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_agent_auto_style_eligibility_v1 (
  feedback_id bigint primary key,
  channel text not null,
  category text not null,
  reply_length_class text not null,
  risk_level text not null,
  collected_at timestamptz not null,
  sent_words integer not null,
  sent_paragraphs integer not null,
  closing_style text not null,
  shortened boolean not null,
  expanded boolean not null,
  unchanged boolean not null,
  direct_answer_first boolean not null,
  avoid_repetition boolean not null,
  automatic_style_eligible boolean not null,
  human_style_eligible boolean not null,
  eligible boolean not null,
  sample_source text,
  block_reasons text[] not null default '{}'::text[]
);

create or replace function public.get_email_agent_learning_quality_v4()
returns jsonb language sql stable security invoker set search_path = public
as $$ select jsonb_build_object(
  'version', 'email-agent-learning-quality-v4',
  'feedback', '{}'::jsonb,
  'automatic_prompt_rewrite_allowed', false,
  'fact_learning_allowed', false,
  'manual_review_required_for_safe_style', false,
  'automatic_send_allowed', false,
  'customer_send_human_approval_required', true
) $$;

create or replace function public.get_email_agent_rollout_gate_v1()
returns jsonb language sql stable security invoker set search_path = public
as $$ select jsonb_build_object(
  'version', 'email-agent-rollout-gate-v1',
  'requested_stage', 'review_only',
  'effective_stage', 'review_only',
  'active_evaluation_version', 'test-v1',
  'decision_gate', jsonb_build_object('passed', true),
  'draft_quality_gate', jsonb_build_object(
    'minimum_samples', 30,
    'thresholds', jsonb_build_object(
      'max_safety_correction_share', 0.02,
      'max_manual_rewrite_share', 0.25,
      'max_median_edit_ratio', 0.35
    )
  ),
  'historical_feedback', '{}'::jsonb,
  'automatic_send_allowed', false,
  'human_send_approval_required', true
) $$;

grant select, insert, update on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
