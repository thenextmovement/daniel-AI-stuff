begin;
alter table public.voice_staff add column can_manage_phone boolean not null default false;
alter table public.voice_staff add column revision integer not null default 1 check(revision>0);
create table public.voice_staff_admin_events(
 id uuid primary key default gen_random_uuid(),
 actor_staff_id uuid not null references public.voice_staff(id),
 actor_device_id uuid not null references public.voice_staff_devices(id),
 staff_id uuid not null references public.voice_staff(id),
 action text not null check(action in('create','update','issue_invite','revoke_invite','revoke_device')),
 related_id uuid,created_at timestamptz not null default now()
);
alter table public.voice_staff_admin_events enable row level security;
revoke all on public.voice_staff_admin_events from public,anon,authenticated;
grant select,insert on public.voice_staff_admin_events to service_role;

-- Management and enrollment both lock staff before invitations. Revoking an
-- invitation/profile and consuming its code cannot cross over each other.
create or replace function public.enroll_voice_staff_device(
 p_device_hash text,p_label text,p_invite_hash text default null,p_access_email text default null
) returns table(device_id uuid,staff_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_staff public.voice_staff%rowtype;v_invite public.voice_staff_invites%rowtype;v_device public.voice_staff_devices%rowtype;
begin
 if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' or p_label is null or length(trim(p_label)) not between 2 and 80 or
  (p_invite_hash is null)=(p_access_email is null) then raise exception 'invalid_device_enrollment' using errcode='22023';end if;
 if p_invite_hash is not null then
  select * into v_invite from public.voice_staff_invites where token_hash=p_invite_hash;
  if not found then raise exception 'enrollment_unavailable' using errcode='22023';end if;
  select * into v_staff from public.voice_staff where id=v_invite.staff_id and enabled for update;
  if not found then raise exception 'enrollment_unavailable' using errcode='22023';end if;
  select * into v_invite from public.voice_staff_invites where token_hash=p_invite_hash and voice_staff_invites.staff_id=v_staff.id
   and consumed_at is null and revoked_at is null and voice_staff_invites.expires_at>now() for update;
  if not found then raise exception 'enrollment_unavailable' using errcode='22023';end if;
 else
  select * into v_staff from public.voice_staff where access_email=lower(trim(p_access_email)) and enabled for update;
  if not found then raise exception 'enrollment_unavailable' using errcode='22023';end if;
 end if;
 if (select count(*) from public.voice_staff_devices where voice_staff_devices.staff_id=v_staff.id and revoked_at is null and voice_staff_devices.expires_at>now())>=8
  then raise exception 'device_limit_reached' using errcode='22023';end if;
 insert into public.voice_staff_devices(staff_id,token_hash,label,enrolled_via,access_email,invite_id,expires_at)
  values(v_staff.id,p_device_hash,trim(p_label),case when p_invite_hash is null then 'personal_access' else 'single_use_invite' end,
   case when p_invite_hash is null then v_staff.access_email end,v_invite.id,now()+interval '30 days') returning * into v_device;
 if v_invite.id is not null then update public.voice_staff_invites set consumed_at=now() where id=v_invite.id;end if;
 return query select v_device.id,v_staff.id,v_device.expires_at;
end $$;

create function public.manage_voice_staff(
 p_actor_device_id uuid,p_action text,p_staff_id uuid default null,p_values jsonb default '{}'::jsonb,
 p_related_id uuid default null,p_token_hash text default null,p_revision integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.voice_staff_devices%rowtype;actor public.voice_staff%rowtype;s public.voice_staff%rowtype;
 invite public.voice_staff_invites%rowtype;target_device public.voice_staff_devices%rowtype;rows jsonb;v_name text;v_email text;v_extension text;v_enabled boolean;
begin
 -- Serialize management edits, including first profile creation and code rotation.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-staff-management',0));
 select * into d from public.voice_staff_devices where id=p_actor_device_id;
 if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 perform 1 from public.voice_staff where id in(d.staff_id,p_staff_id) order by id for update;
 select * into actor from public.voice_staff where id=d.staff_id and enabled and can_manage_phone;
 if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 select * into d from public.voice_staff_devices where id=p_actor_device_id and staff_id=actor.id and revoked_at is null and expires_at>now() for update;
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from actor.access_email)
  then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'displayName',x.display_name,'accessEmail',x.access_email,'extension',x.extension,'enabled',x.enabled,
   'canManagePhone',x.can_manage_phone,'revision',x.revision,
   'devices',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'createdAt',v.created_at,'lastSeenAt',v.last_seen_at,
    'expiresAt',v.expires_at,'isCurrent',v.id=d.id) order by v.created_at desc) from public.voice_staff_devices v
    where v.staff_id=x.id and v.revoked_at is null and v.expires_at>now()),'[]'::jsonb),
   'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at) order by i.created_at desc)
    from public.voice_staff_invites i where i.staff_id=x.id and i.consumed_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb)
   ) order by x.display_name,x.id),'[]'::jsonb) into rows from (select * from public.voice_staff order by display_name,id limit 50)x;
  return jsonb_build_object('staff',rows);
 end if;
 if p_staff_id is null or p_action not in('create','update','issue_invite','revoke_invite','revoke_device')
  then raise exception 'invalid_phone_management_action' using errcode='22023';end if;
 select * into s from public.voice_staff where id=p_staff_id;
 if p_action in('create','update') then
  if jsonb_typeof(p_values) is distinct from 'object' or
   exists(select 1 from jsonb_object_keys(p_values) k where k not in('displayName','accessEmail','extension','enabled')) or
   jsonb_typeof(p_values->'displayName') is distinct from 'string' or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or
   (p_values ? 'accessEmail' and jsonb_typeof(p_values->'accessEmail') not in('string','null')) or
   (p_values ? 'extension' and jsonb_typeof(p_values->'extension') not in('string','null'))
   then raise exception 'invalid_phone_profile' using errcode='22023';end if;
  v_name:=trim(p_values->>'displayName');v_email:=nullif(lower(trim(p_values->>'accessEmail')),'');v_extension:=nullif(trim(p_values->>'extension'),'');v_enabled:=(p_values->>'enabled')::boolean;
  if length(v_name) not between 2 and 100 or v_name ~ '[[:cntrl:]]' or
   (v_email is not null and (length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) or
   (v_extension is not null and v_extension !~ '^[0-9]{1,6}$') then raise exception 'invalid_phone_profile' using errcode='22023';end if;
  if p_action='create' then
   if s.id is not null then
    if s.display_name is distinct from v_name or s.access_email is distinct from v_email or s.extension is distinct from v_extension or s.enabled is distinct from v_enabled
     then raise exception 'phone_profile_conflict' using errcode='22023';end if;
    return jsonb_build_object('staffId',s.id);
   end if;
   if (select count(*) from public.voice_staff)>=50 then raise exception 'phone_staff_limit' using errcode='22023';end if;
   insert into public.voice_staff(id,display_name,access_email,extension,enabled) values(p_staff_id,v_name,v_email,v_extension,v_enabled) returning * into s;
  else
   if s.id is null then raise exception 'phone_profile_not_found' using errcode='22023';end if;
   if p_revision is distinct from s.revision then raise exception 'phone_profile_changed' using errcode='22023';end if;
   if s.id=actor.id and (not v_enabled or s.access_email is distinct from v_email)
    then raise exception 'phone_manager_self_lockout' using errcode='22023';end if;
   if not v_enabled or s.access_email is distinct from v_email then
    update public.voice_staff_invites set revoked_at=coalesce(revoked_at,now()) where staff_id=s.id and consumed_at is null;
    update public.voice_staff_devices set revoked_at=coalesce(revoked_at,now()),available=false,registered=false where staff_id=s.id;
   end if;
   update public.voice_staff set display_name=v_name,access_email=v_email,extension=v_extension,enabled=v_enabled,revision=revision+1 where id=s.id;
  end if;
 elsif s.id is null then raise exception 'phone_profile_not_found' using errcode='22023';
 elsif p_action='issue_invite' then
  if not s.enabled or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_phone_invite' using errcode='22023';end if;
  update public.voice_staff_invites set revoked_at=coalesce(revoked_at,now()) where staff_id=s.id and consumed_at is null;
  insert into public.voice_staff_invites(staff_id,token_hash,expires_at,issued_by)
   values(s.id,p_token_hash,now()+interval '15 minutes',actor.id::text) returning * into invite;
  p_related_id:=invite.id;
 elsif p_action='revoke_invite' then
  select * into invite from public.voice_staff_invites where id=p_related_id and staff_id=s.id for update;
  if not found then raise exception 'phone_invite_not_found' using errcode='22023';end if;
  update public.voice_staff_invites set revoked_at=coalesce(revoked_at,now()) where id=invite.id;
 elsif p_action='revoke_device' then
  select * into target_device from public.voice_staff_devices where id=p_related_id and staff_id=s.id for update;
  if not found then raise exception 'phone_device_not_found' using errcode='22023';end if;
  if target_device.id=d.id then raise exception 'phone_current_device_logout_required' using errcode='22023';end if;
  update public.voice_staff_devices set revoked_at=coalesce(revoked_at,now()),available=false,registered=false where id=target_device.id;
 end if;
 insert into public.voice_staff_admin_events(actor_staff_id,actor_device_id,staff_id,action,related_id)
  values(actor.id,d.id,s.id,p_action,p_related_id);
 return jsonb_build_object('staffId',s.id,'inviteId',case when p_action='issue_invite' then invite.id end,
  'expiresAt',case when p_action='issue_invite' then invite.expires_at end);
end $$;
revoke all on function public.manage_voice_staff(uuid,text,uuid,jsonb,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.manage_voice_staff(uuid,text,uuid,jsonb,uuid,text,integer) to service_role;
comment on column public.voice_staff.can_manage_phone is 'Explicit operator-provisioned phone management role. Never inferred from the shared Ops login or assignable through the phone management API.';
comment on table public.voice_staff_admin_events is 'Phone profile/device/invite changes with personal actor; no credential plaintext or hashes.';
commit;
