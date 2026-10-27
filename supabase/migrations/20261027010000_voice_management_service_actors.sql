begin;
create table public.voice_management_service_actors(
 service_actor text primary key check(length(service_actor) between 1 and 254),
 staff_id uuid not null references public.voice_staff(id),
 active boolean not null default true,
 expires_at timestamptz
);
alter table public.voice_management_service_actors enable row level security;
revoke all on public.voice_management_service_actors from public,anon,authenticated;
grant select,insert,update,delete on public.voice_management_service_actors to service_role;
alter table public.voice_staff_admin_events alter column actor_device_id drop not null;
alter table public.voice_staff_admin_events add column actor_service_id text;
alter table public.voice_staff_admin_events add constraint voice_management_actor_required
 check ((actor_device_id is not null and actor_service_id is null) or (actor_device_id is null and actor_service_id is not null));
create function public.manage_voice_staff_as_actor(
 p_actor_device_id uuid,p_action text,p_staff_id uuid default null,p_values jsonb default '{}'::jsonb,
 p_related_id uuid default null,p_token_hash text default null,p_revision integer default null,p_actor_service_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.voice_staff_devices%rowtype;actor public.voice_staff%rowtype;s public.voice_staff%rowtype;
 invite public.voice_staff_invites%rowtype;target_device public.voice_staff_devices%rowtype;rows jsonb;v_name text;v_email text;v_extension text;v_enabled boolean;
begin
 -- Serialize management edits, including first profile creation and code rotation.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice-staff-management',0));
 if p_actor_service_id is not null then
  if p_actor_device_id is not null then raise exception 'phone_management_forbidden' using errcode='42501';end if;
  select manager_staff.* into actor from public.voice_management_service_actors m join public.voice_staff manager_staff on manager_staff.id=m.staff_id
   where m.service_actor=p_actor_service_id and m.active and (m.expires_at is null or m.expires_at>now()) for share of m;
  if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
  perform 1 from public.voice_staff where id in(actor.id,p_staff_id) order by id for update;
  select manager_staff.* into actor from public.voice_management_service_actors m join public.voice_staff manager_staff on manager_staff.id=m.staff_id
   where m.service_actor=p_actor_service_id and m.active and (m.expires_at is null or m.expires_at>now())
    and manager_staff.enabled and manager_staff.can_manage_phone for share of m;
  if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 else
 select * into d from public.voice_staff_devices where id=p_actor_device_id;
 if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 perform 1 from public.voice_staff where id in(d.staff_id,p_staff_id) order by id for update;
 select * into actor from public.voice_staff where id=d.staff_id and enabled and can_manage_phone;
 if not found then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 select * into d from public.voice_staff_devices where id=p_actor_device_id and staff_id=actor.id and revoked_at is null and expires_at>now() for update;
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from actor.access_email)
  then raise exception 'phone_management_forbidden' using errcode='42501';end if;
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'displayName',x.display_name,'accessEmail',x.access_email,'extension',x.extension,'enabled',x.enabled,
   'canManagePhone',x.can_manage_phone,'revision',x.revision,
   'devices',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'createdAt',v.created_at,'lastSeenAt',v.last_seen_at,
    'expiresAt',v.expires_at,'isCurrent',coalesce(v.id=d.id,false)) order by v.created_at desc) from public.voice_staff_devices v
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
 insert into public.voice_staff_admin_events(actor_staff_id,actor_device_id,staff_id,action,related_id,actor_service_id)
  values(actor.id,d.id,s.id,p_action,p_related_id,p_actor_service_id);
 return jsonb_build_object('staffId',s.id,'inviteId',case when p_action='issue_invite' then invite.id end,
  'expiresAt',case when p_action='issue_invite' then invite.expires_at end);
end $$;
revoke all on function public.manage_voice_staff_as_actor(uuid,text,uuid,jsonb,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.manage_voice_staff_as_actor(uuid,text,uuid,jsonb,uuid,text,integer,text) to service_role;
create or replace function public.manage_voice_staff(
 p_actor_device_id uuid,p_action text,p_staff_id uuid default null,p_values jsonb default '{}'::jsonb,
 p_related_id uuid default null,p_token_hash text default null,p_revision integer default null
) returns jsonb language sql security definer set search_path='' as $$
 select public.manage_voice_staff_as_actor(p_actor_device_id,p_action,p_staff_id,p_values,p_related_id,p_token_hash,p_revision,null);
$$;
comment on table public.voice_management_service_actors is 'Explicit verified Cloudflare service principal to personal phone-manager mapping. No default grant; can_manage_phone and expiry checked on every call.';
commit;
