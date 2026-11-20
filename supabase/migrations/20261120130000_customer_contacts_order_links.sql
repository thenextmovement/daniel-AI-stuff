-- Additive customer contact storage. No existing import, main field or queue changes.
create table public.customer_contact_points (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 kind text not null check (kind in ('email','phone')),
 slot smallint not null check (slot between 1 and 10),
 value text not null,
 label text not null default '' check (length(label)<=100),
 created_at timestamptz not null default now(),
 unique(customer_id,kind,slot),
 unique(customer_id,kind,value),
 check ((kind='email' and value=lower(btrim(value)) and length(value)<=254
         and value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
     or (kind='phone' and value ~ '^\+[1-9][0-9]{6,14}$'))
);
create index customer_contact_points_lookup on public.customer_contact_points(kind,value);
alter table public.customer_contact_points enable row level security;
revoke all on public.customer_contact_points from public,anon,authenticated;
grant select,insert,update,delete on public.customer_contact_points to service_role;
comment on table public.customer_contact_points is 'Optional additional contact addresses: up to 10 emails and 10 E.164 phone numbers per existing customer. Not CC recipients; does not replace main fields.';

-- Stable links are separate from source orders and operational master_orders.
create table public.shopify_order_customer_links (
 shopify_order_id text primary key references public.shopify_orders(shopify_order_id) on delete restrict,
 customer_id uuid not null references public.master_customers(id) on delete restrict,
 matched_email text not null,
 match_method text not null check (match_method='unique_contact_email'),
 created_at timestamptz not null default now()
);
create index shopify_order_customer_links_customer on public.shopify_order_customer_links(customer_id);
alter table public.shopify_order_customer_links enable row level security;
revoke all on public.shopify_order_customer_links from public,anon,authenticated;
grant select on public.shopify_order_customer_links to service_role;

-- Always resolve the customer's CURRENT organization; never copy a stale org onto an order.
create view public.customer_linked_shopify_orders with (security_invoker=true) as
 select l.shopify_order_id,l.customer_id,c.organization_id as tenant_id,
 c.customer_organization_id, o.name,o.created_at,o.currency,o.current_total_price,
 o.is_test,o.cancelled_at,l.match_method,l.created_at as linked_at
 from public.shopify_order_customer_links l
 join public.master_customers c on c.id=l.customer_id
 join public.shopify_orders o on o.shopify_order_id=l.shopify_order_id;
revoke all on public.customer_linked_shopify_orders from public,anon,authenticated;
grant select on public.customer_linked_shopify_orders to service_role;

create function public.set_customer_organization_v1(p_customer_id uuid,p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_tenant uuid;
begin
 select organization_id into v_tenant from public.master_customers where id=p_customer_id for update;
 if not found or v_tenant is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
 if p_organization_id is not null and not exists(select 1 from public.customer_organizations
    where id=p_organization_id and organization_id=v_tenant) then
  raise exception 'ORGANIZATION_NOT_FOUND_IN_TENANT';
 end if;
 update public.master_customers set customer_organization_id=p_organization_id
 where id=p_customer_id and customer_organization_id is distinct from p_organization_id;
end $$;
revoke all on function public.set_customer_organization_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_customer_organization_v1(uuid,uuid) to service_role;

-- Caller supplies the confirmed tenant and recognized supplier tags. Dry-run is the default.
create function public.backfill_shopify_customer_links_v1(
 p_tenant_id uuid,p_supplier_tags text[],p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' set lock_timeout='2s' as $$
declare v_report jsonb; v_written integer:=0;
begin
 if p_tenant_id is null or p_supplier_tags is null or cardinality(p_supplier_tags)=0 then
  raise exception 'BACKFILL_SCOPE_REQUIRED';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('backfill_shopify_customer_links_v1',0));
 -- Table locks give one consistent candidate set; short bounded transaction only.
 lock table public.master_customers in share mode;
 lock table public.customer_contact_points in share mode;
 lock table public.shopify_orders in share mode;
 create temporary table customer_link_candidates on commit drop as
 with addresses as (
  select id customer_id,organization_id,lower(btrim(email)) email from public.master_customers
  union
  select c.id,c.organization_id,p.value from public.customer_contact_points p
  join public.master_customers c on c.id=p.customer_id where p.kind='email'
 ), identity_groups as (
  select email,count(distinct customer_id) n,min(customer_id::text)::uuid customer_id,
   bool_and(organization_id=p_tenant_id) in_tenant
  from addresses where nullif(email,'') is not null group by email
 )
 select o.shopify_order_id,g.customer_id,lower(btrim(coalesce(nullif(btrim(o.email),''),o.kunde_email))) email,
 case when l.shopify_order_id is not null then 'already_linked'
 when exists(select 1 from regexp_split_to_table(coalesce(o.tags,''),',') t
   where lower(btrim(t)) in (select lower(btrim(x)) from unnest(p_supplier_tags) x)) then 'supplier_excluded'
 when o.is_test is distinct from false then 'test_or_unverified'
 when g.n>1 then 'ambiguous'
 when g.n is null then 'unmatched'
 when g.in_tenant is distinct from true then 'outside_tenant'
 else 'eligible' end status
 from public.shopify_orders o left join identity_groups g
 on g.email=lower(btrim(coalesce(nullif(btrim(o.email),''),o.kunde_email)))
 left join public.shopify_order_customer_links l using(shopify_order_id);
 select jsonb_object_agg(status,n) into v_report from (
 select status,count(*) n from customer_link_candidates group by status) counts;
 if p_apply then
  insert into public.shopify_order_customer_links(shopify_order_id,customer_id,matched_email,match_method)
  select shopify_order_id,customer_id,email,'unique_contact_email' from customer_link_candidates
  where status='eligible' on conflict(shopify_order_id) do nothing;
  get diagnostics v_written=row_count;
 end if;
 drop table customer_link_candidates;
 return jsonb_build_object('applied',p_apply,'inserted',v_written,'counts',coalesce(v_report,'{}'::jsonb));
end $$;
revoke all on function public.backfill_shopify_customer_links_v1(uuid,text[],boolean) from public,anon,authenticated;
grant execute on function public.backfill_shopify_customer_links_v1(uuid,text[],boolean) to service_role;
