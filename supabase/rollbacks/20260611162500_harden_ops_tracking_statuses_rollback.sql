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
    when text ~ 'failed|nicht zugestellt|zustellung fehlgeschlagen|empfaenger nicht|empfänger nicht|annahme verweigert|address problem|adressproblem' then 'delivery_failed'
    when text ~ 'returned|retoure abgeschlossen|ruecksendung zugestellt|rücksendung zugestellt|returned to sender' then 'returned'
    when text ~ 'return to sender|returning|retoure|ruecksendung|rücksendung|zurueck an absender|zurück an absender' then 'returning'
    when text ~ 'delivered|zugestellt|erfolgreich zugestellt' then 'delivered'
    when text ~ 'pickup|paketshop|parcelshop|filiale|packstation|abhol' then 'pickup_available'
    when text ~ 'out for delivery|in zustellung|zustellung heute|wird heute zugestellt' then 'out_for_delivery'
    when text ~ 'label|announced|angekuendigt|angekündigt|daten.*uebermittelt|daten.*übermittelt|sendungsdaten' then 'label_created'
    when text ~ 'delay|delayed|verspaetet|verspätet|transit|unterwegs|sort|depot|hub|transport|scan|processed|verarbeitet' then 'in_transit'
    else 'in_transit'
  end
  from input;
$$;

