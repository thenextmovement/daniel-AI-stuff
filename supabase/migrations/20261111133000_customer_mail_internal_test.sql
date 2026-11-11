create function public.customer_mail_test_owner(mail_subject text, mail_time timestamptz)
returns uuid language sql stable security invoker set search_path='' as $$
 select min(c.id::text)::uuid from public.master_customers c
 where lower(btrim(c.email))='rh@neontrip.de'
 and c.created_at >= timestamptz '2026-11-11T11:11:56Z' and c.created_at <= mail_time
 and c.request_id ~* '^[a-f0-9]{8}-[a-f0-9-]{27}$'
 and lower(mail_subject) ~ ('\m' || left(lower(c.request_id),8) || '\M')
 having count(*)=1
$$;
revoke all on function public.customer_mail_test_owner(text,timestamptz) from public,anon,authenticated;
grant execute on function public.customer_mail_test_owner(text,timestamptz) to service_role;

create or replace view public.customer_mail_timeline with (security_invoker=true) as
 with matches as (
 select h.mailbox,h.outlook_id,min(a.customer_id::text)::uuid as customer_id
 from public.customer_mail_history h
 cross join lateral unnest(h.customer_addresses) as participant(email)
 join public.customer_mail_history_addresses a on a.email=participant.email
 group by h.mailbox,h.outlook_id having count(distinct a.customer_id)=1
 )
 select m.customer_id,h.* from matches m join public.customer_mail_history h using(mailbox,outlook_id)
 union all
 select owner.customer_id,h.* from public.customer_mail_history h
 cross join lateral (select public.customer_mail_test_owner(h.subject,h.occurred_at) as customer_id) owner
 where h.customer_addresses=array['rh@neontrip.de'] and owner.customer_id is not null
 order by occurred_at,outlook_id;

create or replace function public.ingest_customer_mail_page(p_lane text,p_revision bigint,p_messages jsonb,p_next text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_mail_import_state; saved integer;
begin
 select * into strict s from public.customer_mail_import_state where lane=p_lane for update;
 if s.revision<>p_revision then return jsonb_build_object('stale',true); end if;
 if p_next is not null and p_next !~ '^https://graph[.]microsoft[.]com/v1[.]0/me/messages[?]' then raise exception 'Unexpected Graph page'; end if;
 if jsonb_typeof(p_messages) is distinct from 'array' then raise exception 'Missing Graph page'; end if;
 with messages as (
 select * from jsonb_to_recordset(p_messages) as m(id text,internet_id text,thread text,direction text,occurred timestamptz,sender text,recipients text[],cc text[],bcc text[],addresses text[],subject text,body text)
 )
 insert into public.customer_mail_history as h
 select 'support@neontrip.de',m.id,m.internet_id,m.thread,m.direction,m.occurred,m.sender,m.recipients,m.cc,m.bcc,m.addresses,m.subject,m.body from messages m
 where exists (select 1 from unnest(m.addresses) as participant(email)
 where participant.email in (select a.email from public.customer_mail_history_addresses a))
 or (m.addresses=array['rh@neontrip.de'] and public.customer_mail_test_owner(m.subject,m.occurred) is not null)
 on conflict(mailbox,outlook_id) do update set
 internet_message_id=excluded.internet_message_id,conversation_id=excluded.conversation_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
 from_email=excluded.from_email,to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,bcc_emails=excluded.bcc_emails,customer_addresses=excluded.customer_addresses,subject=excluded.subject,body_text=excluded.body_text
 where (h.*) is distinct from (excluded.*);
 get diagnostics saved=row_count;
 update public.customer_mail_import_state set cursor_url=p_next,revision=revision+1,last_page_at=now(),
 watermark=case when p_next is null and lane='recent' then scan_started-interval '10 minutes' else watermark end,
 completed_at=case when p_next is null then now() else completed_at end,
 scan_started=case when p_next is null then now() else scan_started end,
 next_run=case when p_next is not null then now() when lane='history' then now()+interval '7 days' else now()+interval '2 minutes' end where lane=p_lane;
 return jsonb_build_object('saved',saved,'more',p_next is not null);
end $$;
