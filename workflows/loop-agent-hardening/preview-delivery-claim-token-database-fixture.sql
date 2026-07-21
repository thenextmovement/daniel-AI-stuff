create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.preview_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  trello_card_id text not null,
  trello_card_url text,
  request_id text,
  master_request_uuid uuid,
  card_name text,
  source_list_id text not null,
  entered_at timestamptz not null default now(),
  status text not null default 'pending' check (
    status in ('pending','leased','processing','retry','sent','failed','blocked','abandoned')
  ),
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
  check (attempts >= 0 and max_attempts > 0)
);

alter table public.preview_delivery_jobs enable row level security;
grant select, insert, update, delete, truncate, references, trigger
  on table public.preview_delivery_jobs to anon, authenticated, service_role;

create function public.enqueue_preview_delivery_jobs(
  p_card jsonb
) returns jsonb language sql security definer set search_path = public
as $$ select jsonb_build_object('legacy_fixture', true, 'card', p_card) $$;

create function public.enqueue_preview_delivery_jobs(
  p_card jsonb,
  p_event jsonb
) returns jsonb language sql security definer set search_path = public
as $$ select jsonb_build_object('legacy_fixture', true, 'card', p_card, 'event', p_event) $$;

create function public.claim_next_preview_delivery_job(
  p_worker_id text,
  p_lease_seconds integer default 1200,
  p_max_active integer default 3
) returns jsonb language sql security definer set search_path = public
as $$ select jsonb_build_object('legacy_fixture', true) $$;

create function public.finish_preview_delivery_job(
  p_job_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_n8n_execution_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language sql security definer set search_path = public
as $$ select jsonb_build_object('legacy_fixture', true) $$;

grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.enqueue_preview_delivery_jobs(jsonb)
  to service_role;
grant execute on function public.enqueue_preview_delivery_jobs(jsonb, jsonb)
  to service_role;
