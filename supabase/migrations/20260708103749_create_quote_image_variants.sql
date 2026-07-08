create table if not exists public.quote_image_variants (
  id uuid primary key default gen_random_uuid(),
  variant_key text not null unique,
  quote_id text not null,
  quote_image_id text not null,
  quote_item_id text null,
  source_design_asset_id uuid null references public.design_assets(id) on delete set null,
  design_job_id uuid null references public.design_jobs(id) on delete set null,
  design_prompt_version_id uuid null references public.design_prompt_versions(id) on delete set null,
  variant_type text not null,
  variant_value text not null,
  variant_value_normalized text not null,
  status text not null default 'pending',
  source_image_url text not null,
  storage_bucket text null,
  storage_path text null,
  public_url text null,
  mime_type text null,
  prompt_hash text null,
  error_message text null,
  generated_at timestamptz null,
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_image_variants_type_check check (variant_type in ('light_color', 'product_change')),
  constraint quote_image_variants_status_check check (status in ('pending', 'generating', 'ready', 'failed', 'expired', 'removed')),
  constraint quote_image_variants_ready_url_check check (status <> 'ready' or public_url is not null)
);

create index if not exists quote_image_variants_quote_idx
  on public.quote_image_variants(quote_id, created_at desc);

create index if not exists quote_image_variants_image_lookup_idx
  on public.quote_image_variants(quote_image_id, variant_type, variant_value_normalized);

create index if not exists quote_image_variants_status_idx
  on public.quote_image_variants(status, updated_at desc);

create index if not exists quote_image_variants_design_job_idx
  on public.quote_image_variants(design_job_id)
  where design_job_id is not null;

alter table public.quote_image_variants enable row level security;

revoke all on public.quote_image_variants from anon, authenticated, service_role;
grant select, insert, update on public.quote_image_variants to service_role;

-- Variant cache is server-only for now. Future public quote endpoints must stay behind
-- Next.js server validation, rate limits, and token-scoped access; do not grant anon access here.
