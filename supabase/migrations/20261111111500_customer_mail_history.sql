create table public.customer_mail_history (
  mailbox text not null check (mailbox='support@neontrip.de'),
  outlook_id text not null,
  internet_message_id text,
  conversation_id text,
  direction text not null check (direction in ('inbound','outbound')),
  occurred_at timestamptz not null,
  from_email text not null,
  to_emails text[] not null,
  cc_emails text[] not null,
  bcc_emails text[] not null,
  customer_addresses text[] not null,
  subject text,
  body_text text not null,
  primary key(mailbox,outlook_id)
);
alter table public.customer_mail_history enable row level security;
revoke all on public.customer_mail_history from public, anon, authenticated;
grant select on public.customer_mail_history to service_role;
create index customer_mail_history_addresses_idx on public.customer_mail_history using gin(customer_addresses);
create index customer_mail_history_thread_idx on public.customer_mail_history(conversation_id,occurred_at,outlook_id);

create view public.customer_mail_history_addresses with (security_invoker=true) as
 select distinct customer_id, lower(trim(address)) as email from (
 select c.id as customer_id, unnest(array[c.email,c.original_email,c.billing_email] || coalesce(c.cc_emails,'{}')) as address from public.master_customers c
 union all select customer_id,value from public.customer_contact_history where type='email'
 ) a where address like '%@%' and lower(trim(address)) not like '%@neontrip.de';
revoke all on public.customer_mail_history_addresses from public, anon, authenticated;
grant select on public.customer_mail_history_addresses to service_role;
create view public.customer_mail_timeline with (security_invoker=true) as
 select resolved.customer_id,h.* from public.customer_mail_history h
 cross join lateral (select min(a.customer_id::text)::uuid as customer_id from public.customer_mail_history_addresses a
 where a.email=any(h.customer_addresses) having count(distinct a.customer_id)=1) resolved
 order by h.occurred_at,h.outlook_id;
revoke all on public.customer_mail_timeline from public,anon,authenticated;
grant select on public.customer_mail_timeline to service_role;

create table public.customer_mail_import_state (
 lane text primary key check(lane in ('history','recent')),
 cursor_url text, scan_started timestamptz not null default now(), watermark timestamptz,
 revision bigint not null default 0, completed_at timestamptz, last_page_at timestamptz,
 next_run timestamptz not null default now()
);
alter table public.customer_mail_import_state enable row level security;
revoke all on public.customer_mail_import_state from public,anon,authenticated;
grant select on public.customer_mail_import_state to service_role;
insert into public.customer_mail_import_state(lane,watermark) values ('history',null),('recent',now()-interval '2 days');

create function public.ingest_customer_mail_page(p_lane text,p_revision bigint,p_messages jsonb,p_next text)
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
 where exists (select 1 from public.customer_mail_history_addresses a where a.email=any(m.addresses))
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
revoke all on function public.ingest_customer_mail_page(text,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_customer_mail_page(text,bigint,jsonb,text) to service_role;
