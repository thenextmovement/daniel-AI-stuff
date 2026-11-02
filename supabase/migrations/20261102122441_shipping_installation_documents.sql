-- Extend the existing shipping notification mechanism; no separate delivery queue.
-- Deployment time is the permanent no-backfill boundary (not reset on reapplication).
insert into public.shipping_audit_log(action, idempotency_key, metadata)
values ('installation_documents_activation', 'installation_documents_activation:v1', '{"contract":"confirmed_transport_scan"}')
on conflict (idempotency_key) do nothing;

alter table public.shipping_notifications drop constraint shipping_notifications_kind_check;
alter table public.shipping_notifications add constraint shipping_notifications_kind_check
check (kind in ('customer_pickup_available','internal_delivery_problem','customer_installation_documents'));

-- Normalization defaults unknown statuses to in_transit in the legacy tracker.
-- Therefore require explicit provider evidence, never normalized_status alone.
create or replace function public.shipping_installation_is_transport_event(p_event public.shipping_tracking_events)
returns boolean language plpgsql stable security invoker set search_path = public as $$
declare v_time text; v_parsed timestamptz; v_code text;
begin
 if p_event.normalized_status not in ('in_transit','out_for_delivery','pickup_available') then return false; end if;
 if p_event.raw_event->>'source' = 'shopify_fulfillment_event' then
   return coalesce(p_event.carrier_event_id ~ '^gid://shopify/FulfillmentEvent/[0-9]+$'
     and p_event.carrier_status_code in ('IN_TRANSIT','CARRIER_PICKED_UP','OUT_FOR_DELIVERY','READY_FOR_PICKUP'),false);
 end if;
 if p_event.raw_event->>'source' is distinct from '17track' then return false; end if;
 v_code := lower(coalesce(p_event.raw_event#>>'{event,status_code}', p_event.raw_event#>>'{event,statusCode}',
   p_event.raw_event#>>'{event,checkpoint_status}', p_event.raw_event#>>'{event,event_status}',p_event.raw_event#>>'{event,status}'));
 if v_code is null or v_code not in ('intransit','in_transit','outfordelivery','out_for_delivery','availableforpickup','available_for_pickup') then return false; end if;
 v_time := coalesce(p_event.raw_event#>>'{event,time_iso}',p_event.raw_event#>>'{event,time_utc}',
   p_event.raw_event#>>'{event,event_time}',p_event.raw_event#>>'{event,eventTime}',p_event.raw_event#>>'{event,datetime}',
   p_event.raw_event#>>'{event,date}',p_event.raw_event#>>'{event,time}',p_event.raw_event#>>'{event,timestamp}');
 if v_time is null or v_time !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}[T ]' then return false; end if;
 begin v_parsed := v_time::timestamptz; exception when others then return false; end;
 -- Reject the legacy parser's synthetic now() fallback for malformed/missing times.
 return abs(extract(epoch from (v_parsed-p_event.event_time))) < 1;
end;
$$;

create or replace function public.shipping_reserve_installation_documents(
 p_order_id text, p_fulfillment_id text, p_tracking_numbers text[], p_recipient text,
 p_owner uuid, p_metadata jsonb
) returns setof public.shipping_notifications language plpgsql security invoker set search_path = public as $$
declare
 v_shipment uuid; v_event uuid; v_event_time timestamptz; v_cutoff timestamptz;
 v_key text := 'customer:installation_documents:shopify:' || p_order_id || ':' || p_fulfillment_id;
begin
 if p_order_id !~ '^[0-9]+$' or p_fulfillment_id !~ '^[0-9]+$' or p_owner is null
   or nullif(p_recipient,'') is null or jsonb_typeof(p_metadata) <> 'object' then
   raise exception 'invalid installation reservation';
 end if;
 select created_at into v_cutoff from public.shipping_audit_log
 where idempotency_key='installation_documents_activation:v1';
 if v_cutoff is null then return; end if;
 -- Returning/closed parcels suppress instructions; a newly delivered parcel still needs its documents.
 if exists(select 1 from public.shipping_shipments s where s.source='shopify'
   and s.shopify_order_id=p_order_id and s.shopify_fulfillment_id=p_fulfillment_id
   and s.status in ('returning','returned','closed')) then return; end if;
 if exists(select 1 from public.shipping_shipments s join public.shipping_tracking_events e on e.shipment_id=s.id
   where s.source='shopify' and s.shopify_order_id=p_order_id and s.shopify_fulfillment_id=p_fulfillment_id
     and public.shipping_installation_is_transport_event(e) and e.event_time < v_cutoff) then return; end if;
 select s.id, e.id, e.event_time into v_shipment, v_event, v_event_time
 from public.shipping_shipments s
 join lateral (select e.* from public.shipping_tracking_events e
   where e.shipment_id=s.id and e.tracking_number=s.tracking_number
     and e.carrier=s.carrier and public.shipping_installation_is_transport_event(e)
   order by e.event_time, e.id limit 1) e on true
 where s.source='shopify' and s.shopify_order_id=p_order_id
   and s.shopify_fulfillment_id=p_fulfillment_id and s.tracking_number=any(p_tracking_numbers)
   and s.status in ('in_transit','out_for_delivery','pickup_available','delivery_failed','delivered')
   and e.event_time >= v_cutoff and e.event_time <= now()
   and e.event_time >= now()-interval '21 days'
 order by e.event_time, s.id limit 1;
 if v_shipment is null then return; end if;
 return query insert into public.shipping_notifications(
   notification_key,shipment_id,kind,recipient_type,recipient_email,status,last_error,metadata)
 values(v_key,v_shipment,'customer_installation_documents','customer',lower(p_recipient),'pending',
   nullif(p_metadata->>'review_reason',''),
   p_metadata || jsonb_build_object('owner_token',p_owner,'scan_event_id',v_event,'scan_event_time',v_event_time))
 on conflict(notification_key) do nothing returning *;
end; $$;

-- One transition authorizes one POST /send. A timeout never reclaims the row.
create or replace function public.shipping_authorize_installation_send(p_id uuid,p_owner uuid,p_draft_id text)
returns setof public.shipping_notifications language sql security invoker set search_path=public as $$
 update public.shipping_notifications n set status='sending',attempts=1,claimed_at=now(),
   provider_message_id=p_draft_id,updated_at=now()
 where n.id=p_id and n.kind='customer_installation_documents' and n.status='pending'
   and n.attempts=0 and n.last_error is null and n.metadata->>'owner_token'=p_owner::text
   and n.created_at > now()-interval '15 minutes' and nullif(p_draft_id,'') is not null
   and not exists(select 1 from public.shipping_shipments s join public.shipping_shipments own on own.id=n.shipment_id
     where s.shopify_order_id=own.shopify_order_id and s.shopify_fulfillment_id=own.shopify_fulfillment_id
       and s.status in ('returning','returned','closed'))
 returning n.*;
$$;

create or replace function public.shipping_complete_installation_send(p_id uuid,p_owner uuid,p_draft_id text,p_receipt jsonb)
returns setof public.shipping_notifications language sql security invoker set search_path=public as $$
 update public.shipping_notifications n set status='sent',sent_at=now(),updated_at=now(),
   metadata=n.metadata || jsonb_build_object('sent_receipt',p_receipt)
 where n.id=p_id and n.kind='customer_installation_documents' and n.status='sending'
   and n.metadata->>'owner_token'=p_owner::text and n.provider_message_id=p_draft_id
   and p_receipt->>'id'=p_draft_id and p_receipt->>'isDraft'='false'
   and nullif(p_receipt->>'internetMessageId','') is not null
   and p_receipt->>'parentFolderId'=n.metadata#>>'{expected,sentFolderId}'
 returning n.*;
$$;

revoke all on function public.shipping_installation_is_transport_event(public.shipping_tracking_events) from public,anon,authenticated;
revoke all on function public.shipping_reserve_installation_documents(text,text,text[],text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.shipping_authorize_installation_send(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.shipping_complete_installation_send(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.shipping_installation_is_transport_event(public.shipping_tracking_events) to service_role;
grant execute on function public.shipping_reserve_installation_documents(text,text,text[],text,uuid,jsonb) to service_role;
grant execute on function public.shipping_authorize_installation_send(uuid,uuid,text) to service_role;
grant execute on function public.shipping_complete_installation_send(uuid,uuid,text,jsonb) to service_role;

-- Preserve the legacy functions verbatim except exclusion of the new kind.
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
      and n.kind <> 'customer_installation_documents'
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
  where id = p_notification_id and kind <> 'customer_installation_documents'
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
  where id = p_notification_id and kind <> 'customer_installation_documents'
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
