create table if not exists public.ops_internal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open',
  priority text not null default 'normal',
  category text not null default 'other',
  assignee_label text,
  due_at timestamptz,
  request_id text,
  customer_name text,
  customer_email text,
  trello_card_id text,
  source_app text not null default 'ops_tasks',
  source_ref text,
  created_by text,
  updated_by text,
  completed_by text,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_internal_tasks_status_check check (status in ('open', 'in_progress', 'waiting', 'done', 'archived')),
  constraint ops_internal_tasks_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint ops_internal_tasks_category_check check (category in ('customer', 'call', 'problem', 'product_restock', 'offer', 'admin', 'other'))
);

create index if not exists ops_internal_tasks_active_due_idx
  on public.ops_internal_tasks (status, due_at, priority, updated_at desc)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists ops_internal_tasks_assignee_due_idx
  on public.ops_internal_tasks (assignee_label, status, due_at)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists ops_internal_tasks_request_idx
  on public.ops_internal_tasks (request_id, status, updated_at desc)
  where request_id is not null;

create index if not exists ops_internal_tasks_category_idx
  on public.ops_internal_tasks (category, status, due_at);

comment on table public.ops_internal_tasks is
  'Internal NEONTRIP team tasks for ops coordination. Postgres is source of truth; Trello is projection only.';

alter table public.ops_internal_tasks enable row level security;

drop policy if exists ops_internal_tasks_service_role_all on public.ops_internal_tasks;
create policy ops_internal_tasks_service_role_all
  on public.ops_internal_tasks
  for all
  to service_role
  using (true)
  with check (true);
