begin;
create table public.voice_phone_mobile_incoming(
 id uuid primary key default gen_random_uuid(),
 incoming_id uuid not null references public.voice_phone_incoming(id),
 staff_id uuid not null references public.voice_staff(id),
 device_id uuid not null references public.voice_staff_devices(id),
 mobile_link_id uuid not null references public.voice_mobile_links(id),
 phone text not null check(phone ~ '^[+][1-9][0-9]{6,14}$'),
 state text not null default 'ready' check(state in('ready','claimed','screening','adopted','ended')),
 provider_call_sid text unique check(provider_call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 claimed_at timestamptz,ended_at timestamptz,provider_ended_at timestamptz,
 mobile_leg_id uuid unique references public.voice_phone_mobile_legs(id),
 expires_at timestamptz not null,cleanup_pending boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(incoming_id,staff_id)
);
create unique index voice_mobile_incoming_one_offer on public.voice_phone_mobile_incoming(staff_id)
 where ended_at is null;
create index voice_mobile_incoming_recovery on public.voice_phone_mobile_incoming(updated_at)
 where ended_at is null or cleanup_pending;
alter table public.voice_phone_mobile_incoming enable row level security;
revoke all on public.voice_phone_mobile_incoming from public,anon,authenticated;
grant select,insert,update on public.voice_phone_mobile_incoming to service_role;

-- Offers do not own or create the customer call. Both browser acceptance and
-- mobile DTMF acceptance serialize on the existing incoming ledger.
create function public.offer_voice_mobile_incoming(p_incoming_id uuid,p_allowed_phones text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.voice_phone_incoming%rowtype;r record;result jsonb;
begin
 select * into i from public.voice_phone_incoming where id=p_incoming_id for update;
 if not found then raise exception 'incoming_not_found';end if;
 if i.state='waiting' and i.ended_at is null and i.expires_at>now() and i.customer_joined and i.conference_sid is not null then
  for r in select s.id from public.voice_staff s where s.enabled and s.mobile_receive_device_id is not null order by s.id for update loop
   insert into public.voice_phone_mobile_incoming(incoming_id,staff_id,device_id,mobile_link_id,phone,expires_at)
   select i.id,x.staff_id,x.device_id,x.link_id,x.phone,i.expires_at from public.voice_mobile_receivers(r.id) x
   where x.phone=any(p_allowed_phones) and x.phone<>i.phone
    and not exists(select 1 from public.voice_phone_incoming_declines where incoming_id=i.id and staff_id=x.staff_id)
    and not exists(select 1 from public.voice_phone_calls where staff_id=x.staff_id and (ended_at is null or cleanup_pending))
    and not exists(select 1 from public.voice_phone_transfers where (from_staff_id=x.staff_id or to_staff_id=x.staff_id) and (ended_at is null or cleanup_pending))
    and not exists(select 1 from public.voice_phone_mobile_legs where staff_id=x.staff_id and cleanup_pending)
    and not exists(select 1 from public.voice_phone_mobile_incoming where staff_id=x.staff_id and (ended_at is null or cleanup_pending))
   on conflict(incoming_id,staff_id) do nothing;
  end loop;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from public.voice_phone_mobile_incoming x
 where x.incoming_id=i.id and (x.ended_at is null or x.cleanup_pending);
 return jsonb_build_object('offers',result);
end $$;

create function public.advance_voice_mobile_incoming(p_id uuid,p_kind text,p_call_sid text default null,p_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.voice_phone_mobile_incoming%rowtype;i public.voice_phone_incoming%rowtype;c public.voice_phone_calls%rowtype;
 v_incoming uuid;v_staff uuid;eligible boolean;dial boolean:=false;
begin
 select incoming_id,staff_id into v_incoming,v_staff from public.voice_phone_mobile_incoming where id=p_id;
 select * into i from public.voice_phone_incoming where id=v_incoming for update;
 perform 1 from public.voice_staff where id=v_staff for update;
 perform 1 from public.voice_staff_devices d join public.voice_phone_mobile_incoming x on x.device_id=d.id where x.id=p_id for update of d;
 select * into o from public.voice_phone_mobile_incoming where id=p_id for update;
 if not found then raise exception 'incoming_mobile_offer_not_found';end if;
 if p_kind not in('claim','bind','prompt','confirm','reject','terminal','expire','cancel','cleanup') then raise exception 'incoming_mobile_action_invalid';end if;
 if p_kind in('bind','prompt','confirm','reject','terminal') then
  if o.claimed_at is null or p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$' or p_call_sid=i.customer_call_sid
   or (o.provider_call_sid is not null and o.provider_call_sid<>p_call_sid) then raise exception 'incoming_mobile_leg_conflict';end if;
  o.provider_call_sid:=p_call_sid;
 end if;
 -- After adoption callbacks belong to the ordinary mobile call reducer, even
 -- after an onward handoff. The offer must never clean up that shared leg.
 if o.mobile_leg_id is not null then return jsonb_build_object('offer',to_jsonb(o),'incoming',to_jsonb(i),'dial',false);end if;
 eligible:=i.state='waiting' and i.ended_at is null and i.expires_at>now() and i.customer_joined and i.conference_sid is not null
  and exists(select 1 from public.voice_mobile_receivers(o.staff_id) x where x.device_id=o.device_id and x.link_id=o.mobile_link_id and x.phone=o.phone)
  and not exists(select 1 from public.voice_phone_incoming_declines where incoming_id=i.id and staff_id=o.staff_id)
  and not exists(select 1 from public.voice_phone_calls where staff_id=o.staff_id and (ended_at is null or cleanup_pending))
  and not exists(select 1 from public.voice_phone_transfers where (from_staff_id=o.staff_id or to_staff_id=o.staff_id) and (ended_at is null or cleanup_pending))
  and not exists(select 1 from public.voice_phone_mobile_legs where staff_id=o.staff_id and cleanup_pending);
 if p_kind='cleanup' then
  if o.ended_at is not null and o.provider_call_sid is null and o.expires_at+interval '60 seconds'<=now() and o.updated_at=p_updated_at
  then o.cleanup_pending:=false;end if;
 else
  if p_kind='terminal' then o.provider_ended_at:=coalesce(o.provider_ended_at,now());end if;
  if o.ended_at is null and (p_kind in('cancel','reject','terminal') or not eligible or o.expires_at<=now()) then
   o.state:='ended';o.ended_at:=now();
   if p_kind='reject' and i.state='waiting' then
    insert into public.voice_phone_incoming_declines(incoming_id,staff_id) values(i.id,o.staff_id) on conflict do nothing;
   end if;
  elsif o.ended_at is null then
   if p_kind='claim' and o.claimed_at is null then o.state:='claimed';o.claimed_at:=now();dial:=true;
   elsif p_kind='prompt' then o.state:='screening';
   elsif p_kind='confirm' then
    if o.state<>'screening' then raise exception 'incoming_mobile_screening_required';end if;
    insert into public.voice_phone_calls(id,device_id,staff_id,request_key,customer_id,request_id,phone,state,direction,
     customer_call_sid,conference_sid,customer_dispatch,customer_joined,expires_at,agent_transport)
    values(i.id,o.device_id,o.staff_id,i.id,i.customer_id,i.request_id,i.phone,'connecting','inbound',
     i.customer_call_sid,i.conference_sid,'acknowledged',true,now()+interval '30 seconds','mobile') returning * into c;
    insert into public.voice_phone_mobile_legs(id,call_id,staff_id,device_id,mobile_link_id,phone,state,provider_call_sid,
     claimed_at,confirmed_at,expires_at,cleanup_pending)
    values(o.id,c.id,o.staff_id,o.device_id,o.mobile_link_id,o.phone,'confirmed',o.provider_call_sid,o.claimed_at,now(),c.expires_at,true);
    update public.voice_phone_calls set agent_call_sid=o.provider_call_sid,updated_at=now() where id=c.id returning * into c;
    update public.voice_phone_incoming set state='claimed',device_id=o.device_id,staff_id=o.staff_id,expires_at=c.expires_at,updated_at=now()
     where id=i.id returning * into i;
    update public.voice_call_sessions set operator_name=(select display_name from public.voice_staff where id=o.staff_id),
     context_snapshot=context_snapshot||jsonb_build_object('staff_id',o.staff_id),updated_at=now() where id=i.id;
    o.state:='adopted';o.mobile_leg_id:=o.id;o.ended_at:=now();
    update public.voice_phone_mobile_incoming set state='ended',ended_at=now(),cleanup_pending=claimed_at is not null and provider_ended_at is null,updated_at=now()
     where incoming_id=i.id and id<>o.id and ended_at is null;
   end if;
  end if;
  o.cleanup_pending:=o.mobile_leg_id is null and o.claimed_at is not null and o.provider_ended_at is null;
 end if;
 update public.voice_phone_mobile_incoming set state=o.state,provider_call_sid=o.provider_call_sid,claimed_at=o.claimed_at,
  ended_at=o.ended_at,provider_ended_at=o.provider_ended_at,mobile_leg_id=o.mobile_leg_id,cleanup_pending=o.cleanup_pending,updated_at=now()
 where id=o.id returning * into o;
 return jsonb_build_object('offer',to_jsonb(o),'incoming',to_jsonb(i),'dial',dial);
end $$;

create function public.ack_voice_incoming_cleanup(p_incoming_id uuid,p_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.voice_phone_incoming where id=p_incoming_id for update;
 update public.voice_phone_incoming set cleanup_pending=false where id=p_incoming_id and ended_at is not null and updated_at=p_updated_at
 and not exists(select 1 from public.voice_phone_mobile_incoming where incoming_id=p_incoming_id and cleanup_pending);
end $$;
-- A completed inbound call also waits for any losing handset invitations.
alter function public.ack_voice_phone_cleanup(uuid,timestamptz) rename to ack_voice_phone_cleanup_before_mobile_incoming;
revoke all on function public.ack_voice_phone_cleanup_before_mobile_incoming(uuid,timestamptz) from public,anon,authenticated,service_role;
create function public.ack_voice_phone_cleanup(p_call_id uuid,p_updated_at timestamptz)
returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if exists(select 1 from public.voice_phone_mobile_incoming where incoming_id=p_call_id and cleanup_pending) then return c;end if;
 return public.ack_voice_phone_cleanup_before_mobile_incoming(p_call_id,p_updated_at);
end $$;
revoke all on function public.offer_voice_mobile_incoming(uuid,text[]),public.advance_voice_mobile_incoming(uuid,text,text,timestamptz),
 public.ack_voice_incoming_cleanup(uuid,timestamptz),public.ack_voice_phone_cleanup(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.offer_voice_mobile_incoming(uuid,text[]),public.advance_voice_mobile_incoming(uuid,text,text,timestamptz),
 public.ack_voice_incoming_cleanup(uuid,timestamptz),public.ack_voice_phone_cleanup(uuid,timestamptz) to service_role;
commit;
