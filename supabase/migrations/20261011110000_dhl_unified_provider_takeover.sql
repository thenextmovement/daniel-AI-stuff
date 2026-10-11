-- NEONTRIP inbound only: successful DHL Unified ingestion owns subsequent tracking.
-- Keep 17TRACK for FedEx and DHL shipments without a validated takeover.
-- CREATE OR REPLACE preserves existing grants; all RPCs remain SECURITY INVOKER.
create or replace function public.inbound_claim_due_17track_registrations(p_limit integer default 20, p_now timestamptz default now())
returns table (
  shipment_id uuid,
  registration_id uuid,
  carrier text,
  tracking_number text,
  trello_card_name text,
  trello_card_url text,
  attempts integer
)
language plpgsql
security invoker
as $$
declare
  v_claim_limit integer;
begin
  perform pg_advisory_xact_lock(170017, 1);
  v_claim_limit := least(
    greatest(1, least(p_limit, 50)),
    public.seventeen_track_daily_registration_capacity(100, p_now)
  );

  if v_claim_limit <= 0 then
    return;
  end if;

  return query
  with candidates as (
    select s.id
    from public.inbound_shipments s
    left join public.inbound_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and (s.carrier <> 'dhl' or s.metadata->>'tracking_provider' is distinct from 'dhl-unified')
      and (
        r.id is null
        or r.status in ('pending', 'failed', 'rejected')
        or (r.status = 'registering' and coalesce(r.last_attempt_at, r.updated_at) <= p_now - interval '30 minutes')
      )
      and coalesce(r.next_attempt_at, p_now) <= p_now
    order by coalesce(r.next_attempt_at, s.created_at), s.updated_at
    limit v_claim_limit
    for update of s skip locked
  ), claimed as (
    insert into public.inbound_tracking_registrations as target (
      shipment_id,
      provider,
      registration_key,
      carrier,
      tracking_number,
      provider_tag,
      status,
      attempts,
      last_attempt_at,
      next_attempt_at,
      updated_at
    )
    select
      s.id,
      '17track',
      '17track:' || s.id::text,
      s.carrier,
      s.tracking_number,
      s.id::text,
      'registering',
      1,
      p_now,
      p_now + interval '30 minutes',
      p_now
    from candidates c
    join public.inbound_shipments s on s.id = c.id
    on conflict on constraint inbound_tracking_registrations_shipment_provider_unique do update
      set status = 'registering',
          carrier = excluded.carrier,
          tracking_number = excluded.tracking_number,
          provider_tag = excluded.provider_tag,
          attempts = target.attempts + 1,
          last_attempt_at = p_now,
          next_attempt_at = p_now + interval '30 minutes',
          updated_at = p_now
    returning target.*
  )
  select
    s.id,
    c.id,
    s.carrier,
    s.tracking_number,
    s.trello_card_name,
    s.trello_card_url,
    c.attempts
  from claimed c
  join public.inbound_shipments s on s.id = c.shipment_id;
end;
$$;

