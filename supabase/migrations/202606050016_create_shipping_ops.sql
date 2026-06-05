create extension if not exists pgcrypto;

create table if not exists public.shipping_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_key text not null unique,
  source text not null default 'shopify',
  shopify_order_id text null,
  shopify_order_number text null,
  shopify_fulfillment_id text null,
  request_id text null,
  customer_name text null,
  customer_email text null,
  customer_phone text null,
  carrier text not null default 'unknown',
  tracking_number text null,
  tracking_url text null,
  destination_country text null,
  status text not null default 'created',
  status_reason text null,
  risk_level text not null default 'normal',
  shipped_at timestamptz null,
  delivered_at timestamptz null,
  last_event_at timestamptz null,
  last_carrier_sync_at timestamptz null,
  next_check_at timestamptz null,
  raw_shopify jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_shipments_carrier_check check (carrier in ('dpd', 'dhl', 'other', 'unknown')),
  constraint shipping_shipments_status_check check (
    status in (
      'created',
      'tracking_missing',
      'label_created',
      'carrier_not_found',
      'in_transit',
      'out_for_delivery',
      'pickup_available',
      'delivery_failed',
      'delivered',
      'returning',
      'returned',
      'lost_or_stale',
      'closed'
    )
  ),
  constraint shipping_shipments_risk_level_check check (risk_level in ('low', 'normal', 'watch', 'high', 'urgent', 'closed')),
  constraint shipping_shipments_tracking_unique unique (carrier, tracking_number)
);

create table if not exists public.shipping_tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipping_shipments(id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  carrier_event_id text null,
  event_key text not null unique,
  carrier_status_code text null,
  carrier_status_text text null,
  event_time timestamptz not null,
  event_location text null,
  normalized_status text not null,
  mapping_version text not null,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint shipping_tracking_events_carrier_check check (carrier in ('dpd', 'dhl', 'other', 'unknown')),
  constraint shipping_tracking_events_status_check check (
    normalized_status in (
      'created',
      'tracking_missing',
      'label_created',
      'carrier_not_found',
      'in_transit',
      'out_for_delivery',
      'pickup_available',
      'delivery_failed',
      'delivered',
      'returning',
      'returned',
      'lost_or_stale',
      'closed'
    )
  )
);

create table if not exists public.shipping_incidents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipping_shipments(id) on delete cascade,
  request_id text null,
  incident_key text not null unique,
  incident_type text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  description text null,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  rule_version text not null,
  source_event_id uuid null references public.shipping_tracking_events(id) on delete set null,
  active_task_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_incidents_type_check check (
    incident_type in (
      'tracking_missing',
      'label_created_no_scan',
      'carrier_not_found',
      'stale_in_transit',
      'delivery_failed',
      'pickup_available',
      'return_to_sender',
      'returned',
      'lost_or_stale'
    )
  ),
  constraint shipping_incidents_severity_check check (severity in ('watch', 'high', 'urgent')),
  constraint shipping_incidents_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored'))
);

create table if not exists public.shipping_audit_log (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid null references public.shipping_shipments(id) on delete set null,
  incident_id uuid null references public.shipping_incidents(id) on delete set null,
  action text not null,
  status text not null default 'success',
  idempotency_key text not null unique,
  actor jsonb null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint shipping_audit_log_status_check check (status in ('success', 'failed', 'skipped'))
);

create index if not exists shipping_shipments_request_idx on public.shipping_shipments(request_id);
create index if not exists shipping_shipments_status_risk_idx on public.shipping_shipments(status, risk_level, updated_at desc);
create index if not exists shipping_shipments_tracking_idx on public.shipping_shipments(carrier, tracking_number);
create index if not exists shipping_tracking_events_shipment_time_idx on public.shipping_tracking_events(shipment_id, event_time desc);
create index if not exists shipping_incidents_status_severity_idx on public.shipping_incidents(status, severity, last_detected_at desc);
create index if not exists shipping_incidents_request_idx on public.shipping_incidents(request_id);
create index if not exists shipping_audit_log_shipment_idx on public.shipping_audit_log(shipment_id, created_at desc);

alter table public.shipping_shipments enable row level security;
alter table public.shipping_tracking_events enable row level security;
alter table public.shipping_incidents enable row level security;
alter table public.shipping_audit_log enable row level security;

-- Interne Shipping-Ops laufen ueber Next.js Serverrouten und n8n mit Service-Role-Credentials.
-- Keine anon/authenticated Policies: Trello/Frontend sind Projektionen, die Datenbank bleibt Source of Truth.
