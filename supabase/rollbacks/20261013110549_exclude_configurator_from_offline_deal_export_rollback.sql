-- NEONTRIP only. Replace the existing candidate filter; no new objects,
-- triggers, schedules, credentials, conversion actions or permissions.
-- Guard the complete active definition so a parallel change cannot be lost.
do $migration$
declare
  current_definition text := pg_catalog.pg_get_functiondef(
    'public.gads_paid_deal_export_candidates_v2(integer,integer)'::regprocedure
  );
begin
  if pg_catalog.md5(current_definition) = '937e220972649bb428bca6c0c9a673cf' then
    return;
  end if;
  if pg_catalog.md5(current_definition) <> '8087a3962a148fdf1cb694e552cb9d8d' then
    raise exception 'NEONTRIP Ads export changed; re-inspect before rolling back configurator exclusion';
  end if;
  execute $definition$CREATE OR REPLACE FUNCTION public.gads_paid_deal_export_candidates_v2(p_lookback_days integer DEFAULT 90, p_limit integer DEFAULT 100)
 RETURNS TABLE(shopify_order_number text, shopify_created_at timestamp with time zone, request_id uuid, email text, first_name text, last_name text, phone text, conversion_value numeric, conversion_time timestamp with time zone, value_source text, time_source text, request_resolution_source text, billing_case_id uuid, supplier_sale_id uuid, refund_net_cents bigint, gclid text, gbraid text, wbraid text, hashed_email text, consent_ad_user_data text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    mo.shopify_order_number,
    mo.shopify_created_at,
    resolved.resolved_request_id,
    pg_catalog.lower(pg_catalog.btrim(mc.email)) as email,
    pg_catalog.lower(pg_catalog.btrim(coalesce(mc.first_name, ''))) as first_name,
    pg_catalog.lower(pg_catalog.btrim(coalesce(mc.last_name, ''))) as last_name,
    pg_catalog.btrim(coalesce(mc.phone, '')) as phone,
    pg_catalog.round(financial.remaining_net_cents::numeric / 100.0, 2) as conversion_value,
    financial.conversion_time,
    financial.value_source,
    financial.time_source,
    resolved.resolution_source,
    financial.billing_case_id,
    financial.supplier_sale_id,
    financial.refund_net_cents,
    private.gads_valid_click_id_v1(mr.gclid) as gclid,
    private.gads_valid_click_id_v1(mr.gbraid) as gbraid,
    private.gads_valid_click_id_v1(mr.wbraid) as wbraid,
    case
      when mr.consent_ad_user_data = 'granted'
       and customer_match_v2.normalize_buyer_email(request_customer.email) is not null
        then pg_catalog.encode(
          extensions.digest(
            customer_match_v2.normalize_buyer_email(request_customer.email),
            'sha256'
          ),
          'hex'
        )
      else null
    end as hashed_email,
    mr.consent_ad_user_data
  from public.master_orders mo
  join public.master_customers mc
    on mc.id = mo.customer_id
  cross join lateral public.resolve_shopify_order_request_link_v1(
    mo.shopify_order_id,
    mo.shopify_order_number,
    mo.customer_id,
    coalesce(mo.shopify_created_at, mo.created_at),
    mo.note
  ) resolved
  join public.master_requests mr
    on mr.id = resolved.resolved_request_id
  left join public.master_customers request_customer
    on request_customer.id = mr.customer_id
  cross join lateral private.gads_deal_financial_state_v1(
    mo.shopify_order_id,
    mo.shopify_order_number
  ) financial
  where financial.paid_evidence
    and not financial.cancelled
    and financial.refund_ledger_valid
    and financial.remaining_net_cents > 0
    and financial.conversion_time is not null
    and financial.conversion_time >= current_timestamp - pg_catalog.make_interval(
      days => least(90, greatest(1, coalesce(p_lookback_days, 90)))
    )
    and nullif(pg_catalog.btrim(mo.shopify_order_number), '') is not null
    and nullif(pg_catalog.btrim(mc.email), '') is not null
    and (
      private.gads_valid_click_id_v1(mr.gclid) is not null
      or private.gads_valid_click_id_v1(mr.gbraid) is not null
      or private.gads_valid_click_id_v1(mr.wbraid) is not null
      or (
        mr.consent_ad_user_data = 'granted'
        and customer_match_v2.normalize_buyer_email(request_customer.email) is not null
      )
    )
    and not exists (
      select 1
      from public.google_ads_conversions gac
      where pg_catalog.regexp_replace(coalesce(gac.shopify_order_number, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '')
    )
  order by financial.conversion_time asc, mo.shopify_order_number
  limit least(500, greatest(1, coalesce(p_limit, 100)));
$function$
$definition$;
end;
$migration$;
