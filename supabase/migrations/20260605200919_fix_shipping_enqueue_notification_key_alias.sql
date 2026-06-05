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
  with pickup_candidates as (
    select
      s.id as shipment_id,
      i.id as incident_id,
      i.incident_type,
      s.customer_email,
      s.tracking_number,
      s.carrier,
      e.event_location,
      e.carrier_status_text
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
  )
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
    'customer:pickup_available:' || pc.shipment_id::text,
    pc.shipment_id,
    pc.incident_id,
    'customer_pickup_available',
    'customer',
    lower(btrim(pc.customer_email)),
    jsonb_build_object(
      'incident_type', pc.incident_type,
      'notification_stage', 'initial',
      'tracking_number', pc.tracking_number,
      'carrier', pc.carrier,
      'event_location', coalesce(pc.event_location, ''),
      'carrier_status_text', coalesce(pc.carrier_status_text, '')
    ),
    p_now
  from pickup_candidates pc
  where not exists (
    select 1
    from public.shipping_notifications existing
    where existing.shipment_id = pc.shipment_id
      and existing.kind = 'customer_pickup_available'
  )
  on conflict on constraint shipping_notifications_notification_key_key do nothing;

  with pickup_candidates as (
    select
      s.id as shipment_id,
      i.id as incident_id,
      i.incident_type,
      s.customer_email,
      s.tracking_number,
      s.carrier,
      e.event_location,
      e.carrier_status_text,
      h.sent_count,
      h.last_sent_at,
      h.open_retry_count
    from public.shipping_incidents i
    join public.shipping_shipments s on s.id = i.shipment_id
    left join lateral (
      select event_location, carrier_status_text, event_time
      from public.shipping_tracking_events
      where shipment_id = s.id
      order by event_time desc
      limit 1
    ) e on true
    join lateral (
      select
        count(*) filter (where n.status = 'sent')::integer as sent_count,
        max(n.sent_at) filter (where n.status = 'sent') as last_sent_at,
        count(*) filter (
          where n.status in ('pending', 'sending')
             or (n.status = 'failed' and n.attempts < 3)
        )::integer as open_retry_count
      from public.shipping_notifications n
      where n.shipment_id = s.id
        and n.kind = 'customer_pickup_available'
    ) h on true
    where i.incident_type = 'pickup_available'
      and i.status in ('open', 'acknowledged')
      and s.status = 'pickup_available'
      and nullif(btrim(s.customer_email), '') is not null
      and lower(btrim(s.customer_email)) like '%@%.%'
      and lower(btrim(s.customer_email)) not like '%@neontrip.de'
      and lower(btrim(s.customer_email)) not like '%@neontrip.test'
      and h.sent_count between 1 and 3
      and h.last_sent_at <= p_now - interval '2 days'
      and h.open_retry_count = 0
  )
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
    'customer:pickup_available:' || pc.shipment_id::text || ':reminder:' || pc.sent_count::text,
    pc.shipment_id,
    pc.incident_id,
    'customer_pickup_available',
    'customer',
    lower(btrim(pc.customer_email)),
    jsonb_build_object(
      'incident_type', pc.incident_type,
      'notification_stage', 'reminder',
      'reminder_number', pc.sent_count,
      'last_sent_at', pc.last_sent_at,
      'tracking_number', pc.tracking_number,
      'carrier', pc.carrier,
      'event_location', coalesce(pc.event_location, ''),
      'carrier_status_text', coalesce(pc.carrier_status_text, '')
    ),
    p_now
  from pickup_candidates pc
  on conflict on constraint shipping_notifications_notification_key_key do nothing;

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
  on conflict on constraint shipping_notifications_notification_key_key do nothing;

  return query
  select n.id, n.notification_key, n.kind, n.status
  from public.shipping_notifications n
  where n.created_at >= p_now - interval '5 minutes'
  order by n.created_at desc;
end;
$$;

revoke all on function public.shipping_enqueue_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_enqueue_notifications(timestamptz) to service_role;
