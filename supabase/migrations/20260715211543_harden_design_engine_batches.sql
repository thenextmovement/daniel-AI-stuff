alter table public.design_jobs
  add column if not exists action_type text null,
  add column if not exists action_value text null,
  add column if not exists source_attachment_id text null,
  add column if not exists source_attachment_name text null,
  add column if not exists source_fingerprint text null,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists started_at timestamptz null,
  add column if not exists heartbeat_at timestamptz null,
  add column if not exists finished_at timestamptz null;

alter table public.design_jobs
  drop constraint if exists design_jobs_action_type_check;

alter table public.design_jobs
  add constraint design_jobs_action_type_check
  check (action_type is null or action_type in ('manual_edit', 'light_color', 'product_change', 'mockup_mode'));

alter table public.design_jobs
  drop constraint if exists design_jobs_attempt_count_check;

alter table public.design_jobs
  add constraint design_jobs_attempt_count_check check (attempt_count >= 0 and attempt_count <= 10);

create index if not exists design_jobs_card_action_idx
  on public.design_jobs(trello_card_id, action_type, action_value, updated_at desc);

create table if not exists public.design_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  source_query text not null,
  request_id text null,
  trello_card_id text not null,
  trello_card_url text null,
  action_type text not null,
  action_value text not null,
  replace_trello boolean not null default false,
  status text not null default 'pending',
  operator_name text null,
  total_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_batches_action_type_check check (action_type in ('light_color', 'product_change')),
  constraint design_batches_status_check check (status in ('pending', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  constraint design_batches_count_check check (
    total_count >= 0 and completed_count >= 0 and failed_count >= 0
    and completed_count + failed_count <= total_count
  )
);

create table if not exists public.design_batch_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  batch_id uuid not null references public.design_batches(id) on delete cascade,
  sequence_number integer not null,
  source_card_id text not null,
  source_attachment_id text not null,
  source_attachment_name text not null,
  source_mime_type text null,
  source_fingerprint text not null,
  job_id uuid null references public.design_jobs(id) on delete set null,
  asset_id uuid null references public.design_assets(id) on delete set null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  worker_run_id text null,
  error_message text null,
  trello_new_attachment_id text null,
  trello_original_name text null,
  trello_archived_name text null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz null,
  heartbeat_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_batch_items_status_check check (
    status in ('pending', 'generating', 'generated', 'attaching', 'completed', 'failed', 'cancelled')
  ),
  constraint design_batch_items_attempt_check check (attempt_count >= 0 and attempt_count <= 10),
  constraint design_batch_items_sequence_check check (sequence_number >= 0),
  constraint design_batch_items_batch_source_key unique (batch_id, source_attachment_id)
);

create index if not exists design_batches_card_idx
  on public.design_batches(trello_card_id, created_at desc);

create index if not exists design_batches_status_idx
  on public.design_batches(status, updated_at desc);

create index if not exists design_batch_items_claim_idx
  on public.design_batch_items(batch_id, status, sequence_number, updated_at);

create index if not exists design_batch_items_job_idx
  on public.design_batch_items(job_id)
  where job_id is not null;

create index if not exists design_batch_items_asset_idx
  on public.design_batch_items(asset_id)
  where asset_id is not null;

create or replace function public.claim_next_design_batch_item(
  p_batch_id uuid,
  p_worker_run_id text,
  p_stale_before timestamptz default now() - interval '5 minutes',
  p_max_attempts integer default 3
)
returns setof public.design_batch_items
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select item.id
    into claimed_id
  from public.design_batch_items item
  join public.design_batches batch on batch.id = item.batch_id
  where item.batch_id = p_batch_id
    and batch.status not in ('completed', 'completed_with_errors', 'cancelled')
    and item.attempt_count < greatest(1, least(coalesce(p_max_attempts, 3), 10))
    and (
      item.status = 'pending'
      or item.status = 'failed'
      or (item.status in ('generating', 'attaching') and coalesce(item.heartbeat_at, item.updated_at) < p_stale_before)
    )
  order by item.sequence_number asc, item.created_at asc
  for update of item skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  update public.design_batches
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_batch_id;

  return query
  update public.design_batch_items
  set
    status = 'generating',
    attempt_count = attempt_count + 1,
    worker_run_id = nullif(trim(p_worker_run_id), ''),
    error_message = null,
    started_at = coalesce(started_at, now()),
    heartbeat_at = now(),
    finished_at = null,
    updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

create or replace function public.refresh_design_batch_status(p_batch_id uuid)
returns setof public.design_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_total integer;
  failed_total integer;
  active_total integer;
begin
  select
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status in ('pending', 'generating', 'generated', 'attaching') or (status = 'failed' and attempt_count < 3))
  into completed_total, failed_total, active_total
  from public.design_batch_items
  where batch_id = p_batch_id;

  return query
  update public.design_batches
  set
    completed_count = completed_total,
    failed_count = failed_total,
    status = case
      when status = 'cancelled' then 'cancelled'
      when active_total > 0 then 'running'
      when failed_total > 0 and completed_total > 0 then 'completed_with_errors'
      when failed_total > 0 then 'failed'
      else 'completed'
    end,
    finished_at = case when status = 'cancelled' or active_total = 0 then coalesce(finished_at, now()) else null end,
    updated_at = now()
  where id = p_batch_id
  returning *;
end;
$$;

alter table public.design_batches enable row level security;
alter table public.design_batch_items enable row level security;

revoke all on public.design_batches from anon, authenticated, service_role;
revoke all on public.design_batch_items from anon, authenticated, service_role;
revoke all on function public.claim_next_design_batch_item(uuid, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.refresh_design_batch_status(uuid) from public, anon, authenticated;

grant select, insert, update on public.design_batches to service_role;
grant select, insert, update on public.design_batch_items to service_role;
grant execute on function public.claim_next_design_batch_item(uuid, text, timestamptz, integer) to service_role;
grant execute on function public.refresh_design_batch_status(uuid) to service_role;
