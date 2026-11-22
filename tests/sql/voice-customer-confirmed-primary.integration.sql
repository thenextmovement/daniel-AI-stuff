
begin;
insert into master_customers(id,email,organization_id,first_name,last_name,name,request_id,updated_at)
values('10000000-0000-0000-0000-000000000001','old@example.test','a0000000-0000-0000-0000-000000000001','Old','Name','Old Name','REQ','2026-11-20'),
('10000000-0000-0000-0000-000000000002','untouched@example.test','a0000000-0000-0000-0000-000000000001','Untouched','Name','Untouched Name','OTHER','2026-11-20');
insert into voice_staff values('20000000-0000-0000-0000-000000000001');
do $test$
declare c uuid:='10000000-0000-0000-0000-000000000001';t uuid:='a0000000-0000-0000-0000-000000000001';actor uuid:='20000000-0000-0000-0000-000000000001';returned_id uuid; saved jsonb; previous jsonb; owned_before text[];
begin
 perform public.save_voice_customer_v1(c,t,'2026-11-20','Old','Name','old@example.test',null,'[]','[]',null,null,actor);
 -- Existing Kundenakte retains its own primary-contact editing contract.
 begin
 perform public.save_voice_customer_v2(c,t,(select updated_at from master_customers where id=c),'Old','Name','new@example.test','+4915904209999','[]','[]',null,null,actor,false,false);
 raise exception 'unconfirmed change accepted';
 exception when raise_exception then if sqlerrm<>'primary_email_confirmation_required' then raise;end if;end;
 begin
 perform public.save_voice_customer_v2(c,t,(select updated_at from master_customers where id=c),'Old','Name','new@example.test','+4915904209999','[]','[]',null,null,actor,true,false);
 raise exception 'unconfirmed phone accepted';
 exception when raise_exception then if sqlerrm<>'primary_phone_confirmation_required' then raise;end if;end;
 if (select email from master_customers where id=c)<>'old@example.test' then raise exception 'partial write';end if;
 perform public.save_voice_customer_v2(c,t,(select updated_at from master_customers where id=c),'Old','Name','new@example.test','+4915904209999','[]','[]',null,null,actor,true,true);
 if not exists(select 1 from master_customers where id=c and email='new@example.test' and phone='+4915904209999') then raise exception 'primary values not persisted';end if;
 if has_function_privilege('anon','public.save_voice_customer_v2(uuid,uuid,timestamptz,text,text,text,text,jsonb,jsonb,uuid,text,uuid,boolean,boolean)','execute') or has_function_privilege('authenticated','public.save_voice_customer_v2(uuid,uuid,timestamptz,text,text,text,text,jsonb,jsonb,uuid,text,uuid,boolean,boolean)','execute') then raise exception 'public write permission';end if;

 perform public.save_voice_customer_v1(c,t,(select updated_at from master_customers where id=c),'New','Name','new@example.test','+4915904209999','[]','[]',null,null,actor);
 update master_customers set first_name='Imported',last_name='Fresh',email='old@example.test',phone=null where id=c;
 if not exists(select 1 from master_customers where id=c and first_name='New' and last_name='Fresh' and email='new@example.test' and phone='+4915904209999') then raise exception 'import overwrote manually changed fields';end if;
 insert into master_customers(id,email,organization_id,first_name,last_name,phone) values(gen_random_uuid(),'old@example.test',t,'Old','Newer',null)
 on conflict(email) do update set first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone
 returning id into returned_id;
 if returned_id<>c then raise exception 'old-email upsert split identity';end if;
 if (select count(*) from master_customers)<>2 then raise exception 'duplicate customer';end if;
 update master_customers set first_name='Still importable' where email='untouched@example.test';
 if not exists(select 1 from master_customers where email='untouched@example.test' and first_name='Still importable') then raise exception 'unrelated import blocked';end if;
 perform public.patch_customer_record_contact_v1(c,'{"first_name":"Edited again","phone":"+442079460018"}');
 if not exists(select 1 from master_customers where id=c and first_name='Edited again' and phone='+442079460018') then raise exception 'existing Kundenakte blocked';end if;
 select to_jsonb(m) into previous from master_customers m where id=c;
 select fields into owned_before from customer_manual_contact_fields where customer_id=c;
 saved:=public.patch_customer_record_contact_v1(c,'{"email":"failed@example.test","last_name":"Failed"}');
 perform public.restore_customer_record_contact_v1(c,jsonb_build_object('email',previous->'email','last_name',previous->'last_name'),saved->'_contactRollback');
 if exists(select 1 from customer_previous_primary_emails where email='failed@example.test') then raise exception 'failed edit reserved email';end if;
 if (select fields from customer_manual_contact_fields where customer_id=c) is distinct from owned_before then raise exception 'failed edit retained field ownership';end if;
 if (select email from master_customers where id=c)<>previous->>'email' then raise exception 'rollback did not restore contact';end if;
end $test$;
rollback;
