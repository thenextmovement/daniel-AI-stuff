create or replace function public.shipping_record_tracking_event(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_shipment_payload jsonb := coalesce(p_payload -> 'shipment', '{}'::jsonb);
  v_event_payload jsonb := coalesce(p_payload -> 'event', p_payload);
  v_carrier text := public.shipping_normalize_carrier(coalesce(v_event_payload ->> 'carrier', v_shipment_payload ->> 'carrier'));
  v_tracking_number text := nullif(btrim(coalesce(v_event_payload ->> 'trackingNumber', v_event_payload ->> 'tracking_number', v_shipment_payload ->> 'trackingNumber', v_shipment_payload ->> 'tracking_number')), '');
  v_event_time timestamptz;
  v_status text;
  v_event_key text;
  v_shipment_key text;
  v_shipment public.shipping_shipments%rowtype;
  v_event public.shipping_tracking_events%rowtype;
  v_incident_count integer := 0;
begin
  if v_tracking_number is null then
    raise exception 'tracking number is required' using errcode = '22023';
  end if;

  v_event_time := coalesce(nullif(v_event_payload ->> 'eventTime', ''), nullif(v_event_payload ->> 'event_time', ''))::timestamptz;
  if v_event_time is null then
    raise exception 'event time is required' using errcode = '22023';
  end if;

  v_status := public.shipping_normalize_status(v_carrier, coalesce(v_event_payload ->> 'statusCode', v_event_payload ->> 'status_code'), coalesce(v_event_payload ->> 'statusText', v_event_payload ->> 'status_text'));
  v_shipment_key := nullif(btrim(coalesce(v_shipment_payload ->> 'shipmentKey', v_shipment_payload ->> 'shipment_key')), '');
  if v_shipment_key is null then
    v_shipment_key := coalesce(
      'shopify:' || nullif(v_shipment_payload ->> 'shopifyOrderId', '') || ':' || nullif(v_shipment_payload ->> 'shopifyFulfillmentId', '') || ':' || v_carrier || ':' || v_tracking_number,
      'carrier:' || v_carrier || ':' || v_tracking_number
    );
  end if;

  select * into v_shipment
  from public.shipping_shipments
  where carrier = v_carrier
    and tracking_number = v_tracking_number
  order by updated_at desc
  limit 1;

  if v_shipment.id is not null then
    v_shipment_key := v_shipment.shipment_key;
  end if;

  insert into public.shipping_shipments (
    shipment_key,
    source,
    shopify_order_id,
    shopify_order_number,
    shopify_fulfillment_id,
    request_id,
    customer_name,
    customer_email,
    customer_phone,
    carrier,
    tracking_number,
    tracking_url,
    destination_country,
    status,
    risk_level,
    shipped_at,
    delivered_at,
    last_event_at,
    last_carrier_sync_at,
    raw_shopify,
    updated_at
  )
  values (
    v_shipment_key,
    coalesce(nullif(v_shipment_payload ->> 'source', ''), 'shopify'),
    nullif(v_shipment_payload ->> 'shopifyOrderId', ''),
    nullif(v_shipment_payload ->> 'shopifyOrderNumber', ''),
    nullif(v_shipment_payload ->> 'shopifyFulfillmentId', ''),
    nullif(v_shipment_payload ->> 'requestId', ''),
    nullif(v_shipment_payload ->> 'customerName', ''),
    lower(nullif(v_shipment_payload ->> 'customerEmail', '')),
    nullif(v_shipment_payload ->> 'customerPhone', ''),
    v_carrier,
    v_tracking_number,
    nullif(v_shipment_payload ->> 'trackingUrl', ''),
    nullif(v_shipment_payload ->> 'destinationCountry', ''),
    v_status,
    public.shipping_risk_level(v_status),
    nullif(v_shipment_payload ->> 'shippedAt', '')::timestamptz,
    case when v_status = 'delivered' then v_event_time else nullif(v_shipment_payload ->> 'deliveredAt', '')::timestamptz end,
    v_event_time,
    now(),
    coalesce(v_shipment_payload -> 'rawShopify', '{}'::jsonb),
    now()
  )
  on conflict (shipment_key) do update
    set source = excluded.source,
        shopify_order_id = coalesce(excluded.shopify_order_id, public.shipping_shipments.shopify_order_id),
        shopify_order_number = coalesce(excluded.shopify_order_number, public.shipping_shipments.shopify_order_number),
        shopify_fulfillment_id = coalesce(excluded.shopify_fulfillment_id, public.shipping_shipments.shopify_fulfillment_id),
        request_id = coalesce(excluded.request_id, public.shipping_shipments.request_id),
        customer_name = coalesce(excluded.customer_name, public.shipping_shipments.customer_name),
        customer_email = coalesce(excluded.customer_email, public.shipping_shipments.customer_email),
        customer_phone = coalesce(excluded.customer_phone, public.shipping_shipments.customer_phone),
        carrier = excluded.carrier,
        tracking_number = excluded.tracking_number,
        tracking_url = coalesce(excluded.tracking_url, public.shipping_shipments.tracking_url),
        destination_country = coalesce(excluded.destination_country, public.shipping_shipments.destination_country),
        status = case
          when public.shipping_shipments.last_event_at is null or excluded.last_event_at >= public.shipping_shipments.last_event_at then excluded.status
          else public.shipping_shipments.status
        end,
        risk_level = case
          when public.shipping_shipments.last_event_at is null or excluded.last_event_at >= public.shipping_shipments.last_event_at then excluded.risk_level
          else public.shipping_shipments.risk_level
        end,
        shipped_at = coalesce(public.shipping_shipments.shipped_at, excluded.shipped_at),
        delivered_at = coalesce(excluded.delivered_at, public.shipping_shipments.delivered_at),
        last_event_at = greatest(coalesce(public.shipping_shipments.last_event_at, excluded.last_event_at), excluded.last_event_at),
        last_carrier_sync_at = excluded.last_carrier_sync_at,
        raw_shopify = case when excluded.raw_shopify = '{}'::jsonb then public.shipping_shipments.raw_shopify else excluded.raw_shopify end,
        updated_at = excluded.updated_at
  returning * into v_shipment;

  v_event_key := nullif(btrim(coalesce(v_event_payload ->> 'eventKey', v_event_payload ->> 'event_key')), '');
  if v_event_key is null then
    v_event_key := concat_ws(
      ':',
      v_carrier,
      lower(v_tracking_number),
      coalesce(nullif(v_event_payload ->> 'carrierEventId', ''), nullif(v_event_payload ->> 'carrier_event_id', ''), nullif(v_event_payload ->> 'statusCode', ''), 'status'),
      to_char(v_event_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      left(lower(coalesce(v_event_payload ->> 'statusText', v_event_payload ->> 'status_text', '')), 80)
    );
  end if;

  insert into public.shipping_tracking_events (
    shipment_id,
    carrier,
    tracking_number,
    carrier_event_id,
    event_key,
    carrier_status_code,
    carrier_status_text,
    event_time,
    event_location,
    normalized_status,
    mapping_version,
    raw_event
  )
  values (
    v_shipment.id,
    v_carrier,
    v_tracking_number,
    coalesce(nullif(v_event_payload ->> 'carrierEventId', ''), nullif(v_event_payload ->> 'carrier_event_id', '')),
    v_event_key,
    coalesce(nullif(v_event_payload ->> 'statusCode', ''), nullif(v_event_payload ->> 'status_code', '')),
    coalesce(nullif(v_event_payload ->> 'statusText', ''), nullif(v_event_payload ->> 'status_text', '')),
    v_event_time,
    coalesce(nullif(v_event_payload ->> 'eventLocation', ''), nullif(v_event_payload ->> 'event_location', '')),
    v_status,
    'carrier_status_mapping_v2_20260605',
    coalesce(v_event_payload -> 'rawEvent', v_event_payload -> 'raw_event', '{}'::jsonb)
  )
  on conflict (event_key) do update
    set raw_event = excluded.raw_event,
        carrier_status_text = coalesce(excluded.carrier_status_text, public.shipping_tracking_events.carrier_status_text),
        normalized_status = excluded.normalized_status,
        mapping_version = excluded.mapping_version
  returning * into v_event;

  select count(*)::integer into v_incident_count
  from public.shipping_evaluate_shipment(v_shipment.id);

  select * into v_shipment
  from public.shipping_shipments
  where id = v_shipment.id;

  return jsonb_build_object(
    'shipment_id', v_shipment.id,
    'shipment_key', v_shipment.shipment_key,
    'shipment_status', v_shipment.status,
    'risk_level', v_shipment.risk_level,
    'event_id', v_event.id,
    'event_key', v_event.event_key,
    'normalized_status', v_event.normalized_status,
    'incident_count', v_incident_count
  );
end;
$$;

revoke all on function public.shipping_record_tracking_event(jsonb) from public, anon, authenticated;
grant execute on function public.shipping_record_tracking_event(jsonb) to service_role;
