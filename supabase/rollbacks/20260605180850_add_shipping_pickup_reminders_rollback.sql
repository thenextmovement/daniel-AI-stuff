create or replace function public.shipping_enqueue_notifications(p_now timestamptz default now())
returns table (
  notification_id uuid,
  notification_key text,
  kind text,
  status text
)
language plpgsql
security invoker
as $$
begin
  insert into public.shipping_notifications (
    notification_key,
    shipment_id,
    incident_id,
    kind,
    recipient_type,
    recipient_email,
    metadata,
    updated_at
  )
  select
    'customer:pickup_available:' || s.id::text,
    s.id,
    i.id,
    'customer_pickup_available',
    'customer',
    lower(btrim(s.customer_email)),
    jsonb_build_object(
      'incident_type', i.incident_type,
      'tracking_number', s.tracking_number,
      'carrier', s.carrier,
      'event_location', coalesce(e.event_location, ''),
      'carrier_status_text', coalesce(e.carrier_status_text, '')
    ),
    p_now
  from public.shipping_incidents i
  join public.shipping_shipments s on s.id = i.shipment_id
  left join lateral (
    select event_location, carrier_status_text, event_time
    from public.shipping_tracking_events
    where shipment_id = s.id
    order by event_time desc
    limit 1
  ) e on true
  where i.incident_type = 'pickup_available'
    and i.status in ('open', 'acknowledged')
    and s.status = 'pickup_available'
    and nullif(btrim(s.customer_email), '') is not null
    and lower(btrim(s.customer_email)) like '%@%.%'
    and lower(btrim(s.customer_email)) not like '%@neontrip.de'
    and lower(btrim(s.customer_email)) not like '%@neontrip.test'
  on conflict (notification_key) do nothing;

  insert into public.shipping_notifications (
    notification_key,
    shipment_id,
    incident_id,
    kind,
    recipient_type,
    recipient_email,
    metadata,
    updated_at
  )
  select
    'internal:delivery_problem:' || i.id::text,
    s.id,
    i.id,
    'internal_delivery_problem',
    'internal',
    'info@neontrip.de',
    jsonb_build_object(
      'incident_type', i.incident_type,
      'severity', i.severity,
      'tracking_number', s.tracking_number,
      'carrier', s.carrier,
      'carrier_status_text', coalesce(e.carrier_status_text, '')
    ),
    p_now
  from public.shipping_incidents i
  join public.shipping_shipments s on s.id = i.shipment_id
  left join lateral (
    select carrier_status_text, event_time
    from public.shipping_tracking_events
    where shipment_id = s.id
    order by event_time desc
    limit 1
  ) e on true
  where i.incident_type in ('delivery_failed', 'return_to_sender', 'returned')
    and i.status in ('open', 'acknowledged')
  on conflict (notification_key) do nothing;

  return query
  select n.id, n.notification_key, n.kind, n.status
  from public.shipping_notifications n
  where n.created_at >= p_now - interval '5 minutes'
  order by n.created_at desc;
end;
$$;

revoke all on function public.shipping_enqueue_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_enqueue_notifications(timestamptz) to service_role;
