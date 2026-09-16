begin;
alter table public.voice_phone_calls add column direction text not null default 'outbound' check(direction in('outbound','inbound'));
create table public.voice_phone_incoming(
 id uuid primary key references public.voice_call_sessions(id),
 customer_call_sid text unique not null check(customer_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 phone text not null check(phone ~ '^[+][1-9][0-9]{6,14}$'),
 called_number text not null check(called_number ~ '^[+][1-9][0-9]{6,14}$'),
 customer_id uuid,request_id text,display_name text,
 state text not null default 'waiting' check(state in('waiting','claimed','connected','missed','ended')),
 device_id uuid references public.voice_staff_devices(id),staff_id uuid references public.voice_staff(id),
 conference_sid text unique check(conference_sid ~ '^CF[0-9a-fA-F]{32}$'),
 customer_joined boolean not null default false,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '60 seconds',
 ended_at timestamptz,cleanup_pending boolean not null default false,updated_at timestamptz not null default now()
);
create table public.voice_phone_incoming_declines(
 incoming_id uuid not null references public.voice_phone_incoming(id),staff_id uuid not null references public.voice_staff(id),
 created_at timestamptz not null default now(),primary key(incoming_id,staff_id)
);
create table public.voice_phone_incoming_events(
 incoming_id uuid not null references public.voice_phone_incoming(id),event_key text not null check(char_length(event_key) between 1 and 160),
 primary key(incoming_id,event_key)
);
alter table public.voice_phone_incoming enable row level security;
alter table public.voice_phone_incoming_declines enable row level security;
alter table public.voice_phone_incoming_events enable row level security;
revoke all on public.voice_phone_incoming,public.voice_phone_incoming_declines,public.voice_phone_incoming_events from public,anon,authenticated;
grant select,insert,update,delete on public.voice_phone_incoming,public.voice_phone_incoming_declines,public.voice_phone_incoming_events to service_role;

create function public.receive_voice_phone_incoming(p_call_sid text,p_phone text,p_called_number text,p_customer_id uuid default null,p_request_id text default null,p_display_name text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.voice_phone_incoming%rowtype;v_id uuid:=gen_random_uuid();
begin
 if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then raise exception 'invalid_incoming_call';end if;
 -- Same signed provider callback can be delivered concurrently.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-incoming:'||p_call_sid,0));
 select * into r from public.voice_phone_incoming where customer_call_sid=p_call_sid;
 if found then
  if r.phone is distinct from p_phone or r.called_number is distinct from p_called_number then raise exception 'incoming_binding_conflict';end if;
  return to_jsonb(r);
 end if;
 insert into public.voice_call_sessions(id,idempotency_key,operator_name,mode,bound_request_id,context_snapshot)
  values(v_id,'incoming:'||p_call_sid,'Nicht angenommen','internal_test',p_request_id,
   jsonb_build_object('interaction_mode','human_phone','direction','inbound','customer_id',p_customer_id,'phone_pilot',true,'customer_match','caller_number_not_identity'));
 insert into public.voice_phone_incoming(id,customer_call_sid,phone,called_number,customer_id,request_id,display_name)
  values(v_id,p_call_sid,p_phone,p_called_number,p_customer_id,p_request_id,left(p_display_name,200)) returning * into r;
 return to_jsonb(r);
end $$;

create function public.personal_voice_phone_incoming(p_device_id uuid,p_action text,p_incoming_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.voice_staff_devices%rowtype;s public.voice_staff%rowtype;r public.voice_phone_incoming%rowtype;c public.voice_phone_calls%rowtype;rows jsonb;
begin
 select * into d from public.voice_staff_devices where id=p_device_id and revoked_at is null and expires_at>now();
 select * into s from public.voice_staff where id=d.staff_id and enabled;
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email) then raise exception 'phone_identity_required';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rows from (
   select i.* from public.voice_phone_incoming i where i.ended_at is null and (
    (i.state='waiting' and i.customer_joined and i.conference_sid is not null and i.expires_at>now()
     and d.registered and d.available and d.last_seen_at>now()-interval '45 seconds' and d.last_seen_at<=now()+interval '5 seconds'
     and not exists(select 1 from public.voice_phone_incoming_declines where incoming_id=i.id and staff_id=s.id)
     and not exists(select 1 from public.voice_phone_calls where staff_id=s.id and (ended_at is null or cleanup_pending))
     and not exists(select 1 from public.voice_phone_transfers where (from_staff_id=s.id or to_staff_id=s.id) and (ended_at is null or cleanup_pending)))
    or (i.state='claimed' and i.device_id=d.id and i.expires_at>now()))
   order by i.created_at,i.id limit 10
  ) x;
  return jsonb_build_object('incoming',rows);
 end if;
 if p_action not in('accept','decline') then raise exception 'invalid_incoming_action';end if;
 select * into r from public.voice_phone_incoming where id=p_incoming_id for update;
 if not found then raise exception 'incoming_not_found';end if;
 if p_action='accept' and r.device_id=d.id and r.state in('claimed','connected') and r.ended_at is null then
  select * into c from public.voice_phone_calls where id=r.id;
  if not found or c.device_id is distinct from d.id or c.ended_at is not null or (not c.agent_joined and c.expires_at<=now()) then raise exception 'incoming_no_longer_available';end if;
  return jsonb_build_object('call',to_jsonb(c));
 end if;
 if r.state<>'waiting' or r.ended_at is not null or r.expires_at<=now() then raise exception 'incoming_no_longer_available';end if;
 if p_action='decline' then
  insert into public.voice_phone_incoming_declines(incoming_id,staff_id) values(r.id,s.id) on conflict do nothing;
  return jsonb_build_object('declined',true);
 end if;
 select * into s from public.voice_staff where id=s.id and enabled for update;
 if not found then raise exception 'phone_identity_required';end if;
 select * into d from public.voice_staff_devices where id=p_device_id and staff_id=s.id and revoked_at is null and expires_at>now() for update;
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email) then raise exception 'phone_identity_required';end if;
 if not d.registered or not d.available or d.last_seen_at is null or d.last_seen_at<=now()-interval '45 seconds'
  or d.last_seen_at>now()+interval '5 seconds' or not r.customer_joined or r.conference_sid is null
  or exists(select 1 from public.voice_phone_incoming_declines where incoming_id=r.id and staff_id=s.id)
 then raise exception 'incoming_accept_ineligible';end if;
 if exists(select 1 from public.voice_phone_calls where staff_id=s.id and (ended_at is null or cleanup_pending)) or
  exists(select 1 from public.voice_phone_transfers where (from_staff_id=s.id or to_staff_id=s.id) and (ended_at is null or cleanup_pending))
 then raise exception 'phone_staff_busy';end if;
 insert into public.voice_phone_calls(id,device_id,staff_id,request_key,customer_id,request_id,phone,state,direction,
  customer_call_sid,conference_sid,customer_dispatch,customer_joined,expires_at)
 values(r.id,d.id,s.id,r.id,r.customer_id,r.request_id,r.phone,'connecting','inbound',r.customer_call_sid,r.conference_sid,'acknowledged',true,now()+interval '30 seconds')
 returning * into c;
 update public.voice_phone_incoming set state='claimed',device_id=d.id,staff_id=s.id,expires_at=now()+interval '30 seconds',updated_at=now() where id=r.id;
 update public.voice_call_sessions set operator_name=s.display_name,context_snapshot=context_snapshot||jsonb_build_object('staff_id',s.id),updated_at=now() where id=r.id;
 return jsonb_build_object('call',to_jsonb(c));
end $$;

-- Check the inbound answer deadline again at the actual browser join.
create or replace function public.bind_voice_phone_call(p_call_id uuid,p_device_id uuid,p_agent_call_sid text)
 returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if not found or c.device_id<>p_device_id or c.ended_at is not null or
  ((c.state='reserved' or (c.direction='inbound' and not c.agent_joined)) and c.expires_at<=now()) then raise exception 'phone_call_forbidden'; end if;
 if not exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  where d.id=c.device_id and s.id=c.staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email)) then raise exception 'phone_identity_required'; end if;
 if p_agent_call_sid is null or p_agent_call_sid !~ '^CA[0-9a-fA-F]{32}$' or
  (c.agent_call_sid is not null and c.agent_call_sid<>p_agent_call_sid) then raise exception 'phone_leg_conflict'; end if;
 update public.voice_phone_calls set agent_call_sid=p_agent_call_sid,state=case when state='reserved' then 'connecting' else state end,updated_at=now()
  where id=c.id returning * into c;
 return c;
