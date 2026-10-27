begin;
create temporary table test_company_brain_actor_format(actor_email text);
do $$ declare definition text; begin
select pg_get_constraintdef(oid) into strict definition from pg_constraint where conrelid='public.company_brain_actor_roles'::regclass and conname='company_brain_actor_roles_email_check';
execute 'alter table test_company_brain_actor_format add constraint tested_actor_format ' || definition;
end $$;
insert into test_company_brain_actor_format values ('daniel@neontrip.de'),('00d93f4a3dc4d4546937709878b4a8fd.access');
do $$ declare v text; begin
foreach v in array array['arbitrary-service','ABCDEF0123456789abcdef0123456789.access','00d93f4a3dc4d4546937709878b4a8fd.access.evil',' x@y.de','service@invalid'] loop
 begin
 insert into test_company_brain_actor_format values(v);
 raise exception 'Invalid actor accepted: %',v;
 exception when check_violation then null;
 end;
end loop;
end $$;
rollback;
