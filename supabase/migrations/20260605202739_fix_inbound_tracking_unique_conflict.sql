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

revoke all on function public.inbound_record_trello_candidates(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_record_trello_candidates(jsonb, timestamptz) to service_role;
