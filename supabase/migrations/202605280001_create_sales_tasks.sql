create table if not exists public.sales_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  task_type text not null,
  status text not null default 'open',
  title text not null,
  detail text,
  due_at timestamptz,
  priority_tier text not null default 'standard',
  assignee_label text,
  source text not null,
  source_ref text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sales_tasks_status_check check (status in ('open', 'waiting', 'blocked', 'done', 'closed')),
  constraint sales_tasks_priority_check check (priority_tier in ('standard', 'important', 'vip'))
);

create unique index if not exists sales_tasks_idempotency_key_idx
  on public.sales_tasks (idempotency_key);

create index if not exists sales_tasks_active_due_idx
  on public.sales_tasks (status, due_at, priority_tier)
  where status in ('open', 'waiting', 'blocked');

create index if not exists sales_tasks_request_active_idx
  on public.sales_tasks (request_id, status, updated_at desc)
  where status in ('open', 'waiting', 'blocked');

comment on table public.sales_tasks is
  'Persistent internal NEONTRIP sales/call/email task queue. Postgres is source of truth; Trello is projection only.';

comment on column public.sales_tasks.idempotency_key is
  'Stable key for deterministic upsert of derived tasks from calls, offers, and email signals.';

