-- Run only against an isolated test database after the fixture and ingestion migration.
begin;
create function pg_temp.payload() returns jsonb language sql as $$
select jsonb_build_object('trackingNumber','0012345678','trelloCardId','111111111111111111111111',
  'trelloBoardId','62bae9b97705e7419ed64593','trelloListId','6347e0a2f062500084675062',
  'carrier','dhl','rawResponse',jsonb_build_object('provider','dhl-unified','id','0012345678'),
  'events',jsonb_build_array(jsonb_build_object('eventKey','dhl-unified:'||repeat('a',64),'statusText','Shipment picked up','eventTime','2026-01-01T10:00:00Z')),
  'replacementRound',jsonb_build_object('previousTrackingNumbers',jsonb_build_array('1123456789'),
    'trackingNumbers',jsonb_build_array('0012345678'),'previousArrivedAt','2025-12-01T10:00:00Z',
    'addedAt','2025-12-02T10:00:00Z','arrivalActionId',repeat('2',24),'trackingActionId',repeat('3',24)))
$$;
create function pg_temp.reject(p jsonb) returns void language plpgsql as $$
begin
  begin
    perform public.inbound_record_dhl_unified_response(p);
  exception when others then
    if sqlerrm = 'unexpected accepted payload' then raise; end if;
    return;
  end;
  raise exception 'unexpected accepted payload';
end $$;
do $$
declare p jsonb := pg_temp.payload(); n int;
begin
  perform public.inbound_record_dhl_unified_response(p);
  select count(*) into n from public.inbound_shipments where tracking_number='0012345678' and metadata->>'tracking_provider'='dhl-unified';
  assert n=1, 'replacement must be ingested';
  perform public.inbound_record_dhl_unified_response(p);
  select count(*) into n from public.inbound_shipments where tracking_number='0012345678';
  assert n=1, 'repeat cannot duplicate shipment';
  perform pg_temp.reject(p - 'replacementRound');
  perform pg_temp.reject(jsonb_set(p,'{replacementRound}','null'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,previousTrackingNumbers}','[]'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,trackingNumbers}','["1123456789"]'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,previousTrackingNumbers}','["0012345678"]'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,addedAt}','"2025-11-01T10:00:00Z"'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,addedAt}','"2999-01-01T10:00:00Z"'));
  perform pg_temp.reject(jsonb_set(p,'{replacementRound,arrivalActionId}','""'));
  perform pg_temp.reject(jsonb_set(p,'{trelloCardId}','"999999999999999999999999"'));
  perform pg_temp.reject(jsonb_set(p,'{trelloBoardId}','"foreign"'));
  perform pg_temp.reject(jsonb_set(p,'{trelloListId}','"646b8c9613dc4e7000f6657e"'));
  perform public.inbound_record_dhl_unified_response(jsonb_set(p - 'replacementRound','{trelloListId}','"69ff17bfab2afaaf96f7033a"'));
  perform public.inbound_record_dhl_unified_response((p - 'events' - 'rawResponse') || '{"trackingError":"dhl_http_503"}'::jsonb);
  assert (select status_reason='tracking_api_error:dhl_http_503' from public.inbound_shipments where tracking_number='0012345678'), 'error must remain visible';
end $$;
rollback;
