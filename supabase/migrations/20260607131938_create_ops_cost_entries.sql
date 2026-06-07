create table if not exists public.ops_cost_entries (
  id uuid primary key default gen_random_uuid(),
  cost_key text not null unique,
  source text not null,
  source_ref text not null,
  category text not null,
  subcategory text null,
  amount numeric not null,
  currency text not null default 'EUR',
  occurred_on date not null,
  occurred_at timestamptz null,
  request_ref text null,
  order_ref text null,
  shipment_ref text null,
  description text null,
  confidence text not null default 'actual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_cost_entries_amount_check check (amount >= 0),
  constraint ops_cost_entries_currency_check check (currency in ('EUR', 'USD')),
  constraint ops_cost_entries_category_check check (
    category in ('ads', 'ai', 'voice', 'shipping', 'production', 'customs', 'tool', 'manual', 'other')
  ),
  constraint ops_cost_entries_confidence_check check (confidence in ('actual', 'derived', 'estimated'))
);

create index if not exists ops_cost_entries_period_idx
  on public.ops_cost_entries(occurred_on desc, category, subcategory);

create index if not exists ops_cost_entries_source_idx
  on public.ops_cost_entries(source, source_ref);

create index if not exists ops_cost_entries_refs_idx
  on public.ops_cost_entries(request_ref, order_ref, shipment_ref);

alter table public.ops_cost_entries enable row level security;

create policy "ops_cost_entries_service_role_all"
  on public.ops_cost_entries
  for all
  to service_role
  using (true)
  with check (true);

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

  return jsonb_build_object(
    'ok', true,
    'sea_campaign_daily', v_sea_count,
    'google_ads_daily_spend', v_legacy_ads_count,
    'anthropic_api_daily_costs', v_ai_count,
    'voice_agent_calls', v_voice_count,
    'synced_at', p_now
  );
end;
$$;

revoke all on table public.ops_cost_entries from public, anon, authenticated;
revoke all on function public.ops_sync_known_cost_entries(timestamptz) from public, anon, authenticated;

grant all on table public.ops_cost_entries to service_role;
grant execute on function public.ops_sync_known_cost_entries(timestamptz) to service_role;
