create or replace function public.shipping_normalize_carrier(p_value text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_value, '') = '' then 'unknown'
    when lower(p_value) like '%dpd%' then 'dpd'
    when lower(p_value) like '%dhl%' or lower(p_value) like '%deutsche post%' then 'dhl'
    else 'other'
  end;
$$;

create or replace function public.shipping_normalize_status(p_carrier text, p_status_code text, p_status_text text)
returns text
language sql
immutable
as $$
  with input as (
    select lower(concat_ws(' ', p_carrier, p_status_code, p_status_text)) as text
  )
  select case
    when text ~ 'attempted[_\s-]*delivery' then 'delivery_failed'
    when text ~ 'ready[_\s-]*for[_\s-]*pickup' then 'pickup_available'
    when text ~ 'out[_\s-]*for[_\s-]*delivery' then 'out_for_delivery'
    when text ~ 'carrier[_\s-]*picked[_\s-]*up|in[_\s-]*transit' then 'in_transit'
    when text ~ 'label[_\s-]*(printed|purchased)|confirmed' then 'label_created'
    when text ~ '\bfailure\b' then 'delivery_failed'
    when text ~ 'not\s*found|unknown shipment|keine sendung|nicht gefunden|no tracking' then 'carrier_not_found'
    when text ~ 'returned|retoure abgeschlossen|ruecksendung zugestellt|rücksendung zugestellt|returned to sender' then 'returned'
    when text ~ 'return to sender|returning|retoure|ruecksendung|rücksendung|zurueck an absender|zurück an absender' then 'returning'
    when text ~ 'delivered|zugestellt|erfolgreich zugestellt' then 'delivered'
    when text ~ 'failed|nicht zugestellt|zustellung fehlgeschlagen|empfaenger nicht|empfänger nicht|annahme verweigert|address problem|adressproblem' then 'delivery_failed'
    when text ~ 'pickup|paketshop|parcelshop|filiale|packstation|abhol' then 'pickup_available'
    when text ~ 'out for delivery|in zustellung|zustellung heute|wird heute zugestellt' then 'out_for_delivery'
    when text ~ 'label|announced|angekuendigt|angekündigt|daten.*uebermittelt|daten.*übermittelt|sendungsdaten' then 'label_created'
    when text ~ 'delay|delayed|verspaetet|verspätet|transit|unterwegs|sort|depot|hub|transport|scan|processed|verarbeitet' then 'in_transit'
    else 'in_transit'
  end
  from input;
$$;

create or replace function public.shipping_business_days_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
as $$
  select case
    when p_from is null then null
    else (
      select count(*)::integer
      from generate_series(
        (date_trunc('day', p_from at time zone 'utc') + interval '1 day')::date,
        (date_trunc('day', p_to at time zone 'utc'))::date,
        interval '1 day'
      ) as day(value)
      where extract(isodow from day.value) between 1 and 5
    )
  end;
$$;

create or replace function public.shipping_risk_level(p_status text, p_has_urgent boolean default false, p_has_high boolean default false, p_has_watch boolean default false)
returns text
language sql
immutable
as $$
  select case
    when p_status in ('delivered', 'closed') then 'closed'
    when p_has_urgent then 'urgent'
    when p_has_high then 'high'
    when p_has_watch then 'watch'
    when p_status in ('delivery_failed', 'returning', 'returned', 'lost_or_stale', 'carrier_not_found') then 'high'
    when p_status in ('pickup_available', 'label_created', 'tracking_missing') then 'watch'
    else 'normal'
  end;
$$;

create or replace function public.shipping_evaluate_shipment(p_shipment_id uuid, p_now timestamptz default now())
returns table (
  incident_id uuid,
  incident_type text,
  severity text,
  status text
)
language plpgsql
security invoker
as $$
declare
  v_shipment public.shipping_shipments%rowtype;
  v_event public.shipping_tracking_events%rowtype;
  v_last_movement_at timestamptz;
  v_business_days_idle integer;
  v_candidate record;
  v_has_urgent boolean := false;
  v_has_high boolean := false;
  v_has_watch boolean := false;
