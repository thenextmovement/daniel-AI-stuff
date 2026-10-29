\set ON_ERROR_STOP on
alter table inbound_shipments add column status text, add column delivered_at timestamptz;
\ir ../../supabase/migrations/20261029130000_dhl_terminal_mirror_reconcile.sql
insert into inbound_shipments(id,carrier,tracking_number,trello_card_id,status,last_checked_at,metadata)
values('11111111-1111-1111-1111-111111111111','dhl','6018049730','6ac4b453d8eaa1c43ead981d','in_transit','2026-10-21T07:02:23Z','{"tracking_provider":"dhl-unified","keep":true}');
create function pg_temp.payload() returns jsonb language sql as $$
 select '{"shipmentId":"11111111-1111-1111-1111-111111111111","carrier":"dhl","trackingNumber":"6018049730","trelloCardId":"6ac4b453d8eaa1c43ead981d","trelloBoardId":"62bae9b97705e7419ed64593","trelloListId":"646c788ae63245624b6d6a7a","rawResponse":{"provider":"dhl-unified","id":"6018049730","service":"express"},"events":[{"eventTime":"2026-10-21T12:19:00Z","statusCode":"delivered","statusText":"Delivered","rawEvent":{"statusCode":"delivered","description":"Delivered","supplementalDetails":false}}]}'::jsonb
$$;
do $$
declare p jsonb:=pg_temp.payload();r jsonb;k text;v jsonb;
begin
 -- Identity mismatch never changes another shipment; malformed responses fail closed.
 foreach k in array array['shipmentId','trelloCardId','trelloBoardId','trelloListId','trackingNumber','carrier'] loop
  begin
   perform inbound_reconcile_dhl_terminal(p||jsonb_build_object(k,case when k='shipmentId' then '22222222-2222-2222-2222-222222222222' else 'wrong' end));
   raise exception 'accepted wrong identity %',k;
  exception when invalid_parameter_value then null;
  end;
 end loop;
 -- Nonterminal, supplemental and tied contradictory responses cannot close.
 foreach v in array array[
  jsonb_set(p,'{events,0,statusCode}','"transit"'),
  jsonb_set(p,'{events,0,statusText}','"Delivered [Unreviewed carrier details]"'),
  jsonb_set(p,'{events,0,rawEvent,supplementalDetails}','true'),
  jsonb_set(p,'{events}',(p->'events')||jsonb_build_array(jsonb_set(p#>'{events,0}','{statusCode}','"transit"')))
 ] loop
  r:=inbound_reconcile_dhl_terminal(v);
  if r->>'updated'<>'false' then raise exception 'false terminal accepted';end if;
 end loop;
 r:=inbound_reconcile_dhl_terminal(p);
 if r->>'updated'<>'true' then raise exception 'delivery rejected';end if;
 if not exists(select 1 from inbound_shipments where status='delivered' and delivered_at='2026-10-21T12:19:00Z' and last_checked_at='2026-10-21T07:02:23Z' and metadata->>'keep'='true') then raise exception 'incorrect mutation or release freshness changed';end if;
 if (inbound_reconcile_dhl_terminal(p))->>'updated'<>'false' then raise exception 'replayed terminal mutation';end if;
 if has_function_privilege('anon','inbound_reconcile_dhl_terminal(jsonb)','execute') or has_function_privilege('authenticated','inbound_reconcile_dhl_terminal(jsonb)','execute') or not has_function_privilege('service_role','inbound_reconcile_dhl_terminal(jsonb)','execute') then raise exception 'bad grants';end if;
 if exists(select 1 from inbound_incidents) then raise exception 'unexpected incident';end if;
end $$;
