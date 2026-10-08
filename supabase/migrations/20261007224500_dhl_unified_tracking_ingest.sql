-- Prepared only: direct DHL ingestion without replacing the existing 17TRACK functions.
-- Caller is the single Leo worker, which rechecks the current Trello identity before ingest.
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
  return v_result;
end;
$$;
revoke all on function public.inbound_record_dhl_unified_response(jsonb) from public,anon,authenticated;
grant execute on function public.inbound_record_dhl_unified_response(jsonb) to service_role;
