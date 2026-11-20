delete from shopify_orders where shopify_order_id='1';
do $$begin if exists(select 1 from shopify_order_customer_links where shopify_order_id='1') then raise exception 'order deletion blocked';end if;end $$;
delete from master_customers where id='10000000-0000-4000-8000-000000000001';
do $$begin if exists(select 1 from customer_contact_points) or exists(select 1 from shopify_order_customer_links) then raise exception 'customer deletion blocked';end if;end $$;
select 'PASS: supplemental records preserve existing delete behavior' result;
