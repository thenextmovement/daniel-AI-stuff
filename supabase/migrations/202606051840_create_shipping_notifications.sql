create table if not exists public.shipping_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_key text not null unique,
  shipment_id uuid not null references public.shipping_shipments(id) on delete cascade,
  incident_id uuid null references public.shipping_incidents(id) on delete set null,
  kind text not null,
  recipient_type text not null,
  channel text not null default 'outlook_email',
  status text not null default 'pending',
  recipient_email text not null,
  attempts integer not null default 0,
  claimed_at timestamptz null,
  sent_at timestamptz null,
  failed_at timestamptz null,
  provider_message_id text null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_notifications_kind_check check (kind in ('customer_pickup_available', 'internal_delivery_problem')),
  constraint shipping_notifications_recipient_type_check check (recipient_type in ('customer', 'internal')),
  constraint shipping_notifications_channel_check check (channel in ('outlook_email')),
  constraint shipping_notifications_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'))
);

create index if not exists shipping_notifications_status_idx on public.shipping_notifications(status, updated_at);
create index if not exists shipping_notifications_shipment_idx on public.shipping_notifications(shipment_id, created_at desc);
create index if not exists shipping_notifications_incident_idx on public.shipping_notifications(incident_id, created_at desc);

alter table public.shipping_notifications enable row level security;

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

create or replace function public.shipping_mark_notification_sent(
  p_notification_id uuid,
  p_provider_message_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns public.shipping_notifications
language plpgsql
security invoker
as $$
declare
  v_row public.shipping_notifications%rowtype;
begin
  update public.shipping_notifications
  set status = 'sent',
      sent_at = p_now,
      provider_message_id = nullif(btrim(p_provider_message_id), ''),
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = p_now
  where id = p_notification_id
  returning * into v_row;

  if not found then
    raise exception 'shipping notification not found: %', p_notification_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.shipping_mark_notification_failed(
  p_notification_id uuid,
  p_error text,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns public.shipping_notifications
language plpgsql
security invoker
as $$
declare
  v_row public.shipping_notifications%rowtype;
begin
  update public.shipping_notifications
  set status = case when attempts >= 3 then 'failed' else 'pending' end,
      failed_at = p_now,
      last_error = left(coalesce(p_error, 'unknown'), 1000),
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = p_now
  where id = p_notification_id
  returning * into v_row;

  if not found then
    raise exception 'shipping notification not found: %', p_notification_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.shipping_enqueue_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_claim_pending_notifications(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_mark_notification_sent(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_mark_notification_failed(uuid, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.shipping_enqueue_notifications(timestamptz) to service_role;
grant execute on function public.shipping_claim_pending_notifications(integer, timestamptz) to service_role;
grant execute on function public.shipping_mark_notification_sent(uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.shipping_mark_notification_failed(uuid, text, jsonb, timestamptz) to service_role;
