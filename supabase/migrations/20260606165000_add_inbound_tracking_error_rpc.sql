create or replace function public.inbound_record_tracking_error(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
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

revoke all on function public.inbound_record_tracking_error(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_record_tracking_error(jsonb, timestamptz) to service_role;
