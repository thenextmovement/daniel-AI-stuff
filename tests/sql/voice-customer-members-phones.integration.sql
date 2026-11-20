begin;
alter table master_customers alter updated_at set default '2026-11-20';
insert into customer_organizations(id,organization_id,name) values('30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Shared');
insert into master_customers(id,email,organization_id,customer_organization_id) values
('10000000-0000-0000-0000-000000000001','one@first.test','a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000002','two@other.test','a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000003','outsider@first.test','a0000000-0000-0000-0000-000000000001',null),
('10000000-0000-0000-0000-000000000004','foreign@other.test','a0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');
insert into voice_staff values('20000000-0000-0000-0000-000000000001');
insert into customer_contact_points(customer_id,kind,slot,value) values('10000000-0000-0000-0000-000000000002','email',1,'extra@alias.test');
insert into customer_previous_primary_emails values('a0000000-0000-0000-0000-000000000001','previous@alias.test','10000000-0000-0000-0000-000000000002');
do $test$
declare c uuid:='10000000-0000-0000-0000-000000000001';t uuid:='a0000000-0000-0000-0000-000000000001';actor uuid:='20000000-0000-0000-0000-000000000001'; m jsonb;rev timestamptz;i integer;
begin
 m:=voice_customer_order_members_v1(c,t);
 if not (m->>'explicit')::boolean or jsonb_array_length(m->'emails')<>4 or not (m->'emails' ? 'two@other.test') or not (m->'emails' ? 'previous@alias.test') then raise exception 'organization members incorrect';end if;
 if voice_customer_order_members_v1(c,'a0000000-0000-0000-0000-000000000002') is not null then raise exception 'foreign tenant accessible';end if;
 select updated_at into rev from master_customers where id=c;
 for i in 1..10 loop perform add_voice_customer_phone_v1(c,'+49159000000'||i::text,actor);end loop;
 perform add_voice_customer_phone_v1(c,'+491590000001',actor);
 if (select count(*) from customer_contact_points where customer_id=c and kind='phone')<>10 or (select count(*) from voice_customer_phone_numbers where customer_id=c)<>10 then raise exception 'plus phone not mirrored or duplicate';end if;
 begin
 perform add_voice_customer_phone_v1(c,'+442079460018',actor);
 raise exception 'eleventh phone accepted';
 exception when raise_exception then if sqlerrm<>'contact_limit_reached' then raise;end if;end;
 begin
 perform save_voice_customer_v1(c,t,rev,'One','Customer','one@first.test',null,'[]','[]',null,null,actor);
 raise exception 'stale editor overwrote plus';
 exception when serialization_failure then null;end;
 if has_function_privilege('anon','public.add_voice_customer_phone_v1(uuid,text,uuid)','execute') or has_function_privilege('authenticated','public.voice_customer_order_members_v1(uuid,uuid)','execute') then raise exception 'public access';end if;
end $test$;
rollback;
