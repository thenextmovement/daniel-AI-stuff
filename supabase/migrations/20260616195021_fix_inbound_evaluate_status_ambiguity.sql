create or replace function public.inbound_evaluate_shipment(p_shipment_id uuid, p_now timestamptz default now())
returns table (
  incident_id uuid,
  incident_key text,
  incident_type text,
  severity text,
  status text
)
language plpgsql
security invoker
as $$
declare
  v_shipment public.inbound_shipments%rowtype;
  v_latest public.inbound_tracking_events%rowtype;
  v_hours_since_tracking numeric;
  v_hours_since_movement numeric;
  v_candidates jsonb := '[]'::jsonb;
  v_candidate jsonb;
begin
  select * into v_shipment from public.inbound_shipments where id = p_shipment_id;
  if v_shipment.id is null then
    return;
  end if;

  select * into v_latest
  from public.inbound_tracking_events
  where shipment_id = p_shipment_id
  order by event_time desc
  limit 1;

  v_hours_since_tracking := extract(epoch from (p_now - coalesce(v_shipment.tracking_first_seen_at, v_shipment.first_seen_at))) / 3600;
  v_hours_since_movement := extract(epoch from (p_now - coalesce(v_shipment.last_movement_at, v_shipment.last_event_at, v_shipment.tracking_first_seen_at, v_shipment.first_seen_at))) / 3600;

  if v_shipment.status = 'clearance_action_required' then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', 'clearance_action_required',
      'severity', 'urgent',
      'title', 'Clearance Event: Aktion erforderlich',
      'description', coalesce(v_latest.carrier_status_text, 'Der Carrier meldet einen Zoll-/Clearance-Vorgang mit Handlungsbedarf.')
    ));
  elsif v_shipment.status = 'clearance_in_progress' then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', 'clearance_watch',
      'severity', case when v_hours_since_movement >= 24 then 'high' else 'watch' end,
      'title', 'Zollvorgang beobachten',
      'description', coalesce(v_latest.carrier_status_text, 'Die Sendung befindet sich im Clearance-Prozess.')
    ));
  end if;

  if v_shipment.status = 'out_for_delivery' then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', 'out_for_delivery',
      'severity', 'high',
      'title', 'Inbound-Sendung ist in Zustellung',
      'description', 'Die Sendung ist out for delivery. Unterlagen/Trackingnummer vorbereiten.'
    ));
  end if;

  if v_shipment.status in ('tracking_created', 'label_created', 'carrier_not_found') and v_hours_since_tracking >= 72 then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', case when v_shipment.status = 'carrier_not_found' then 'carrier_not_found' else 'not_tendered' end,
      'severity', 'high',
      'title', 'Trackingnummer seit 72h ohne echte Übergabe',
      'description', 'Die Trackingnummer ist seit mindestens 72 Stunden bekannt, aber es gibt keine belastbare Paketbewegung.'
    ));
  end if;

  if v_shipment.status in ('in_transit', 'tendered') and v_hours_since_movement >= 72 then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', 'stale_no_movement',
      'severity', 'high',
      'title', 'Inbound-Sendung bewegt sich nicht',
      'description', 'Seit mindestens 72 Stunden gibt es kein neues Tracking-Event.'
    ));
  end if;

  if v_shipment.status = 'exception' then
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'type', 'carrier_exception',
      'severity', 'urgent',
      'title', 'Carrier meldet Ausnahme',
      'description', coalesce(v_latest.carrier_status_text, 'Der Carrier meldet eine Ausnahme oder Verzögerung.')
    ));
  end if;

  for v_candidate in select * from jsonb_array_elements(v_candidates)
  loop
    insert into public.inbound_incidents as target (
      shipment_id,
      incident_key,
      incident_type,
      severity,
      status,
      title,
      description,
      first_detected_at,
      last_detected_at,
      rule_version,
      source_event_id,
      metadata,
      updated_at
    )
    values (
      p_shipment_id,
      'inbound:' || p_shipment_id::text || ':' || (v_candidate ->> 'type'),
      v_candidate ->> 'type',
      v_candidate ->> 'severity',
      'open',
      v_candidate ->> 'title',
      v_candidate ->> 'description',
      p_now,
      p_now,
      'inbound_shipping_rules_v1_20260605',
      v_latest.id,
      jsonb_build_object('hours_since_tracking', v_hours_since_tracking, 'hours_since_movement', v_hours_since_movement),
      p_now
    )
    on conflict on constraint inbound_incidents_incident_key_key do update
      set severity = excluded.severity,
          status = case when target.status in ('resolved', 'ignored') then target.status else target.status end,
          title = excluded.title,
          description = excluded.description,
          last_detected_at = excluded.last_detected_at,
          source_event_id = excluded.source_event_id,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
    returning target.id, target.incident_key, target.incident_type, target.severity, target.status
    into incident_id, incident_key, incident_type, severity, status;
    return next;
  end loop;

  if v_shipment.status = 'delivered' then
    update public.inbound_incidents as i
    set status = 'resolved',
        resolved_at = coalesce(i.resolved_at, p_now),
        updated_at = p_now
    where i.shipment_id = p_shipment_id
      and i.status in ('open', 'acknowledged');
  end if;
end;
$$;