begin
  select * into v_shipment
  from public.shipping_shipments
  where id = p_shipment_id;

  if not found then
    raise exception 'shipping shipment not found: %', p_shipment_id using errcode = 'P0002';
  end if;

  select * into v_event
  from public.shipping_tracking_events
  where shipment_id = p_shipment_id
  order by event_time desc
  limit 1;

  v_last_movement_at := coalesce(v_event.event_time, v_shipment.last_event_at, v_shipment.shipped_at);
  v_business_days_idle := public.shipping_business_days_between(v_last_movement_at, p_now);

  if v_shipment.status in ('delivered', 'closed') then
    update public.shipping_incidents
    set status = 'resolved',
        resolved_at = coalesce(resolved_at, p_now),
        updated_at = p_now
    where shipment_id = p_shipment_id
      and status in ('open', 'acknowledged');

    update public.shipping_shipments
    set risk_level = 'closed',
        updated_at = p_now
    where id = p_shipment_id;

    return;
  end if;

  for v_candidate in
    select * from (
      values
        ('tracking_missing'::text, 'high'::text, 'Trackingnummer fehlt'::text, 'Die Sendung wurde in Shopify angelegt, hat aber noch keine belastbare Trackingnummer.'::text, null::jsonb),
        ('carrier_not_found', 'high', 'Carrier kennt die Sendung nicht', 'Die Trackingnummer wurde beim Versanddienstleister nicht gefunden. Trackingnummer und Carrier pruefen.', null::jsonb),
        ('label_created_no_scan', 'high', 'Label erstellt, aber kein Carrier-Scan', concat('Seit ', coalesce(v_business_days_idle, 0), ' Werktagen gibt es nach Label-Erstellung keine echte Paketbewegung.'), jsonb_build_object('business_days_idle', v_business_days_idle)),
        ('stale_in_transit', 'high', 'Sendung bewegt sich nicht', concat('Seit ', coalesce(v_business_days_idle, 0), ' Werktagen gibt es kein neues Tracking-Event.'), jsonb_build_object('business_days_idle', v_business_days_idle)),
        ('pickup_available', case when coalesce(v_business_days_idle, 0) >= 3 then 'urgent' else 'watch' end, 'Paket liegt zur Abholung bereit', 'Die Sendung liegt in Paketshop, Filiale oder Packstation. Kunde sollte rechtzeitig informiert werden.', jsonb_build_object('business_days_idle', v_business_days_idle)),
        ('delivery_failed', 'urgent', 'Zustellung fehlgeschlagen', coalesce(v_event.carrier_status_text, 'Der Versanddienstleister meldet eine fehlgeschlagene Zustellung.'), null::jsonb),
        ('return_to_sender', 'urgent', 'Sendung kommt zurueck', 'Der Carrier meldet eine Ruecksendung an den Absender. Kunde und interne Klaerung erforderlich.', null::jsonb),
        ('returned', 'high', 'Sendung wurde zurueckgesendet', 'Die Sendung ist als Ruecklaeufer markiert. Ursache und weiteres Vorgehen klaeren.', null::jsonb)
    ) as candidate(incident_type, severity, title, description, metadata)
    where
      (candidate.incident_type = 'tracking_missing' and v_shipment.status = 'tracking_missing')
      or (candidate.incident_type = 'carrier_not_found' and v_shipment.status = 'carrier_not_found')
      or (candidate.incident_type = 'label_created_no_scan' and v_shipment.status = 'label_created' and coalesce(v_business_days_idle, 0) >= 2)
      or (candidate.incident_type = 'stale_in_transit' and v_shipment.status in ('in_transit', 'out_for_delivery') and coalesce(v_business_days_idle, 0) >= 3)
      or (candidate.incident_type = 'pickup_available' and v_shipment.status = 'pickup_available')
      or (candidate.incident_type = 'delivery_failed' and v_shipment.status = 'delivery_failed')
      or (candidate.incident_type = 'return_to_sender' and v_shipment.status = 'returning')
      or (candidate.incident_type = 'returned' and v_shipment.status = 'returned')
  loop
    v_has_urgent := v_has_urgent or v_candidate.severity = 'urgent';
    v_has_high := v_has_high or v_candidate.severity = 'high';
    v_has_watch := v_has_watch or v_candidate.severity = 'watch';

    insert into public.shipping_incidents (
      shipment_id,
      request_id,
      incident_key,
      incident_type,
      severity,
      status,
      title,
      description,
      last_detected_at,
      rule_version,
      source_event_id,
      metadata,
      updated_at
    )
    values (
      p_shipment_id,
      v_shipment.request_id,
      p_shipment_id::text || ':' || v_candidate.incident_type,
      v_candidate.incident_type,
      v_candidate.severity,
      'open',
      v_candidate.title,
      v_candidate.description,
      p_now,
      'shipping_rules_v1_20260605',
      v_event.id,
      coalesce(v_candidate.metadata, '{}'::jsonb),
      p_now
    )
    on conflict (incident_key) do update
      set severity = excluded.severity,
          status = case
            when public.shipping_incidents.status in ('resolved', 'ignored') then public.shipping_incidents.status
            else excluded.status
          end,
          title = excluded.title,
          description = excluded.description,
          last_detected_at = excluded.last_detected_at,
          source_event_id = excluded.source_event_id,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
    returning
      public.shipping_incidents.id,
      public.shipping_incidents.incident_type,
      public.shipping_incidents.severity,
      public.shipping_incidents.status
    into incident_id, incident_type, severity, status;

    return next;
  end loop;

  update public.shipping_shipments
  set risk_level = public.shipping_risk_level(v_shipment.status, v_has_urgent, v_has_high, v_has_watch),
      updated_at = p_now
  where id = p_shipment_id;
end;
$$;

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
    'carrier_status_mapping_v1_20260605',
    coalesce(v_event_payload -> 'rawEvent', v_event_payload -> 'raw_event', '{}'::jsonb)
  )
  on conflict (event_key) do update
    set raw_event = excluded.raw_event,
        carrier_status_text = coalesce(excluded.carrier_status_text, public.shipping_tracking_events.carrier_status_text)
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

revoke all on function public.shipping_normalize_carrier(text) from public, anon, authenticated;
revoke all on function public.shipping_normalize_status(text, text, text) from public, anon, authenticated;
revoke all on function public.shipping_business_days_between(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_risk_level(text, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.shipping_evaluate_shipment(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_record_tracking_event(jsonb) from public, anon, authenticated;

grant execute on function public.shipping_normalize_carrier(text) to service_role;
grant execute on function public.shipping_normalize_status(text, text, text) to service_role;
grant execute on function public.shipping_business_days_between(timestamptz, timestamptz) to service_role;
grant execute on function public.shipping_risk_level(text, boolean, boolean, boolean) to service_role;
grant execute on function public.shipping_evaluate_shipment(uuid, timestamptz) to service_role;
grant execute on function public.shipping_record_tracking_event(jsonb) to service_role;
