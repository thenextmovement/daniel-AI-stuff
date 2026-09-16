-- Personal phone accounts are separate from the existing Ops login.
-- No employees, credentials, routing or active phone connections are seeded.
create table public.voice_staff (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 2 and 100),
  access_email text unique check (access_email = lower(trim(access_email)) and position('@' in access_email) > 1),
  extension text unique check (extension ~ '^[0-9]{1,6}$'),
  placetel_employee_id text unique check (placetel_employee_id ~ '^[0-9]{1,20}$'),
  placetel_target_id text unique check (placetel_target_id ~ '^[0-9]{1,20}$'),
  callback_phone text check (callback_phone ~ '^\+[1-9][0-9]{7,14}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.voice_staff_invites (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.voice_staff(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  issued_by text not null check (length(issued_by) between 3 and 200),
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create table public.voice_staff_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.voice_staff(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (length(trim(label)) between 2 and 80),
  enrolled_via text not null check (enrolled_via in ('personal_access', 'single_use_invite')),
  access_email text,
  invite_id uuid unique references public.voice_staff_invites(id),
  available boolean not null default false,
  registered boolean not null default false,
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check ((enrolled_via = 'single_use_invite' and invite_id is not null and access_email is null)
      or (enrolled_via = 'personal_access' and invite_id is null and access_email is not null))
);
create index voice_staff_devices_presence on public.voice_staff_devices(staff_id, last_seen_at desc) where revoked_at is null;
alter table public.voice_staff enable row level security;
alter table public.voice_staff_invites enable row level security;
alter table public.voice_staff_devices enable row level security;
revoke all on public.voice_staff, public.voice_staff_invites, public.voice_staff_devices from public, anon, authenticated;
grant select, insert, update, delete on public.voice_staff, public.voice_staff_invites, public.voice_staff_devices to service_role;

-- Redeeming consumes an invite and creates exactly one device in one transaction.
create function public.enroll_voice_staff_device(
  p_device_hash text, p_label text, p_invite_hash text default null, p_access_email text default null
) returns table(device_id uuid, staff_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.voice_staff%rowtype;
  v_invite public.voice_staff_invites%rowtype;
  v_device public.voice_staff_devices%rowtype;
begin
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' or
     p_label is null or length(trim(p_label)) not between 2 and 80 or
     (p_invite_hash is null) = (p_access_email is null) then
    raise exception 'invalid_device_enrollment' using errcode = '22023';
  end if;
  if p_invite_hash is not null then
    select * into v_invite from public.voice_staff_invites i
      where i.token_hash = p_invite_hash and i.consumed_at is null and i.revoked_at is null
        and i.expires_at > now() for update;
    if not found then raise exception 'enrollment_unavailable' using errcode = '22023'; end if;
    select * into v_staff from public.voice_staff s where s.id = v_invite.staff_id and s.enabled for update;
  else
    select * into v_staff from public.voice_staff s
      where s.access_email = lower(trim(p_access_email)) and s.enabled for update;
  end if;
  if not found then raise exception 'enrollment_unavailable' using errcode = '22023'; end if;
  -- Bounded active devices per staff member; revoked/expired devices do not count.
  if (select count(*) from public.voice_staff_devices d where d.staff_id = v_staff.id
      and d.revoked_at is null and d.expires_at > now()) >= 8 then
    raise exception 'device_limit_reached' using errcode = '22023';
  end if;
  insert into public.voice_staff_devices(staff_id,token_hash,label,enrolled_via,access_email,invite_id,expires_at)
    values(v_staff.id,p_device_hash,trim(p_label),
      case when p_invite_hash is null then 'personal_access' else 'single_use_invite' end,
      case when p_invite_hash is null then v_staff.access_email end,v_invite.id,now()+interval '30 days')
    returning * into v_device;
  if v_invite.id is not null then
    update public.voice_staff_invites set consumed_at = now() where id = v_invite.id;
  end if;
  return query select v_device.id,v_staff.id,v_device.expires_at;
end $$;
revoke all on function public.enroll_voice_staff_device(text,text,text,text) from public, anon, authenticated;
grant execute on function public.enroll_voice_staff_device(text,text,text,text) to service_role;

comment on table public.voice_staff_invites is 'Only hashes of independently issued personal, single-use phone enrollment codes; never usable as general Ops credentials.';
