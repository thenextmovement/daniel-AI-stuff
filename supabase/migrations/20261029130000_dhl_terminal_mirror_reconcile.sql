-- Terminal-only reconciliation for existing Sign Arrived mirrors. Never call the
-- general event evaluator: release freshness, events and outboxes stay untouched.
create or replace function public.inbound_reconcile_dhl_terminal(p_payload jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare
 v_id uuid; v_tracking text:=p_payload->>'trackingNumber'; v_card text:=p_payload->>'trelloCardId';
 v_last timestamptz; v_event jsonb; v_current text;
begin
 if p_payload->>'trelloBoardId' is distinct from '62bae9b97705e7419ed64593'
 or p_payload->>'trelloListId' is distinct from '646c788ae63245624b6d6a7a'
 or coalesce(v_tracking,'') !~ '^\d{10}$' or coalesce(v_card,'') !~ '^[a-f0-9]{24}$'
 or coalesce(p_payload->>'shipmentId','') !~ '^[a-f0-9-]{36}$'
 or p_payload->>'carrier' is distinct from 'dhl'
 or p_payload#>>'{rawResponse,provider}' is distinct from 'dhl-unified'
 or p_payload#>>'{rawResponse,id}' is distinct from v_tracking
 or p_payload#>>'{rawResponse,service}' is distinct from 'express'
 or jsonb_typeof(p_payload->'events') is distinct from 'array' then
  raise exception 'invalid DHL terminal identity' using errcode='22023';
 end if;
 if jsonb_array_length(p_payload->'events') not between 1 and 249 then
  raise exception 'invalid DHL terminal events' using errcode='22023';
 end if;
 for v_event in select * from jsonb_array_elements(p_payload->'events') loop
  if coalesce(v_event->>'eventTime','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
   or (v_event->>'eventTime')::timestamptz>now() then
   raise exception 'invalid DHL terminal event time' using errcode='22023';
  end if;
 end loop;
 select max((e->>'eventTime')::timestamptz) into v_last from jsonb_array_elements(p_payload->'events') e;
 -- Every event tied at the latest instant must affirm delivery. Generic customs,
 -- transit, supplemental instructions and contradictory same-time rows do not close.
 if exists(select 1 from jsonb_array_elements(p_payload->'events') e
  where (e->>'eventTime')::timestamptz=v_last and
   (e->>'statusCode' is distinct from 'delivered' or e->>'statusText' is distinct from 'Delivered'
    or e#>>'{rawEvent,statusCode}' is distinct from 'delivered'
    or e#>>'{rawEvent,description}' is distinct from 'Delivered'
    or e#>>'{rawEvent,supplementalDetails}' is distinct from 'false')) then
  return jsonb_build_object('updated',false);
 end if;
 select id,status into v_id,v_current from public.inbound_shipments
  where id=(p_payload->>'shipmentId')::uuid and carrier='dhl' and tracking_number=v_tracking
   and trello_card_id=v_card and metadata->>'tracking_provider'='dhl-unified' for update;
 if v_id is null then raise exception 'DHL terminal shipment conflict' using errcode='22023'; end if;
 if v_current in ('delivered','closed') then return jsonb_build_object('updated',false); end if;
 update public.inbound_shipments set status='delivered',delivered_at=v_last,updated_at=now(),
  metadata=metadata||jsonb_build_object('terminal_reconciliation',jsonb_build_object(
   'provider','dhl-unified','tracking_number',v_tracking,'status','delivered','event_time',v_last,
   'checked_at',now(),'scope','terminal_mirror_only_no_events_or_release_freshness')) where id=v_id;
 return jsonb_build_object('updated',true,'shipment_id',v_id);
end; $$;
revoke all on function public.inbound_reconcile_dhl_terminal(jsonb) from public,anon,authenticated;
grant execute on function public.inbound_reconcile_dhl_terminal(jsonb) to service_role;
