create table if not exists public.inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_key text not null unique,
  source text not null default 'trello',
  trello_card_id text null,
  trello_card_name text null,
  trello_card_url text null,
  trello_list_id text null,
  trello_list_name text null,
  carrier text not null default 'unknown',
  tracking_number text not null,
  tracking_raw text null,
  status text not null default 'tracking_created',
  status_reason text null,
  risk_level text not null default 'watch',
  first_seen_at timestamptz not null default now(),
  tracking_first_seen_at timestamptz not null default now(),
  tendered_at timestamptz null,
  last_event_at timestamptz null,
  last_movement_at timestamptz null,
  last_checked_at timestamptz null,
  next_check_at timestamptz null,
  delivered_at timestamptz null,
  carrier_last_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_shipments_carrier_check check (carrier in ('dhl', 'fedex', 'other', 'unknown')),
  constraint inbound_shipments_status_check check (
    status in (
      'tracking_created',
      'carrier_not_found',
      'label_created',
      'tendered',
      'in_transit',
      'clearance_in_progress',
      'clearance_action_required',
      'out_for_delivery',
      'delivered',
      'exception',
      'stale',
      'closed'
    )
  ),
  constraint inbound_shipments_risk_level_check check (risk_level in ('low', 'normal', 'watch', 'high', 'urgent', 'closed')),
  constraint inbound_shipments_tracking_unique unique (carrier, tracking_number)
);

create table if not exists public.inbound_tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inbound_shipments(id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  carrier_event_id text null,
  event_key text not null unique,
  carrier_status_code text null,
  carrier_status_text text null,
  event_time timestamptz not null,
  event_location text null,
  normalized_status text not null,
  mapping_version text not null,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inbound_tracking_events_carrier_check check (carrier in ('dhl', 'fedex', 'other', 'unknown')),
  constraint inbound_tracking_events_status_check check (
    normalized_status in (
      'tracking_created',
      'carrier_not_found',
      'label_created',
      'tendered',
      'in_transit',
      'clearance_in_progress',
      'clearance_action_required',
      'out_for_delivery',
      'delivered',
      'exception',
      'stale',
      'closed'
    )
  )
);

create table if not exists public.inbound_incidents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inbound_shipments(id) on delete cascade,
  incident_key text not null unique,
  incident_type text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  description text null,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  rule_version text not null,
  source_event_id uuid null references public.inbound_tracking_events(id) on delete set null,
  active_task_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_incidents_type_check check (
    incident_type in (
      'clearance_action_required',
      'clearance_watch',
      'out_for_delivery',
      'not_tendered',
      'stale_no_movement',
      'carrier_exception',
      'carrier_not_found',
      'tracking_error'
    )
  ),
  constraint inbound_incidents_severity_check check (severity in ('watch', 'high', 'urgent')),
  constraint inbound_incidents_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored'))
);

create table if not exists public.inbound_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_key text not null unique,
  shipment_id uuid not null references public.inbound_shipments(id) on delete cascade,
  incident_id uuid null references public.inbound_incidents(id) on delete set null,
  kind text not null default 'internal_inbound_shipping_alert',
  recipient_type text not null default 'internal',
  channel text not null default 'outlook_email',
  status text not null default 'pending',
  recipient_email text not null default 'info@neontrip.de',
  subject text not null,
  body_html text not null,
  attempts integer not null default 0,
  claimed_at timestamptz null,
  sent_at timestamptz null,
  failed_at timestamptz null,
  provider_message_id text null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_notifications_kind_check check (kind in ('internal_inbound_shipping_alert')),
  constraint inbound_notifications_recipient_type_check check (recipient_type in ('internal')),
  constraint inbound_notifications_channel_check check (channel in ('outlook_email')),
  constraint inbound_notifications_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'))
);

