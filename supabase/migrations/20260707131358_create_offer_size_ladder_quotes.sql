create extension if not exists pgcrypto;

create table if not exists public.offer_size_quote_anchor_sets (
  id uuid primary key default gen_random_uuid(),
  set_key text not null unique,
  trello_card_id text not null,
  trello_card_url text null,
  offer_id text null,
  offer_item_id text null,
  design_id text null,
  product_model text not null default 'unknown',
  pricing_basis text not null default 'new_supplier_direct_2_6',
  customer_factor numeric(8, 4) not null default 2.6,
  min_long_side_cm numeric(8, 2) null,
  requested_long_side_cm numeric(8, 2) null,
  max_long_side_cm numeric(8, 2) not null default 250,
  step_cm numeric(8, 2) not null default 10,
  status text not null default 'draft',
  confidence numeric(5, 4) null,
  issues jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  source_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  reviewed_by text null,
  reviewed_at timestamptz null,
  applied_by text null,
  applied_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_size_quote_anchor_sets_product_model_check check (
    product_model in ('neonflex', 'uv_print', 'three_d', 'full_glow', 'outdoor', 'acryl_light_box', 'unsupported', 'unknown')
  ),
  constraint offer_size_quote_anchor_sets_pricing_basis_check check (
    pricing_basis in ('new_supplier_direct_2_6', 'legacy_supplier_2_3', 'manual')
  ),
  constraint offer_size_quote_anchor_sets_status_check check (
    status in ('draft', 'needs_review', 'approved', 'blocked', 'applied', 'superseded')
  ),
  constraint offer_size_quote_anchor_sets_factor_check check (customer_factor > 0),
  constraint offer_size_quote_anchor_sets_step_check check (step_cm > 0),
  constraint offer_size_quote_anchor_sets_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists public.offer_size_quote_anchors (
  id uuid primary key default gen_random_uuid(),
  anchor_set_id uuid not null references public.offer_size_quote_anchor_sets(id) on delete cascade,
  role text not null,
  width_cm numeric(8, 2) not null,
  height_cm numeric(8, 2) not null,
  long_side_cm numeric(8, 2) generated always as (greatest(width_cm, height_cm)) stored,
  area_cm2 numeric(12, 2) generated always as (width_cm * height_cm) stored,
  production_price numeric(12, 2) not null,
  shipping_price numeric(12, 2) not null,
  supplier_total numeric(12, 2) generated always as (production_price + shipping_price) stored,
  currency text not null default 'USD',
  source text not null default 'trello_ocr',
  confidence numeric(5, 4) null,
  raw_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint offer_size_quote_anchors_role_check check (role in ('minimum', 'requested', 'max_250')),
  constraint offer_size_quote_anchors_source_check check (source in ('trello_ocr', 'manual', 'supplier_form', 'custom_fields')),
  constraint offer_size_quote_anchors_dimensions_check check (width_cm > 0 and height_cm > 0),
  constraint offer_size_quote_anchors_prices_check check (production_price >= 0 and shipping_price >= 0 and (production_price + shipping_price) > 0),
  constraint offer_size_quote_anchors_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint offer_size_quote_anchors_set_role_key unique (anchor_set_id, role)
);

create table if not exists public.offer_size_options (
  id uuid primary key default gen_random_uuid(),
  anchor_set_id uuid not null references public.offer_size_quote_anchor_sets(id) on delete cascade,
  offer_id text null,
  offer_item_id text null,
  size_label text not null,
  width_cm numeric(8, 2) not null,
  height_cm numeric(8, 2) not null,
  long_side_cm numeric(8, 2) not null,
  area_cm2 numeric(12, 2) not null,
  production_price_estimated numeric(12, 2) not null,
  shipping_price_estimated numeric(12, 2) not null,
  supplier_total_estimated numeric(12, 2) not null,
  customer_factor numeric(8, 4) not null default 2.6,
  customer_unit_price_net numeric(12, 2) not null,
  currency text not null default 'USD',
  customer_currency text not null default 'EUR',
  model_key text not null default 'anchored_offer_size_ladder',
  model_version text not null default 'anchored_offer_size_ladder_v1',
  confidence numeric(5, 4) not null default 0,
  review_status text not null default 'needs_review',
  review_reason text null,
  issues jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint offer_size_options_dimensions_check check (width_cm > 0 and height_cm > 0 and long_side_cm > 0 and area_cm2 > 0),
  constraint offer_size_options_prices_check check (
    production_price_estimated >= 0
    and shipping_price_estimated >= 0
    and supplier_total_estimated > 0
    and customer_factor > 0
    and customer_unit_price_net > 0
  ),
  constraint offer_size_options_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint offer_size_options_review_status_check check (review_status in ('auto_ok', 'needs_review', 'blocked')),
  constraint offer_size_options_set_long_side_key unique (anchor_set_id, long_side_cm)
);

create index if not exists offer_size_quote_anchor_sets_trello_idx
  on public.offer_size_quote_anchor_sets(trello_card_id, created_at desc);
create index if not exists offer_size_quote_anchor_sets_offer_idx
  on public.offer_size_quote_anchor_sets(offer_id, created_at desc)
  where offer_id is not null;
create index if not exists offer_size_quote_anchor_sets_status_idx
  on public.offer_size_quote_anchor_sets(status, updated_at desc);
create index if not exists offer_size_quote_anchors_set_idx
  on public.offer_size_quote_anchors(anchor_set_id, role);
create index if not exists offer_size_options_set_idx
  on public.offer_size_options(anchor_set_id, sort_order);
create index if not exists offer_size_options_offer_idx
  on public.offer_size_options(offer_id, offer_item_id, sort_order)
  where offer_id is not null;

alter table public.offer_size_quote_anchor_sets enable row level security;
alter table public.offer_size_quote_anchors enable row level security;
alter table public.offer_size_options enable row level security;

revoke all on public.offer_size_quote_anchor_sets from anon, authenticated, service_role;
revoke all on public.offer_size_quote_anchors from anon, authenticated, service_role;
revoke all on public.offer_size_options from anon, authenticated, service_role;

grant select, insert, update on public.offer_size_quote_anchor_sets to service_role;
grant select, insert, update, delete on public.offer_size_quote_anchors to service_role;
grant select, insert, update, delete on public.offer_size_options to service_role;

comment on table public.offer_size_quote_anchor_sets is
  'Ops-owned source of truth for three-anchor supplier quote sets used to build customer-visible size ladders.';
comment on table public.offer_size_quote_anchors is
  'Supplier quoted minimum, requested and 250cm anchors with split production and shipping prices.';
comment on table public.offer_size_options is
  'Deterministic size ladder options generated from supplier anchors before being applied to Offers.';
