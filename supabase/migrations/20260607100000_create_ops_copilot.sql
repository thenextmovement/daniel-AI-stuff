create table if not exists public.ops_copilot_threads (
  id uuid primary key default gen_random_uuid(),
  started_by text,
  current_path text,
  page_title text,
  last_message_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_copilot_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.ops_copilot_threads(id) on delete cascade,
  role text not null,
  content text not null,
  operator_name text,
  current_path text,
  page_title text,
  model text,
  openai_response_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_copilot_messages_role_check check (role in ('user', 'assistant', 'system'))
);

create table if not exists public.ops_copilot_tool_calls (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.ops_copilot_threads(id) on delete cascade,
  message_id uuid references public.ops_copilot_messages(id) on delete set null,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result_status text not null default 'ok',
  result_summary text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_copilot_tool_calls_status_check check (result_status in ('ok', 'error'))
);

create index if not exists ops_copilot_threads_last_message_idx
  on public.ops_copilot_threads (last_message_at desc);

create index if not exists ops_copilot_messages_thread_created_idx
  on public.ops_copilot_messages (thread_id, created_at asc);

create index if not exists ops_copilot_tool_calls_thread_created_idx
  on public.ops_copilot_tool_calls (thread_id, created_at asc);

create index if not exists ops_copilot_tool_calls_tool_created_idx
  on public.ops_copilot_tool_calls (tool_name, created_at desc);

comment on table public.ops_copilot_threads is
  'Internal NEONTRIP Ops Copilot chat threads. Postgres is source of truth; tool calls are executed server-side only.';

comment on table public.ops_copilot_messages is
  'Internal NEONTRIP Ops Copilot chat messages. Customer/customer-derived content is untrusted input.';

comment on table public.ops_copilot_tool_calls is
  'Audit log for read-only Ops Copilot tool calls. Stores arguments and summaries, not full customer-data payloads.';

alter table public.ops_copilot_threads enable row level security;
alter table public.ops_copilot_messages enable row level security;
alter table public.ops_copilot_tool_calls enable row level security;

drop policy if exists ops_copilot_threads_service_role_all on public.ops_copilot_threads;
create policy ops_copilot_threads_service_role_all
  on public.ops_copilot_threads
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists ops_copilot_messages_service_role_all on public.ops_copilot_messages;
create policy ops_copilot_messages_service_role_all
  on public.ops_copilot_messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists ops_copilot_tool_calls_service_role_all on public.ops_copilot_tool_calls;
create policy ops_copilot_tool_calls_service_role_all
  on public.ops_copilot_tool_calls
  for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'ops_copilot_threads_updated_at'
      and tgrelid = 'public.ops_copilot_threads'::regclass
  ) then
    create trigger ops_copilot_threads_updated_at
      before update on public.ops_copilot_threads
      for each row execute function public.update_updated_at_column();
  end if;
end $$;
