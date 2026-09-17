begin;
alter table public.voice_staff add column mobile_receive_device_id uuid references public.voice_staff_devices(id),
 add column mobile_receive_link_id uuid references public.voice_mobile_links(id);
alter table public.voice_phone_transfers add column to_transport text not null default 'browser' check(to_transport in('browser','mobile')),
 add column mobile_leg_id uuid references public.voice_phone_mobile_legs(id);
alter table public.voice_phone_mobile_legs add column transfer_id uuid unique references public.voice_phone_transfers(id);

create function public.voice_mobile_receivers(p_staff_id uuid default null)
returns table(staff_id uuid,device_id uuid,link_id uuid,phone text)
language sql stable security definer set search_path='' as $$
 select s.id,d.id,l.id,l.phone from public.voice_staff s
 join public.voice_staff_devices d on d.id=s.mobile_receive_device_id and d.staff_id=s.id
 join public.voice_mobile_links l on l.id=s.mobile_receive_link_id and l.staff_id=s.id
 where (p_staff_id is null or s.id=p_staff_id) and s.enabled and d.revoked_at is null and d.expires_at>now()+interval '2 minutes'
 and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email)
 and l.state='verified' and l.revoked_at is null and l.staff_revision=s.revision;
$$;
create function public.set_voice_mobile_receiving(p_device_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s public.voice_staff%rowtype;d public.voice_staff_devices%rowtype;l public.voice_mobile_links%rowtype;
begin
 select s0.* into s from public.voice_staff s0 join public.voice_staff_devices d0 on d0.staff_id=s0.id where d0.id=p_device_id for update of s0;
 select * into d from public.voice_staff_devices where id=p_device_id for update;
 if not found or not s.enabled or d.revoked_at is not null or d.expires_at<=now() or
  (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email)
 then raise exception 'phone_identity_required';end if;
 if p_enabled then
  select * into l from public.voice_mobile_links where staff_id=s.id and state='verified' and revoked_at is null and staff_revision=s.revision;
  if not found then raise exception 'mobile_link_required';end if;
 end if;
 update public.voice_staff set mobile_receive_device_id=case when p_enabled then d.id end,
  mobile_receive_link_id=case when p_enabled then l.id end where id=s.id;
end $$;
revoke all on function public.voice_mobile_receivers(uuid),public.set_voice_mobile_receiving(uuid,boolean) from public,anon,authenticated;
grant execute on function public.voice_mobile_receivers(uuid),public.set_voice_mobile_receiving(uuid,boolean) to service_role;

create function public.begin_voice_phone_transfer_routed(p_call_id uuid,p_device_id uuid,p_target_staff_id uuid,p_request_key uuid,p_mobile_enabled boolean,p_browser_enabled boolean)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype; t public.voice_phone_transfers%rowtype; d public.voice_staff_devices%rowtype; r record;m uuid;mobile_target boolean;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if not found or c.device_id<>p_device_id or c.ended_at is not null or c.cleanup_pending or
  c.state<>'connected' or not c.customer_joined or c.customer_call_sid is null or c.conference_sid is null
 then raise exception 'transfer_call_not_eligible';end if;
 if not exists(select 1 from public.voice_staff_devices x join public.voice_staff s on s.id=x.staff_id
  where x.id=p_device_id and x.staff_id=c.staff_id and s.enabled and x.revoked_at is null and x.expires_at>now()
   and (x.enrolled_via<>'personal_access' or x.access_email is not distinct from s.access_email))
 then raise exception 'phone_identity_required';end if;
 select * into t from public.voice_phone_transfers where call_id=c.id and request_key=p_request_key;
 if found then
  if t.from_device_id<>p_device_id or t.to_staff_id<>p_target_staff_id then raise exception 'transfer_replay_conflict';end if;
  return to_jsonb(t);
 end if;
 if p_target_staff_id=c.staff_id then raise exception 'transfer_same_person';end if;
 perform 1 from public.voice_staff where id=p_target_staff_id and enabled for update;
 if not found then raise exception 'transfer_target_unavailable';end if;
 if exists(select 1 from public.voice_phone_calls where staff_id=p_target_staff_id and (ended_at is null or cleanup_pending)) or
  exists(select 1 from public.voice_phone_transfers where (call_id=c.id or to_staff_id=p_target_staff_id or from_staff_id=p_target_staff_id) and (ended_at is null or cleanup_pending))
 then raise exception 'transfer_target_busy';end if;
 select mobile_receive_device_id is not null into mobile_target from public.voice_staff where id=p_target_staff_id;
 if mobile_target then
  if not p_mobile_enabled then raise exception 'mobile_transfers_disabled';end if;
  select * into r from public.voice_mobile_receivers(p_target_staff_id);
  if not found or r.phone=c.phone then raise exception 'transfer_target_unavailable';end if;
  if exists(select 1 from public.voice_phone_mobile_legs where staff_id=p_target_staff_id and cleanup_pending) then raise exception 'transfer_target_busy';end if;
  select * into d from public.voice_staff_devices where id=r.device_id;
 else
  if not p_browser_enabled then raise exception 'browser_transfers_disabled';end if;
 select x.* into d from public.voice_staff_devices x join public.voice_staff s on s.id=x.staff_id
  where x.staff_id=p_target_staff_id and x.revoked_at is null and x.expires_at>now()+interval '2 minutes'
   and x.available and x.registered and x.last_seen_at>now()-interval '45 seconds' and x.last_seen_at<=now()+interval '5 seconds'
   and (x.enrolled_via<>'personal_access' or x.access_email is not distinct from s.access_email)
  order by x.last_seen_at desc,x.id limit 1;
 if not found then raise exception 'transfer_target_unavailable';end if;
 end if;
 insert into public.voice_phone_transfers(call_id,request_key,from_staff_id,from_device_id,from_call_sid,to_staff_id,to_device_id)
  values(c.id,p_request_key,c.staff_id,c.device_id,c.agent_call_sid,p_target_staff_id,d.id) returning * into t;
 if mobile_target then
  insert into public.voice_phone_mobile_legs(call_id,staff_id,device_id,mobile_link_id,phone,transfer_id,expires_at)
  values(c.id,p_target_staff_id,d.id,r.link_id,r.phone,t.id,t.expires_at) returning id into m;
  update public.voice_phone_transfers set to_transport='mobile',mobile_leg_id=m where id=t.id returning * into t;
 end if;
 return to_jsonb(t);
end $$;
create or replace function public.begin_voice_phone_transfer(p_call_id uuid,p_device_id uuid,p_target_staff_id uuid,p_request_key uuid)
returns jsonb language sql security definer set search_path='' as $$
 select public.begin_voice_phone_transfer_routed(p_call_id,p_device_id,p_target_staff_id,p_request_key,false,true);
$$;
revoke all on function public.begin_voice_phone_transfer_routed(uuid,uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.begin_voice_phone_transfer_routed(uuid,uuid,uuid,uuid,boolean,boolean) to service_role;

create or replace function public.advance_voice_phone_mobile(p_id uuid,p_kind text,p_call_sid text default null,p_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;m public.voice_phone_mobile_legs%rowtype;v_call uuid;eligible boolean;owned boolean;dial boolean:=false;effect jsonb;t public.voice_phone_transfers%rowtype;invited boolean:=false;
begin
 select call_id into v_call from public.voice_phone_mobile_legs where id=p_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select t0.* into t from public.voice_phone_transfers t0 join public.voice_phone_mobile_legs m0 on m0.transfer_id=t0.id where m0.id=p_id for update of t0;
 select * into m from public.voice_phone_mobile_legs where id=p_id for update;
 if not found then raise exception 'mobile_leg_not_found';end if;
 owned:=coalesce(c.mobile_leg_id=m.id and c.device_id=m.device_id and c.staff_id=m.staff_id,false);
 invited:=coalesce(t.id=m.transfer_id and t.mobile_leg_id=m.id and t.to_device_id=m.device_id and t.to_staff_id=m.staff_id
  and not t.owner_adopted and t.ended_at is null and not t.cancel_requested and t.state in('preparing','dialing','consulting','committing')
  and c.device_id=t.from_device_id and c.staff_id=t.from_staff_id,false);
 eligible:=exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  join public.voice_mobile_links l on l.staff_id=s.id and l.id=m.mobile_link_id
  where d.id=m.device_id and s.id=m.staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email)
   and l.state='verified' and l.revoked_at is null and l.staff_revision=s.revision and l.phone=m.phone);
 if invited and not exists(select 1 from public.voice_mobile_receivers(m.staff_id) r where r.device_id=m.device_id and r.link_id=m.mobile_link_id) then eligible:=false;end if;
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
  if m.ended_at is null and (p_kind in('terminal','cancel','reject') or c.ended_at is not null or not (owned or invited) or not eligible or
    (m.confirmed_at is null and m.expires_at<=now())) then
   m.state:='ended';m.ended_at:=now();
  elsif m.ended_at is null then
   if p_kind='claim' and m.claimed_at is null and (owned or (invited and t.dial_claimed and t.customer_held and t.state='dialing')) then
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
 if m.transfer_id is not null and t.ended_at is null and not t.owner_adopted and m.provider_call_sid is not null and t.to_call_sid is null and t.dial_claimed then
  effect:=public.advance_voice_phone_transfer(t.id,'mobile:bind','target_bound',m.provider_call_sid);
  select * into t from public.voice_phone_transfers where id=t.id;
 end if;
 if m.transfer_id is not null and m.ended_at is not null and t.ended_at is null and not t.owner_adopted then
  effect:=public.advance_voice_phone_transfer(t.id,'mobile:ended',case when t.to_call_sid is not null then 'target_left' else 'request_cancel' end,t.to_call_sid,t.from_device_id);
  select * into t from public.voice_phone_transfers where id=t.id;
 end if;
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
  'transfer',case when t.id is not null then to_jsonb(t) else null end,
  'join',(owned or invited) and c.ended_at is null and m.ended_at is null and m.confirmed_at is not null,
  'closeCall',c.ended_at is not null and c.cleanup_pending);