create index if not exists inbound_shipments_status_idx on public.inbound_shipments(status, risk_level, updated_at desc);
create index if not exists inbound_shipments_trello_idx on public.inbound_shipments(trello_card_id, updated_at desc);
create index if not exists inbound_shipments_next_check_idx on public.inbound_shipments(next_check_at, status);
create index if not exists inbound_tracking_events_shipment_time_idx on public.inbound_tracking_events(shipment_id, event_time desc);
create index if not exists inbound_incidents_shipment_idx on public.inbound_incidents(shipment_id, updated_at desc);
create index if not exists inbound_incidents_status_severity_idx on public.inbound_incidents(status, severity, last_detected_at desc);
create index if not exists inbound_notifications_shipment_idx on public.inbound_notifications(shipment_id, updated_at desc);
create index if not exists inbound_notifications_incident_idx on public.inbound_notifications(incident_id, updated_at desc);
create index if not exists inbound_notifications_status_idx on public.inbound_notifications(status, updated_at);

alter table public.inbound_shipments enable row level security;
alter table public.inbound_tracking_events enable row level security;
alter table public.inbound_incidents enable row level security;
alter table public.inbound_notifications enable row level security;

create or replace function public.inbound_normalize_carrier(p_value text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_value, '') ~* 'dhl' then 'dhl'
    when coalesce(p_value, '') ~* 'fed\s*ex|fedex|fx' then 'fedex'
    when btrim(coalesce(p_value, '')) = '' then 'unknown'
    else 'other'
  end;
$$;

