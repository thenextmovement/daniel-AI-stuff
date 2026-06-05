drop index if exists public.shipping_shipments_tracking_idx;

create index if not exists shipping_incidents_shipment_idx
  on public.shipping_incidents(shipment_id);

create index if not exists shipping_incidents_source_event_idx
  on public.shipping_incidents(source_event_id)
  where source_event_id is not null;

create index if not exists shipping_audit_log_incident_idx
  on public.shipping_audit_log(incident_id, created_at desc)
  where incident_id is not null;
