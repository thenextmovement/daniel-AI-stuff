\set ON_ERROR_STOP on
insert into master_customers values
 ('10000000-0000-4000-8000-000000000001','one@example.test','+4930123456','a0000000-0000-0000-0000-000000000001',null),
 ('10000000-0000-4000-8000-000000000002','duplicate@example.test',null,'a0000000-0000-0000-0000-000000000001',null),
 ('10000000-0000-4000-8000-000000000003','DUPLICATE@example.test',null,'a0000000-0000-0000-0000-000000000001',null),
 ('10000000-0000-4000-8000-000000000004','other@example.test',null,'b0000000-0000-0000-0000-000000000001',null);
insert into customer_organizations values
 ('20000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','Org A'),
 ('20000000-0000-4000-8000-000000000002','a0000000-0000-0000-0000-000000000001','Org B'),
 ('20000000-0000-4000-8000-000000000003','b0000000-0000-0000-0000-000000000001','Other tenant');
insert into customer_contact_points(customer_id,kind,slot,value)
 select '10000000-0000-4000-8000-000000000001','email',i,'alias'||i||'@example.test' from generate_series(1,10) i;
insert into customer_contact_points(customer_id,kind,slot,value)
 select '10000000-0000-4000-8000-000000000001','phone',i,'+4930123456'||i from generate_series(1,10) i;
do $$begin
 begin insert into customer_contact_points(customer_id,kind,slot,value) values
 ('10000000-0000-4000-8000-000000000001','email',11,'extra@example.test');
 raise exception 'eleventh accepted'; exception when check_violation then null;end;
 begin insert into customer_contact_points(customer_id,kind,slot,value) values
 ('10000000-0000-4000-8000-000000000001','phone',11,'+493012345678');
 raise exception 'eleventh phone accepted'; exception when check_violation then null;end;
 begin update customer_contact_points set value='invalid' where kind='phone' and slot=1;
 raise exception 'invalid phone accepted'; exception when check_violation then null;end;
 begin update customer_contact_points set value='BAD@EXAMPLE.TEST' where kind='email' and slot=1;
 raise exception 'unnormalized email accepted'; exception when check_violation then null;end;
 begin update customer_contact_points set value='alias2@example.test' where kind='email' and slot=1;
 raise exception 'duplicate accepted'; exception when unique_violation then null;end;
 if (select phone from master_customers where id='10000000-0000-4000-8000-000000000001')<>'+4930123456' then raise exception 'main changed';end if;
end $$;
insert into shopify_orders(shopify_order_id,email,is_test,tags) values
 ('1','one@example.test',false,null),('2','duplicate@example.test',false,null),
 ('3','missing@example.test',false,null),('4','one@example.test',false,'Quentin (noch bezahlen)'),
 ('5','one@example.test',true,null),('6','alias1@example.test',false,null),
 ('7','other@example.test',false,null),('8','one@example.test',null,null);
do $$declare r jsonb;begin
 r:=backfill_shopify_customer_links_v1('a0000000-0000-0000-0000-000000000001',array['Quentin (noch bezahlen)']);
 if (r#>>'{counts,eligible}')::int<>2 or (select count(*) from shopify_order_customer_links)<>0 then raise exception 'dryrun';end if;
 r:=backfill_shopify_customer_links_v1('a0000000-0000-0000-0000-000000000001',array['Quentin (noch bezahlen)'],true);
 if (r->>'inserted')::int<>2 then raise exception 'insert count %',r;end if;
 r:=backfill_shopify_customer_links_v1('a0000000-0000-0000-0000-000000000001',array['Quentin (noch bezahlen)'],true);
 if (r->>'inserted')::int<>0 then raise exception 'not idempotent';end if;
end $$;
select set_customer_organization_v1('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
select set_customer_organization_v1('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
do $$begin
 if exists(select 1 from customer_linked_shopify_orders where customer_organization_id is distinct from '20000000-0000-4000-8000-000000000002'::uuid) then raise exception 'org move not reflected';end if;
 begin perform set_customer_organization_v1('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003');
 raise exception 'cross tenant allowed';exception when raise_exception then if sqlerrm<>'ORGANIZATION_NOT_FOUND_IN_TENANT' then raise;end if;end;
end $$;
select set_customer_organization_v1('10000000-0000-4000-8000-000000000001',null);
update master_customers set email='changed@example.test' where id='10000000-0000-4000-8000-000000000001';
do $$begin
 if (select count(*) from customer_linked_shopify_orders)<>2 then raise exception 'email lost order';end if;
 if exists(select 1 from customer_linked_shopify_orders where customer_organization_id is not null) then raise exception 'org removal';end if;
 if has_table_privilege('anon','customer_contact_points','select') or has_table_privilege('authenticated','shopify_order_customer_links','insert') or has_function_privilege('anon','backfill_shopify_customer_links_v1(uuid,text[],boolean)','execute') then raise exception 'public access';end if;
end $$;
select 'PASS: contact limits/validation/dedup, main fields preserved, dry-run, ambiguous/unmatched/test/supplier/tenant exclusions, idempotency, org reassignment/removal, stable order links, permissions' result;