create or replace function public.inbound_normalize_status(p_carrier text, p_status_code text, p_status_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_code text := upper(btrim(coalesce(p_status_code, '')));
  v_text text := lower(coalesce(p_carrier, '') || ' ' || coalesce(p_status_code, '') || ' ' || coalesce(p_status_text, ''));
begin
  if v_code in ('DL') or v_text ~ 'delivered|zugestellt|delivery complete' then
    return 'delivered';
  end if;
  if v_code in ('OD') or v_text ~ 'out for delivery|outfordelivery|with courier|in zustellung|wird zugestellt' then
    return 'out_for_delivery';
  end if;
  if v_code in ('CD') or v_text ~ 'clearance delay|additional information required|customs.*required|clearance.*required|zoll.*information|zoll.*erforder' then
    return 'clearance_action_required';
  end if;
  if v_code in ('CP') or v_text ~ 'clearance event|clearance in progress|customs clearance|processed for clearance|zoll|verzoll' then
    return 'clearance_in_progress';
  end if;
  if v_code in ('DE', 'DD', 'SE') or v_text ~ 'exception|expired|delay|delayed|on hold|shipment is on hold|problem|failed' then
    return 'exception';
  end if;
  if v_code in ('OC') or v_text ~ 'shipment information sent|inforeceived|info received|label created|label generated|sendungsdaten|daten.*uebermittelt|daten.*übermittelt' then
    return 'label_created';
  end if;
  if v_code in ('PU', 'IP') or v_text ~ 'picked up|in fedex possession|accepted|received by carrier|shipment picked up|abgeholt|uebernommen|übernommen' then
    return 'tendered';
  end if;
  if v_code in ('IT', 'DP', 'AF', 'AR', 'TR', 'CC', 'PM') or v_text ~ 'in transit|intransit|on the way|arrived|departed|facility|hub|sort|transport|unterwegs|processed' then
    return 'in_transit';
  end if;
  if v_text ~ 'not found|notfound|no tracking|unknown shipment|keine sendung|nicht gefunden' then
    return 'carrier_not_found';
  end if;
  return 'in_transit';
end;
$$;

revoke all on function public.shipping_normalize_status(text, text, text) from public, anon, authenticated;
revoke all on function public.inbound_normalize_status(text, text, text) from public, anon, authenticated;
grant execute on function public.shipping_normalize_status(text, text, text) to service_role;
grant execute on function public.inbound_normalize_status(text, text, text) to service_role;

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
    update public.inbound_incidents
    set status = 'resolved',
        resolved_at = coalesce(resolved_at, p_now),
        updated_at = p_now
    where shipment_id = p_shipment_id
      and status in ('open', 'acknowledged');
  end if;
end;
$$;

create or replace function public.inbound_enqueue_notifications(p_now timestamptz default now())
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
  with candidates as (
    select
      i.id as incident_id,
      i.incident_type,
      i.severity,
      i.title,
      i.description,
      s.id as shipment_id,
      s.carrier,
      s.tracking_number,
      s.tracking_raw,
      s.trello_card_name,
      s.trello_card_url,
      s.status as shipment_status,
      n.sent_count,
      n.last_sent_at,
      n.open_retry_count
    from public.inbound_incidents i
    join public.inbound_shipments s on s.id = i.shipment_id
    join lateral (
      select
        count(*) filter (where existing.status = 'sent')::integer as sent_count,
        max(existing.sent_at) filter (where existing.status = 'sent') as last_sent_at,
        count(*) filter (
          where existing.status in ('pending', 'sending')
             or (existing.status = 'failed' and existing.attempts < 3)
        )::integer as open_retry_count
      from public.inbound_notifications existing
      where existing.incident_id = i.id
    ) n on true
    where i.status in ('open', 'acknowledged')
      and i.incident_type in ('clearance_action_required', 'out_for_delivery', 'not_tendered', 'stale_no_movement', 'carrier_exception', 'carrier_not_found', 'tracking_error')
      and n.open_retry_count = 0
      and (
        n.sent_count = 0
        or (n.sent_count between 1 and 5 and n.last_sent_at <= p_now - interval '1 day')
      )
  )
  insert into public.inbound_notifications (
    notification_key,
    shipment_id,
    incident_id,
    recipient_email,
    subject,
    body_html,
    metadata,
    updated_at
  )
  select
    'inbound:incident:' || c.incident_id::text || ':' || case when c.sent_count = 0 then 'initial' else 'reminder:' || c.sent_count::text end,
    c.shipment_id,
    c.incident_id,
    'info@neontrip.de',
    case
      when c.incident_type = 'out_for_delivery' then 'Inbound Shipping: Sendung ist in Zustellung'
      when c.incident_type = 'clearance_action_required' then 'Inbound Shipping: Clearance Event braucht Aktion'
      else 'Inbound Shipping: Warnung zu eingehender Sendung'
    end,
    '<p><strong>' || replace(replace(replace(c.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</strong></p>' ||
    '<p>' || replace(replace(replace(coalesce(c.description, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;">' ||
    '<tr><th>Carrier</th><td>' || upper(c.carrier) || '</td></tr>' ||
    '<tr><th>Tracking</th><td>' || replace(replace(replace(c.tracking_number, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</td></tr>' ||
    '<tr><th>Status</th><td>' || replace(replace(replace(c.shipment_status, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</td></tr>' ||
    '<tr><th>Trello</th><td>' || replace(replace(replace(coalesce(c.trello_card_name, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</td></tr>' ||
    '</table>' ||
    case when c.trello_card_url is not null then '<p><a href="' || replace(replace(replace(c.trello_card_url, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '">Trello Card öffnen</a></p>' else '' end ||
    '<p><a href="https://ops.neontrip.de/ops/customer-records/inbound-shipping">Inbound Shipping Board öffnen</a></p>',
    jsonb_build_object('incident_type', c.incident_type, 'severity', c.severity, 'sent_count', c.sent_count),
    p_now
  from candidates c
  on conflict on constraint inbound_notifications_notification_key_key do nothing;

  return query
  select n.id, n.notification_key, n.kind, n.status
  from public.inbound_notifications n
  where n.created_at >= p_now - interval '5 minutes'
  order by n.created_at desc;
end;
$$;

revoke all on function public.inbound_evaluate_shipment(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_enqueue_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_evaluate_shipment(uuid, timestamptz) to service_role;
grant execute on function public.inbound_enqueue_notifications(timestamptz) to service_role;