create or replace function public.inbound_parse_tracking_value(p_value text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_raw text := btrim(coalesce(p_value, ''));
  v_carrier text := public.inbound_normalize_carrier(p_value);
  v_tracking text;
begin
  if v_raw = '' then
    return jsonb_build_object('valid', false, 'carrier', 'unknown', 'tracking_number', null, 'raw', v_raw);
  end if;

  v_tracking := regexp_replace(v_raw, '^(dhl\s*(express)?|fed\s*ex|fedex|fx)\s*[:#-]?\s*', '', 'i');
  v_tracking := upper(regexp_replace(v_tracking, '[^A-Z0-9]', '', 'g'));

  if length(v_tracking) < 6 then
    return jsonb_build_object('valid', false, 'carrier', v_carrier, 'tracking_number', null, 'raw', v_raw);
  end if;

  return jsonb_build_object('valid', true, 'carrier', v_carrier, 'tracking_number', v_tracking, 'raw', v_raw);
end;
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
  if v_code in ('OD') or v_text ~ 'out for delivery|with courier|in zustellung|wird zugestellt' then
    return 'out_for_delivery';
  end if;
  if v_code in ('CD') or v_text ~ 'clearance delay|additional information required|customs.*required|clearance.*required|zoll.*information|zoll.*erforder' then
    return 'clearance_action_required';
  end if;
  if v_code in ('CP') or v_text ~ 'clearance event|clearance in progress|customs clearance|processed for clearance|zoll|verzoll' then
    return 'clearance_in_progress';
  end if;
  if v_code in ('DE', 'DD', 'SE') or v_text ~ 'exception|delay|delayed|on hold|shipment is on hold|problem|failed' then
    return 'exception';
  end if;
  if v_code in ('OC') or v_text ~ 'shipment information sent|label created|label generated|sendungsdaten|daten.*uebermittelt|daten.*übermittelt' then
    return 'label_created';
  end if;
  if v_code in ('PU', 'IP') or v_text ~ 'picked up|in fedex possession|accepted|received by carrier|shipment picked up|abgeholt|uebernommen|übernommen' then
    return 'tendered';
  end if;
  if v_code in ('IT', 'DP', 'AF', 'AR', 'TR', 'CC', 'PM') or v_text ~ 'in transit|on the way|arrived|departed|facility|hub|sort|transport|unterwegs|processed' then
    return 'in_transit';
  end if;
  if v_text ~ 'not found|no tracking|unknown shipment|keine sendung|nicht gefunden' then
    return 'carrier_not_found';
  end if;
  return 'in_transit';
end;
$$;

create or replace function public.inbound_risk_level(p_status text)
returns text
language sql
immutable
as $$
  select case
    when p_status in ('delivered', 'closed') then 'closed'
    when p_status in ('clearance_action_required', 'exception') then 'urgent'
    when p_status in ('out_for_delivery', 'carrier_not_found', 'stale') then 'high'
    when p_status in ('tracking_created', 'label_created', 'clearance_in_progress') then 'watch'
    else 'normal'
  end;
$$;

create or replace function public.inbound_record_trello_candidates(p_payload jsonb, p_now timestamptz default now())
returns table (
  shipment_id uuid,
  shipment_key text,
  carrier text,
  tracking_number text,
  status text
)
language plpgsql
security invoker
as $$
declare
  v_item jsonb;
  v_parsed jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'shipments', '[]'::jsonb))
  loop
    v_parsed := public.inbound_parse_tracking_value(v_item ->> 'trackingRaw');
    if coalesce((v_parsed ->> 'valid')::boolean, false) then
      insert into public.inbound_shipments as target (
        shipment_key,
        source,
        trello_card_id,
        trello_card_name,
        trello_card_url,
        trello_list_id,
        trello_list_name,
        carrier,
        tracking_number,
        tracking_raw,
        status,
        risk_level,
        first_seen_at,
        tracking_first_seen_at,
        next_check_at,
        metadata,
        updated_at
      )
      values (
        'trello:' || nullif(v_item ->> 'trelloCardId', '') || ':' || (v_parsed ->> 'carrier') || ':' || (v_parsed ->> 'tracking_number'),
        'trello',
        nullif(v_item ->> 'trelloCardId', ''),
        nullif(v_item ->> 'trelloCardName', ''),
        nullif(v_item ->> 'trelloCardUrl', ''),
        nullif(v_item ->> 'trelloListId', ''),
        nullif(v_item ->> 'trelloListName', ''),
        v_parsed ->> 'carrier',
        v_parsed ->> 'tracking_number',
        v_parsed ->> 'raw',
        'tracking_created',
        'watch',
        p_now,
        p_now,
        p_now,
        jsonb_build_object('source', 'trello_discovery', 'tracking_field_name', coalesce(v_item ->> 'trackingFieldName', 'Tracking number')),
        p_now
      )
      on conflict on constraint inbound_shipments_tracking_unique do update
        set trello_card_id = coalesce(excluded.trello_card_id, target.trello_card_id),
            trello_card_name = coalesce(excluded.trello_card_name, target.trello_card_name),
            trello_card_url = coalesce(excluded.trello_card_url, target.trello_card_url),
            trello_list_id = coalesce(excluded.trello_list_id, target.trello_list_id),
            trello_list_name = coalesce(excluded.trello_list_name, target.trello_list_name),
            tracking_raw = excluded.tracking_raw,
            next_check_at = least(coalesce(target.next_check_at, p_now), p_now),
            metadata = target.metadata || excluded.metadata,
            updated_at = p_now
      returning target.id, target.shipment_key, target.carrier, target.tracking_number, target.status
      into shipment_id, shipment_key, carrier, tracking_number, status;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.inbound_claim_due_tracking_shipments(p_limit integer default 20, p_now timestamptz default now())
