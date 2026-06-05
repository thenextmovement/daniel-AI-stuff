create or replace function public.shipping_claim_pending_notifications(
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns table (
  notification_id uuid,
  notification_key text,
  kind text,
  recipient_type text,
  recipient_email text,
  attempts integer,
  shipment_id uuid,
  incident_id uuid,
  shipment_key text,
  shopify_order_number text,
  request_id text,
  customer_name text,
  customer_email text,
  carrier text,
  tracking_number text,
  tracking_url text,
  status text,
  incident_type text,
  incident_title text,
  incident_description text,
  incident_severity text,
  latest_event_time timestamptz,
  latest_event_location text,
  latest_event_status_text text
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select n.id
    from public.shipping_notifications n
    where n.channel = 'outlook_email'
      and (
        n.status = 'pending'
        or (n.status = 'failed' and n.attempts < 3 and n.updated_at <= p_now - interval '30 minutes')
        or (n.status = 'sending' and n.claimed_at <= p_now - interval '30 minutes')
      )
    order by n.created_at asc
    limit greatest(least(coalesce(p_limit, 20), 50), 1)
    for update skip locked
  ),
  claimed as (
    update public.shipping_notifications n
    set status = 'sending',
        attempts = n.attempts + 1,
        claimed_at = p_now,
        last_error = null,
        updated_at = p_now
    from candidates c
    where n.id = c.id
    returning n.*
  )
  select
    c.id,
    c.notification_key,
    c.kind,
    c.recipient_type,
    c.recipient_email,
    c.attempts,
    s.id,
    i.id,
    s.shipment_key,
    s.shopify_order_number,
    s.request_id,
    s.customer_name,
    s.customer_email,
    s.carrier,
    s.tracking_number,
    s.tracking_url,
    s.status,
    i.incident_type,
    i.title,
    i.description,
    i.severity,
    e.event_time,
    e.event_location,
    e.carrier_status_text
  from claimed c
  join public.shipping_shipments s on s.id = c.shipment_id
  left join public.shipping_incidents i on i.id = c.incident_id
  left join lateral (
    select event_time, event_location, carrier_status_text
    from public.shipping_tracking_events
    where public.shipping_tracking_events.shipment_id = s.id
    order by event_time desc
    limit 1
  ) e on true
  order by c.created_at asc;
end;
$$;

revoke all on function public.shipping_claim_pending_notifications(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_pending_notifications(integer, timestamptz) to service_role;
