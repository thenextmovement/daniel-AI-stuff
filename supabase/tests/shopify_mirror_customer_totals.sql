create role anon; create role authenticated; create role service_role;
create table public.shopify_orders(shopify_order_id text primary key,email text,currency text,cancelled_at timestamptz,ingested_at timestamptz);
create table public.master_customers(id integer primary key,email text,total_orders integer default 0,total_revenue numeric default 0);
create table public.workflow_audit_log(action text,status text,metadata jsonb);
\i /work/supabase/migrations/20261120102000_shopify_mirror_customer_totals.sql
insert into master_customers(id,email) values (1,'Person@example.test'),(2,'other@example.test'),(3,'foreign@example.test'),(4,'none@example.test');
insert into shopify_orders values
 ('1',' person@example.test ','EUR',null,now(),false,80,now()),
 ('2','person@example.test','EUR',null,now(),true,999,now()),
 ('3','person@example.test','EUR',now(),now(),false,999,now()),
 ('4','other@example.test','EUR',null,now(),false,50,now()),
 ('5','foreign@example.test','DKK',null,now(),false,100,now());
-- Ensure a single frozen timestamp.
update shopify_orders set ingested_at='2026-01-01';
update shopify_orders set ingested_at=statement_timestamp();
create temp table snapshot as select max(ingested_at) observed from shopify_orders;
do $$ begin
 begin perform refresh_shopify_customer_totals_v1((select observed from snapshot),5); raise exception 'accepted unverified'; exception when others then if sqlerrm<>'SHOPIFY_TOTALS_UNVERIFIED_SNAPSHOT' then raise; end if; end;
end $$;
insert into workflow_audit_log select 'ops_source_mirror_verified','success',jsonb_build_object('source','shopify','source_complete',true,'source_count',5,'written_count',5,'observed_at',observed) from snapshot;
select refresh_shopify_customer_totals_v1((select observed from snapshot),5);
do $$ begin
 if not exists(select 1 from master_customers where id=1 and total_orders=1 and total_revenue=80) then raise exception 'wrong exact-email or exclusions'; end if;
 if not exists(select 1 from master_customers where id=2 and total_orders=1 and total_revenue=50) then raise exception 'domain incorrectly grouped'; end if;
 if not exists(select 1 from master_customers where id=3 and total_orders=1 and total_revenue is null) then raise exception 'currency mixed'; end if;
 if not exists(select 1 from master_customers where id=4 and total_orders=0 and total_revenue=0) then raise exception 'missing zero'; end if;
 if (refresh_shopify_customer_totals_v1((select observed from snapshot),5)->>'customers_updated')::int<>0 then raise exception 'not idempotent'; end if;
 if has_function_privilege('anon','public.refresh_shopify_customer_totals_v1(timestamptz,integer)','execute') then raise exception 'anon permitted'; end if;
 if has_function_privilege('authenticated','public.refresh_shopify_customer_totals_v1(timestamptz,integer)','execute') then raise exception 'user permitted'; end if;
end $$;
update shopify_orders set is_test=null where shopify_order_id='1';
do $$ begin
 begin perform refresh_shopify_customer_totals_v1((select observed from snapshot),5); raise exception 'accepted missing flag'; exception when others then if sqlerrm<>'SHOPIFY_TOTALS_INCOMPLETE_SNAPSHOT' then raise; end if; end;
 if (select total_orders from master_customers where id=1)<>1 then raise exception 'failure changed counters'; end if;
end $$;
update shopify_orders set is_test=false where shopify_order_id='1';
delete from shopify_orders where shopify_order_id='5';
do $$ begin
 begin perform refresh_shopify_customer_totals_v1((select observed from snapshot),5); raise exception 'accepted partial'; exception when others then if sqlerrm<>'SHOPIFY_TOTALS_INCOMPLETE_SNAPSHOT' then raise; end if; end;
 begin perform refresh_shopify_customer_totals_v1(now()-interval '1 hour',5); raise exception 'accepted stale'; exception when others then if sqlerrm<>'SHOPIFY_TOTALS_INVALID_SNAPSHOT' then raise; end if; end;
end $$;
select 'ALL SQL CHECKS PASSED';
