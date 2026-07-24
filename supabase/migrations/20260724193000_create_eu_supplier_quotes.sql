create extension if not exists pgcrypto;
create table public.eu_supplier_organizations (
  id uuid primary key default gen_random_uuid(), name text not null, canonical_domain text not null unique,
  email_domains text[] not null default '{}', contact_emails text[] not null default '{}',
  website_url text, country_code text, research jsonb not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint eu_supplier_domain_check check (canonical_domain = lower(canonical_domain) and canonical_domain !~ '@')
);
create table public.eu_supplier_requests (
  id uuid primary key default gen_random_uuid(), correlation_id uuid not null default gen_random_uuid() unique,
  trello_card_id text not null unique, trello_card_url text not null, trello_card_name text not null,
  source_list_id text, request_snapshot jsonb not null default '{}',
  status text not null default 'collecting' check (status in ('collecting','ready','selected','ordered','cancelled','needs_review')),
  selected_organization_id uuid references public.eu_supplier_organizations(id), selected_by text, selected_at timestamptz, selection_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.eu_supplier_deliveries (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.eu_supplier_requests(id) on delete cascade,
  organization_id uuid not null references public.eu_supplier_organizations(id), recipient_email text not null,
  idempotency_key text not null unique, status text not null default 'queued' check (status in ('queued','sending','sent','retry_wait','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2), provider_message_id text, provider_conversation_id text,
  last_error_code text, last_error_summary text, next_attempt_at timestamptz, sent_at timestamptz, failed_at timestamptz,
  alert_status text not null default 'not_needed' check (alert_status in ('not_needed','pending','sending','sent','failed')),
  alert_idempotency_key text unique, alert_sent_at timestamptz, workflow_execution_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(request_id, recipient_email)
);
create table public.eu_supplier_replies (
  id uuid primary key default gen_random_uuid(), request_id uuid references public.eu_supplier_requests(id) on delete set null,
  organization_id uuid references public.eu_supplier_organizations(id), internet_message_id text not null unique, conversation_id text,
  sender_email text not null, sender_domain text not null, received_at timestamptz not null, subject text, body_excerpt text,
  attachment_manifest jsonb not null default '[]', match_status text not null check (match_status in ('matched','ambiguous','unmatched')),
  extraction_status text not null default 'pending' check (extraction_status in ('pending','validated','needs_review','failed')),
  extraction_confidence numeric(5,4), raw_extraction jsonb, created_at timestamptz not null default now()
);
create table public.eu_supplier_offers (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.eu_supplier_requests(id) on delete cascade,
  organization_id uuid not null references public.eu_supplier_organizations(id), reply_id uuid references public.eu_supplier_replies(id) on delete set null,
  currency text, unit_price numeric(14,2), total_price numeric(14,2), shipping_cost numeric(14,2),
  production_days_min integer, production_days_max integer, shipping_days_min integer, shipping_days_max integer,
  valid_until date, stated_terms jsonb not null default '{}', confidence numeric(5,4),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','verified','rejected')),
  verified_by text, verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(reply_id)
);
create index eu_supplier_deliveries_request_idx on public.eu_supplier_deliveries(request_id,status);
create index eu_supplier_deliveries_conversation_idx on public.eu_supplier_deliveries(provider_conversation_id) where provider_conversation_id is not null;
create index eu_supplier_replies_lookup_idx on public.eu_supplier_replies(sender_domain,received_at desc);
create index eu_supplier_offers_request_idx on public.eu_supplier_offers(request_id,organization_id);
alter table public.eu_supplier_organizations enable row level security;
alter table public.eu_supplier_requests enable row level security;
alter table public.eu_supplier_deliveries enable row level security;
alter table public.eu_supplier_replies enable row level security;
alter table public.eu_supplier_offers enable row level security;
revoke all on public.eu_supplier_organizations,public.eu_supplier_requests,public.eu_supplier_deliveries,public.eu_supplier_replies,public.eu_supplier_offers from anon,authenticated;
grant all on public.eu_supplier_organizations,public.eu_supplier_requests,public.eu_supplier_deliveries,public.eu_supplier_replies,public.eu_supplier_offers to service_role;
