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

create or replace function public.ops_sync_known_cost_entries(p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_sea_count integer := 0;
  v_legacy_ads_count integer := 0;
  v_ai_count integer := 0;
  v_voice_count integer := 0;
  v_inbound_production_count integer := 0;
  v_inbound_shipping_count integer := 0;
begin
  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'sea_campaign_daily:' || s.date::text || ':' || s.campaign_id,
    'sea_campaign_daily',
    s.date::text || ':' || s.campaign_id,
    'ads',
    'google_ads_campaign',
    coalesce(s.cost_eur, 0),
    'EUR',
    s.date,
    s.date::timestamptz,
    'Google Ads campaign spend from sea_campaign_daily',
    'actual',
    jsonb_build_object(
      'campaign_id', s.campaign_id,
      'campaign_name', s.campaign_name,
      'campaign_status', s.campaign_status,
      'conversions', s.conversions,
      'conversion_value', s.conversion_value,
      'synced_at', s.synced_at
    ),
    p_now
  from public.sea_campaign_daily s
  where coalesce(s.cost_eur, 0) > 0
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_sea_count = row_count;

  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'google_ads_daily_spend:' || g.date::text,
    'google_ads_daily_spend',
    g.date::text,
    'ads',
    'legacy_google_ads_daily_spend',
    coalesce(g.spend, 0),
    'EUR',
    g.date,
    g.date::timestamptz,
    'Legacy Google Ads daily spend. Used only where campaign-level SEA rows are absent for the same date.',
    'actual',
    jsonb_build_object(
      'clicks', g.clicks,
      'impressions', g.impressions,
      'synced_at', g.synced_at,
      'coverage_note', 'legacy daily total; skipped on dates that exist in sea_campaign_daily'
    ),
    p_now
  from public.google_ads_daily_spend g
  where coalesce(g.spend, 0) > 0
    and not exists (
      select 1
      from public.sea_campaign_daily s
      where s.date = g.date
    )
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_legacy_ads_count = row_count;

  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'anthropic_api_daily_costs:' || c.cost_date::text,
    'anthropic_api_daily_costs',
    c.cost_date::text,
    'ai',
    'anthropic',
    coalesce(c.total_cost_usd, 0),
    'USD',
    c.cost_date,
    c.cost_date::timestamptz,
    'Anthropic API daily cost',
    'actual',
    jsonb_build_object(
      'total_cost_cents', c.total_cost_cents,
      'model_breakdown', c.model_breakdown,
      'alert_level', c.alert_level,
      'rolling_avg_7d_usd', c.rolling_avg_7d_usd,
      'projected_daily_usd', c.projected_daily_usd
    ),
    p_now
  from public.anthropic_api_daily_costs c
  where coalesce(c.total_cost_usd, 0) > 0
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_ai_count = row_count;

  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    request_ref,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'voice_agent_calls:' || v.id::text,
    'voice_agent_calls',
    v.id::text,
    'voice',
    'voice_agent',
    coalesce(v.estimated_cost, 0),
    'USD',
    coalesce(v.created_at, p_now)::date,
    coalesce(v.created_at, p_now),
    v.request_id::text,
    'Voice agent estimated call cost',
    'estimated',
    jsonb_build_object(
      'vapi_call_id', v.vapi_call_id,
      'duration_seconds', v.duration_seconds,
      'direction', v.direction,
      'detected_intent', v.detected_intent
    ),
    p_now
  from public.voice_agent_calls v
  where coalesce(v.estimated_cost, 0) > 0
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        request_ref = excluded.request_ref,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_voice_count = row_count;

  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    shipment_ref,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'inbound_shipments:' || parsed.id::text || ':final_production_price',
    'inbound_shipments',
    parsed.id::text,
    'production',
    'china_supplier_production',
    parsed.production_amount,
    parsed.cost_currency,
    coalesce(parsed.tracking_first_seen_at, parsed.first_seen_at, parsed.created_at, p_now)::date,
    coalesce(parsed.tracking_first_seen_at, parsed.first_seen_at, parsed.created_at, p_now),
    parsed.id::text,
    'China supplier production cost from Trello final_production_price',
    'actual',
    jsonb_build_object(
      'trello_card_id', parsed.trello_card_id,
      'trello_card_name', parsed.trello_card_name,
      'trello_card_url', parsed.trello_card_url,
      'tracking_number', parsed.tracking_number,
      'carrier', parsed.carrier,
      'field_name', parsed.metadata ->> 'production_price_field_name',
      'currency_assumption', case when parsed.metadata ? 'inbound_cost_currency' then null else 'USD default because Trello field has no currency' end,
      'cost_snapshot_at', parsed.metadata ->> 'cost_snapshot_at'
    ),
    p_now
  from (
    select
      s.*,
      case
        when production_raw ~ '^[0-9]+(\.[0-9]+)?$' then production_raw::numeric
        else null
      end as production_amount,
      case
        when upper(coalesce(s.metadata ->> 'inbound_cost_currency', 'USD')) in ('EUR', 'USD') then upper(coalesce(s.metadata ->> 'inbound_cost_currency', 'USD'))
        else 'USD'
      end as cost_currency
    from (
      select
        shipment.*,
        nullif(regexp_replace(replace(coalesce(shipment.metadata ->> 'final_production_price', ''), ',', '.'), '[^0-9.-]', '', 'g'), '') as production_raw
      from public.inbound_shipments shipment
      where shipment.metadata ? 'final_production_price'
    ) s
  ) parsed
  where parsed.production_amount > 0
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        shipment_ref = excluded.shipment_ref,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_inbound_production_count = row_count;

  insert into public.ops_cost_entries as target (
    cost_key,
    source,
    source_ref,
    category,
    subcategory,
    amount,
    currency,
    occurred_on,
    occurred_at,
    shipment_ref,
    description,
    confidence,
    metadata,
    updated_at
  )
  select
    'inbound_shipments:' || parsed.id::text || ':final_shipping_price',
    'inbound_shipments',
    parsed.id::text,
    'shipping',
    'china_inbound_shipping',
    parsed.shipping_amount,
    parsed.cost_currency,
    coalesce(parsed.tracking_first_seen_at, parsed.first_seen_at, parsed.created_at, p_now)::date,
    coalesce(parsed.tracking_first_seen_at, parsed.first_seen_at, parsed.created_at, p_now),
    parsed.id::text,
    'China inbound shipping cost from Trello final_shipping_price',
    'actual',
    jsonb_build_object(
      'trello_card_id', parsed.trello_card_id,
      'trello_card_name', parsed.trello_card_name,
      'trello_card_url', parsed.trello_card_url,
      'tracking_number', parsed.tracking_number,
      'carrier', parsed.carrier,
      'field_name', parsed.metadata ->> 'shipping_price_field_name',
      'currency_assumption', case when parsed.metadata ? 'inbound_cost_currency' then null else 'USD default because Trello field has no currency' end,
      'cost_snapshot_at', parsed.metadata ->> 'cost_snapshot_at'
    ),
    p_now
  from (
    select
      s.*,
      case
        when shipping_raw ~ '^[0-9]+(\.[0-9]+)?$' then shipping_raw::numeric
        else null
      end as shipping_amount,
      case
        when upper(coalesce(s.metadata ->> 'inbound_cost_currency', 'USD')) in ('EUR', 'USD') then upper(coalesce(s.metadata ->> 'inbound_cost_currency', 'USD'))
        else 'USD'
      end as cost_currency
    from (
      select
        shipment.*,
        nullif(regexp_replace(replace(coalesce(shipment.metadata ->> 'final_shipping_price', ''), ',', '.'), '[^0-9.-]', '', 'g'), '') as shipping_raw
      from public.inbound_shipments shipment
      where shipment.metadata ? 'final_shipping_price'
    ) s
  ) parsed
  where parsed.shipping_amount > 0
  on conflict (cost_key) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        occurred_on = excluded.occurred_on,
        occurred_at = excluded.occurred_at,
        shipment_ref = excluded.shipment_ref,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = excluded.metadata,
        updated_at = p_now;

  get diagnostics v_inbound_shipping_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'sea_campaign_daily', v_sea_count,
    'google_ads_daily_spend', v_legacy_ads_count,
    'anthropic_api_daily_costs', v_ai_count,
    'voice_agent_calls', v_voice_count,
    'inbound_production_costs', v_inbound_production_count,
    'inbound_shipping_costs', v_inbound_shipping_count,
    'synced_at', p_now
  );
end;
$$;

revoke all on function public.ops_sync_known_cost_entries(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_sync_known_cost_entries(timestamptz) to service_role;
