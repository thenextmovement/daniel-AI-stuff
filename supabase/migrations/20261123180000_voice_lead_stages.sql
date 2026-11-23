-- Independent voice queue only. Never writes automation/cadence or customer state.
alter table public.voice_hot_lead_state drop constraint voice_hot_lead_state_status_check;
alter table public.voice_hot_lead_state add constraint voice_hot_lead_state_status_check check(status in ('ignored','reached','scheduled','not_reached','no_followup','active'));
alter table public.voice_hot_lead_state add column stage smallint check(stage between 1 and 3), add column due_at timestamptz, add column outcomes jsonb not null default '{}'::jsonb;
create table public.voice_hot_lead_actions (
 id uuid primary key,request_id uuid not null references public.master_requests(id) on delete cascade,
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 stage smallint not null check(stage between 1 and 3),action text not null check(action in ('ignored','reached','scheduled','not_reached','no_followup','active')),
 due_date date,due_at timestamptz,created_at timestamptz not null default now(),stage_captured_at timestamptz not null,
 revision integer not null
);
alter table public.voice_hot_lead_actions enable row level security;
revoke all on public.voice_hot_lead_actions from public,anon,authenticated;
grant select on public.voice_hot_lead_actions to service_role;
create index voice_hot_lead_actions_request on public.voice_hot_lead_actions(request_id,created_at desc);
create function public.save_voice_hot_lead_v2(p_request_id uuid,p_customer_id uuid,p_status text,p_source_at timestamptz,p_due_date date,p_due_at timestamptz,p_revision integer,p_stage smallint,p_action_id uuid,p_captured_at timestamptz)
returns public.voice_hot_lead_state language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.voice_hot_lead_state;previous public.voice_hot_lead_actions;
begin
 if p_status is null or p_status not in ('ignored','reached','scheduled','not_reached','no_followup','active') or p_stage is null or p_stage not between 1 and 3 or p_action_id is null or p_source_at is null or p_captured_at is null or p_captured_at>now()+interval '1 minute' or p_revision is null or p_revision<0 then raise exception 'invalid_hot_lead_state'; end if;
 if (p_status='scheduled')<>(p_due_date is not null) or p_due_date<(now() at time zone 'Europe/Berlin')::date or (p_due_at is not null and (p_status<>'scheduled' or (p_due_at at time zone 'Europe/Berlin')::date<>p_due_date or p_due_at<now())) then raise exception 'invalid_hot_lead_date'; end if;
 perform 1 from public.master_requests where id=p_request_id and customer_id=p_customer_id for update;
 if not found then raise exception 'hot_lead_customer_mismatch'; end if;
 select * into result from public.voice_hot_lead_state where request_id=p_request_id;
 select * into previous from public.voice_hot_lead_actions where id=p_action_id;
 if found then
  if previous.request_id<>p_request_id or previous.customer_id<>p_customer_id or previous.action<>p_status or previous.stage<>p_stage or previous.due_date is distinct from p_due_date or previous.due_at is distinct from p_due_at then raise exception 'hot_lead_action_conflict'; end if;
  return result;
 end if;
 if coalesce(result.revision,0)<>p_revision then raise exception 'hot_lead_revision_conflict'; end if;
 if result.status in ('ignored','no_followup') and p_status<>'active' then raise exception 'hot_lead_requires_reactivation'; end if;
 insert into public.voice_hot_lead_state(request_id,customer_id,status,source_at,due_date,due_at,stage,outcomes,revision)
 values(p_request_id,p_customer_id,
 case when p_status in ('reached','not_reached') and result.status='scheduled' and result.stage is not null and result.handled_at>=p_captured_at then 'scheduled' else p_status end,p_source_at,
 case when p_status in ('reached','not_reached') and result.status='scheduled' and result.stage is not null and result.handled_at>=p_captured_at then result.due_date else p_due_date end,
 case when p_status in ('reached','not_reached') and result.status='scheduled' and result.stage is not null and result.handled_at>=p_captured_at then result.due_at else p_due_at end,
 case when p_status in ('reached','not_reached') and result.status='scheduled' and result.stage is not null and result.handled_at>=p_captured_at then greatest(result.stage,case when p_stage=2 then 3 else p_stage end) else p_stage end,
 case when p_status in ('reached','not_reached') then coalesce(result.outcomes,'{}'::jsonb)||jsonb_build_object(p_stage::text,p_status) else coalesce(result.outcomes,'{}'::jsonb) end,p_revision+1)
 on conflict(request_id) do update set status=excluded.status,source_at=excluded.source_at,due_date=excluded.due_date,due_at=excluded.due_at,stage=excluded.stage,outcomes=excluded.outcomes,handled_at=now(),revision=excluded.revision returning * into result;
 insert into public.voice_hot_lead_actions(id,request_id,customer_id,stage,action,due_date,due_at,stage_captured_at,revision) values(p_action_id,p_request_id,p_customer_id,p_stage,p_status,p_due_date,p_due_at,p_captured_at,result.revision);
 return result;
end $$;
revoke all on function public.save_voice_hot_lead_v2(uuid,uuid,text,timestamptz,date,timestamptz,integer,smallint,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_voice_hot_lead_v2(uuid,uuid,text,timestamptz,date,timestamptz,integer,smallint,uuid,timestamptz) to service_role;

create or replace view public.voice_hot_lead_candidates with(security_invoker=true) as
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
 (select max(cs.pending_callback_at) from public.sales_call_cadence_state cs where cs.request_id in (r.request_id,r.id::text)) as callback_at, s.stage, s.due_at, s.outcomes
from public.master_requests r join public.voice_customer_directory c on c.id=r.customer_id
left join public.voice_hot_lead_state s on s.request_id=r.id;
revoke all on public.voice_hot_lead_candidates from public,anon,authenticated;
grant select on public.voice_hot_lead_candidates to service_role;
