begin;
insert into master_customers(id,email,phone,organization_id,updated_at) values('10000000-0000-0000-0000-000000000003','legacy@example.test','015904209999','a0000000-0000-0000-0000-000000000001','2026-11-20');
do $$declare c uuid:='10000000-0000-0000-0000-000000000003';t uuid:='a0000000-0000-0000-0000-000000000001';r timestamptz;begin
perform save_voice_customer_v1(c,t,'2026-11-20','Test','Customer','legacy@example.test','015904209999','[]','["+4915904208888"]',null,null,null);
if (select phone from master_customers where id=c)<>'015904209999' then raise exception 'primary changed';end if;
if not exists(select 1 from voice_customer_phone_numbers where customer_id=c and phone='+4915904208888' and created_by is null) then raise exception 'OPS-only add failed';end if;
select updated_at into r from master_customers where id=c;
begin
perform save_voice_customer_v1(c,t,r,'Test','Customer','changed@example.test','015904209999','[]','[]',null,null,null);
raise exception 'primary change accepted';
exception when raise_exception then if sqlerrm<>'primary_contacts_readonly' then raise;end if;end;
end $$;
rollback;
