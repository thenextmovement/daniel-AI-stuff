create view public.voice_customer_directory with (security_invoker=true) as
select c.id,coalesce(r.request_id,c.request_id) as request_id,r.title as request_title,r.created_at as request_created_at,c.name,c.first_name,c.last_name,c.company,c.company_name,c.email,c.phone,c.original_phone,c.billing_email,c.original_email
from public.master_customers c left join lateral (
 select request_id,title,created_at from public.master_requests where customer_id=c.id and request_id is not null order by created_at desc nulls last,id desc limit 1
) r on true;

create view public.voice_customer_events with (security_invoker=true) as
select customer_id,'mail:'||outlook_id as id,occurred_at,direction as kind,subject,left(body_text,2400) as detail,
substring(subject from '(?i)[(]([0-9a-f]{8}(?:-[0-9a-f-]{27})?)[)]') as request_ref,null::uuid as session_id
from public.customer_mail_timeline
union all select r.customer_id,'session:'||s.id,s.started_at,'transcript','Telefonat',coalesce(nullif(s.summary,''),'Keine Zusammenfassung gespeichert.'),s.bound_request_id,s.id
from public.voice_call_sessions s join public.master_requests r on r.request_id=s.bound_request_id
where s.transcript_storage_enabled and s.mode<>'internal_test' and s.consent_status='confirmed'
union all select customer_id,'call:'||id,created_at,'call',case when direction='inbound' then 'Eingehender Anruf' else 'Ausgehender Anruf' end,
case when customer_joined then 'Gespräch verbunden.' else 'Keine Gesprächsverbindung bestätigt.' end,request_id,null::uuid from public.voice_phone_calls where customer_id is not null;

revoke all on public.voice_customer_directory, public.voice_customer_events from public, anon, authenticated;
grant select on public.voice_customer_directory, public.voice_customer_events to service_role;
