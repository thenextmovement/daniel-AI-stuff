begin;
-- Pilot call ledger. Customer data stays bound to the selected record; pilot calls
-- are excluded from customer history. No provider configuration is changed here.
create table public.voice_phone_calls (
 id uuid primary key references public.voice_call_sessions(id),
 device_id uuid not null references public.voice_staff_devices(id),
 staff_id uuid not null references public.voice_staff(id),
 request_key uuid not null,
 customer_id uuid,
 request_id text check (request_id is null or char_length(request_id) between 1 and 160),
 phone text not null check (phone ~ '^[+][1-9][0-9]{6,14}$'),
 state text not null default 'reserved' check (state in ('reserved','connecting','dialing','ringing','connected','completed','cancelled','failed','uncertain')),
 agent_call_sid text unique check (agent_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 customer_call_sid text unique check (customer_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 conference_sid text unique check (conference_sid ~ '^CF[0-9a-fA-F]{32}$'),
 customer_dispatch text not null default 'ready' check (customer_dispatch in ('ready','claimed','acknowledged','uncertain')),
 agent_joined boolean not null default false,
 customer_joined boolean not null default false,
 customer_status_rank integer not null default 0,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '2 minutes',
 ended_at timestamptz,
 cleanup_pending boolean not null default false,
 updated_at timestamptz not null default now(),
 unique(device_id,request_key)
);
create unique index voice_phone_calls_one_per_staff on public.voice_phone_calls(staff_id) where ended_at is null or cleanup_pending;
create table public.voice_phone_events (
 call_id uuid not null references public.voice_phone_calls(id),
 event_key text not null check (char_length(event_key) between 1 and 160),
 kind text not null check (char_length(kind) between 1 and 60),
 created_at timestamptz not null default now(),
 primary key(call_id,event_key)
);
alter table public.voice_phone_calls enable row level security;
alter table public.voice_phone_events enable row level security;
revoke all on public.voice_phone_calls,public.voice_phone_events from public,anon,authenticated;
grant select,insert,update,delete on public.voice_phone_calls,public.voice_phone_events to service_role;

create function public.reserve_voice_phone_call(p_device_id uuid,p_staff_id uuid,p_request_key uuid,p_phone text,p_customer_id uuid default null,p_request_id text default null)
 returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare d public.voice_staff_devices%rowtype; s public.voice_staff%rowtype; c public.voice_phone_calls%rowtype; v_id uuid:=gen_random_uuid();
begin
 select * into s from public.voice_staff where id=p_staff_id and enabled for update;
 if not found then raise exception 'phone_identity_required'; end if;
 select * into d from public.voice_staff_devices where id=p_device_id and staff_id=s.id and revoked_at is null and expires_at>now();
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email) then raise exception 'phone_identity_required'; end if;
 select * into c from public.voice_phone_calls where device_id=d.id and request_key=p_request_key;
 if found then
  if c.phone is distinct from p_phone or c.customer_id is distinct from p_customer_id or c.request_id is distinct from p_request_id then raise exception 'phone_reservation_conflict'; end if;
  return c;
 end if;
 -- A reservation that never reached the provider can be safely expired.
 with expired as (
  update public.voice_phone_calls set state='cancelled',ended_at=now(),updated_at=now()
   where staff_id=s.id and ended_at is null and state='reserved' and expires_at<now() returning id
 ) update public.voice_call_sessions set status='cancelled',ended_at=now(),updated_at=now() where id in(select id from expired);
 if exists(select 1 from public.voice_phone_calls where staff_id=s.id and (ended_at is null or cleanup_pending)) then raise exception 'phone_staff_busy'; end if;
 insert into public.voice_call_sessions(id,idempotency_key,operator_name,mode,bound_request_id,context_snapshot)
  values(v_id,'phone:'||d.id||':'||p_request_key,s.display_name,'internal_test',p_request_id,
   jsonb_build_object('interaction_mode','human_phone','customer_id',p_customer_id,'staff_id',s.id,'phone_pilot',true));
 insert into public.voice_phone_calls(id,device_id,staff_id,request_key,phone,customer_id,request_id)
  values(v_id,d.id,s.id,p_request_key,p_phone,p_customer_id,p_request_id) returning * into c;
 return c;
end $$;

create function public.bind_voice_phone_call(p_call_id uuid,p_device_id uuid,p_agent_call_sid text)
 returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if not found or c.device_id<>p_device_id or c.ended_at is not null or
  (c.state='reserved' and c.expires_at<=now()) then raise exception 'phone_call_forbidden'; end if;
 if not exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  where d.id=c.device_id and s.id=c.staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email)) then raise exception 'phone_identity_required'; end if;
 if p_agent_call_sid is null or p_agent_call_sid !~ '^CA[0-9a-fA-F]{32}$' or
  (c.agent_call_sid is not null and c.agent_call_sid<>p_agent_call_sid) then raise exception 'phone_leg_conflict'; end if;
 update public.voice_phone_calls set agent_call_sid=p_agent_call_sid,state=case when state='reserved' then 'connecting' else state end,updated_at=now()
  where id=c.id returning * into c;
 return c;
