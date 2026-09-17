begin;
-- Personal mobile verification only. No production numbers or calls are seeded.
create table public.voice_mobile_links (
 id uuid primary key,
 staff_id uuid not null references public.voice_staff(id),
 staff_revision integer not null check(staff_revision>0),
 device_id uuid not null references public.voice_staff_devices(id),
 phone text not null check(phone ~ '^[+][1-9][0-9]{6,14}$'),
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 state text not null default 'reserved' check(state in('reserved','claimed','answered','verified','failed','cancelled')),
 claimed_at timestamptz,
 provider_call_sid text unique check(provider_call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 verified_at timestamptz,
 revoked_at timestamptz,
 expires_at timestamptz not null default now()+interval '3 minutes',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 ended_at timestamptz,
 provider_ended_at timestamptz,
 cleanup_pending boolean not null default false
);
create unique index voice_mobile_one_pending on public.voice_mobile_links(staff_id) where ended_at is null;
create unique index voice_mobile_one_verified on public.voice_mobile_links(staff_id) where state='verified' and revoked_at is null;
create index voice_mobile_rate_phone on public.voice_mobile_links(phone,created_at desc);
alter table public.voice_mobile_links enable row level security;
revoke all on public.voice_mobile_links from public,anon,authenticated;
grant select,insert,update on public.voice_mobile_links to service_role;

create function public.reserve_voice_mobile_link(p_id uuid,p_device_id uuid,p_phone text,p_code_hash text)
returns public.voice_mobile_links language plpgsql security definer set search_path='' as $$
declare s public.voice_staff%rowtype;d public.voice_staff_devices%rowtype;r public.voice_mobile_links%rowtype;
begin
 select * into d from public.voice_staff_devices where id=p_device_id;
 select * into s from public.voice_staff where id=d.staff_id and enabled for update;
 select * into d from public.voice_staff_devices where id=p_device_id and revoked_at is null and expires_at>now() for update;
 if s.id is null or d.id is null or (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email)
 then raise exception 'phone_identity_required' using errcode='42501';end if;
 if p_id is null or p_phone is null or p_phone !~ '^[+][1-9][0-9]{6,14}$' or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
 then raise exception 'mobile_input_invalid' using errcode='22023';end if;
 select * into r from public.voice_mobile_links where id=p_id;
 if found then
  if r.device_id<>d.id or r.phone<>p_phone or r.code_hash<>p_code_hash
  then raise exception 'mobile_request_conflict' using errcode='22023';end if;
  return r;
 end if;
 -- Serialize the per-number rate bound across different staff members too.
 perform pg_advisory_xact_lock(hashtextextended('voice-mobile-number:'||p_phone,0));
 if exists(select 1 from public.voice_mobile_links where staff_id=s.id and (ended_at is null or cleanup_pending))
 then raise exception 'mobile_attempt_pending' using errcode='22023';end if;
 if exists(select 1 from public.voice_mobile_links where staff_id=s.id and created_at>now()-interval '1 minute') or
  (select count(*) from public.voice_mobile_links where (staff_id=s.id or phone=p_phone) and created_at>now()-interval '1 hour')>=3
 then raise exception 'mobile_rate_limited' using errcode='22023';end if;
 insert into public.voice_mobile_links(id,staff_id,staff_revision,device_id,phone,code_hash) values(p_id,s.id,s.revision,d.id,p_phone,p_code_hash) returning * into r;
 return r;
end $$;

create function public.advance_voice_mobile_link(p_id uuid,p_action text,p_call_sid text default null,p_code_hash text default null,p_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.voice_mobile_links%rowtype;s public.voice_staff%rowtype;d public.voice_staff_devices%rowtype;eligible boolean;claimed boolean:=false;
begin
 select * into r from public.voice_mobile_links where id=p_id;
 if not found then raise exception 'mobile_attempt_not_found' using errcode='22023';end if;
 -- Same staff -> device -> attempt ordering as enrollment and administration.
 select * into s from public.voice_staff where id=r.staff_id for update;
 select * into d from public.voice_staff_devices where id=r.device_id for update;
 select * into r from public.voice_mobile_links where id=p_id for update;
 eligible:=s.enabled and s.revision=r.staff_revision and d.revoked_at is null and d.expires_at>now() and
  (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email);
 if p_action not in('claim','bind','prompt','verify','terminal','cancel','expire','cleanup')
 then raise exception 'mobile_action_invalid' using errcode='22023';end if;
 if p_action in('bind','prompt','verify','terminal') then
  if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$' or
   (r.provider_call_sid is not null and r.provider_call_sid<>p_call_sid) or r.claimed_at is null
  then raise exception 'mobile_leg_conflict' using errcode='22023';end if;
  r.provider_call_sid:=p_call_sid;
 end if;
 if p_action='cleanup' then
  if r.ended_at is not null and r.updated_at=p_updated_at then r.cleanup_pending:=false;end if;
 elsif p_action='terminal' then
  r.provider_ended_at:=coalesce(r.provider_ended_at,now());r.cleanup_pending:=false;
  if r.ended_at is null then r.state:='failed';r.ended_at:=now();end if;
 elsif p_action='cancel' or (p_action='expire' and (not eligible or r.expires_at<=now())) or
   (r.ended_at is null and (not eligible or r.expires_at<=now())) then
  r.cleanup_pending:=r.provider_ended_at is null and (r.provider_call_sid is not null or r.claimed_at is not null);
  if r.ended_at is null then r.state:='cancelled';r.ended_at:=now();end if;
  -- Even an unacknowledged dispatch remains pending until its deadline; do not
  -- start another call while the provider may still return a late leg.
 elsif r.ended_at is null then
  if p_action='claim' and r.state='reserved' then r.state:='claimed';r.claimed_at:=now();claimed:=true;
  elsif p_action='prompt' then r.state:='answered';
  elsif p_action='verify' then
   if r.state<>'answered' then raise exception 'mobile_prompt_required' using errcode='22023';end if;
   if p_code_hash is not null and r.code_hash=p_code_hash then
    update public.voice_mobile_links set revoked_at=now(),updated_at=now()
      where staff_id=r.staff_id and state='verified' and revoked_at is null and id<>r.id;
    r.state:='verified';r.verified_at:=now();
   else r.state:='failed';end if;
   r.ended_at:=now();r.cleanup_pending:=r.provider_ended_at is null;
  end if;
 elsif p_action in('bind','prompt','verify') and r.provider_ended_at is null then
  r.cleanup_pending:=true;
 end if;
 update public.voice_mobile_links set state=r.state,claimed_at=r.claimed_at,provider_call_sid=r.provider_call_sid,
  verified_at=r.verified_at,ended_at=r.ended_at,provider_ended_at=r.provider_ended_at,cleanup_pending=r.cleanup_pending,updated_at=now()
  where id=r.id returning * into r;
 return jsonb_build_object('attempt',to_jsonb(r)-'code_hash','claimed',claimed,
  'accepted',r.state='verified' and r.revoked_at is null and eligible);
end $$;

create function public.unlink_voice_mobile(p_device_id uuid,p_link_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.voice_staff%rowtype;d public.voice_staff_devices%rowtype;
begin
 select * into d from public.voice_staff_devices where id=p_device_id;
 select * into s from public.voice_staff where id=d.staff_id and enabled for update;
 select * into d from public.voice_staff_devices where id=p_device_id and revoked_at is null and expires_at>now() for update;
 if s.id is null or d.id is null or (d.enrolled_via='personal_access' and d.access_email is distinct from s.access_email)
 then raise exception 'phone_identity_required' using errcode='42501';end if;
 -- Exact link ID: a stale form must not remove a subsequently verified number.
 update public.voice_mobile_links set revoked_at=coalesce(revoked_at,now()),updated_at=now()
 where id=p_link_id and staff_id=s.id and state='verified';
 if not found then raise exception 'mobile_link_not_found' using errcode='22023';end if;
end $$;
revoke all on function public.reserve_voice_mobile_link(uuid,uuid,text,text),public.advance_voice_mobile_link(uuid,text,text,text,timestamptz),public.unlink_voice_mobile(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_voice_mobile_link(uuid,uuid,text,text),public.advance_voice_mobile_link(uuid,text,text,text,timestamptz),public.unlink_voice_mobile(uuid,uuid) to service_role;
commit;
