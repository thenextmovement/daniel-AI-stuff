create role service_role bypassrls; create role anon; create role authenticated;
create table master_customers(id uuid,email text,original_email text,billing_email text,cc_emails text[]);
create table customer_contact_history(customer_id uuid,type text,value text);
insert into master_customers values('00000000-0000-0000-0000-000000000001','a@example.org',null,null,null),('00000000-0000-0000-0000-000000000002','b@example.org',null,null,null);
\i /tmp/mail-history.sql
do $$
declare example jsonb := '{"id":"m1","thread":"t1","direction":"inbound","occurred":"2026-11-01","sender":"a@example.org","recipients":[],"cc":[],"bcc":[],"addresses":["a@example.org"],"subject":"hi","body":"full text"}';
begin
 perform ingest_customer_mail_page('history',0,jsonb_build_array(example,example || '{"id":"m2","direction":"outbound","occurred":"2026-11-02"}',example || '{"id":"ambiguous","addresses":["a@example.org","b@example.org"]}',example || '{"id":"foreign","addresses":["other@example.org"]}'),null);
 if (select count(*) from customer_mail_history)<>3 or (select count(*) from customer_mail_timeline)<>2 then raise exception 'Customer isolation failed'; end if;
 if not (ingest_customer_mail_page('history',0,'[]',null)->>'stale')::boolean then raise exception 'Checkpoint race'; end if;
 if (ingest_customer_mail_page('history',1,jsonb_build_array(example),null)->>'saved')::integer<>0 then raise exception 'Duplicate write'; end if;
 if has_table_privilege('anon','customer_mail_history','select') or has_function_privilege('authenticated','ingest_customer_mail_page(text,bigint,jsonb,text)','execute') then raise exception 'Private access failed'; end if;
end $$;
