-- Additive mirror metadata; existing financial fields retain their meaning.
alter table public.shopify_orders
  add column if not exists is_test boolean,
  add column if not exists current_total_price numeric,
  add column if not exists shopify_updated_at timestamptz;
alter table public.master_customers add column if not exists orders_synced_at timestamptz;

create or replace function public.refresh_shopify_customer_totals_v1(p_observed_at timestamptz, p_expected_count integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_count integer; v_changed integer;
begin
 if p_observed_at is null or p_expected_count is null or p_expected_count<1
    or p_observed_at < statement_timestamp()-interval '30 minutes'
    or p_observed_at > statement_timestamp()+interval '1 minute' then
   raise exception 'SHOPIFY_TOTALS_INVALID_SNAPSHOT';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('shopify_customer_totals_v1',0));
 -- Do not calculate while batches are changing the mirror.
 lock table public.shopify_orders in share mode;
 if not exists(select 1 from public.workflow_audit_log
    where action='ops_source_mirror_verified' and status='success'
    and metadata->>'source'='shopify' and metadata->>'source_complete'='true'
    and (metadata->>'observed_at')::timestamptz=p_observed_at
    and (metadata->>'source_count')::integer=p_expected_count
    and (metadata->>'written_count')::integer=p_expected_count) then
   raise exception 'SHOPIFY_TOTALS_UNVERIFIED_SNAPSHOT';
 end if;
 select count(*) into v_count from public.shopify_orders where ingested_at=p_observed_at;
 if v_count<>p_expected_count or exists(select 1 from public.shopify_orders
    where ingested_at>p_observed_at) or exists(select 1 from public.shopify_orders
    where ingested_at=p_observed_at and (is_test is null or current_total_price is null
       or current_total_price<0 or shopify_updated_at is null or currency is null or currency !~ '^[A-Z]{3}$')) then
   raise exception 'SHOPIFY_TOTALS_INCOMPLETE_SNAPSHOT';
 end if;
 with totals as (
  select lower(btrim(email)) email, count(*)::integer quantity,
    case when bool_and(currency='EUR') then sum(current_total_price) else null end revenue
  from public.shopify_orders
  where ingested_at=p_observed_at and is_test=false and cancelled_at is null
    and nullif(btrim(email),'') is not null
  group by lower(btrim(email))
 ), calculated as (
  select c.id,coalesce(t.quantity,0) quantity,
   case when t.quantity is null then 0::numeric else t.revenue end revenue
  from public.master_customers c left join totals t on t.email=lower(btrim(c.email))
 )
 update public.master_customers c set total_orders=x.quantity,total_revenue=x.revenue,orders_synced_at=p_observed_at
 from calculated x where c.id=x.id and (c.orders_synced_at is null or c.orders_synced_at<=p_observed_at)
 and (c.total_orders is distinct from x.quantity or c.total_revenue is distinct from x.revenue
      or c.orders_synced_at is distinct from p_observed_at);
 get diagnostics v_changed=row_count;
 return jsonb_build_object('status','success','source_count',v_count,'customers_updated',v_changed,'observed_at',p_observed_at);
end $$;
revoke all on function public.refresh_shopify_customer_totals_v1(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.refresh_shopify_customer_totals_v1(timestamptz,integer) to service_role;
comment on column public.master_customers.orders_synced_at is 'Verified complete Shopify snapshot used for exact-email totals; excludes tests and cancelled orders.';
comment on column public.master_customers.total_revenue is 'Shopify current order totals in EUR after verified sync; NULL when eligible orders include another currency. Not a payment or accounting revenue measure.';