end $$;

-- Browser admission cannot consume a mobile invitation. Only the signed
-- handset path, after its own DTMF proof, may bind that target.
alter function public.bind_voice_phone_transfer_device(uuid,uuid,text) rename to bind_voice_phone_transfer_before_mobile;
revoke all on function public.bind_voice_phone_transfer_before_mobile(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.bind_voice_phone_transfer_device(p_transfer_id uuid,p_device_id uuid,p_call_sid text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.voice_phone_transfers%rowtype;v_call uuid;
begin
 select call_id into v_call from public.voice_phone_transfers where id=p_transfer_id;
 perform 1 from public.voice_phone_calls where id=v_call for update;
 select * into t from public.voice_phone_transfers where id=p_transfer_id for update;
 if t.to_transport='mobile' then raise exception 'mobile_transfer_requires_callback';end if;
 return public.bind_voice_phone_transfer_before_mobile(p_transfer_id,p_device_id,p_call_sid);
end $$;

alter function public.advance_voice_phone_transfer(uuid,text,text,text,uuid) rename to advance_voice_phone_transfer_before_mobile;
revoke all on function public.advance_voice_phone_transfer_before_mobile(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
create function public.advance_voice_phone_transfer(p_transfer_id uuid,p_key text,p_kind text,p_call_sid text default null,p_actor_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.voice_phone_transfers%rowtype;c public.voice_phone_calls%rowtype;m public.voice_phone_mobile_legs%rowtype;r jsonb;v_call uuid;
begin
 select call_id into v_call from public.voice_phone_transfers where id=p_transfer_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into t from public.voice_phone_transfers where id=p_transfer_id for update;
 if t.to_transport='mobile' and p_kind in('target_joined','request_commit','adopt') then
  select * into m from public.voice_phone_mobile_legs where id=t.mobile_leg_id;
  if m.id is null or m.confirmed_at is null or m.ended_at is not null or m.provider_call_sid is distinct from t.to_call_sid or
   not exists(select 1 from public.voice_mobile_receivers(t.to_staff_id) x where x.device_id=t.to_device_id and x.link_id=m.mobile_link_id)
  then raise exception 'mobile_transfer_not_confirmed';end if;
 end if;
 r:=public.advance_voice_phone_transfer_before_mobile(p_transfer_id,p_key,p_kind,p_call_sid,p_actor_device_id);
 select * into t from public.voice_phone_transfers where id=p_transfer_id;
 if t.to_transport='mobile' and t.ended_at is not null and t.state<>'transferred' and
  exists(select 1 from public.voice_phone_mobile_legs where id=t.mobile_leg_id and cleanup_pending) then
  update public.voice_phone_transfers set cleanup_pending=true where id=t.id returning * into t;
  r:=jsonb_set(r,'{transfer}',to_jsonb(t));
 end if;
 return r;
end $$;
create function public.ack_voice_transfer_cleanup(p_transfer_id uuid,p_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare t public.voice_phone_transfers%rowtype;v_call uuid;
begin
 select call_id into v_call from public.voice_phone_transfers where id=p_transfer_id;
 perform 1 from public.voice_phone_calls where id=v_call for update;
 select * into t from public.voice_phone_transfers where id=p_transfer_id for update;
 if t.ended_at is not null and t.updated_at=p_updated_at and not exists(
  select 1 from public.voice_phone_mobile_legs where id=t.mobile_leg_id and cleanup_pending
 ) then update public.voice_phone_transfers set cleanup_pending=false where id=t.id;end if;
end $$;
revoke all on function public.bind_voice_phone_transfer_device(uuid,uuid,text),public.advance_voice_phone_transfer(uuid,text,text,text,uuid),public.ack_voice_transfer_cleanup(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.bind_voice_phone_transfer_device(uuid,uuid,text),public.advance_voice_phone_transfer(uuid,text,text,text,uuid),public.ack_voice_transfer_cleanup(uuid,timestamptz) to service_role;
commit;
