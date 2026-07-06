create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'design-assets',
  'design-assets',
  true,
  10485760,
  array['image/png', 'image/webp', 'image/jpeg']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.design_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  request_id text null,
  trello_card_id text null,
  trello_card_url text null,
  offer_id text null,
  source_query text null,
  status text not null default 'draft',
  prompt_version_id uuid null,
  selected_asset_id uuid null,
  operator_name text null,
  created_by text null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_jobs_status_check check (
    status in (
      'draft',
      'queued',
      'generating',
      'generated',
      'failed',
      'cancelled',
      'attached_to_trello',
      'linked_to_offer'
    )
  )
);

create table if not exists public.design_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.design_jobs(id) on delete cascade,
  version_number integer not null,
  prompt_title text not null,
  prompt_text text not null,
  prompt_hash text not null,
  source text not null default 'manual',
  edited_by text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint design_prompt_versions_source_check check (source in ('preview', 'manual', 'imported', 'regenerated')),
  constraint design_prompt_versions_job_version_key unique (job_id, version_number)
);

create table if not exists public.design_assets (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null unique,
  job_id uuid null references public.design_jobs(id) on delete set null,
  prompt_version_id uuid null references public.design_prompt_versions(id) on delete set null,
  request_id text null,
  trello_card_id text null,
  source text not null default 'generated',
  status text not null default 'draft',
  storage_bucket text null,
  storage_path text null,
  public_url text null,
  trello_attachment_id text null,
  name text null,
  mime_type text null,
  width integer null,
  height integer null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_assets_source_check check (source in ('generated', 'imported_trello', 'manual_upload')),
  constraint design_assets_status_check check (
    status in ('draft', 'generated', 'stored', 'attached_to_trello', 'linked_to_offer', 'removed', 'failed')
  )
);

create table if not exists public.design_trello_removal_backups (
  id uuid primary key default gen_random_uuid(),
  backup_key text not null unique,
  trello_card_id text not null,
  trello_card_url text null,
  operator_name text null,
  reason text null,
  status text not null default 'prepared',
  selected_attachment_count integer not null default 0,
  attachments jsonb not null default '[]'::jsonb,
  applied_at timestamptz null,
  rolled_back_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_trello_removal_backups_status_check check (status in ('prepared', 'applied', 'rolled_back', 'failed')),
  constraint design_trello_removal_backups_count_check check (selected_attachment_count >= 0)
);

create table if not exists public.design_offer_asset_links (
  id uuid primary key default gen_random_uuid(),
  link_key text not null unique,
  asset_id uuid not null references public.design_assets(id) on delete cascade,
  offer_id text not null,
  offer_item_id text null,
  offer_version_id text null,
  design_group_key text null,
  status text not null default 'proposed',
  reviewed_by text null,
  reviewed_at timestamptz null,
  price_context jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint design_offer_asset_links_status_check check (
    status in ('proposed', 'linked', 'rejected', 'superseded', 'needs_price_review')
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'design_jobs_prompt_version_id_fkey'
      and conrelid = 'public.design_jobs'::regclass
  ) then
    alter table public.design_jobs
      add constraint design_jobs_prompt_version_id_fkey
      foreign key (prompt_version_id)
      references public.design_prompt_versions(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'design_jobs_selected_asset_id_fkey'
      and conrelid = 'public.design_jobs'::regclass
  ) then
    alter table public.design_jobs
      add constraint design_jobs_selected_asset_id_fkey
      foreign key (selected_asset_id)
      references public.design_assets(id)
      on delete set null;
  end if;
end $$;

create index if not exists design_jobs_request_idx on public.design_jobs(request_id, created_at desc);
create index if not exists design_jobs_trello_idx on public.design_jobs(trello_card_id, created_at desc);
create index if not exists design_jobs_status_idx on public.design_jobs(status, updated_at desc);
create index if not exists design_prompt_versions_job_idx on public.design_prompt_versions(job_id, version_number desc);
create index if not exists design_assets_job_idx on public.design_assets(job_id, created_at desc);
create index if not exists design_assets_trello_idx on public.design_assets(trello_card_id, created_at desc);
create index if not exists design_trello_removal_backups_card_idx on public.design_trello_removal_backups(trello_card_id, created_at desc);
create index if not exists design_offer_asset_links_offer_idx on public.design_offer_asset_links(offer_id, created_at desc);
create index if not exists design_offer_asset_links_asset_idx on public.design_offer_asset_links(asset_id);

alter table public.design_jobs enable row level security;
alter table public.design_prompt_versions enable row level security;
alter table public.design_assets enable row level security;
alter table public.design_trello_removal_backups enable row level security;
alter table public.design_offer_asset_links enable row level security;

revoke all on public.design_jobs from anon, authenticated, service_role;
revoke all on public.design_prompt_versions from anon, authenticated, service_role;
revoke all on public.design_assets from anon, authenticated, service_role;
revoke all on public.design_trello_removal_backups from anon, authenticated, service_role;
revoke all on public.design_offer_asset_links from anon, authenticated, service_role;

grant select, insert, update on public.design_jobs to service_role;
grant select, insert, update on public.design_prompt_versions to service_role;
grant select, insert, update on public.design_assets to service_role;
grant select, insert, update on public.design_trello_removal_backups to service_role;
grant select, insert, update on public.design_offer_asset_links to service_role;

-- Design Ops laufen ausschliesslich ueber Next.js Serverrouten und spaeter n8n mit Service-Role-Credentials.
-- Keine anon/authenticated Policies: Trello bleibt Projektion, die Datenbank ist Source of Truth.
