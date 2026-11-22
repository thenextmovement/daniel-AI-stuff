-- Independent Telefonzentrale queue: existing automation tables are read only.
create table public.voice_hot_lead_state (
 request_id uuid primary key references public.master_requests(id) on delete cascade,
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 status text not null check(status in ('ignored','reached','scheduled')),
 source_at timestamptz not null,
 handled_at timestamptz not null default now(),
 due_date date,
 revision integer not null default 1,
 check ((status='scheduled')=(due_date is not null))
);
alter table public.voice_hot_lead_state enable row level security;
revoke all on public.voice_hot_lead_state from public,anon,authenticated;
grant select,insert,update,delete on public.voice_hot_lead_state to service_role;
create index voice_hot_lead_due on public.voice_hot_lead_state(due_date) where status='scheduled';

create function public.save_voice_hot_lead(p_request_id uuid,p_customer_id uuid,p_status text,p_source_at timestamptz,p_due_date date,p_revision integer)
returns public.voice_hot_lead_state language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.voice_hot_lead_state;
begin
 if p_status not in ('ignored','reached','scheduled') or p_status is null or p_source_at is null or p_revision is null or p_revision<0 then raise exception 'invalid_hot_lead_state'; end if;
 if (p_status='scheduled')<>(p_due_date is not null) or p_due_date < (now() at time zone 'Europe/Berlin')::date then raise exception 'invalid_hot_lead_date'; end if;
 perform 1 from public.master_requests where id=p_request_id and customer_id=p_customer_id for update;
 if not found then raise exception 'hot_lead_customer_mismatch'; end if;
 select * into result from public.voice_hot_lead_state where request_id=p_request_id;
 if coalesce(result.revision,0)<>p_revision then raise exception 'hot_lead_revision_conflict'; end if;
 insert into public.voice_hot_lead_state(request_id,customer_id,status,source_at,due_date,revision) values(p_request_id,p_customer_id,p_status,p_source_at,p_due_date,p_revision+1)
 on conflict(request_id) do update set status=excluded.status,source_at=excluded.source_at,due_date=excluded.due_date,handled_at=now(),revision=excluded.revision
 returning * into result;
 return result;
end $$;
revoke all on function public.save_voice_hot_lead(uuid,uuid,text,timestamptz,date,integer) from public,anon,authenticated;
grant execute on function public.save_voice_hot_lead(uuid,uuid,text,timestamptz,date,integer) to service_role;

create view public.voice_hot_lead_candidates with(security_invoker=true) as
select r.id,r.request_id,r.customer_id,r.trello_card_id,r.title,r.created_at,r.status,r.deal_status,
 array(select distinct e.offer_id from public.ops_offer_events e where e.request_id in (r.request_id,r.id::text) and e.offer_id is not null) as offer_ids,
 c.name,c.company,c.company_name,c.email,c.phone,c.additional_phones,
 coalesce(r.final_value,r.estimated_value) as estimated_amount,
 s.status as list_status,s.source_at,s.handled_at,s.due_date,coalesce(s.revision,0) as revision,
 greatest(
  (select max(x.created_at) from public.sales_call_results x where x.request_id in (r.request_id,r.id::text) and x.call_done='yes' and x.superseded_at is null),
  (select max(pc.provider_ended_at) from public.voice_placetel_calls pc join public.voice_call_sessions vs on vs.id=pc.session_id where vs.bound_request_id in (r.request_id,r.id::text) and vs.context_snapshot->>'placetel_customer_id'=r.customer_id::text)
 ) as last_confirmed_call,
 (exists(select 1 from public.master_orders o where o.request_id::text in (r.id::text,r.request_id) and o.cancelled_at is null)
  or exists(select 1 from public.customer_case_state cs where cs.request_id in (r.request_id,r.id::text) and cs.state in ('handled','closed','do_not_contact'))
  or exists(select 1 from public.sales_call_cadence_state cs where cs.request_id in (r.request_id,r.id::text) and cs.blocked)
  or exists(select 1 from public.lead_followup_plans p where p.request_id in (r.request_id,r.id::text) and p.contactability_status='do_not_contact')
  or exists(select 1 from public.followup_blacklist b where (lower(b.email)=lower(c.email) or lower(b.domain)=lower(split_part(c.email,'@',2))) and (b.expires_at is null or b.expires_at>now()))) as blocked,
 (select max(cs.pending_callback_at) from public.sales_call_cadence_state cs where cs.request_id in (r.request_id,r.id::text)) as callback_at
from public.master_requests r join public.voice_customer_directory c on c.id=r.customer_id
left join public.voice_hot_lead_state s on s.request_id=r.id;
revoke all on public.voice_hot_lead_candidates from public,anon,authenticated;
grant select on public.voice_hot_lead_candidates to service_role;