end $$;

-- Reuse the existing call reducer, including transfer protection. Inbound caller
-- arrival alone is not a connected employee conversation.
alter function public.apply_voice_phone_event(uuid,text,text,text,text) rename to apply_voice_phone_event_before_incoming;
revoke all on function public.apply_voice_phone_event_before_incoming(uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.apply_voice_phone_event(p_call_id uuid,p_key text,p_kind text,p_call_sid text default null,p_conference_sid text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;c public.voice_phone_calls%rowtype;
begin
 result:=public.apply_voice_phone_event_before_incoming(p_call_id,p_key,p_kind,p_call_sid,p_conference_sid);
 if exists(select 1 from public.voice_phone_incoming where id=p_call_id) then
  select * into c from public.voice_phone_calls where id=p_call_id;
  if c.ended_at is null then
   update public.voice_phone_calls set state=case when agent_joined and customer_joined then 'connected' else 'connecting' end where id=c.id returning * into c;
   update public.voice_call_sessions set status=case when c.agent_joined and c.customer_joined then 'live' else 'created' end,
    started_at=case when c.agent_joined and c.customer_joined then coalesce(started_at,now()) else null end where id=c.id;
  elsif not c.agent_joined then
   update public.voice_phone_calls set state='cancelled' where id=c.id returning * into c;
   update public.voice_call_sessions set status='cancelled',started_at=null where id=c.id;
  end if;
  result:=jsonb_set(result,'{call}',to_jsonb(c));
 end if;
 return result;
end $$;

create function public.event_voice_phone_incoming(p_incoming_id uuid,p_key text,p_kind text,p_call_sid text default null,p_conference_sid text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.voice_phone_incoming%rowtype;c public.voice_phone_calls%rowtype;effect jsonb;
begin
 select * into r from public.voice_phone_incoming where id=p_incoming_id for update;
 if not found then raise exception 'incoming_not_found';end if;
 if p_kind not in('customer_join','customer_leave','conference_start','conference_end','dial_end','expire','sync') then raise exception 'invalid_incoming_event';end if;
 if p_kind not in('expire','sync') and (p_call_sid is distinct from r.customer_call_sid and p_kind not in('conference_start','conference_end')) then raise exception 'incoming_call_mismatch';end if;
 if p_conference_sid is not null and (p_conference_sid !~ '^CF[0-9a-fA-F]{32}$' or (r.conference_sid is not null and r.conference_sid<>p_conference_sid)) then raise exception 'incoming_conference_mismatch';end if;
 if p_kind='customer_join' and p_conference_sid is null then raise exception 'incoming_conference_required';end if;
 select * into c from public.voice_phone_calls where id=r.id;
 if found then
  if p_kind in('customer_join','customer_leave','conference_start','conference_end') then
   effect:=public.apply_voice_phone_event(c.id,p_key,p_kind,p_call_sid,p_conference_sid);
  elsif p_kind='dial_end' then
   effect:=public.apply_voice_phone_event(c.id,p_key,'customer_completed',r.customer_call_sid);
  elsif p_kind='expire' and not c.agent_joined and r.expires_at<=now() then
   effect:=public.apply_voice_phone_event(c.id,p_key,'cancel',c.agent_call_sid);
  end if;
  select * into c from public.voice_phone_calls where id=r.id;
  update public.voice_phone_incoming set state=case when c.ended_at is not null then case when c.agent_joined then 'ended' else 'missed' end when c.agent_joined and c.customer_joined then 'connected' else state end,
   ended_at=c.ended_at,updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('incoming',to_jsonb(r),'call',to_jsonb(c),'close',false,'closeCall',c.ended_at is not null and c.cleanup_pending);
 end if;
 if p_kind='expire' and r.expires_at>now() then return jsonb_build_object('incoming',to_jsonb(r),'close',false);end if;
 insert into public.voice_phone_incoming_events(incoming_id,event_key) values(r.id,p_key) on conflict do nothing;
 if not found then return jsonb_build_object('incoming',to_jsonb(r),'close',r.cleanup_pending);end if;
 if r.ended_at is null then
  if p_kind='customer_join' then r.customer_joined:=true;r.conference_sid:=p_conference_sid;
  elsif p_kind in('customer_leave','conference_end','dial_end') or (p_kind='expire' and r.expires_at<=now()) then
   r.state:='missed';r.ended_at:=now();r.cleanup_pending:=true;
  end if;
 end if;
 update public.voice_phone_incoming set state=r.state,customer_joined=r.customer_joined,conference_sid=coalesce(r.conference_sid,p_conference_sid),
  ended_at=r.ended_at,cleanup_pending=r.cleanup_pending,updated_at=now() where id=r.id returning * into r;
 if r.ended_at is not null then update public.voice_call_sessions set status='cancelled',ended_at=r.ended_at,updated_at=now() where id=r.id;end if;
 return jsonb_build_object('incoming',to_jsonb(r),'close',r.cleanup_pending);
end $$;
revoke all on function public.receive_voice_phone_incoming(text,text,text,uuid,text,text),public.personal_voice_phone_incoming(uuid,text,uuid),
 public.apply_voice_phone_event(uuid,text,text,text,text),public.event_voice_phone_incoming(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.receive_voice_phone_incoming(text,text,text,uuid,text,text),public.personal_voice_phone_incoming(uuid,text,uuid),
 public.apply_voice_phone_event(uuid,text,text,text,text),public.event_voice_phone_incoming(uuid,text,text,text,text) to service_role;
comment on table public.voice_phone_incoming is 'Inbound pilot wait/answer ledger. Caller number is a customer lookup hint, never authentication. Accept is atomic; decline affects only the declining staff member.';
commit;