create or replace function public.inbound_claim_due_17track_tracking_shipments(
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns table (
  shipment_id uuid,
  shipment_key text,
  carrier text,
  tracking_number text,
  provider_carrier_id integer,
  provider_tag text,
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
    join public.inbound_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
     and r.status = 'accepted'
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and (s.carrier <> 'dhl' or s.metadata->>'tracking_provider' is distinct from 'dhl-unified')
      and nullif(s.tracking_number, '') is not null
      and (s.next_check_at is null or s.next_check_at <= p_now)
    order by coalesce(s.next_check_at, r.first_registered_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update of s skip locked
  ), claimed as (
    update public.inbound_shipments s
    set next_check_at = p_now + interval '1 hour',
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select
    s.id,
    s.shipment_key,
    s.carrier,
    s.tracking_number,
    r.provider_carrier_id,
    r.provider_tag,
    s.trello_card_id,
    s.trello_card_name,
    s.trello_card_url,
    s.status
  from claimed s
  join public.inbound_tracking_registrations r
    on r.shipment_id = s.id
   and r.provider = '17track'
   and r.status = 'accepted';
end;
$$;

create or replace function public.inbound_record_17track_registration(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_dhl_owned boolean;
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.inbound_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'failed');
  v_provider_carrier_id integer := nullif(p_payload ->> 'providerCarrierId', '')::integer;
  v_error text := nullif(p_payload ->> 'error', '');
  v_raw_response jsonb := coalesce(p_payload -> 'rawResponse', '{}'::jsonb);
  v_registration_id uuid;
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

  -- Serialize provider ownership with the DHL ingest, including responses claimed before takeover.
  select s.carrier = 'dhl' and s.metadata->>'tracking_provider' = 'dhl-unified'
  into v_dhl_owned
  from public.inbound_shipments s
  where s.id = v_shipment_id
  for update;
  if v_dhl_owned then
    return jsonb_build_object('shipment_id', v_shipment_id, 'status', 'skipped_provider_takeover');
  end if;

  if v_status not in ('accepted', 'rejected', 'failed') then
    v_status := 'failed';
  end if;

  insert into public.inbound_tracking_registrations as target (
    shipment_id,
    provider,
    registration_key,
    carrier,
    tracking_number,
    provider_carrier_id,
    provider_tag,
    status,
    attempts,
    first_registered_at,
    last_attempt_at,
    next_attempt_at,
    last_error,
    raw_response,
    updated_at
  )
  values (
    v_shipment_id,
    '17track',
    '17track:' || v_shipment_id::text,
    v_carrier,
    v_tracking_number,
    v_provider_carrier_id,
    v_shipment_id::text,
    v_status,
    1,
    case when v_status = 'accepted' then p_now else null end,
    p_now,
    case when v_status = 'accepted' then null else p_now + interval '1 hour' end,
    v_error,
    v_raw_response,
    p_now
  )
  on conflict on constraint inbound_tracking_registrations_shipment_provider_unique do update
    set carrier = excluded.carrier,
        tracking_number = excluded.tracking_number,
        provider_carrier_id = coalesce(excluded.provider_carrier_id, target.provider_carrier_id),
        provider_tag = excluded.provider_tag,
        status = excluded.status,
        first_registered_at = case
          when excluded.status = 'accepted' then coalesce(target.first_registered_at, p_now)
          else target.first_registered_at
        end,
        last_attempt_at = p_now,
        next_attempt_at = excluded.next_attempt_at,
        last_error = excluded.last_error,
        raw_response = excluded.raw_response,
        updated_at = p_now
  returning target.id into v_registration_id;

  update public.inbound_shipments
  set metadata = metadata || jsonb_build_object(
        '17track_registration_status', v_status,
        '17track_provider_carrier_id', v_provider_carrier_id
      ),
      updated_at = p_now
  where id = v_shipment_id;

  if v_status in ('failed', 'rejected') then
    perform public.inbound_record_tracking_error(jsonb_build_object(
      'shipmentId', v_shipment_id,
      'carrier', v_carrier,
      'trackingNumber', v_tracking_number,
      'trackingError', jsonb_build_object(
        'provider', '17track',
        'title', '17TRACK registration failed',
        'detail', coalesce(v_error, '17TRACK Registrierung fehlgeschlagen.'),
        'node', '17TRACK registration'
      ),
      'rawResponse', v_raw_response
    ), p_now);
  end if;

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'registration_id', v_registration_id,
    'provider', '17track',
    'status', v_status
  );
end;
$$;

create or replace function public.inbound_record_tracking_error(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_dhl_owned boolean;
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.inbound_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_error jsonb := coalesce(p_payload -> 'trackingError', '{}'::jsonb);
  v_raw_response jsonb := coalesce(p_payload -> 'rawResponse', '{}'::jsonb);
  v_http_status integer := nullif(v_error ->> 'httpStatus', '')::integer;
  v_provider text := coalesce(nullif(v_error ->> 'provider', ''), v_carrier, 'carrier');
  v_title text;
  v_description text;
  v_incident_id uuid;
  v_incident_key text;
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

  -- Serialize provider ownership with the DHL ingest, including responses claimed before takeover.
  select s.carrier = 'dhl' and s.metadata->>'tracking_provider' = 'dhl-unified'
  into v_dhl_owned
  from public.inbound_shipments s
  where s.id = v_shipment_id
  for update;
  if v_dhl_owned and lower(v_provider) = '17track' then
    return jsonb_build_object('shipment_id', v_shipment_id, 'status', 'skipped_provider_takeover');
  end if;

  v_title := 'Tracking API Fehler: ' || upper(v_provider) || ' konnte nicht abgefragt werden';
  v_description := concat_ws(
    ' ',
    'Der Inbound-Agent konnte die Carrier-Events nicht laden.',
    case when v_http_status is not null then 'HTTP ' || v_http_status::text || '.' else null end,
    coalesce(nullif(v_error ->> 'detail', ''), nullif(v_error ->> 'message', ''), nullif(v_error ->> 'title', ''), 'Bitte API-Zugang/Credentials pruefen.')
  );
  v_incident_key := 'inbound:' || v_shipment_id::text || ':tracking_error:' || lower(v_provider);

  update public.inbound_shipments
  set
    risk_level = case
      when risk_level in ('urgent', 'closed') then risk_level
      else 'high'
    end,
    status_reason = left('tracking_api_error:' || lower(v_provider) || coalesce(':' || v_http_status::text, ''), 200),
    last_checked_at = p_now,
    next_check_at = p_now + interval '30 minutes',
    carrier_last_response = v_raw_response,
    metadata = metadata || jsonb_build_object('last_tracking_error', v_error),
    updated_at = p_now
  where id = v_shipment_id;

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
    metadata,
    updated_at
  )
  values (
    v_shipment_id,
    v_incident_key,
    'tracking_error',
    case when coalesce(v_http_status, 0) in (401, 403) then 'urgent' else 'high' end,
    'open',
    v_title,
    v_description,
    p_now,
    p_now,
    'inbound_tracking_error_v1_20260606',
    jsonb_build_object(
      'carrier', v_carrier,
      'tracking_number', v_tracking_number,
      'tracking_error', v_error
    ),
    p_now
  )
  on conflict on constraint inbound_incidents_incident_key_key do update
    set severity = excluded.severity,
        status = case when target.status in ('resolved', 'ignored') then 'open' else target.status end,
        title = excluded.title,
        description = excluded.description,
        last_detected_at = excluded.last_detected_at,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
  returning target.id into v_incident_id;

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'incident_id', v_incident_id,
    'incident_type', 'tracking_error',
    'status', 'open'
  );
end;
$$;

create or replace function public.inbound_record_carrier_response(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_dhl_owned boolean;
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

  -- Serialize provider ownership with the DHL ingest, including responses claimed before takeover.
  select s.carrier = 'dhl' and s.metadata->>'tracking_provider' = 'dhl-unified'
  into v_dhl_owned
  from public.inbound_shipments s
  where s.id = v_shipment_id
  for update;
  if v_dhl_owned
    and p_payload#>>'{rawResponse,provider}' is distinct from 'dhl-unified'
    and p_payload#>>'{rawResponse,source}' is distinct from 'ops_manual' then
    return jsonb_build_object('shipment_id', v_shipment_id, 'status', 'skipped_provider_takeover');
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

create or replace function public.inbound_record_dhl_unified_response(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_tracking text := p_payload->>'trackingNumber';
  v_card text := p_payload->>'trelloCardId';
  v_list text := p_payload->>'trelloListId';
  v_id uuid;
  v_current_card text;
  v_error text := p_payload->>'trackingError';
  v_result jsonb;
  v_event jsonb;
begin
  if v_tracking is null or v_tracking !~ '^\d{10}$' or v_card is null or v_card !~ '^[a-f0-9]{24}$'
    or p_payload->>'trelloBoardId' is distinct from '62bae9b97705e7419ed64593'
    or v_list is null or v_list not in ('6347e0971a7efc0482e6c3fe','6544ca38c328c64bbcabf4e8','69ff17bfab2afaaf96f7033a','69ef8a5b2e64cf224dd5746e','6347e09cb326e6014856bc3b') then
    raise exception 'invalid DHL/Trello identity' using errcode='22023';
  end if;
  -- Serialize discovery and response writes for this number without changing existing mappings.
  perform pg_advisory_xact_lock(hashtextextended('leo-dhl:'||v_tracking,0));
  select id,trello_card_id into v_id,v_current_card from public.inbound_shipments
    where carrier='dhl' and tracking_number=v_tracking for update;
  if v_id is null then
    if v_list='6347e09cb326e6014856bc3b' then raise exception 'new shipment outside intake'; end if;
    insert into public.inbound_shipments(shipment_key,source,carrier,tracking_number,tracking_raw,trello_card_id,trello_card_name,trello_card_url,trello_list_id,trello_list_name)
      values('trello:'||v_card||':dhl:'||v_tracking,'trello','dhl',v_tracking,'DHL '||v_tracking,v_card,p_payload->>'trelloCardName',p_payload->>'trelloCardUrl',v_list,p_payload->>'trelloListName')
      on conflict (carrier,tracking_number) do nothing returning id into v_id;
    select id,trello_card_id into v_id,v_current_card from public.inbound_shipments where carrier='dhl' and tracking_number=v_tracking for update;
  end if;
  if v_current_card is distinct from v_card or (nullif(p_payload->>'shipmentId','') is not null and (p_payload->>'shipmentId')::uuid <> v_id) then
    raise exception 'DHL shipment/card conflict' using errcode='22023';
  end if;
  if v_error is not null then
    if v_error !~ '^dhl_[a-z0-9_]+$' then raise exception 'invalid error code'; end if;
    update public.inbound_shipments set status_reason='tracking_api_error:'||v_error,last_checked_at=now(),updated_at=now()
      where id=v_id;
    -- Errors are returned to Leo/Kai, never enqueued into the legacy Outlook notifier.
    return jsonb_build_object('shipment_id',v_id,'error',v_error);
  end if;
  if p_payload->>'carrier' is distinct from 'dhl' or p_payload#>>'{rawResponse,provider}' is distinct from 'dhl-unified'
    or p_payload#>>'{rawResponse,id}' is distinct from v_tracking
    or jsonb_typeof(p_payload->'events') is distinct from 'array' then raise exception 'invalid DHL response'; end if;
  if jsonb_array_length(p_payload->'events') not between 1 and 250 then raise exception 'invalid DHL events'; end if;
  for v_event in select * from jsonb_array_elements(p_payload->'events') loop
    if coalesce(v_event->>'eventKey','') !~ '^dhl-unified:[a-f0-9]{64}$' or coalesce(v_event->>'statusText','')=''
      or coalesce(v_event->>'eventTime','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
      or (v_event->>'eventTime')::timestamptz>now() then raise exception 'invalid DHL event'; end if;
  end loop;
  v_result := public.inbound_record_carrier_response(p_payload || jsonb_build_object('shipmentId',v_id));
  update public.inbound_shipments set status_reason=case when status_reason like 'tracking_api_error:%' or status_reason='tracking_registered:17track' then null else status_reason end,
    metadata=metadata||jsonb_build_object('tracking_provider','dhl-unified'),updated_at=now() where id=v_id;

  -- A validated DHL response supersedes only earlier errors from the retired provider.
  -- Customs/transport incidents and other providers retain their own resolution rules.
  update public.inbound_incidents i
  set status = 'resolved',
      resolved_at = coalesce(i.resolved_at, now()),
      updated_at = now(),
      metadata = i.metadata || jsonb_build_object(
        'resolved_by', 'inbound_record_dhl_unified_response',
        'resolved_reason', 'Successful DHL Unified response superseded 17TRACK tracking error',
        'tracking_recovered_at', now()
      )
  where i.shipment_id = v_id
    and i.incident_type = 'tracking_error'
    and i.status in ('open', 'acknowledged')
    and i.metadata#>>'{tracking_error,provider}' = '17track'
    and i.last_detected_at <= now();
  return v_result;
end;
$$;

-- Repair already persisted recoveries only when the current response, identity and
-- event history prove successful DHL coverage at or after the legacy error.
-- Do not clear newer/current errors or delete any incident/event/registration history.
update public.inbound_incidents i
set status = 'resolved',
    resolved_at = coalesce(i.resolved_at, now()),
    updated_at = now(),
    metadata = i.metadata || jsonb_build_object(
      'resolved_by', 'dhl_unified_provider_takeover_backfill',
      'resolved_reason', 'Successful DHL Unified response superseded 17TRACK tracking error',
      'tracking_recovered_at', s.last_checked_at
    )
from public.inbound_shipments s
where s.id = i.shipment_id
  and i.incident_type = 'tracking_error'
  and i.status in ('open', 'acknowledged')
  and i.metadata#>>'{tracking_error,provider}' = '17track'
  and s.carrier = 'dhl'
  and s.metadata->>'tracking_provider' = 'dhl-unified'
  and s.carrier_last_response->>'provider' = 'dhl-unified'
  and s.carrier_last_response->>'id' = s.tracking_number
  and s.last_checked_at >= i.last_detected_at
  and coalesce(s.status_reason, '') not like 'tracking_api_error:%'
  and exists (
    select 1 from public.inbound_tracking_events e
    where e.shipment_id = s.id
      and e.carrier = 'dhl'
      and e.tracking_number = s.tracking_number
      and e.event_key ~ '^dhl-unified:[a-f0-9]{64}$'
  );
