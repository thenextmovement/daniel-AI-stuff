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

drop function if exists public.shipping_is_recent_shipment(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz);
