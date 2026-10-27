begin;
insert into public.voice_staff(id,display_name,enabled,can_manage_phone) values
 ('29500000-0000-4000-8000-000000000901','MCP test manager',true,true),
 ('29500000-0000-4000-8000-000000000902','MCP test staff',true,false);
insert into public.voice_management_service_actors(service_actor,staff_id) values
 ('mcp-test-service','29500000-0000-4000-8000-000000000901');
update public.voice_staff set access_email='manager@example.test' where id='29500000-0000-4000-8000-000000000901';
insert into public.voice_staff_devices(id,staff_id,token_hash,label,enrolled_via,access_email,expires_at) values
 ('29500000-0000-4000-8000-000000000903','29500000-0000-4000-8000-000000000901',repeat('a',64),'Local test device','personal_access','manager@example.test',now()+interval '1 day');
do $test$
declare result jsonb;
begin
 begin
  perform public.manage_voice_staff_as_actor(null,'list',p_actor_service_id=>'unknown-service');
  raise exception 'unmapped service accepted';
 exception when insufficient_privilege then null; end;
 result:=public.manage_voice_staff('29500000-0000-4000-8000-000000000903','list');
 if jsonb_array_length(result->'staff')<2 then raise exception 'legacy device list failed';end if;
 begin
  perform public.manage_voice_staff_as_actor('29500000-0000-4000-8000-000000000903','list',p_actor_service_id=>'mcp-test-service');
  raise exception 'mixed actor accepted';
 exception when insufficient_privilege then null;end;
 update public.voice_management_service_actors set expires_at=now()-interval '1 minute' where service_actor='mcp-test-service';
 begin
  perform public.manage_voice_staff_as_actor(null,'list',p_actor_service_id=>'mcp-test-service');
  raise exception 'expired mapping accepted';
 exception when insufficient_privilege then null;end;
 update public.voice_management_service_actors set expires_at=null where service_actor='mcp-test-service';
 result:=public.manage_voice_staff_as_actor(null,'list',p_actor_service_id=>'mcp-test-service');
 if jsonb_array_length(result->'staff')<2 then raise exception 'list failed';end if;
 perform public.manage_voice_staff_as_actor(null,'update','29500000-0000-4000-8000-000000000902',
  '{"displayName":"Updated MCP test","accessEmail":null,"extension":"901","enabled":true}',p_revision=>1,p_actor_service_id=>'mcp-test-service');
 if not exists(select 1 from public.voice_staff_admin_events where actor_service_id='mcp-test-service' and actor_device_id is null and action='update') then raise exception 'service audit missing';end if;
 begin
  perform public.manage_voice_staff_as_actor(null,'update','29500000-0000-4000-8000-000000000902',
   '{"displayName":"Stale","enabled":true}',p_revision=>1,p_actor_service_id=>'mcp-test-service');
  raise exception 'stale revision accepted';
 exception when invalid_parameter_value then if SQLERRM!='phone_profile_changed' then raise;end if;end;
 begin
  perform public.manage_voice_staff_as_actor(null,'update','29500000-0000-4000-8000-000000000901',
   '{"displayName":"Manager","enabled":false}',p_revision=>1,p_actor_service_id=>'mcp-test-service');
  raise exception 'self lockout accepted';
 exception when invalid_parameter_value then if SQLERRM!='phone_manager_self_lockout' then raise;end if;end;
 update public.voice_staff set can_manage_phone=false where id='29500000-0000-4000-8000-000000000901';
 begin
  perform public.manage_voice_staff_as_actor(null,'list',p_actor_service_id=>'mcp-test-service');
  raise exception 'revoked role accepted';
 exception when insufficient_privilege then null;end;
 update public.voice_staff set can_manage_phone=true where id='29500000-0000-4000-8000-000000000901';
 update public.voice_management_service_actors set active=false where service_actor='mcp-test-service';
 begin
  perform public.manage_voice_staff_as_actor(null,'list',p_actor_service_id=>'mcp-test-service');
  raise exception 'revoked mapping accepted';
 exception when insufficient_privilege then null;end;
end $test$;
rollback;
