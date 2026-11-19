begin;
insert into master_customers(id,request_id,phone) values('10000000-0000-4000-8000-000000000001','legacy','+493055500001'),('10000000-0000-4000-8000-000000000002','other',null);
insert into master_requests(id,request_id,customer_id) values('20000000-0000-4000-8000-000000000001','legacy',null),('20000000-0000-4000-8000-000000000002','linked','10000000-0000-4000-8000-000000000001');
insert into voice_staff(id) values('30000000-0000-4000-8000-000000000001');
select save_voice_customer_brief('10000000-0000-4000-8000-000000000001','legacy','fresh',repeat('a',64),'2026-11-19T12:00Z');
select save_voice_customer_brief('10000000-0000-4000-8000-000000000001','legacy','stale',repeat('b',64),'2026-11-19T11:00Z');
select save_voice_customer_brief('10000000-0000-4000-8000-000000000001','linked','linked',repeat('c',64),'2026-11-19T12:00Z');
do $$begin
 if (select summary from voice_customer_briefs where request_id='legacy')<>'fresh' then raise exception 'stale_overwrite';end if;
 begin perform save_voice_customer_brief('10000000-0000-4000-8000-000000000002','linked','wrong',repeat('d',64),now());raise exception 'expected_binding_failure';
 exception when raise_exception then if sqlerrm<>'customer_binding_mismatch' then raise;end if;end;
 if has_table_privilege('anon','voice_customer_phone_numbers','select') or has_function_privilege('authenticated','save_voice_customer_brief(uuid,text,text,text,timestamptz)','execute') then raise exception 'public_access';end if;
end $$;
insert into voice_customer_phone_numbers(customer_id,phone,created_by) values('10000000-0000-4000-8000-000000000001','+49154312345678','30000000-0000-4000-8000-000000000001');
insert into voice_customer_phone_numbers(customer_id,phone,created_by) values('10000000-0000-4000-8000-000000000001','+49154312345678','30000000-0000-4000-8000-000000000001') on conflict do nothing;
do $$begin
 if (select count(*) from voice_customer_phone_numbers)<>1 then raise exception 'duplicate';end if;
 if (select phone from master_customers where id='10000000-0000-4000-8000-000000000001')<>'+493055500001' then raise exception 'primary_changed';end if;
 if not exists(select from voice_customer_directory where id='10000000-0000-4000-8000-000000000001' and additional_phones @> array['+49154312345678'])then raise exception 'alias_not_visible';end if;
end $$;
rollback;