returns table (
  shipment_id uuid,
  shipment_key text,
  carrier text,
  tracking_number text,
  tracking_raw text,
  trello_card_id text,
  trello_card_name text,
  trello_card_url text,
  status text
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select s.id
    from public.inbound_shipments s
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and (s.next_check_at is null or s.next_check_at <= p_now)
    order by coalesce(s.next_check_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), claimed as (
    update public.inbound_shipments s
    set next_check_at = p_now + interval '1 hour',
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select
    c.id,
    c.shipment_key,
    c.carrier,
    c.tracking_number,
    c.tracking_raw,
    c.trello_card_id,
    c.trello_card_name,
    c.trello_card_url,
    c.status
  from claimed c;
end;
$$;

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

create or replace function public.inbound_record_carrier_response(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.inbound_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_events jsonb := coalesce(p_payload -> 'events', '[]'::jsonb);
  v_event jsonb;
  v_event_time timestamptz;
  v_status text;
  v_event_key text;
  v_event_id uuid;
  v_latest_status text := 'carrier_not_found';
  v_latest_event_at timestamptz := null;
  v_latest_movement_at timestamptz := null;
  v_event_count integer := 0;
begin
  if v_shipment_id is null then
    select id into v_shipment_id
    from public.inbound_shipments
    where carrier = v_carrier and tracking_number = v_tracking_number
    limit 1;
  end if;

  if v_shipment_id is null then
    raise exception 'inbound shipment not found' using errcode = '22023';
  end if;

  if jsonb_array_length(v_events) = 0 then
    update public.inbound_shipments
    set status = case when status in ('tracking_created', 'label_created') then 'carrier_not_found' else status end,
        risk_level = public.inbound_risk_level(case when status in ('tracking_created', 'label_created') then 'carrier_not_found' else status end),
        last_checked_at = p_now,
        carrier_last_response = coalesce(p_payload -> 'rawResponse', '{}'::jsonb),
        updated_at = p_now
    where id = v_shipment_id;

    perform public.inbound_evaluate_shipment(v_shipment_id, p_now);
    return jsonb_build_object('shipment_id', v_shipment_id, 'event_count', 0, 'status', 'carrier_not_found');
  end if;

  for v_event in select * from jsonb_array_elements(v_events)
  loop
    v_event_time := coalesce(nullif(v_event ->> 'eventTime', ''), p_now::text)::timestamptz;
    v_status := public.inbound_normalize_status(v_carrier, v_event ->> 'statusCode', v_event ->> 'statusText');
    v_event_key := coalesce(
      nullif(v_event ->> 'eventKey', ''),
      concat_ws(
        ':',
        'inbound',
        v_carrier,
        lower(v_tracking_number),
        coalesce(nullif(v_event ->> 'carrierEventId', ''), nullif(v_event ->> 'statusCode', ''), 'status'),
        to_char(v_event_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        left(lower(coalesce(v_event ->> 'statusText', '')), 80)
      )
    );

    insert into public.inbound_tracking_events (
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
      v_shipment_id,
      v_carrier,
      v_tracking_number,
      nullif(v_event ->> 'carrierEventId', ''),
      v_event_key,
      nullif(v_event ->> 'statusCode', ''),
      nullif(v_event ->> 'statusText', ''),
      v_event_time,
      nullif(v_event ->> 'eventLocation', ''),
      v_status,
      'inbound_carrier_mapping_v1_20260605',
      coalesce(v_event -> 'rawEvent', v_event)
    )
    on conflict (event_key) do update
      set carrier_status_text = coalesce(excluded.carrier_status_text, public.inbound_tracking_events.carrier_status_text),
          normalized_status = excluded.normalized_status,
          mapping_version = excluded.mapping_version,
          raw_event = excluded.raw_event
    returning id into v_event_id;

    v_event_count := v_event_count + 1;
    if v_latest_event_at is null or v_event_time >= v_latest_event_at then
      v_latest_event_at := v_event_time;
      v_latest_status := v_status;
    end if;
    if v_status in ('tendered', 'in_transit', 'clearance_in_progress', 'clearance_action_required', 'out_for_delivery', 'exception', 'delivered') then
      if v_latest_movement_at is null or v_event_time >= v_latest_movement_at then
        v_latest_movement_at := v_event_time;
      end if;
    end if;
  end loop;

  update public.inbound_shipments
  set status = v_latest_status,
      risk_level = public.inbound_risk_level(v_latest_status),
      tendered_at = case when tendered_at is null and v_latest_movement_at is not null then v_latest_movement_at else tendered_at end,
      last_event_at = greatest(coalesce(last_event_at, v_latest_event_at), v_latest_event_at),
      last_movement_at = greatest(coalesce(last_movement_at, v_latest_movement_at), coalesce(v_latest_movement_at, last_movement_at)),
      delivered_at = case when v_latest_status = 'delivered' then coalesce(delivered_at, v_latest_event_at) else delivered_at end,
      last_checked_at = p_now,
      carrier_last_response = coalesce(p_payload -> 'rawResponse', '{}'::jsonb),
      updated_at = p_now
  where id = v_shipment_id;

  perform public.inbound_evaluate_shipment(v_shipment_id, p_now);
  return jsonb_build_object('shipment_id', v_shipment_id, 'event_count', v_event_count, 'status', v_latest_status);
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

create or replace function public.inbound_claim_pending_notifications(p_limit integer default 20, p_now timestamptz default now())
returns table (
  notification_id uuid,
  notification_key text,
  recipient_email text,
  subject text,
  body_html text,
  attempts integer
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select n.id
    from public.inbound_notifications n
    where n.channel = 'outlook_email'
      and (
        n.status = 'pending'
        or (n.status = 'failed' and n.attempts < 3 and n.updated_at <= p_now - interval '15 minutes')
        or (n.status = 'sending' and n.claimed_at <= p_now - interval '30 minutes')
      )
    order by n.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), claimed as (
    update public.inbound_notifications n
    set status = 'sending',
        attempts = n.attempts + 1,
        claimed_at = p_now,
        updated_at = p_now
    from candidates c
    where n.id = c.id
    returning n.*
  )
  select c.id, c.notification_key, c.recipient_email, c.subject, c.body_html, c.attempts
  from claimed c;
end;
$$;

create or replace function public.inbound_mark_notification_sent(
  p_notification_id uuid,
  p_provider_message_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns table (
  notification_id uuid,
  notification_key text,
  status text
)
language plpgsql
security invoker
as $$
begin
  return query
  update public.inbound_notifications n
  set status = 'sent',
      sent_at = p_now,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      metadata = n.metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = p_now
  where n.id = p_notification_id
  returning n.id, n.notification_key, n.status;
end;
$$;

create or replace function public.inbound_mark_notification_failed(
  p_notification_id uuid,
  p_error text,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns table (
  notification_id uuid,
  notification_key text,
  status text
)
language plpgsql
security invoker
as $$
begin
  return query
  update public.inbound_notifications n
  set status = case when n.attempts >= 3 then 'failed' else 'pending' end,
      failed_at = p_now,
      last_error = left(coalesce(p_error, 'unknown'), 1000),
      metadata = n.metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = p_now
  where n.id = p_notification_id
  returning n.id, n.notification_key, n.status;
end;
$$;

revoke all on function public.inbound_normalize_carrier(text) from public, anon, authenticated;
revoke all on function public.inbound_parse_tracking_value(text) from public, anon, authenticated;
revoke all on function public.inbound_normalize_status(text, text, text) from public, anon, authenticated;
revoke all on function public.inbound_risk_level(text) from public, anon, authenticated;
revoke all on function public.inbound_record_trello_candidates(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_claim_due_tracking_shipments(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_record_carrier_response(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_evaluate_shipment(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_enqueue_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_claim_pending_notifications(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_mark_notification_sent(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_mark_notification_failed(uuid, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.inbound_normalize_carrier(text) to service_role;
grant execute on function public.inbound_parse_tracking_value(text) to service_role;
grant execute on function public.inbound_normalize_status(text, text, text) to service_role;
grant execute on function public.inbound_risk_level(text) to service_role;
grant execute on function public.inbound_record_trello_candidates(jsonb, timestamptz) to service_role;
grant execute on function public.inbound_claim_due_tracking_shipments(integer, timestamptz) to service_role;
grant execute on function public.inbound_record_carrier_response(jsonb, timestamptz) to service_role;
grant execute on function public.inbound_evaluate_shipment(uuid, timestamptz) to service_role;
grant execute on function public.inbound_enqueue_notifications(timestamptz) to service_role;
grant execute on function public.inbound_claim_pending_notifications(integer, timestamptz) to service_role;
grant execute on function public.inbound_mark_notification_sent(uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.inbound_mark_notification_failed(uuid, text, jsonb, timestamptz) to service_role;
