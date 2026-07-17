create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.email_locks (
  request_id text primary key,
  locked_at timestamptz not null default now(),
  message_id text,
  internet_message_id text,
  conversation_id text,
  status text not null default 'processing',
  attempt_count integer not null default 0,
  lease_until timestamptz,
  next_retry_at timestamptz,
  last_error text,
  draft_id text,
  updated_at timestamptz not null default now(),
  constraint email_locks_status_check check (
    status in ('processing', 'draft_created', 'failed_retryable', 'failed_final')
  ),
  constraint email_locks_attempt_count_check check (
    attempt_count >= 0 and attempt_count <= 20
  )
);

create table public.email_agent_log (
  id bigint generated always as identity primary key,
  message_id text not null unique,
  conversation_id text,
  from_email text not null,
  from_name text,
  subject text,
  body_preview text,
  category text,
  confidence double precision,
  order_found boolean not null default false,
  order_count integer not null default 0,
  draft_created boolean not null default false,
  draft_id text,
  draft_body_preview text,
  error_message text,
  processing_time_ms integer,
  created_at timestamptz not null default now(),
  request_id text,
  internet_message_id text,
  message_source text,
  latest_message_fingerprint text,
  reply_length_class text,
  risk_level text,
  validation_reasons text[] not null default '{}',
  context_snapshot jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending_review',
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.email_locks, public.email_agent_log to service_role;
grant usage, select on sequence public.email_agent_log_id_seq to service_role;

create or replace function public.complete_email_agent_message(
  p_request_id text,
  p_record jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.email_locks
  set status = 'draft_created',
      draft_id = nullif(p_record->>'draft_id', ''),
      lease_until = null,
      next_retry_at = null,
      updated_at = now()
  where request_id = p_request_id;

  return jsonb_build_object(
    'completed', true,
    'request_id', p_request_id,
    'draft_id', p_record->>'draft_id'
  );
end;
$$;

grant execute on function public.complete_email_agent_message(text, jsonb) to service_role;
