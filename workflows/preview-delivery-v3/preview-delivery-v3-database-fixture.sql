create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create table public.preview_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  trello_card_id text not null,
  trello_card_url text,
  request_id text,
  master_request_uuid uuid,
  card_name text,
  source_list_id text not null,
  entered_at timestamptz not null default now(),
  status text not null default 'pending',
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lock_owner text,
  locked_at timestamptz,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  idempotency_key text not null unique,
  last_error_code text,
  last_error_message text,
  n8n_execution_id text,
  sent_at timestamptz,
  failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  queue_seq bigint generated always as identity,
  claim_token uuid,
  last_finish_token uuid,
  last_finish_execution_id text
);

create table public.preview_delivery_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.preview_delivery_jobs(id) on delete restrict,
  claim_token uuid,
  event_key text not null unique,
  event_type text not null check (
    event_type in (
      'claimed', 'sent', 'retry', 'failed', 'blocked', 'abandoned',
      'stale_finish_rejected', 'delivery_receipt_rejected'
    )
  ),
  workflow_execution_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.preview_delivery_jobs enable row level security;
alter table public.preview_delivery_job_events enable row level security;
grant select, insert, update on public.preview_delivery_jobs to service_role;
grant select, insert on public.preview_delivery_job_events to service_role;
