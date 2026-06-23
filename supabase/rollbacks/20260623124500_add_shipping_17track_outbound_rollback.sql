drop function if exists public.shipping_claim_due_17track_tracking_shipments(integer, timestamptz);
drop function if exists public.shipping_record_17track_registration(jsonb, timestamptz);
drop function if exists public.shipping_claim_due_17track_registrations(integer, timestamptz);
drop function if exists public.shipping_record_tracking_error(jsonb, timestamptz);

drop table if exists public.shipping_tracking_registrations;

delete from public.shipping_incidents
where incident_type = 'tracking_error';

alter table public.shipping_incidents drop constraint if exists shipping_incidents_type_check;

alter table public.shipping_incidents
  add constraint shipping_incidents_type_check check (
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
  );
