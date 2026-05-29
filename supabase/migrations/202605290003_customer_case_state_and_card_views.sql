create table if not exists public.customer_case_state (
  request_id text primary key,
  state text not null default 'active' check (state in ('active', 'handled', 'snoozed')),
  snoozed_until timestamptz,
  reason text,
  updated_by text,
  source_action text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_case_state is
  'Deterministic current workboard state for NEONTRIP Customer Records. Audit log remains history.';

create index if not exists customer_case_state_state_updated_idx
  on public.customer_case_state (state, updated_at desc);

insert into public.customer_case_state (
  request_id,
  state,
  snoozed_until,
  reason,
  updated_by,
  source_action,
  metadata,
  created_at,
  updated_at
)
select distinct on (request_id)
  request_id,
  case
    when action = 'customer_workboard_snoozed' then 'snoozed'
    else 'handled'
  end as state,
  nullif(metadata->>'snooze_until', '')::timestamptz as snoozed_until,
  nullif(metadata->>'reason', '') as reason,
  nullif(coalesce(metadata->>'actor_label', metadata->>'operator_name'), '') as updated_by,
  action as source_action,
  metadata,
  created_at,
  created_at as updated_at
from (
  select
    coalesce(nullif(metadata->>'request_id', ''), nullif(document_id, '')) as request_id,
    action,
    metadata,
    created_at
  from public.workflow_audit_log
  where workflow_name = 'customer_records_console'
    and action in ('customer_workboard_handled', 'customer_workboard_snoozed')
) audit
where request_id is not null
order by request_id, created_at desc
on conflict (request_id) do update
  set state = excluded.state,
      snoozed_until = excluded.snoozed_until,
      reason = excluded.reason,
      updated_by = excluded.updated_by,
      source_action = excluded.source_action,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;

alter table public.customer_case_state enable row level security;

create table if not exists public.ops_card_views (
  request_id text not null,
  viewer_key text not null,
  operator_name text not null,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (request_id, viewer_key)
);

comment on table public.ops_card_views is
  'Short-lived soft awareness heartbeats for NEONTRIP ops cards. This is not a lock.';

create index if not exists ops_card_views_request_seen_idx
  on public.ops_card_views (request_id, last_seen_at desc);

alter table public.ops_card_views enable row level security;
