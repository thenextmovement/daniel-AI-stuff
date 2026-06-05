drop index if exists public.shipping_audit_log_incident_idx;
drop index if exists public.shipping_incidents_source_event_idx;
drop index if exists public.shipping_incidents_shipment_idx;

create index if not exists shipping_shipments_tracking_idx
  on public.shipping_shipments(carrier, tracking_number);
