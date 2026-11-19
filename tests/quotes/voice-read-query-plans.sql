\set ON_ERROR_STOP on
-- Isolated disposable database only; no production fixtures.
create table master_customers(id uuid primary key,request_id text,name text,first_name text,last_name text,company text,company_name text,email text,phone text,original_phone text,billing_email text,original_email text);
create table master_requests(id uuid primary key,customer_id uuid,request_id text,title text,created_at timestamptz);
create table voice_customer_phone_numbers(customer_id uuid,phone text,created_at timestamptz);
create table customer_email_messages(id integer primary key,matched_email text,from_email text);
insert into master_customers(id,request_id,name)
select md5(i::text)::uuid,'fallback-'||i,'Customer '||i from generate_series(1,9000) i;
insert into master_requests
select md5('request-'||i)::uuid,md5((i%8000+1)::text)::uuid,'request-'||i,'Title '||i,
 case when i%5=0 then null else '2026-01-01'::timestamptz+(i%10)*interval '1 day' end
from generate_series(1,16000) i;
insert into master_requests values
(md5('null-ref')::uuid,md5('1')::uuid,null,'Must not win',now()),
(md5('orphan')::uuid,null,'orphan','Orphan',now());
insert into voice_customer_phone_numbers values
(md5('1')::uuid,'+4915904209999','2026-01-02'),
(md5('1')::uuid,'+33123456789','2026-01-01');
create view voice_customer_directory with (security_invoker=true) as
select c.id,coalesce(r.request_id,c.request_id) request_id,r.title request_title,r.created_at request_created_at,
c.name,c.first_name,c.last_name,c.company,c.company_name,c.email,c.phone,c.original_phone,c.billing_email,c.original_email,
array(select p.phone from voice_customer_phone_numbers p where p.customer_id=c.id order by p.created_at,p.phone) additional_phones
from master_customers c left join lateral
(select request_id,title,created_at from master_requests where customer_id=c.id and request_id is not null
 order by created_at desc nulls last,id desc limit 1) r on true;
create index on master_requests(customer_id);
create temp table expected as select * from voice_customer_directory;
do $$ begin create role fixture_reader; exception when duplicate_object then null; end $$;
grant select on voice_customer_directory to fixture_reader;
\ir ../../supabase/migrations/20261119190000_voice_read_query_plans.sql
\ir ../../supabase/migrations/20261119190000_voice_read_query_plans.sql
do $$ begin
 if exists((select * from expected except all select * from voice_customer_directory)
 union all (select * from voice_customer_directory except all select * from expected)) then
 raise exception 'directory results changed'; end if;
 if not exists(select from pg_class where oid='voice_customer_directory'::regclass and 'security_invoker=true'=any(reloptions)) then raise exception 'security option lost'; end if;
 if not has_table_privilege('fixture_reader','voice_customer_directory','select') then raise exception 'grant lost'; end if;
 if (select count(*) from voice_customer_directory)<>9000 then raise exception 'customer missing/duplicated'; end if;
end $$;
insert into customer_email_messages select i,'customer-'||i||'@example.test','sender-'||i||'@example.test' from generate_series(1,33000) i;
analyze;
do $$ declare p json; begin
 execute 'explain (format json) select id from customer_email_messages where matched_email=''customer-25@example.test'' or from_email=''sender-25@example.test''' into p;
 if p::text not like '%BitmapOr%' then raise exception 'email OR still scans all rows: %',p; end if;
 execute 'explain (format json) select id,request_id from voice_customer_directory order by request_created_at desc nulls last,name,id limit 30' into p;
 if p::text like '%Nested Loop%' then raise exception 'directory still repeats per-customer request lookup: %',p; end if;
end $$;
select 'PASS: 9000 customers identical, ties/nulls/fallback/phones/grants preserved, bounded query plans' as result;
