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
  v_existing_id uuid;
  v_trello_card_id text;
  v_carrier text;
  v_tracking_number text;
  v_tracking_raw text;
  v_shipment_key text;
  v_provider_carrier_id integer;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'shipments', '[]'::jsonb))
  loop
    v_parsed := public.inbound_parse_tracking_value(v_item ->> 'trackingRaw');
    if coalesce((v_parsed ->> 'valid')::boolean, false) then
      v_production_amount := null;
      v_shipping_amount := null;
      v_existing_id := null;
      v_trello_card_id := nullif(v_item ->> 'trelloCardId', '');
      v_carrier := v_parsed ->> 'carrier';
      v_tracking_number := v_parsed ->> 'tracking_number';
      v_tracking_raw := v_parsed ->> 'raw';
      v_shipment_key := 'trello:' || v_trello_card_id || ':' || v_carrier || ':' || v_tracking_number;
      v_provider_carrier_id := case
        when v_carrier = 'dhl' then 7041
        when v_carrier = 'fedex' then 100003
        else null
      end;
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

      if v_trello_card_id is not null and v_carrier in ('dhl', 'fedex') then
        select s.id
        into v_existing_id
        from public.inbound_shipments s
        where s.trello_card_id = v_trello_card_id
          and s.tracking_number = v_tracking_number
          and s.carrier <> v_carrier
          and s.carrier in ('dhl', 'fedex')
          and not exists (
            select 1
            from public.inbound_tracking_events e
            where e.shipment_id = s.id
          )
          and not exists (
            select 1
            from public.inbound_shipments conflicting
            where conflicting.carrier = v_carrier
              and conflicting.tracking_number = v_tracking_number
              and conflicting.id <> s.id
          )
        order by s.updated_at desc
        limit 1
        for update of s;
      end if;

      if v_existing_id is not null then
        update public.inbound_shipments as target
        set shipment_key = v_shipment_key,
            trello_card_id = v_trello_card_id,
            trello_card_name = coalesce(nullif(v_item ->> 'trelloCardName', ''), target.trello_card_name),
            trello_card_url = coalesce(nullif(v_item ->> 'trelloCardUrl', ''), target.trello_card_url),
            trello_list_id = coalesce(nullif(v_item ->> 'trelloListId', ''), target.trello_list_id),
            trello_list_name = coalesce(nullif(v_item ->> 'trelloListName', ''), target.trello_list_name),
            carrier = v_carrier,
            tracking_number = v_tracking_number,
            tracking_raw = v_tracking_raw,
            status = case
              when target.status in ('delivered', 'closed') then target.status
              else 'tracking_created'
            end,
            status_reason = case
              when target.status in ('delivered', 'closed') then target.status_reason
              else 'tracking_carrier_corrected_from_trello'
            end,
            risk_level = case
              when target.status in ('delivered', 'closed') then target.risk_level
              else 'watch'
            end,
            last_checked_at = case
              when target.status in ('delivered', 'closed') then target.last_checked_at
              else null
            end,
            next_check_at = case
              when target.status in ('delivered', 'closed') then target.next_check_at
              else p_now
            end,
            carrier_last_response = case
              when target.status in ('delivered', 'closed') then target.carrier_last_response
              else '{}'::jsonb
            end,
            metadata = jsonb_strip_nulls(
              (coalesce(target.metadata, '{}'::jsonb) - 'last_tracking_error') ||
              v_metadata ||
              jsonb_build_object(
                'tracking_provider', '17track',
                '17track_registration_status', 'pending',
                '17track_provider_carrier_id', v_provider_carrier_id,
                'carrier_corrected_by', 'inbound_record_trello_candidates',
                'carrier_corrected_at', p_now,
                'carrier_correction_reason', 'same_trello_card_tracking_number_without_events',
                'carrier_correction_before', jsonb_build_object(
                  'shipment_key', target.shipment_key,
                  'carrier', target.carrier,
                  'tracking_raw', target.tracking_raw,
                  'status', target.status,
                  'risk_level', target.risk_level,
                  'status_reason', target.status_reason
                )
              )
            ),
            updated_at = p_now
        where target.id = v_existing_id
        returning target.id, target.shipment_key, target.carrier, target.tracking_number, target.status
        into shipment_id, shipment_key, carrier, tracking_number, status;

        update public.inbound_tracking_registrations as target
        set carrier = v_carrier,
            tracking_number = v_tracking_number,
            provider_carrier_id = v_provider_carrier_id,
            provider_tag = v_existing_id::text,
            status = 'pending',
            attempts = 0,
            first_registered_at = null,
            last_attempt_at = null,
            next_attempt_at = p_now,
            last_error = null,
            raw_response = '{}'::jsonb,
            metadata = jsonb_strip_nulls(
              coalesce(target.metadata, '{}'::jsonb) ||
              jsonb_build_object(
                'carrier_corrected_by', 'inbound_record_trello_candidates',
                'carrier_corrected_at', p_now,
                'carrier_correction_reason', 'same_trello_card_tracking_number_without_events'
              )
            ),
            updated_at = p_now
        where target.shipment_id = v_existing_id
          and target.provider = '17track';

        update public.inbound_incidents as target
        set status = 'resolved',
            resolved_at = coalesce(target.resolved_at, p_now),
            updated_at = p_now,
            metadata = target.metadata || jsonb_build_object(
              'resolved_by', 'inbound_record_trello_candidates',
              'resolved_reason', 'carrier corrected from Trello tracking field',
              'resolved_at', p_now
            )
        where target.shipment_id = v_existing_id
          and target.incident_type = 'tracking_error'
          and target.status in ('open', 'acknowledged')
          and (
            target.incident_key like 'inbound:' || v_existing_id::text || ':tracking_error:%'
            or lower(coalesce(target.metadata #>> '{tracking_error,provider}', '')) = '17track'
          );

        return next;
      else
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
          v_shipment_key,
          'trello',
          v_trello_card_id,
          nullif(v_item ->> 'trelloCardName', ''),
          nullif(v_item ->> 'trelloCardUrl', ''),
          nullif(v_item ->> 'trelloListId', ''),
          nullif(v_item ->> 'trelloListName', ''),
          v_carrier,
          v_tracking_number,
          v_tracking_raw,
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
    end if;
  end loop;
end;
$$;

revoke all on function public.inbound_record_trello_candidates(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_record_trello_candidates(jsonb, timestamptz) to service_role;

with corrected_shipments as (
  update public.inbound_shipments as target
  set shipment_key = 'trello:69d8dc3579a34f020b0f2e33:dhl:871030317880',
      carrier = 'dhl',
      tracking_raw = 'DHL871030317880',
      status = case
        when target.status in ('delivered', 'closed') then target.status
        else 'tracking_created'
      end,
      status_reason = case
        when target.status in ('delivered', 'closed') then target.status_reason
        else 'tracking_carrier_corrected_from_trello'
      end,
      risk_level = case
        when target.status in ('delivered', 'closed') then target.risk_level
        else 'watch'
      end,
      last_checked_at = case
        when target.status in ('delivered', 'closed') then target.last_checked_at
        else null
      end,
      next_check_at = case
        when target.status in ('delivered', 'closed') then target.next_check_at
        else now()
      end,
      carrier_last_response = case
        when target.status in ('delivered', 'closed') then target.carrier_last_response
        else '{}'::jsonb
      end,
      metadata = jsonb_strip_nulls(
        (coalesce(target.metadata, '{}'::jsonb) - 'last_tracking_error') ||
        jsonb_build_object(
          'tracking_provider', '17track',
          '17track_registration_status', 'pending',
          '17track_provider_carrier_id', 7041,
          'carrier_corrected_by', '20260607194137_fix_inbound_trello_carrier_correction',
          'carrier_corrected_at', now(),
          'carrier_correction_reason', 'trello_custom_field_corrected_from_fedex_to_dhl',
          'carrier_correction_before', jsonb_build_object(
            'shipment_key', target.shipment_key,
            'carrier', target.carrier,
            'tracking_raw', target.tracking_raw,
            'status', target.status,
            'risk_level', target.risk_level,
            'status_reason', target.status_reason,
            'last_tracking_error', target.metadata -> 'last_tracking_error'
          )
        )
      ),
      updated_at = now()
  where target.trello_card_id = '69d8dc3579a34f020b0f2e33'
    and target.tracking_number = '871030317880'
    and target.carrier = 'fedex'
    and not exists (
      select 1
      from public.inbound_tracking_events e
      where e.shipment_id = target.id
    )
    and not exists (
      select 1
      from public.inbound_shipments conflicting
      where conflicting.carrier = 'dhl'
        and conflicting.tracking_number = '871030317880'
        and conflicting.id <> target.id
    )
  returning target.id
),
reset_registrations as (
  update public.inbound_tracking_registrations as target
  set carrier = 'dhl',
      tracking_number = '871030317880',
      provider_carrier_id = 7041,
      provider_tag = corrected_shipments.id::text,
      status = 'pending',
      attempts = 0,
      first_registered_at = null,
      last_attempt_at = null,
      next_attempt_at = now(),
      last_error = null,
      raw_response = '{}'::jsonb,
      metadata = jsonb_strip_nulls(
        coalesce(target.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'carrier_corrected_by', '20260607194137_fix_inbound_trello_carrier_correction',
          'carrier_corrected_at', now(),
          'carrier_correction_reason', 'trello_custom_field_corrected_from_fedex_to_dhl'
        )
      ),
      updated_at = now()
  from corrected_shipments
  where target.shipment_id = corrected_shipments.id
    and target.provider = '17track'
  returning target.id
)
update public.inbound_incidents as target
set status = 'resolved',
    resolved_at = coalesce(target.resolved_at, now()),
    updated_at = now(),
    metadata = target.metadata || jsonb_build_object(
      'resolved_by', '20260607194137_fix_inbound_trello_carrier_correction',
      'resolved_reason', 'carrier corrected from FedEx to DHL before tracking events existed',
      'resolved_at', now()
    )
from corrected_shipments
where target.shipment_id = corrected_shipments.id
  and target.incident_type = 'tracking_error'
  and target.status in ('open', 'acknowledged')
  and (
    target.incident_key like 'inbound:' || corrected_shipments.id::text || ':tracking_error:%'
    or lower(coalesce(target.metadata #>> '{tracking_error,provider}', '')) = '17track'
  );