end $$;

-- Signed provider events are reduced under a row lock. Replays never dispatch
-- another customer call, and late ringing/join callbacks never reopen a call.
create function public.apply_voice_phone_event(p_call_id uuid,p_key text,p_kind text,p_call_sid text default null,p_conference_sid text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype; v_dial boolean:=false; v_rank integer;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if not found then raise exception 'phone_call_not_found'; end if;
 if p_kind not in ('agent_join','agent_leave','conference_start','conference_end','customer_join','customer_leave','customer_initiated','customer_ringing','customer_answered','customer_completed','customer_busy','customer_no-answer','customer_failed','customer_canceled','dispatch_ack','dispatch_uncertain','cancel') then raise exception 'phone_event_invalid'; end if;
 if p_conference_sid is not null and (p_conference_sid !~ '^CF[0-9a-fA-F]{32}$' or
  (c.conference_sid is not null and c.conference_sid<>p_conference_sid)) then raise exception 'phone_conference_conflict'; end if;
 if p_kind in ('agent_join','agent_leave') and (c.agent_call_sid is null or p_call_sid is distinct from c.agent_call_sid) then raise exception 'phone_leg_conflict'; end if;
 if p_kind like 'customer_%' or p_kind='dispatch_ack' then
  if c.customer_dispatch='ready' or p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' or
   p_call_sid=c.agent_call_sid or (c.customer_call_sid is not null and c.customer_call_sid<>p_call_sid)
   then raise exception 'phone_leg_conflict'; end if;
  c.customer_call_sid:=p_call_sid;
 end if;
 if p_kind='agent_join' and p_conference_sid is null then raise exception 'phone_conference_required'; end if;
 insert into public.voice_phone_events(call_id,event_key,kind) values(c.id,p_key,p_kind) on conflict do nothing;
 if not found then return jsonb_build_object('call',to_jsonb(c),'dial',false,'close',c.ended_at is not null,'duplicate',true); end if;
 c.conference_sid:=coalesce(c.conference_sid,p_conference_sid);
 if c.ended_at is null then
  if p_kind='agent_join' then
   c.agent_joined:=true;
   if c.customer_dispatch='ready' then c.customer_dispatch:='claimed';c.state:='dialing';v_dial:=true; end if;
  elsif p_kind='customer_join' then
   c.customer_joined:=true;c.state:='connected';c.customer_dispatch:='acknowledged';
  elsif p_kind like 'customer_%' then
   v_rank:=case p_kind when 'customer_initiated' then 1 when 'customer_ringing' then 2 when 'customer_answered' then 3 else 4 end;
   if v_rank>c.customer_status_rank then
    c.customer_status_rank:=v_rank;
    if v_rank=2 and not c.customer_joined then c.state:='ringing'; end if;
    -- answered alone means the customer leg answered, not that the conference joined.
    if v_rank=4 then
     c.state:=case when p_kind in ('customer_completed','customer_leave') and c.customer_joined then 'completed' else 'failed' end;
     c.ended_at:=now();
    end if;
   end if;
  elsif p_kind in ('agent_leave','conference_end','cancel') then
   c.state:=case when p_kind='cancel' then 'cancelled' when c.customer_joined then 'completed' else 'cancelled' end;c.ended_at:=now();
  elsif p_kind='dispatch_ack' then
   c.customer_dispatch:='acknowledged';
  elsif p_kind='dispatch_uncertain' and c.customer_dispatch='claimed' then
   c.customer_dispatch:='uncertain';c.state:='uncertain';
  end if;
 end if;
 update public.voice_phone_calls set state=c.state,agent_joined=c.agent_joined,customer_joined=c.customer_joined,
  customer_dispatch=c.customer_dispatch,customer_status_rank=c.customer_status_rank,customer_call_sid=c.customer_call_sid,
  conference_sid=c.conference_sid,ended_at=c.ended_at,cleanup_pending=(c.ended_at is not null),updated_at=now() where id=c.id returning * into c;
 update public.voice_call_sessions set
  status=case when c.ended_at is not null then case when c.state='failed' then 'failed' when c.state='cancelled' then 'cancelled' else 'completed' end
   when c.customer_joined then 'live' else status end,
  started_at=case when c.customer_joined then coalesce(started_at,now()) else started_at end,
  ended_at=c.ended_at,updated_at=now() where id=c.id;
 return jsonb_build_object('call',to_jsonb(c),'dial',v_dial,'close',c.ended_at is not null,'duplicate',false);
end $$;
revoke all on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.bind_voice_phone_call(uuid,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.bind_voice_phone_call(uuid,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text) to service_role;
commit;
