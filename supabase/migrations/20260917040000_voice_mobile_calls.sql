begin;
alter table public.voice_phone_calls add column agent_transport text not null default 'browser' check(agent_transport in('browser','mobile'));
create table public.voice_phone_mobile_legs(
 id uuid primary key default gen_random_uuid(),
 call_id uuid not null references public.voice_phone_calls(id),
 staff_id uuid not null references public.voice_staff(id),
 device_id uuid not null references public.voice_staff_devices(id),
 mobile_link_id uuid not null references public.voice_mobile_links(id),
 phone text not null check(phone ~ '^[+][1-9][0-9]{6,14}$'),
 state text not null default 'ready' check(state in('ready','claimed','screening','confirmed','ended')),
 provider_call_sid text unique check(provider_call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 claimed_at timestamptz,
 confirmed_at timestamptz,
 expires_at timestamptz not null default now()+interval '60 seconds',
 ended_at timestamptz,
 provider_ended_at timestamptz,
 cleanup_pending boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index voice_phone_mobile_recover on public.voice_phone_mobile_legs(updated_at) where ended_at is null or cleanup_pending;
alter table public.voice_phone_calls add column mobile_leg_id uuid references public.voice_phone_mobile_legs(id);
alter table public.voice_phone_mobile_legs enable row level security;
revoke all on public.voice_phone_mobile_legs from public,anon,authenticated;
grant select,insert,update on public.voice_phone_mobile_legs to service_role;

-- When a handoff adopts another provider leg, its actual endpoint determines
-- the call's current audio owner. Earlier mobile legs retain their own cleanup.
create function public.voice_phone_agent_transport() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.voice_phone_mobile_legs%rowtype;
begin
 if new.agent_call_sid is distinct from old.agent_call_sid and new.agent_call_sid is not null then
  select * into m from public.voice_phone_mobile_legs where call_id=new.id and provider_call_sid=new.agent_call_sid;
  new.agent_transport:=case when found then 'mobile' else 'browser' end;
  new.mobile_leg_id:=m.id;
 end if;
 return new;
end $$;
revoke all on function public.voice_phone_agent_transport() from public,anon,authenticated,service_role;
create trigger voice_phone_agent_transport before update of agent_call_sid on public.voice_phone_calls
 for each row execute function public.voice_phone_agent_transport();

alter function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text) rename to reserve_voice_phone_call_before_mobile;
revoke all on function public.reserve_voice_phone_call_before_mobile(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
create function public.reserve_voice_phone_call(p_device_id uuid,p_staff_id uuid,p_request_key uuid,p_phone text,p_customer_id uuid default null,p_request_id text default null)
returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 c:=public.reserve_voice_phone_call_before_mobile(p_device_id,p_staff_id,p_request_key,p_phone,p_customer_id,p_request_id);
 if exists(select 1 from public.voice_phone_mobile_legs where call_id=c.id) then raise exception 'phone_transport_conflict';end if;
 return c;
end $$;
create function public.reserve_voice_mobile_call(p_device_id uuid,p_staff_id uuid,p_request_key uuid,p_phone text,p_link_id uuid,p_customer_id uuid default null,p_request_id text default null)
returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;s public.voice_staff%rowtype;l public.voice_mobile_links%rowtype;m public.voice_phone_mobile_legs%rowtype;old_call uuid;
begin
 select * into s from public.voice_staff where id=p_staff_id and enabled for update;
 if not found then raise exception 'phone_identity_required';end if;
 select * into l from public.voice_mobile_links where id=p_link_id and staff_id=s.id and state='verified' and revoked_at is null and staff_revision=s.revision;
 if not found or l.phone=p_phone then raise exception 'mobile_target_invalid';end if;
 select c0.id into old_call from public.voice_phone_calls c0 left join public.voice_phone_mobile_legs m0 on m0.call_id=c0.id
  where (c0.device_id=p_device_id or m0.device_id=p_device_id) and c0.request_key=p_request_key limit 1;
 if old_call is not null and exists(select 1 from public.voice_phone_calls where id=old_call and device_id<>p_device_id) then raise exception 'phone_reservation_transferred';end if;
 if old_call is not null and not exists(select 1 from public.voice_phone_mobile_legs where call_id=old_call and mobile_link_id=l.id)
 then raise exception 'phone_transport_conflict';end if;
 if exists(select 1 from public.voice_phone_mobile_legs where staff_id=s.id and cleanup_pending and call_id is distinct from old_call)
 then raise exception 'phone_staff_busy';end if;
 c:=public.reserve_voice_phone_call_before_mobile(p_device_id,p_staff_id,p_request_key,p_phone,p_customer_id,p_request_id);
 if old_call is not null then return c;end if;
 insert into public.voice_phone_mobile_legs(call_id,staff_id,device_id,mobile_link_id,phone)
 values(c.id,s.id,p_device_id,l.id,l.phone) returning * into m;
 update public.voice_phone_calls set agent_transport='mobile',mobile_leg_id=m.id where id=c.id returning * into c;
 return c;
end $$;

alter function public.bind_voice_phone_call(uuid,uuid,text) rename to bind_voice_phone_call_before_mobile;
revoke all on function public.bind_voice_phone_call_before_mobile(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.bind_voice_phone_call(p_call_id uuid,p_device_id uuid,p_agent_call_sid text)
returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if c.agent_transport='mobile' then raise exception 'mobile_call_requires_callback';end if;
 return public.bind_voice_phone_call_before_mobile(p_call_id,p_device_id,p_agent_call_sid);
end $$;

alter function public.apply_voice_phone_event(uuid,text,text,text,text) rename to apply_voice_phone_event_before_mobile;
revoke all on function public.apply_voice_phone_event_before_mobile(uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.apply_voice_phone_event(p_call_id uuid,p_key text,p_kind text,p_call_sid text default null,p_conference_sid text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if p_kind='agent_join' and c.agent_transport='mobile' and p_call_sid=c.agent_call_sid and not exists(
  select 1 from public.voice_phone_mobile_legs m join public.voice_mobile_links l on l.id=m.mobile_link_id
  join public.voice_staff s on s.id=m.staff_id join public.voice_staff_devices d on d.id=m.device_id
  where m.id=c.mobile_leg_id and m.provider_call_sid=p_call_sid and m.confirmed_at is not null and m.ended_at is null
   and l.state='verified' and l.revoked_at is null and l.staff_revision=s.revision and s.enabled and d.revoked_at is null and d.expires_at>now()
 ) then raise exception 'mobile_confirmation_required';end if;
 return public.apply_voice_phone_event_before_mobile(p_call_id,p_key,p_kind,p_call_sid,p_conference_sid);
end $$;

create function public.advance_voice_phone_mobile(p_id uuid,p_kind text,p_call_sid text default null,p_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;m public.voice_phone_mobile_legs%rowtype;v_call uuid;eligible boolean;owned boolean;dial boolean:=false;effect jsonb;
begin
 select call_id into v_call from public.voice_phone_mobile_legs where id=p_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into m from public.voice_phone_mobile_legs where id=p_id for update;
 if not found then raise exception 'mobile_leg_not_found';end if;
 owned:=coalesce(c.mobile_leg_id=m.id and c.device_id=m.device_id and c.staff_id=m.staff_id,false);
 eligible:=exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  join public.voice_mobile_links l on l.staff_id=s.id and l.id=m.mobile_link_id
  where d.id=m.device_id and s.id=m.staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email)
   and l.state='verified' and l.revoked_at is null and l.staff_revision=s.revision and l.phone=m.phone);
 if p_kind not in('claim','bind','prompt','confirm','reject','terminal','expire','cancel','cleanup') then raise exception 'mobile_leg_action_invalid';end if;
 if p_kind in('bind','prompt','confirm','reject','terminal') then
  if m.claimed_at is null or p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$' or
   (m.provider_call_sid is not null and m.provider_call_sid<>p_call_sid) or p_call_sid=c.customer_call_sid
  then raise exception 'mobile_leg_conflict';end if;
  m.provider_call_sid:=p_call_sid;
 end if;
 if p_kind='cleanup' then
  if m.ended_at is not null and m.provider_call_sid is null and m.expires_at+interval '60 seconds'<=now() and m.updated_at=p_updated_at
  then m.cleanup_pending:=false;end if;
 else
  if p_kind='terminal' then m.provider_ended_at:=coalesce(m.provider_ended_at,now());end if;
  if m.ended_at is null and (p_kind in('terminal','cancel','reject') or c.ended_at is not null or not owned or not eligible or
    (m.confirmed_at is null and m.expires_at<=now())) then
   m.state:='ended';m.ended_at:=now();
  elsif m.ended_at is null then
   if p_kind='claim' and m.claimed_at is null then
    m.state:='claimed';m.claimed_at:=now();dial:=true;
   elsif p_kind='prompt' and m.confirmed_at is null then m.state:='screening';
   elsif p_kind='confirm' then
    if m.state not in('screening','confirmed') then raise exception 'mobile_screening_required';end if;
    m.state:='confirmed';m.confirmed_at:=coalesce(m.confirmed_at,now());
   end if;
  end if;
  m.cleanup_pending:=m.claimed_at is not null and m.provider_ended_at is null;
 end if;
 update public.voice_phone_mobile_legs set state=m.state,claimed_at=m.claimed_at,provider_call_sid=m.provider_call_sid,
  confirmed_at=m.confirmed_at,ended_at=m.ended_at,provider_ended_at=m.provider_ended_at,cleanup_pending=m.cleanup_pending,updated_at=now()
  where id=m.id returning * into m;
 if owned and c.ended_at is null then
  -- The mobile row is written first so the transport trigger can bind this SID.
  if m.provider_call_sid is not null and c.agent_call_sid is null then
   update public.voice_phone_calls set agent_call_sid=m.provider_call_sid,state='connecting',updated_at=now() where id=c.id returning * into c;
  elsif dial then
   update public.voice_phone_calls set state='connecting',updated_at=now() where id=c.id returning * into c;
  end if;
  if m.ended_at is not null then
   effect:=public.apply_voice_phone_event(c.id,'reconcile:mobile:'||m.id,'cancel',c.agent_call_sid);
   select * into c from public.voice_phone_calls where id=c.id;
  end if;
 end if;
 return jsonb_build_object('leg',to_jsonb(m),'call',to_jsonb(c),'dial',dial,
  'join',owned and c.ended_at is null and m.ended_at is null and m.confirmed_at is not null,
  'closeCall',c.ended_at is not null and c.cleanup_pending);
end $$;

create function public.ack_voice_phone_cleanup(p_call_id uuid,p_updated_at timestamptz)
returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if c.ended_at is not null and c.updated_at=p_updated_at and not exists(select 1 from public.voice_phone_mobile_legs where call_id=c.id and cleanup_pending) then
  update public.voice_phone_calls set cleanup_pending=false where id=c.id returning * into c;
 end if;
 return c;
end $$;
revoke all on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.reserve_voice_mobile_call(uuid,uuid,uuid,text,uuid,uuid,text),
 public.bind_voice_phone_call(uuid,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text),
 public.advance_voice_phone_mobile(uuid,text,text,timestamptz),public.ack_voice_phone_cleanup(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.reserve_voice_mobile_call(uuid,uuid,uuid,text,uuid,uuid,text),
 public.bind_voice_phone_call(uuid,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text),
 public.advance_voice_phone_mobile(uuid,text,text,timestamptz),public.ack_voice_phone_cleanup(uuid,timestamptz) to service_role;
commit;
