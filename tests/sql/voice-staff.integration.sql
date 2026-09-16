\set ON_ERROR_STOP on
begin;
do $$
declare
  staff_a uuid; staff_b uuid; device_a uuid; result record; count_devices int;
begin
  insert into voice_staff(display_name,access_email,extension,enabled)
    values('Fixture Alpha','alpha@example.test','101',true) returning id into staff_a;
  insert into voice_staff(display_name,extension,enabled)
    values('Fixture Beta','102',false) returning id into staff_b;
  insert into voice_staff_invites(staff_id,token_hash,expires_at,issued_by)
    values(staff_a,repeat('a',64),now()+interval '15 minutes','fixture-admin'),
          (staff_b,repeat('b',64),now()+interval '15 minutes','fixture-admin');
  select * into result from enroll_voice_staff_device(repeat('1',64),'Office browser',repeat('a',64),null);
  if result.staff_id<>staff_a or result.device_id is null then raise exception 'wrong personal binding'; end if;
  device_a:=result.device_id;
  if not exists(select from voice_staff_devices where id=device_a and enrolled_via='single_use_invite' and invite_id is not null) then
    raise exception 'enrollment provenance missing';
  end if;
  begin
    perform enroll_voice_staff_device(repeat('2',64),'Replay browser',repeat('a',64),null);
    raise exception 'invite replay accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'enrollment_unavailable' then raise; end if;
  end;
  begin
    perform enroll_voice_staff_device(repeat('3',64),'Disabled staff',repeat('b',64),null);
    raise exception 'disabled person accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'enrollment_unavailable' then raise; end if;
  end;
  if exists(select from voice_staff_invites where token_hash=repeat('b',64) and consumed_at is not null) then
    raise exception 'failed enrollment consumed code';
  end if;
  select * into result from enroll_voice_staff_device(repeat('4',64),'Personal Access',null,'alpha@example.test');
  if result.staff_id<>staff_a then raise exception 'personal email mismatch'; end if;
  begin
    perform enroll_voice_staff_device(repeat('5',64),'Wrong email',null,'shared@example.test');
    raise exception 'unassigned email accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'enrollment_unavailable' then raise; end if;
  end;
  begin
    perform enroll_voice_staff_device(repeat('5',64),'Two credentials',repeat('b',64),'alpha@example.test');
    raise exception 'ambiguous credentials accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_device_enrollment' then raise; end if;
  end;
  insert into voice_staff_invites(staff_id,token_hash,created_at,expires_at,issued_by)
    values(staff_a,repeat('c',64),now()-interval '2 hours',now()-interval '1 hour','fixture-admin');
  begin
    perform enroll_voice_staff_device(repeat('6',64),'Expired invite',repeat('c',64),null);
    raise exception 'expired code accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'enrollment_unavailable' then raise; end if;
  end;
  update voice_staff_invites set revoked_at=now() where token_hash=repeat('b',64);
  update voice_staff set enabled=true where id=staff_b;
  begin
    perform enroll_voice_staff_device(repeat('7',64),'Revoked invite',repeat('b',64),null);
    raise exception 'revoked code accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'enrollment_unavailable' then raise; end if;
  end;
  -- A unique token collision must roll the invite consumption back too.
  insert into voice_staff_invites(staff_id,token_hash,expires_at,issued_by)
    values(staff_a,repeat('d',64),now()+interval '1 hour','fixture-admin');
  begin
    perform enroll_voice_staff_device(repeat('1',64),'Duplicate token',repeat('d',64),null);
    raise exception 'duplicate device token accepted';
  exception when unique_violation then null;
  end;
  if exists(select from voice_staff_invites where token_hash=repeat('d',64) and consumed_at is not null) then
    raise exception 'transaction did not roll back';
  end if;
  for i in 1..6 loop
    perform enroll_voice_staff_device(md5(i::text)||md5(i::text),'Additional device',null,'alpha@example.test');
  end loop;
  begin
    perform enroll_voice_staff_device(repeat('8',64),'Ninth device',null,'alpha@example.test');
    raise exception 'device limit bypassed';
  exception when invalid_parameter_value then
    if sqlerrm<>'device_limit_reached' then raise; end if;
  end;
  update voice_staff_devices set revoked_at=now() where id=device_a;
  perform enroll_voice_staff_device(repeat('8',64),'Replacement device',null,'alpha@example.test');
  select count(*) into count_devices from voice_staff_devices where staff_id=staff_a and revoked_at is null;
  if count_devices<>8 then raise exception 'replacement device count invalid'; end if;
  if has_table_privilege('anon','voice_staff','select') or has_table_privilege('authenticated','voice_staff_devices','select') or
     has_function_privilege('authenticated','enroll_voice_staff_device(text,text,text,text)','execute') then
    raise exception 'direct browser access to personal phone records';
  end if;
  if not (select bool_and(relrowsecurity) from pg_class where oid in ('voice_staff'::regclass,'voice_staff_devices'::regclass,'voice_staff_invites'::regclass)) then
    raise exception 'phone RLS missing';
  end if;
end $$;
rollback;

