create or replace function public.gads_paid_deal_export_candidates(
  p_lookback_days integer default 90,
  p_limit integer default 100
)
returns table (
  shopify_order_number text,
  shopify_created_at timestamptz,
  request_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  conversion_value numeric
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    mo.shopify_order_number,
    mo.shopify_created_at,
    mo.request_id,
    lower(btrim(mc.email)) as email,
    lower(btrim(coalesce(mc.first_name, ''))) as first_name,
    lower(btrim(coalesce(mc.last_name, ''))) as last_name,
    btrim(coalesce(mc.phone, '')) as phone,
    cv.conversion_value
  from public.master_orders mo
  join public.master_customers mc
    on mc.id = mo.customer_id
  join lateral (
    select round(
      (ss.offer_snapshot #>> '{totals,subtotalNet}')::numeric,
      2
    ) as conversion_value
    from public.supplier_sales ss
    where (
        ss.shopify_order_id = mo.shopify_order_id
        or regexp_replace(coalesce(ss.shopify_order_name, ''), '^#', '') =
           regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '')
      )
      and (ss.offer_snapshot #>> '{totals,subtotalNet}') ~ '^[0-9]+([.][0-9]+)?$'
      and (ss.offer_snapshot #>> '{totals,subtotalNet}')::numeric >= 0
    order by
      case when ss.shopify_order_id = mo.shopify_order_id then 0 else 1 end,
      ss.updated_at desc
    limit 1
  ) cv on true
  where mo.status = 'paid'
    and mo.cancelled_at is null
    and mo.shopify_created_at >= current_timestamp - make_interval(
      days => least(90, greatest(1, coalesce(p_lookback_days, 90)))
    )
    and nullif(btrim(mo.shopify_order_number), '') is not null
    and nullif(btrim(mc.email), '') is not null
    and not exists (
      select 1
      from public.google_ads_conversions gac
      where gac.shopify_order_number = mo.shopify_order_number
    )
  order by mo.shopify_created_at desc, mo.shopify_order_number
  limit least(500, greatest(1, coalesce(p_limit, 100)));
$function$;

comment on function public.gads_paid_deal_export_candidates(integer, integer)
is 'Returns only paid, non-cancelled, canonical-net Google Ads deal candidates that are not yet in the export ledger.';

revoke all on function public.gads_paid_deal_export_candidates(integer, integer)
from public, anon, authenticated;

grant execute on function public.gads_paid_deal_export_candidates(integer, integer)
to service_role;
