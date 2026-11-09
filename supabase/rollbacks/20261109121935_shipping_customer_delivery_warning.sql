CREATE OR REPLACE FUNCTION public.shipping_claim_pending_notifications(p_limit integer DEFAULT 20, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(notification_id uuid, notification_key text, kind text, recipient_type text, recipient_email text, attempts integer, shipment_id uuid, incident_id uuid, shipment_key text, shopify_order_number text, request_id text, customer_name text, customer_email text, carrier text, tracking_number text, tracking_url text, status text, incident_type text, incident_title text, incident_description text, incident_severity text, latest_event_time timestamp with time zone, latest_event_location text, latest_event_status_text text)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  with candidates as (
    select n.id
    from public.shipping_notifications n
    where n.channel = 'outlook_email'
      and n.kind <> 'customer_installation_documents'
      -- Never let the restored internal template consume customer-addressed rows.
      and (n.kind <> 'internal_delivery_problem' or n.recipient_type = 'internal')
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
$function$;

CREATE OR REPLACE FUNCTION public.shipping_enqueue_notifications(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(notification_id uuid, notification_key text, kind text, status text)
 LANGUAGE plpgsql
AS $function$
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
      and public.shipping_is_recent_shipment(s.shipped_at, coalesce(e.event_time, s.last_event_at), s.created_at, s.updated_at, p_now)
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
      and public.shipping_is_recent_shipment(s.shipped_at, coalesce(e.event_time, s.last_event_at), s.created_at, s.updated_at, p_now)
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
    and public.shipping_is_recent_shipment(s.shipped_at, coalesce(e.event_time, s.last_event_at), s.created_at, s.updated_at, p_now)
  on conflict on constraint shipping_notifications_notification_key_key do nothing;

  return query
  select n.id, n.notification_key, n.kind, n.status
  from public.shipping_notifications n
  where n.created_at >= p_now - interval '5 minutes'
  order by n.created_at desc;
end;
$function$;

revoke all on function public.shipping_enqueue_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_enqueue_notifications(timestamptz) to service_role;
revoke all on function public.shipping_claim_pending_notifications(integer,timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_pending_notifications(integer,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.shipping_claim_notification_monitor_alert(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(alert_key text, recipient_email text, subject text, body_html text, issue_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_previous jsonb := '{}'::jsonb;
  v_current jsonb := '{}'::jsonb;
  v_due jsonb := '[]'::jsonb;
  v_item record;
  v_fingerprint text;
  v_before jsonb;
  v_last_claim timestamptz;
  v_key text;
  v_html text := '';
  v_class text;
  v_count integer := 0;
  v_summary text := '';
  v_action text;
  v_order text;
  v_subject text;
begin
  if p_now is null then raise exception 'monitor timestamp required'; end if;
  -- Serialize overlapping schedule/API calls before reading the existing audit state.
  perform pg_advisory_xact_lock(hashtextextended('shipping_notification_monitor:v2', 0));
  select coalesce(a.metadata->'issues', '{}'::jsonb) into v_previous
    from public.shipping_audit_log a
    where a.idempotency_key = 'shipping_notification_monitor:state:v2';
  v_previous := coalesce(v_previous, '{}'::jsonb);

  for v_item in
    select n.id, n.status, n.kind, n.attempts, n.last_error, n.updated_at,
      s.shopify_order_number,
      ((n.status = 'sending' and coalesce(n.claimed_at, n.updated_at) <= p_now - interval '45 minutes')
        or (n.status = 'pending' and n.updated_at <= p_now - interval '2 hours')
        or (n.status = 'failed' and n.attempts >= 3)) as eligible,
      (n.kind = 'customer_installation_documents' and n.status = 'pending' and n.attempts = 0
        and nullif(n.metadata->>'review_reason', '') is not null) as needs_review
    from public.shipping_notifications n
    join public.shipping_shipments s on s.id = n.shipment_id
    left join public.shipping_incidents i on i.id = n.incident_id
    where n.channel = 'outlook_email'
      and n.status in ('pending','sending','failed')
      -- Only obsolete, NEVER attempted incident notices may disappear. Uncertain sends
      -- and missing installation documents remain actionable even after parcel delivery.
      and not (n.status = 'pending' and n.attempts = 0 and n.kind <> 'customer_installation_documents'
        and ((i.id is not null and i.status in ('resolved','ignored'))
          or (n.kind = 'customer_pickup_available' and s.status in ('delivered','returned','closed'))))
    order by case n.status when 'failed' then 1 when 'sending' then 2 else 3 end, n.updated_at, n.id
  loop
    v_before := v_previous->v_item.id::text;
    -- A refreshed poll timestamp is not recovery. Retain the previous claim while
    -- this still-open record temporarily falls below the age/attempt threshold.
    if not v_item.eligible then
      if v_before is not null then
        v_current := v_current || jsonb_build_object(v_item.id::text, v_before);
      end if;
      continue;
    end if;
    v_class := case when v_item.needs_review then 'Manuelle Freigabe erforderlich'
      when v_item.status = 'sending' then 'Versandergebnis unklar'
      when v_item.status = 'failed' then 'Versand fehlgeschlagen'
      else 'Verarbeitung ausstehend' end;
    -- Poll timestamps and retry counters do not define a new problem.
    v_fingerprint := md5(jsonb_build_array(v_item.status, v_item.kind, v_class, coalesce(v_item.last_error,''))::text);
    v_last_claim := (v_before->>'last_claim_at')::timestamptz;
    if (v_before is null or v_before->>'fingerprint' is distinct from v_fingerprint
        or v_last_claim is null)
        and v_count < 20 then
      v_count := v_count + 1;
      v_order := replace(replace(replace(coalesce(v_item.shopify_order_number, 'ohne Auftragsnummer'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
      if v_item.needs_review then
        v_subject := 'Montageanleitung prüfen';
        v_action := case
          when 'unknown_product' = any(string_to_array(v_item.last_error, ', ')) then
            'Die automatische Auswahl konnte eine Bestellposition keiner Anleitung zuordnen. Bitte die gelieferten Artikel prüfen und die passenden Unterlagen auswählen.'
          when v_item.last_error like '%backlit_manual_not_cleared%' then
            'Für die rückbeleuchteten Buchstaben fehlt eine freigegebene Anleitung. Bitte die passende Anleitung fachlich prüfen.'
          when v_item.last_error like '%recipient_invalid%' then
            'Bitte die E-Mail-Adresse im Auftrag prüfen, bevor die Montageunterlagen versendet werden.'
          else 'Bitte die Ausführung und das Montagezubehör im Auftrag prüfen und die passenden Unterlagen auswählen.' end;
        v_action := 'Die Montageanleitung wartet auf Prüfung. ' || v_action || ' Bisher gab es keinen automatischen Sendeversuch.';
      else
        v_subject := case v_item.status when 'sending' then 'E-Mail-Versand prüfen' when 'failed' then 'E-Mail-Versand fehlgeschlagen' else 'Ausstehende E-Mail prüfen' end;
        v_action := case v_item.status when 'sending' then 'Für die E-Mail fehlt die Versandbestätigung. Bitte zuerst in Outlook unter „Gesendet“ nachsehen, damit niemand sie doppelt erhält.'
          when 'failed' then 'Der E-Mail-Versand meldet einen Fehler. Bitte den letzten Versuch und den Ordner „Gesendet“ prüfen.'
          else 'Die vorgesehene E-Mail wartet seit mindestens zwei Stunden. Bitte im Versandboard prüfen, was den Versand aufhält.' end;
      end if;
      v_subject := coalesce(v_item.shopify_order_number, 'Auftrag') || ' – ' || v_subject;
      v_summary := v_summary || '<p><strong>Auftrag ' || v_order || '</strong><br>' || v_action || '</p>';
      v_last_claim := p_now;
      v_due := v_due || jsonb_build_array(jsonb_build_object('id',v_item.id,'fingerprint',v_fingerprint));
      -- Escape all variable content before embedding in the internal digest.
      v_html := v_html || '<tr><td>' ||
        replace(replace(replace(replace(coalesce(v_item.shopify_order_number,'-'),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') ||
        '</td><td>' || v_class || '</td><td>' ||
        replace(replace(replace(replace(v_item.kind,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') ||
        '</td><td>' || v_item.attempts::text || '</td><td>' ||
        replace(replace(replace(replace(left(coalesce(v_item.last_error,'-'),300),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') || '</td></tr>';
      v_current := v_current || jsonb_build_object(v_item.id::text,
        jsonb_build_object('fingerprint',v_fingerprint,'last_claim_at',v_last_claim));
    else
      -- Preserve the previous fingerprint for deferred rows so the next poll still emits them.
      v_current := v_current || jsonb_build_object(v_item.id::text, coalesce(v_before,'{}'::jsonb));
    end if;
  end loop;

  insert into public.shipping_audit_log(action,status,idempotency_key,actor,metadata,created_at)
    values ('shipping_notification_monitor_observed','success','shipping_notification_monitor:state:v2',
      '{"system":"shipping-agent"}',jsonb_build_object('issues',v_current,'observed_at',p_now),p_now)
    on conflict (idempotency_key) do update set metadata=excluded.metadata;
  if v_count = 0 then return; end if;

  v_key := 'shipping_notification_monitor:v2:' || md5(p_now::text || v_due::text);
  insert into public.shipping_audit_log(action,status,idempotency_key,actor,metadata,created_at)
    values ('shipping_notification_monitor_claim','success',v_key,'{"system":"shipping-agent"}',
      jsonb_build_object('issue_count',v_count,'issues',v_due,'delivery_confirmed',false,
        'meaning','claim_only_not_outlook_delivery'),p_now);
  return query select v_key,'support@neontrip.de'::text,
    case when v_count = 1 then v_subject
         else 'Versand prüfen – ' || v_count::text || ' Aufträge oder Meldungen' end,
    v_summary || '<p><a href="https://ops.neontrip.de/ops/customer-records/shipping">Vorgang im Versandboard prüfen</a></p>' ||
      '<p><strong>Technische Details</strong></p><table cellpadding="6" cellspacing="0" border="1"><tr><th>Auftrag</th><th>Prüfgrund</th><th>Typ</th><th>Sendeversuche</th><th>Details</th></tr>' ||
      v_html || '</table>', v_count;
end;
$function$;

revoke all on function public.shipping_claim_notification_monitor_alert(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_notification_monitor_alert(timestamptz) to service_role;
