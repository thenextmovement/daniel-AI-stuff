create extension if not exists pgcrypto;

create table public.email_agent_decision_shadow (
  id bigint generated always as identity primary key,
  message_id text not null unique,
  body_hash text,
  existing_should_process boolean not null,
  final_decision text not null,
  confidence numeric(5,4) not null,
  requires_human_review boolean not null,
  reason_codes text[] not null default '{}'::text[],
  risk_flags text[] not null default '{}'::text[],
  validation_status text not null,
  classifier_version text not null,
  model_name text,
  created_at timestamptz not null default now()
);

create table public.email_agent_log (
  id uuid primary key default gen_random_uuid(),
  message_id text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.email_agent_feedback (
  id bigint generated always as identity primary key,
  source_message_id text not null,
  sent_message_id text not null unique,
  sent_body_text text,
  edit_ratio numeric(7,6),
  edit_labels text[] not null default '{}'::text[],
  is_valid boolean not null default true,
  collected_at timestamptz not null default now()
);

insert into public.email_agent_decision_shadow (
  message_id, body_hash, existing_should_process, final_decision, confidence,
  requires_human_review, reason_codes, risk_flags, validation_status,
  classifier_version, model_name, created_at
)
select
  'draft-case-' || value,
  md5('draft-body-' || value),
  true,
  'human_review',
  0.9900,
  true,
  array['requires_system_lookup']::text[],
  '{}'::text[],
  'valid_ai',
  'email-decision-shadow-v1',
  'test-model',
  now() - make_interval(mins => value)
from generate_series(1, 5) value;

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, sent_body_text, edit_ratio, edit_labels, is_valid
)
select
  'draft-case-' || value,
  'historical-sent-' || value,
  'Von einem Menschen gesendete Testantwort',
  0.100000,
  array['minor_formatting']::text[],
  true
from generate_series(1, 5) value;

insert into public.email_agent_log (message_id, context_snapshot)
select 'draft-case-' || value, '{}'::jsonb
from generate_series(1, 5) value;

insert into public.email_agent_decision_shadow (
  message_id, body_hash, existing_should_process, final_decision, confidence,
  requires_human_review, reason_codes, risk_flags, validation_status,
  classifier_version, model_name, created_at
)
select
  'human-case-' || value,
  md5('human-body-' || value),
  true,
  'human_review',
  1.0000,
  true,
  array['complaint_or_risk']::text[],
  array['complaint']::text[],
  'deterministic',
  'email-decision-shadow-v1',
  null,
  now() - make_interval(mins => 10 + value)
from generate_series(1, 30) value;

insert into public.email_agent_decision_shadow (
  message_id, body_hash, existing_should_process, final_decision, confidence,
  requires_human_review, reason_codes, risk_flags, validation_status,
  classifier_version, model_name, created_at
)
select
  'no-reply-case-' || value,
  md5('no-reply-body-' || value),
  false,
  'no_reply',
  1.0000,
  false,
  array['automated_notification']::text[],
  '{}'::text[],
  'deterministic',
  'email-decision-shadow-v1',
  null,
  now() - make_interval(mins => 50 + value)
from generate_series(1, 35) value;

-- These historical rows resemble the old relay gap: an internal technical sender
-- must never become a safe no-reply reference solely from internal_or_duplicate.
insert into public.email_agent_decision_shadow (
  message_id, body_hash, existing_should_process, final_decision, confidence,
  requires_human_review, reason_codes, risk_flags, validation_status,
  classifier_version, model_name, created_at
)
select
  'unsafe-internal-reference-' || value,
  md5('unsafe-internal-body-' || value),
  false,
  'no_reply',
  1.0000,
  false,
  array['internal_or_duplicate']::text[],
  '{}'::text[],
  'deterministic',
  'email-decision-shadow-v1',
  null,
  now() - make_interval(mins => 100 + value)
from generate_series(1, 5) value;
