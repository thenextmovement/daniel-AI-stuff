\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;c uuid:=gen_random_uuid();da uuid;db uuid;dc uuid;i uuid;j uuid;r jsonb;n integer;
 values jsonb:='{"displayName":"Managed Gamma","accessEmail":"gamma@example.test","extension":"103","enabled":true}';
begin
 insert into public.voice_staff(display_name,access_email,enabled,can_manage_phone) values('Manager Alpha','manager@example.test',true,true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Member Beta','member@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('1',64),'Management device',null,'manager@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('2',64),'Member device',null,'member@example.test');
 begin
  perform public.manage_voice_staff(db,'list');
  raise exception 'ordinary member became manager';
 exception when insufficient_privilege then if sqlerrm<>'phone_management_forbidden' then raise;end if;end;
 begin
  perform public.manage_voice_staff(db,'create',c,values);
  raise exception 'ordinary member created another profile';
 exception when insufficient_privilege then null;end;
 perform public.manage_voice_staff(da,'create',c,values);
 perform public.manage_voice_staff(da,'create',c,values);
 if (select count(*) from public.voice_staff where id=c)<>1 or (select can_manage_phone from public.voice_staff where id=c) then raise exception 'create replay or implicit admin wrong';end if;
 if (select count(*) from public.voice_staff_admin_events where staff_id=c and action='create')<>1 then raise exception 'create replay repeated side effect';end if;
 begin
  perform public.manage_voice_staff(da,'update',c,values||'{"can_manage_phone":true}',null,null,1);
  raise exception 'API privilege change accepted';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_phone_profile' then raise;end if;end;
 begin
  perform public.manage_voice_staff(da,'update',c,values,null,null,2);
  raise exception 'stale profile revision overwritten';
 exception when invalid_parameter_value then if sqlerrm<>'phone_profile_changed' then raise;end if;end;
 begin
  perform public.manage_voice_staff(da,'update',a,'{"displayName":"Manager Alpha","accessEmail":"manager@example.test","enabled":false}',null,null,1);
  raise exception 'manager disabled self';
 exception when invalid_parameter_value then if sqlerrm<>'phone_manager_self_lockout' then raise;end if;end;
 r:=public.manage_voice_staff(da,'issue_invite',c,'{}',null,repeat('a',64));i:=(r->>'inviteId')::uuid;
 if (r->>'expiresAt')::timestamptz>now()+interval '15 minutes' then raise exception 'invitation lifetime too long';end if;
 r:=public.manage_voice_staff(da,'list');
 if r::text like '%'||repeat('a',64)||'%' or r::text like '%token_hash%' then raise exception 'credential hashes leaked to team view';end if;
 if not exists(select 1 from jsonb_array_elements(r->'staff') x where x->>'id'=a::text and (x->>'canManagePhone')::boolean and x->'devices'->0->>'isCurrent'='true') then raise exception 'admin view binding wrong';end if;
 r:=public.manage_voice_staff(da,'issue_invite',c,'{}',null,repeat('b',64));j:=(r->>'inviteId')::uuid;
 begin
  perform public.enroll_voice_staff_device(repeat('3',64),'Old code device',repeat('a',64),null);
  raise exception 'rotated code accepted';
 exception when invalid_parameter_value then if sqlerrm<>'enrollment_unavailable' then raise;end if;end;
 select device_id into dc from public.enroll_voice_staff_device(repeat('3',64),'New code device',repeat('b',64),null);
 if (select staff_id from public.voice_staff_devices where id=dc)<>c then raise exception 'invite selected wrong person';end if;
 begin
  perform public.enroll_voice_staff_device(repeat('4',64),'Replayed code device',repeat('b',64),null);
  raise exception 'used code accepted twice';
 exception when invalid_parameter_value then if sqlerrm<>'enrollment_unavailable' then raise;end if;end;
 begin
  perform public.manage_voice_staff(da,'revoke_device',b,'{}',dc);
  raise exception 'cross-profile device revoked';
 exception when invalid_parameter_value then if sqlerrm<>'phone_device_not_found' then raise;end if;end;
 if (select revoked_at from public.voice_staff_devices where id=dc) is not null then raise exception 'failed revoke mutated device';end if;
 perform public.manage_voice_staff(da,'revoke_device',c,'{}',dc);
 perform public.manage_voice_staff(da,'revoke_device',c,'{}',dc);
 if (select revoked_at from public.voice_staff_devices where id=dc) is null then raise exception 'device revoke missing';end if;
 begin
  perform public.manage_voice_staff(da,'revoke_device',a,'{}',da);
  raise exception 'manager revoked current device through team form';
 exception when invalid_parameter_value then if sqlerrm<>'phone_current_device_logout_required' then raise;end if;end;
 r:=public.manage_voice_staff(da,'issue_invite',c,'{}',null,repeat('c',64));i:=(r->>'inviteId')::uuid;
 perform public.manage_voice_staff(da,'revoke_invite',c,'{}',i);
 begin
  perform public.enroll_voice_staff_device(repeat('5',64),'Revoked invitation',repeat('c',64),null);
  raise exception 'revoked invite enrolled';
 exception when invalid_parameter_value then if sqlerrm<>'enrollment_unavailable' then raise;end if;end;
 select device_id into dc from public.enroll_voice_staff_device(repeat('6',64),'Gamma Access',null,'gamma@example.test');
 perform public.manage_voice_staff(da,'issue_invite',c,'{}',null,repeat('d',64));
 perform public.manage_voice_staff(da,'update',c,values||'{"accessEmail":"new-gamma@example.test"}',null,null,1);
 if not exists(select 1 from public.voice_staff where id=c and access_email='new-gamma@example.test' and revision=2 and not can_manage_phone) then raise exception 'profile update wrong';end if;
 if exists(select 1 from public.voice_staff_devices where staff_id=c and revoked_at is null) or
    exists(select 1 from public.voice_staff_invites where staff_id=c and revoked_at is null and consumed_at is null) then raise exception 'old identity credentials survived reassignment';end if;
 perform public.manage_voice_staff(da,'update',c,values||'{"accessEmail":"new-gamma@example.test","enabled":false}',null,null,2);
 begin
  perform public.manage_voice_staff(da,'issue_invite',c,'{}',null,repeat('e',64));
  raise exception 'disabled profile received invite';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_phone_invite' then raise;end if;end;
 update public.voice_staff_devices set revoked_at=now() where id=da;
 begin
  perform public.manage_voice_staff(da,'list');
  raise exception 'revoked management device accessed profiles';
 exception when insufficient_privilege then null;end;
 if exists(select 1 from public.voice_staff_admin_events where actor_staff_id<>a or actor_device_id<>da) then raise exception 'audit actor supplied by caller';end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('authenticated','public.manage_voice_staff(uuid,text,uuid,jsonb,uuid,text,integer)','EXECUTE') or
  has_table_privilege('anon','public.voice_staff_admin_events','SELECT') or
  not(select relrowsecurity from pg_class where oid='public.voice_staff_admin_events'::regclass) then raise exception 'management public bypass';end if;
end $$;
rollback;
