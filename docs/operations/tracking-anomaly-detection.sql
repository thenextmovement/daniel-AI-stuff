-- NEONTRIP Ops tracking anomaly detection
-- Read-only report. Do not run destructive statements from this file.

-- 1. Outbound shipments where only a label/pre-advice raw status was stored,
-- but the shipment currently appears as actually moving.
select
  'outbound_label_only_marked_moving' as anomaly,
  s.id as shipment_id,
  s.shipment_key,
  s.carrier,
  s.tracking_number,
  s.status as shipment_status,
  e.normalized_status as latest_event_status,
  e.carrier_status_code,
  e.carrier_status_text,
  e.event_time
from public.shipping_shipments s
join lateral (
  select *
  from public.shipping_tracking_events e
  where e.shipment_id = s.id
  order by e.event_time desc
  limit 1
) e on true
where s.status in ('in_transit', 'out_for_delivery', 'pickup_available')
  and (
    e.normalized_status = 'label_created'
    or lower(coalesce(e.carrier_status_code, '') || ' ' || coalesce(e.carrier_status_text, '')) ~
      'label|pre[-\s]*advice|shipment information received|sendungsdaten|daten.*uebermittelt|daten.*übermittelt'
  );

-- 2. Outbound shipments with raw movement text that are not visible as moving.
select
  'outbound_raw_movement_not_moving' as anomaly,
  s.id as shipment_id,
  s.shipment_key,
  s.carrier,
  s.tracking_number,
  s.status as shipment_status,
  e.normalized_status as latest_event_status,
  e.carrier_status_code,
  e.carrier_status_text,
  e.event_time
from public.shipping_shipments s
join lateral (
  select *
  from public.shipping_tracking_events e
  where e.shipment_id = s.id
  order by e.event_time desc
  limit 1
) e on true
where s.status not in ('in_transit', 'out_for_delivery', 'pickup_available', 'delivered', 'returned', 'closed')
  and lower(coalesce(e.carrier_status_code, '') || ' ' || coalesce(e.carrier_status_text, '')) ~
    'picked up|accepted|received by carrier|in transit|unterwegs|arrived|departed|facility|hub|sort|transport|processed|verarbeitet';

-- 3. Delivered outbound shipments still open.
select
  'outbound_delivered_still_open' as anomaly,
  s.id as shipment_id,
  s.shipment_key,
  s.carrier,
  s.tracking_number,
  s.status as shipment_status,
  s.delivered_at,
  e.event_time,
  e.carrier_status_text
from public.shipping_shipments s
join lateral (
  select *
  from public.shipping_tracking_events e
  where e.shipment_id = s.id
  order by e.event_time desc
  limit 1
) e on true
where s.status not in ('delivered', 'closed')
  and (
    e.normalized_status = 'delivered'
    or lower(coalesce(e.carrier_status_text, '')) ~ 'delivered|zugestellt|delivery complete'
  );

-- 4. Inbound label-created/tracking-created rows that currently have open notifications.
select
  'inbound_label_only_with_notification' as anomaly,
  s.id as shipment_id,
  s.shipment_key,
  s.carrier,
  s.tracking_number,
  s.status as shipment_status,
  i.id as incident_id,
  i.incident_type,
  n.id as notification_id,
  n.status as notification_status,
  n.created_at
from public.inbound_shipments s
join public.inbound_incidents i on i.shipment_id = s.id
join public.inbound_notifications n on n.incident_id = i.id
where s.status in ('tracking_created', 'label_created')
  and n.status in ('pending', 'sending', 'failed');

-- 5. Inbound shipments with raw movement text that are not visible as moving.
select
  'inbound_raw_movement_not_moving' as anomaly,
  s.id as shipment_id,
  s.shipment_key,
  s.carrier,
  s.tracking_number,
  s.status as shipment_status,
  e.normalized_status as latest_event_status,
  e.carrier_status_code,
  e.carrier_status_text,
  e.event_time
from public.inbound_shipments s
join lateral (
  select *
  from public.inbound_tracking_events e
  where e.shipment_id = s.id
  order by e.event_time desc
  limit 1
) e on true
where s.status not in ('tendered', 'in_transit', 'clearance_in_progress', 'clearance_action_required', 'out_for_delivery', 'delivered', 'closed')
  and lower(coalesce(e.carrier_status_code, '') || ' ' || coalesce(e.carrier_status_text, '')) ~
    'picked up|accepted|received by carrier|in transit|unterwegs|arrived|departed|facility|hub|sort|transport|processed|verarbeitet|clearance';

-- 6. Stale shipments after true handoff, not label-only rows.
select
  'stale_after_real_handoff' as anomaly,
  source,
  shipment_id,
  shipment_key,
  carrier,
  tracking_number,
  shipment_status,
  last_movement_at,
  age(now(), last_movement_at) as no_update_for
from (
  select
    'outbound' as source,
    s.id as shipment_id,
    s.shipment_key,
    s.carrier,
    s.tracking_number,
    s.status as shipment_status,
    coalesce(s.last_event_at, s.shipped_at, s.updated_at) as last_movement_at
  from public.shipping_shipments s
  where s.status in ('in_transit', 'out_for_delivery', 'pickup_available')
  union all
  select
    'inbound' as source,
    s.id as shipment_id,
    s.shipment_key,
    s.carrier,
    s.tracking_number,
    s.status as shipment_status,
    coalesce(s.last_movement_at, s.last_event_at, s.tendered_at, s.updated_at) as last_movement_at
  from public.inbound_shipments s
  where s.status in ('tendered', 'in_transit', 'clearance_in_progress', 'clearance_action_required', 'out_for_delivery')
) stale
where last_movement_at <= now() - interval '72 hours';

-- 7. Duplicate or contradictory latest status values per tracking number.
select
  'duplicate_or_conflicting_tracking' as anomaly,
  source,
  carrier,
  tracking_number,
  count(*) as shipment_rows,
  array_agg(shipment_id order by updated_at desc) as shipment_ids,
  array_agg(shipment_status order by updated_at desc) as statuses
from (
  select 'outbound' as source, id as shipment_id, carrier, tracking_number, status as shipment_status, updated_at
  from public.shipping_shipments
  where tracking_number is not null
  union all
  select 'inbound' as source, id as shipment_id, carrier, tracking_number, status as shipment_status, updated_at
  from public.inbound_shipments
) rows
group by source, carrier, tracking_number
having count(*) > 1
   or count(distinct shipment_status) > 1;
