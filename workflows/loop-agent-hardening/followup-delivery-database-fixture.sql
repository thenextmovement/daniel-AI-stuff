create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.followup_queue (
  id uuid primary key default gen_random_uuid(),
  document_id text not null,
  document_name text,
  customer_name text not null,
  customer_email text not null,
  customer_company text,
  segment text,
  anrede text,
  is_urgent boolean,
  budget_tier text,
  visual_style text,
  decision_window_hours integer,
  value numeric,
  currency text,
  followup_type text not null,
  followup_number integer,
  scheduled_for timestamptz not null,
  status text default 'pending',
  retry_count integer default 0,
  error_message text,
  email_subject text,
  email_body text,
  rabatt_guard_triggered boolean,
  cancelled_at timestamptz,
  cancel_reason text,
  reply_detected_at timestamptz,
  reply_subject text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_error_at timestamptz,
  segment_reasoning text,
  processing_started_at timestamptz,
  last_error text,
  enriched_context jsonb,
  context_updated_at timestamptz,
  classification text,
  classification_reason text,
  pandadoc_customer_link text,
  mockup_url text,
  mockup_url_2 text,
  mockup_url_3 text,
  request_id text,
  email_context_checked_at timestamptz,
  email_context_decision text,
  email_context_reason text,
  email_context_snapshot jsonb,
  email_context_confidence numeric,
  email_context_delay_until timestamptz,
  constraint followup_queue_document_id_followup_number_key
    unique (document_id, followup_number)
);

alter table public.followup_queue enable row level security;
revoke all on table public.followup_queue from public, anon, authenticated;
grant select, insert, update on table public.followup_queue to service_role;
