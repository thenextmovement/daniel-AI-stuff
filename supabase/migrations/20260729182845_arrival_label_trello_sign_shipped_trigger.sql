begin;

create table public.arrival_label_trello_trigger_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_after timestamptz not null default now(),
  board_id text not null check (board_id ~ '^[0-9a-f]{24}$'),
  source_list_id text not null check (source_list_id ~ '^[0-9a-f]{24}$'),
  source_list_name text not null check (source_list_name = 'Sign SHIPPED (NEON TRIP)'),
  title_pattern_version text not null check (title_pattern_version = 'dhl-10-digit-suffix-v1'),
  approved_at timestamptz null,
  approved_by text null check (approved_by is null or length(btrim(approved_by)) between 3 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_trello_trigger_requires_approval check (
    not enabled or (approved_at is not null and approved_by is not null)
  )
);

comment on table public.arrival_label_trello_trigger_settings is
  'Fail-closed activation gate for new Quentin Sign SHIPPED cards whose title ends in one exact ten-digit DHL Express number.';

alter table public.arrival_label_trello_trigger_settings enable row level security;
revoke all on table public.arrival_label_trello_trigger_settings from public, anon, authenticated;
grant select, insert, update on table public.arrival_label_trello_trigger_settings to service_role;

insert into public.arrival_label_trello_trigger_settings (
  singleton,
  enabled,
  enabled_after,
  board_id,
  source_list_id,
  source_list_name,
  title_pattern_version
) values (
  true,
  false,
  now(),
  '62bae9b97705e7419ed64593',
  '6347e09cb326e6014856bc3b',
  'Sign SHIPPED (NEON TRIP)',
  'dhl-10-digit-suffix-v1'
);

commit;
