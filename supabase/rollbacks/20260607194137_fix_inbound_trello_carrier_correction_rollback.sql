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
  v_production_raw text;
  v_shipping_raw text;
  v_production_amount numeric;
  v_shipping_amount numeric;
  v_cost_currency text;
  v_metadata jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'shipments', '[]'::jsonb))
  loop
    v_parsed := public.inbound_parse_tracking_value(v_item ->> 'trackingRaw');
    if coalesce((v_parsed ->> 'valid')::boolean, false) then
      v_production_amount := null;
      v_shipping_amount := null;
      v_production_raw := nullif(regexp_replace(replace(coalesce(v_item ->> 'finalProductionPrice', v_item ->> 'productionPrice', ''), ',', '.'), '[^0-9.-]', '', 'g'), '');
      v_shipping_raw := nullif(regexp_replace(replace(coalesce(v_item ->> 'finalShippingPrice', v_item ->> 'shippingPrice', ''), ',', '.'), '[^0-9.-]', '', 'g'), '');
      v_cost_currency := upper(coalesce(nullif(v_item ->> 'costCurrency', ''), 'USD'));

      if v_production_raw ~ '^[0-9]+(\.[0-9]+)?$' then
        v_production_amount := v_production_raw::numeric;
      end if;

      if v_shipping_raw ~ '^[0-9]+(\.[0-9]+)?$' then
        v_shipping_amount := v_shipping_raw::numeric;
      end if;

      if v_cost_currency not in ('EUR', 'USD') then
        v_cost_currency := 'USD';
      end if;

      v_metadata := jsonb_strip_nulls(jsonb_build_object(
        'source', 'trello_discovery',
        'tracking_field_name', coalesce(v_item ->> 'trackingFieldName', 'Tracking number'),
        'final_production_price', v_production_amount,
        'final_shipping_price', v_shipping_amount,
        'final_production_price_raw', nullif(v_item ->> 'finalProductionPrice', ''),
        'final_shipping_price_raw', nullif(v_item ->> 'finalShippingPrice', ''),
        'production_price_field_name', nullif(v_item ->> 'productionPriceFieldName', ''),
        'shipping_price_field_name', nullif(v_item ->> 'shippingPriceFieldName', ''),
        'inbound_cost_currency', case when v_production_amount is not null or v_shipping_amount is not null then v_cost_currency else null end,
        'cost_snapshot_at', case when v_production_amount is not null or v_shipping_amount is not null then p_now else null end
      ));

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
        v_metadata,
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
            metadata = coalesce(target.metadata, '{}'::jsonb) || excluded.metadata,
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

with reverted_shipments as (
  update public.inbound_shipments as target
  set shipment_key = 'trello:69d8dc3579a34f020b0f2e33:fedex:871030317880',
      carrier = 'fedex',
      tracking_raw = 'Fedex871030317880',
      status = case
        when target.status in ('delivered', 'closed') then target.status
        else 'tracking_created'
      end,
      status_reason = case
        when target.status in ('delivered', 'closed') then target.status_reason
        else 'tracking_api_error:17track'
      end,
      risk_level = case
        when target.status in ('delivered', 'closed') then target.risk_level
        else 'high'
      end,
      last_checked_at = case
        when target.status in ('delivered', 'closed') then target.last_checked_at
        else now()
      end,
      next_check_at = case
        when target.status in ('delivered', 'closed') then target.next_check_at
        else now() + interval '30 minutes'
      end,
      metadata = jsonb_strip_nulls(
        coalesce(target.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'tracking_provider', '17track',
          '17track_registration_status', 'accepted',
          '17track_provider_carrier_id', 100003,
          'last_tracking_error', jsonb_build_object(
            'provider', '17track',
            'detail', 'Supabase Anfrage fehlgeschlagen.',
            'restored_by', '20260607194137_fix_inbound_trello_carrier_correction_rollback'
          ),
          'carrier_correction_rollback_at', now(),
          'carrier_correction_rollback_by', '20260607194137_fix_inbound_trello_carrier_correction_rollback'
        )
      ),
      updated_at = now()
  where target.trello_card_id = '69d8dc3579a34f020b0f2e33'
    and target.tracking_number = '871030317880'
    and target.carrier = 'dhl'
    and target.metadata ->> 'carrier_corrected_by' = '20260607194137_fix_inbound_trello_carrier_correction'
    and not exists (
      select 1
      from public.inbound_tracking_events e
      where e.shipment_id = target.id
    )
    and not exists (
      select 1
      from public.inbound_shipments conflicting
      where conflicting.carrier = 'fedex'
        and conflicting.tracking_number = '871030317880'
        and conflicting.id <> target.id
    )
  returning target.id
),
reverted_registrations as (
  update public.inbound_tracking_registrations as target
  set carrier = 'fedex',
      tracking_number = '871030317880',
      provider_carrier_id = 100003,
      provider_tag = reverted_shipments.id::text,
      status = 'accepted',
      attempts = greatest(target.attempts, 3),
      first_registered_at = coalesce(target.first_registered_at, now()),
      last_attempt_at = coalesce(target.last_attempt_at, now()),
      next_attempt_at = null,
      last_error = null,
      metadata = jsonb_strip_nulls(
        coalesce(target.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'carrier_correction_rollback_at', now(),
          'carrier_correction_rollback_by', '20260607194137_fix_inbound_trello_carrier_correction_rollback'
        )
      ),
      updated_at = now()
  from reverted_shipments
  where target.shipment_id = reverted_shipments.id
    and target.provider = '17track'
  returning target.id
)
update public.inbound_incidents as target
set status = 'open',
    resolved_at = null,
    last_detected_at = now(),
    updated_at = now(),
    metadata = target.metadata || jsonb_build_object(
      'reopened_by', '20260607194137_fix_inbound_trello_carrier_correction_rollback',
      'reopened_reason', 'carrier correction rollback',
      'reopened_at', now()
    )
from reverted_shipments
where target.shipment_id = reverted_shipments.id
  and target.incident_type = 'tracking_error'
  and target.status = 'resolved'
  and target.metadata ->> 'resolved_by' = '20260607194137_fix_inbound_trello_carrier_correction';
