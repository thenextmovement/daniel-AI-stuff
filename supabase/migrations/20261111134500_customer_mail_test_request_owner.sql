create or replace function public.customer_mail_test_owner(mail_subject text, mail_time timestamptz)
returns uuid language sql stable security invoker set search_path='' as $$
 select min(c.id::text)::uuid from public.master_customers c
 join public.master_requests r on r.customer_id=c.id
 where lower(btrim(c.email))='rh@neontrip.de'
 and r.created_at >= timestamptz '2026-11-11T11:11:56Z' and r.created_at <= mail_time
 and r.request_id ~* '^[a-f0-9]{8}-[a-f0-9-]{27}$'
 and lower(mail_subject) ~ ('\m' || left(lower(r.request_id),8) || '\M')
 having count(*)=1
$$;

