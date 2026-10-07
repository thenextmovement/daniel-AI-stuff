-- Run only in an isolated disposable PostgreSQL database with the initial inbound schema.
do $$
declare
  p jsonb := '{"carrier":"dhl","trackingNumber":"0012345678","trelloCardId":"111111111111111111111111","trelloBoardId":"62bae9b97705e7419ed64593","trelloListId":"69ff17bfab2afaaf96f7033a","trelloCardUrl":"https://trello.com/c/testonly","events":[{"eventKey":"dhl-unified:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","statusText":"Arrived at DHL Sort Facility","statusCode":"transit","eventTime":"2026-01-01T10:00:00Z","eventLocation":"LEIPZIG, DE"}],"rawResponse":{"provider":"dhl-unified","id":"0012345678"}}'::jsonb;
  n integer;
begin
  perform public.inbound_record_dhl_unified_response(p);
  perform public.inbound_record_dhl_unified_response(p);
  select count(*) into n from public.inbound_tracking_events;
  if n<>1 then raise exception 'replay duplicated events'; end if;
  select count(*) into n from public.inbound_shipments;
  if n<>1 then raise exception 'replay duplicated shipment'; end if;
  begin
    perform public.inbound_record_dhl_unified_response(p||'{"trelloCardId":"222222222222222222222222"}'::jsonb);
    raise exception 'TEST: mapping conflict accepted';
  exception when sqlstate '22023' then null; end;
  if (select trello_card_id from public.inbound_shipments)<>'111111111111111111111111' then raise exception 'mapping overwritten'; end if;
  perform public.inbound_record_dhl_unified_response(p||'{"trackingError":"dhl_http_429"}'::jsonb);
  if (select status_reason from public.inbound_shipments)<>'tracking_api_error:dhl_http_429' then raise exception 'error missing'; end if;
  if exists(select 1 from public.inbound_incidents where incident_type='tracking_error') then raise exception 'legacy error notification created'; end if;
  perform public.inbound_record_dhl_unified_response(p);
  if (select status_reason from public.inbound_shipments) is not null then raise exception 'successful recovery still blocked'; end if;
  if has_function_privilege('anon','public.inbound_record_dhl_unified_response(jsonb)','execute') then raise exception 'public access granted'; end if;
  if not has_function_privilege('service_role','public.inbound_record_dhl_unified_response(jsonb)','execute') then raise exception 'service access absent'; end if;
end $$;
