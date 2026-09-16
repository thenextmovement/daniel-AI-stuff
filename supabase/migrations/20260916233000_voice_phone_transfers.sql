begin;
create table public.voice_phone_transfers (
 id uuid primary key default gen_random_uuid(),
 call_id uuid not null references public.voice_phone_calls(id),
 request_key uuid not null,
 from_staff_id uuid not null references public.voice_staff(id),
 from_device_id uuid not null references public.voice_staff_devices(id),
 from_call_sid text not null check(from_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 to_staff_id uuid not null references public.voice_staff(id),
 to_device_id uuid not null references public.voice_staff_devices(id),
 to_call_sid text unique check(to_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 state text not null default 'preparing' check(state in ('preparing','dialing','consulting','committing','cancelling','transferred','cancelled','failed')),
 cancel_requested boolean not null default false,
 customer_held boolean not null default false,
 dial_claimed boolean not null default false,
 target_joined boolean not null default false,
 target_guards_exit boolean not null default false,
 source_releases_exit boolean not null default false,
 owner_adopted boolean not null default false,
 source_removed boolean not null default false,
 target_removed boolean not null default false,
 customer_resumed boolean not null default false,
 cleanup_pending boolean not null default false,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '60 seconds',
 ended_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(call_id,request_key),
 check(from_staff_id<>to_staff_id),
 check(from_device_id<>to_device_id)
);
create unique index voice_phone_transfer_one_active_call on public.voice_phone_transfers(call_id) where ended_at is null or cleanup_pending;
create unique index voice_phone_transfer_one_active_target on public.voice_phone_transfers(to_staff_id) where ended_at is null or cleanup_pending;
create table public.voice_phone_transfer_events (
 transfer_id uuid not null references public.voice_phone_transfers(id),
 event_key text not null check(char_length(event_key) between 1 and 160),
 kind text not null,
 created_at timestamptz not null default now(),
 primary key(transfer_id,event_key)
);
alter table public.voice_phone_transfers enable row level security;
alter table public.voice_phone_transfer_events enable row level security;
revoke all on public.voice_phone_transfers,public.voice_phone_transfer_events from public,anon,authenticated;
grant select,insert,update,delete on public.voice_phone_transfers,public.voice_phone_transfer_events to service_role;

create function public.begin_voice_phone_transfer(p_call_id uuid,p_device_id uuid,p_target_staff_id uuid,p_request_key uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype; t public.voice_phone_transfers%rowtype; d public.voice_staff_devices%rowtype;
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
 select x.* into d from public.voice_staff_devices x join public.voice_staff s on s.id=x.staff_id
  where x.staff_id=p_target_staff_id and x.revoked_at is null and x.expires_at>now()+interval '2 minutes'
   and x.available and x.registered and x.last_seen_at>now()-interval '45 seconds' and x.last_seen_at<=now()+interval '5 seconds'
   and (x.enrolled_via<>'personal_access' or x.access_email is not distinct from s.access_email)
  order by x.last_seen_at desc,x.id limit 1;
 if not found then raise exception 'transfer_target_unavailable';end if;
 insert into public.voice_phone_transfers(call_id,request_key,from_staff_id,from_device_id,from_call_sid,to_staff_id,to_device_id)
  values(c.id,p_request_key,c.staff_id,c.device_id,c.agent_call_sid,p_target_staff_id,d.id) returning * into t;
 return to_jsonb(t);
end $$;

-- Provider acknowledgments are passed only by the authenticated runtime. Operator
-- intent uses its independently verified device ID, never a browser display name.
create function public.advance_voice_phone_transfer(p_transfer_id uuid,p_key text,p_kind text,p_call_sid text default null,p_actor_device_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;t public.voice_phone_transfers%rowtype;v_call_id uuid;v_dial boolean:=false;
begin
 select call_id into v_call_id from public.voice_phone_transfers where id=p_transfer_id;
 select * into c from public.voice_phone_calls where id=v_call_id for update;
 select * into t from public.voice_phone_transfers where id=p_transfer_id for update;
 if not found then raise exception 'transfer_not_found';end if;
 if p_kind not in ('held','claim_dial','target_bound','target_joined','target_left','request_commit','target_guards','source_releases','adopt','source_removed','resumed','complete','intent_cancel','request_cancel','target_removed','rollback_resumed','rollback_complete','call_ended')
 then raise exception 'transfer_invalid_event';end if;
 if p_kind in ('request_commit','intent_cancel','request_cancel') and (p_actor_device_id is null or
  (p_actor_device_id<>t.from_device_id and (p_kind not in ('intent_cancel','request_cancel') or p_actor_device_id<>t.to_device_id)))
 then raise exception 'transfer_actor_forbidden';end if;
 if p_call_sid is not null and (p_call_sid !~ '^CA[0-9a-fA-F]{32}$' or p_call_sid in(t.from_call_sid,c.customer_call_sid) or
  (t.to_call_sid is not null and t.to_call_sid<>p_call_sid)) then raise exception 'transfer_leg_conflict';end if;
 if p_kind in ('target_bound','target_joined','target_left') and p_call_sid is null then raise exception 'transfer_leg_required';end if;
 if p_kind in ('target_bound','target_joined','target_left') and not t.dial_claimed then raise exception 'transfer_dial_not_claimed';end if;
 if exists(select 1 from public.voice_phone_transfer_events where transfer_id=t.id and event_key=p_key) then
  return jsonb_build_object('transfer',to_jsonb(t),'dial',false,'duplicate',true);
 end if;
 if p_call_sid is not null then t.to_call_sid:=p_call_sid;end if;
 if c.ended_at is not null or p_kind='call_ended' then
  t.state:='failed';t.ended_at:=coalesce(t.ended_at,now());t.cleanup_pending:=true;
 elsif t.ended_at is not null then
  -- A late create response may reveal a target leg after rollback. Re-arm
  -- cleanup instead of reviving the transfer or leaving the phone ringing.
  if p_kind in ('target_bound','target_joined','target_left') and t.state<>'transferred' then t.cleanup_pending:=true;end if;
 else
  case p_kind
  when 'held' then
   if t.state<>'preparing' then raise exception 'transfer_wrong_stage';end if;
   t.customer_held:=true;
  when 'claim_dial' then
   if t.state not in ('preparing','dialing') or not t.customer_held or t.cancel_requested or t.expires_at<=now() then raise exception 'transfer_wrong_stage';end if;
   if not t.dial_claimed then t.dial_claimed:=true;t.state:='dialing';v_dial:=true;end if;
  when 'target_bound' then null;
  when 'target_joined' then
   if t.state not in ('dialing','consulting') or not t.customer_held then raise exception 'transfer_wrong_stage';end if;
   if not exists(select 1 from public.voice_staff_devices x join public.voice_staff s on s.id=x.staff_id
    where x.id=t.to_device_id and x.staff_id=t.to_staff_id and s.enabled and x.revoked_at is null and x.expires_at>now()
     and (x.enrolled_via<>'personal_access' or x.access_email is not distinct from s.access_email))
   then raise exception 'transfer_target_unavailable';end if;
   t.target_joined:=true;t.state:='consulting';
  when 'target_left' then
   t.target_joined:=false;
   if t.owner_adopted then t.state:='failed';t.ended_at:=now();t.cleanup_pending:=true;
   else t.state:='cancelling';end if;
  when 'request_commit' then
   if t.state<>'consulting' or not t.target_joined or t.cancel_requested then raise exception 'transfer_target_not_connected';end if;
   t.state:='committing';
  when 'target_guards' then
   if t.state<>'committing' or not t.target_joined then raise exception 'transfer_wrong_stage';end if;
   t.target_guards_exit:=true;
  when 'source_releases' then
   if t.state<>'committing' or not t.target_guards_exit then raise exception 'transfer_wrong_stage';end if;
   t.source_releases_exit:=true;
  when 'adopt' then
   if t.state<>'committing' or not t.target_joined or not t.target_guards_exit or not t.source_releases_exit or t.to_call_sid is null then raise exception 'transfer_wrong_stage';end if;
   if c.device_id<>t.from_device_id and not t.owner_adopted then raise exception 'transfer_owner_changed';end if;
   if not exists(select 1 from public.voice_staff_devices x join public.voice_staff s on s.id=x.staff_id
    where x.id=t.to_device_id and x.staff_id=t.to_staff_id and s.enabled and x.revoked_at is null and x.expires_at>now()
    and (x.enrolled_via<>'personal_access' or x.access_email is not distinct from s.access_email))
   then raise exception 'transfer_target_unavailable';end if;
   t.owner_adopted:=true;
   update public.voice_phone_calls set staff_id=t.to_staff_id,device_id=t.to_device_id,agent_call_sid=t.to_call_sid,updated_at=now() where id=c.id;
  when 'source_removed' then
   if t.state<>'committing' or not t.owner_adopted then raise exception 'transfer_wrong_stage';end if;
   t.source_removed:=true;
  when 'resumed' then
   if t.state<>'committing' or not t.source_removed then raise exception 'transfer_wrong_stage';end if;
   t.customer_resumed:=true;
  when 'complete' then
   if t.state<>'committing' or not t.customer_resumed then raise exception 'transfer_wrong_stage';end if;
   t.state:='transferred';t.ended_at:=now();
  when 'intent_cancel' then
   if t.state='committing' then raise exception 'transfer_commit_in_progress';end if;
   t.cancel_requested:=true;
  when 'request_cancel' then
   if t.state='committing' then raise exception 'transfer_commit_in_progress';end if;
   t.state:='cancelling';
  when 'target_removed' then
   if t.state<>'cancelling' then raise exception 'transfer_wrong_stage';end if;
   t.target_removed:=true;
  when 'rollback_resumed' then
   if t.state<>'cancelling' or not t.target_removed then raise exception 'transfer_wrong_stage';end if;
   t.customer_resumed:=true;
  when 'rollback_complete' then
   if t.state<>'cancelling' or not t.customer_resumed then raise exception 'transfer_wrong_stage';end if;
   t.state:='cancelled';t.ended_at:=now();
  else null;
  end case;
 end if;
 insert into public.voice_phone_transfer_events(transfer_id,event_key,kind) values(t.id,p_key,p_kind);
 update public.voice_phone_transfers set cancel_requested=t.cancel_requested,state=t.state,to_call_sid=t.to_call_sid,customer_held=t.customer_held,
  dial_claimed=t.dial_claimed,target_joined=t.target_joined,target_guards_exit=t.target_guards_exit,
  source_releases_exit=t.source_releases_exit,owner_adopted=t.owner_adopted,source_removed=t.source_removed,target_removed=t.target_removed,
  customer_resumed=t.customer_resumed,cleanup_pending=t.cleanup_pending,ended_at=t.ended_at,updated_at=now()
  where id=t.id returning * into t;
 return jsonb_build_object('transfer',to_jsonb(t),'dial',v_dial,'duplicate',false);
end $$;
revoke all on function public.begin_voice_phone_transfer(uuid,uuid,uuid,uuid),public.advance_voice_phone_transfer(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_voice_phone_transfer(uuid,uuid,uuid,uuid),public.advance_voice_phone_transfer(uuid,text,text,text,uuid) to service_role;
-- Preserve the reviewed call reducer, adding admission and former-agent handling.
alter function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text) rename to reserve_voice_phone_call_base;
revoke all on function public.reserve_voice_phone_call_base(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
create function public.reserve_voice_phone_call(p_device_id uuid,p_staff_id uuid,p_request_key uuid,p_phone text,p_customer_id uuid default null,p_request_id text default null)
 returns public.voice_phone_calls language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.voice_staff where id=p_staff_id for update;
 if exists(select 1 from public.voice_phone_transfers where (to_staff_id=p_staff_id or from_staff_id=p_staff_id) and (ended_at is null or cleanup_pending)) then raise exception 'phone_staff_busy';end if;
 return public.reserve_voice_phone_call_base(p_device_id,p_staff_id,p_request_key,p_phone,p_customer_id,p_request_id);
end $$;
alter function public.apply_voice_phone_event(uuid,text,text,text,text) rename to apply_voice_phone_event_base;
revoke all on function public.apply_voice_phone_event_base(uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.apply_voice_phone_event(p_call_id uuid,p_key text,p_kind text,p_call_sid text default null,p_conference_sid text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype; t public.voice_phone_transfers%rowtype; r jsonb;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 -- An operator cancellation or worker observation belongs to the agent leg it
 -- inspected. A handoff may have adopted a new leg before this transaction.
 if (p_key='operator:cancel' or p_key like 'reconcile:%') and p_call_sid is distinct from c.agent_call_sid then
  return jsonb_build_object('call',to_jsonb(c),'dial',false,'close',false,'duplicate',false);
 end if;
 if p_kind in ('agent_join','agent_leave') and p_call_sid is distinct from c.agent_call_sid then
  select * into t from public.voice_phone_transfers where call_id=c.id and from_call_sid=p_call_sid and owner_adopted;
  if found then
   if p_conference_sid is not null and p_conference_sid is distinct from c.conference_sid then raise exception 'phone_conference_conflict';end if;
   insert into public.voice_phone_events(call_id,event_key,kind) values(c.id,p_key,'former_'||p_kind) on conflict do nothing;
   if p_kind='agent_leave' and t.state='committing' then
    perform public.advance_voice_phone_transfer(t.id,'source:leave','source_removed');
   end if;
   return jsonb_build_object('call',to_jsonb(c),'dial',false,'close',c.ended_at is not null,'duplicate',false);
  end if;
 end if;
 r:=public.apply_voice_phone_event_base(p_call_id,p_key,p_kind,p_call_sid,p_conference_sid);
 if (r->>'close')::boolean then
  update public.voice_phone_transfers set state='failed',ended_at=coalesce(ended_at,now()),cleanup_pending=true,updated_at=now() where call_id=p_call_id and ended_at is null;
 end if;
 return r;
end $$;
revoke all on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text),public.apply_voice_phone_event(uuid,text,text,text,text) to service_role;

create function public.bind_voice_phone_transfer_device(p_transfer_id uuid,p_device_id uuid,p_call_sid text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.voice_phone_transfers%rowtype;c public.voice_phone_calls%rowtype;v_call_id uuid;r jsonb;
begin
 select call_id into v_call_id from public.voice_phone_transfers where id=p_transfer_id;
 select * into c from public.voice_phone_calls where id=v_call_id for update;
 select * into t from public.voice_phone_transfers where id=p_transfer_id for update;
 if not found or t.to_device_id<>p_device_id or t.ended_at is not null or c.ended_at is not null
  or t.cancel_requested or t.state not in ('dialing','consulting') or not t.customer_held or not t.dial_claimed or t.expires_at<=now()
 then raise exception 'transfer_invitation_not_current';end if;
 if not exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  where d.id=p_device_id and d.staff_id=t.to_staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email))
 then raise exception 'phone_identity_required';end if;
 r:=public.advance_voice_phone_transfer(t.id,'browser:bind','target_bound',p_call_sid);
 return jsonb_build_object('transfer',r->'transfer','call',to_jsonb(c));
end $$;
revoke all on function public.bind_voice_phone_transfer_device(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_voice_phone_transfer_device(uuid,uuid,text) to service_role;

commit;
