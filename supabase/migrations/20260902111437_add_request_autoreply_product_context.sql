-- Persist the request product required for product-safe auto-reply routing.
-- The decision remains fail-closed: an empty product is not treated as Neon.

alter table public.master_requests
  add column if not exists product_type text;

comment on column public.master_requests.product_type is
  'Original bounded NEONTRIP product selection used for deterministic request routing.';
