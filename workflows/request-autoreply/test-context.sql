\set ON_ERROR_STOP on
begin;
insert into public.master_customers(id,email,first_name,last_name,company_name,organization_id) values
('10000000-0000-4000-8000-000000000001','person@gmail.com','Alex','Muster','Example Studio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000002','alex@studio.test','Alex','Muster','EXAMPLE STUDIO GMBH','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000003','billing@studio.test','Finance','Office','Example Studio GmbH','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000004','stranger@gmail.com','Other','Person','Example Studio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000005','colleague@studio.test','Kim','Muster','Example Studio GmbH','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000006','other@gmail.com','Alex','Muster','Different Studio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('10000000-0000-4000-8000-000000000007','tenant@studio.test','Kim','Muster','Example Studio GmbH','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.master_requests(request_id,customer_id,form_id,product_type,file_urls) select
 'qa-'||right(id::text,1),id,'landing-page-form','LED Neonschild','{logo.svg}' from public.master_customers where email like '%studio.test' or email like '%gmail.com';
insert into public.master_orders(customer_id,shopify_order_id,status) values
('10000000-0000-4000-8000-000000000003','qa-paid','paid');

set local role service_role;
do $$
declare x jsonb;
begin
  x:=public.get_request_autoreply_relationship_context('person@gmail.com','qa-1');
  assert x->>'relationship_type'='new', 'private address must not inherit personal purchases';
  assert x->>'organization_relationship_type'='existing_customer', 'same person + company should find company purchase';
  assert x->>'organization_match_method'='same_person_and_company';
  assert x->>'organization_completed_order_count'='1';
  assert x->>'attachment_state'='present' and x->>'product_type'='LED Neonschild';
  x:=public.get_request_autoreply_relationship_context('stranger@gmail.com','qa-4');
  assert x->>'organization_relationship_type'='new', 'company name alone cannot link private contact';
  x:=public.get_request_autoreply_relationship_context('other@gmail.com','qa-6');
  assert x->>'organization_relationship_type'='new', 'same person name alone cannot link company';
  x:=public.get_request_autoreply_relationship_context('colleague@studio.test','qa-5');
  assert x->>'organization_relationship_type'='existing_customer';
  assert x->>'organization_match_method'='business_domain_and_company';
  x:=public.get_request_autoreply_relationship_context('tenant@studio.test','qa-7');
  assert x->>'organization_relationship_type'='new', 'tenant isolation';
  x:=public.get_request_autoreply_relationship_context('person@gmail.com','qa-5');
  assert x->>'organization_relationship_type'='new', 'request/email binding';
  x:=public.get_request_autoreply_relationship_context('billing@studio.test','qa-3');
  assert x->>'relationship_type'='existing_customer', 'exact email contract';
  assert not has_function_privilege('anon','public.get_request_autoreply_relationship_context(text,text)','execute');
  assert not has_function_privilege('authenticated','public.get_request_autoreply_relationship_context(text,text)','execute');
end $$;
reset role;
update public.master_orders set cancelled_at=now() where shopify_order_id='qa-paid';
set local role service_role;
do $$ declare x jsonb; begin
  x:=public.get_request_autoreply_relationship_context('person@gmail.com','qa-1');
  assert x->>'organization_relationship_type'='repeat_inquiry', 'cancelled order is not a purchase';
  assert x->>'organization_completed_order_count'='0';
end $$;
reset role;
-- Same name/company against two different business domains is ambiguous.
insert into public.master_customers(email,first_name,last_name,company_name,organization_id) values
('alex@other-studio.test','Alex','Muster','Example Studio','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
set local role service_role;
do $$ declare x jsonb; begin
  x:=public.get_request_autoreply_relationship_context('person@gmail.com','qa-1');
  assert x->>'organization_match_method'='none', 'ambiguous company domain must fail closed';
end $$;
rollback;
select 'request-autoreply context checks passed' as result;
