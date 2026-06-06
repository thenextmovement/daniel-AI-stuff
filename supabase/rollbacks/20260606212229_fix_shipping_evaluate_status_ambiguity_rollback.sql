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

  if not public.shipping_is_recent_shipment(v_shipment.shipped_at, coalesce(v_event.event_time, v_shipment.last_event_at), v_shipment.created_at, v_shipment.updated_at, p_now) then
    update public.shipping_shipments
    set risk_level = case when status in ('delivered', 'closed') then 'closed' else 'normal' end,
        updated_at = p_now
    where id = p_shipment_id;

    return;
  end if;

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

revoke all on function public.shipping_evaluate_shipment(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_evaluate_shipment(uuid, timestamptz) to service_role;
