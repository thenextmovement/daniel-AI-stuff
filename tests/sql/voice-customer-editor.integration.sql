
begin;
insert into master_customers(id,email,organization_id,first_name,last_name,name,request_id,updated_at) values
('10000000-0000-0000-0000-000000000001','old@example.test','a0000000-0000-0000-0000-000000000001','Old','Name','Old Name','REQ','2026-11-20'),
('10000000-0000-0000-0000-000000000002','other@example.test','a0000000-0000-0000-0000-000000000001','Other','Customer','Other Customer','OTHER','2026-11-20');
insert into voice_staff values('20000000-0000-0000-0000-000000000001');
insert into master_requests(request_id,customer_id) values('REQ','10000000-0000-0000-0000-000000000001');
insert into followup_queue values('REQ','old@example.test','Old Name'),('OTHER','other@example.test','Other Customer');
insert into lead_followup_plans values('REQ','old@example.test');
insert into document_journey values('10000000-0000-0000-0000-000000000001','old@example.test');
do $test$
declare c uuid:='10000000-0000-0000-0000-000000000001';t uuid:='a0000000-0000-0000-0000-000000000001';actor uuid:='20000000-0000-0000-0000-000000000001';rev timestamptz;
begin
 perform public.save_voice_customer_v1(c,t,'2026-11-20','New','Name','new@example.test','+4915904209999','["extra@example.test"]','["+493089755140"]',null,'Example',actor);
 if not exists(select 1 from master_customers where id=c and first_name='New' and email='new@example.test' and phone='+4915904209999' and customer_organization_id is not null) then raise exception 'main fields not saved';end if;
 if (select count(*) from customer_contact_points where customer_id=c)<>2 then raise exception 'aliases not saved';end if;
 if not exists(select 1 from voice_customer_phone_numbers where customer_id=c and phone='+493089755140') then raise exception 'legacy phone consumer not updated';end if;
 if not exists(select 1 from followup_queue where request_id='REQ' and customer_email='new@example.test' and customer_name='New Name') then raise exception 'downstream not updated';end if;
 if not exists(select 1 from followup_queue where request_id='OTHER' and customer_email='other@example.test') then raise exception 'unrelated customer changed';end if;
 select updated_at into rev from master_customers where id=c;
 begin
 perform public.save_voice_customer_v1(c,t,'2026-11-20','Lost','Name','new@example.test',null,'[]','[]',null,null,actor);
 raise exception 'stale revision accepted';
 exception when serialization_failure then null;end;
 begin
 perform public.save_voice_customer_v1(c,t,rev,'Bad','Name','bad@example.test',null,'["not-an-email"]','[]',null,null,actor);
 raise exception 'invalid alias accepted';
 exception when check_violation then null;end;
 if (select email from master_customers where id=c)<>'new@example.test' then raise exception 'partial write after invalid alias';end if;
 begin
 perform public.save_voice_customer_v1(c,t,rev,'Bad','Name','other@example.test',null,'[]','[]',null,null,actor);
 raise exception 'duplicate primary accepted';
 exception when unique_violation then null;end;
 perform public.save_voice_customer_v1(c,t,rev,'New','Name','new@example.test',null,'[]','[]',null,null,actor);
 if exists(select 1 from customer_contact_points where customer_id=c) or exists(select 1 from voice_customer_phone_numbers where customer_id=c) then raise exception 'removed aliases retained';end if;
 if exists(select 1 from master_customers where id=c and customer_organization_id is not null) then raise exception 'organization not removed';end if;
 if has_function_privilege('anon','public.save_voice_customer_v1(uuid,uuid,timestamptz,text,text,text,text,jsonb,jsonb,uuid,text,uuid)','execute') then raise exception 'public write permission';end if;
end $test$;
rollback;
