\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;d uuid;d2 uuid;other_device uuid;k uuid:=gen_random_uuid();c public.voice_phone_calls%rowtype;r jsonb;room text:='CF'||repeat('3',32);agent text:='CA'||repeat('4',32);customer text:='CA'||repeat('5',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Call fixture Alpha','call-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Call fixture Beta','call-beta@example.test',true) returning id into b;
 select device_id into d from public.enroll_voice_staff_device(repeat('6',64),'Fixture browser',null,'call-alpha@example.test');
 select device_id into d2 from public.enroll_voice_staff_device(repeat('7',64),'Second browser',null,'call-alpha@example.test');
 select device_id into other_device from public.enroll_voice_staff_device(repeat('8',64),'Other person',null,'call-beta@example.test');
 select * into c from public.reserve_voice_phone_call(d,a,k,'+493055501234',null,'fixture-request');
 if c.state<>'reserved' or c.staff_id<>a then raise exception 'reservation binding wrong';end if;
 if not exists(select 1 from public.voice_call_sessions where id=c.id and mode='internal_test' and not transcript_storage_enabled and operator_name='Call fixture Alpha' and context_snapshot->>'interaction_mode'='human_phone') then raise exception 'session provenance missing';end if;
 if (public.reserve_voice_phone_call(d,a,k,'+493055501234',null,'fixture-request')).id<>c.id then raise exception 'reservation replay duplicated';end if;
 begin
  perform public.reserve_voice_phone_call(d,a,k,'+493055509999',null,'fixture-request');
  raise exception 'changed replay accepted';
 exception when others then if sqlerrm<>'phone_reservation_conflict' then raise;end if;end;
 begin
  perform public.reserve_voice_phone_call(d2,a,gen_random_uuid(),'+493055501234');
  raise exception 'second staff call accepted';
 exception when others then if sqlerrm<>'phone_staff_busy' then raise;end if;end;
 begin
  perform public.reserve_voice_phone_call(d,b,gen_random_uuid(),'+493055501234');
  raise exception 'cross-person reservation accepted';
 exception when others then if sqlerrm<>'phone_identity_required' then raise;end if;end;
 begin
  perform public.bind_voice_phone_call(c.id,other_device,agent);
  raise exception 'cross-device join accepted';
 exception when others then if sqlerrm<>'phone_call_forbidden' then raise;end if;end;
 perform public.bind_voice_phone_call(c.id,d,agent);
 perform public.bind_voice_phone_call(c.id,d,agent);
 begin
  perform public.bind_voice_phone_call(c.id,d,'CA'||repeat('6',32));
  raise exception 'second agent leg accepted';
 exception when others then if sqlerrm<>'phone_leg_conflict' then raise;end if;end;
 begin
  perform public.apply_voice_phone_event(c.id,'wrong-room','agent_join',agent,'invalid');
  raise exception 'bad conference accepted';
 exception when others then if sqlerrm<>'phone_conference_conflict' then raise;end if;end;
 r:=public.apply_voice_phone_event(c.id,'conf:1','agent_join',agent,room);
 if not (r->>'dial')::boolean or r->'call'->>'state'<>'dialing' then raise exception 'agent did not trigger exactly one dispatch';end if;
 if (public.apply_voice_phone_event(c.id,'conf:1','agent_join',agent,room)->>'dial')::boolean then raise exception 'duplicate dispatched';end if;
 if (public.apply_voice_phone_event(c.id,'conf:2','agent_join',agent,room)->>'dial')::boolean then raise exception 'second join dispatched';end if;
 perform public.apply_voice_phone_event(c.id,'status:answered','customer_answered',customer);
 if (select state from public.voice_phone_calls where id=c.id)='connected' then raise exception 'answered is not proof of conference join';end if;
 perform public.apply_voice_phone_event(c.id,'conf:3','customer_join',customer,room);
 perform public.apply_voice_phone_event(c.id,'dispatch:ack','dispatch_ack',customer);
 perform public.apply_voice_phone_event(c.id,'status:ringing','customer_ringing',customer);
 if not exists(select 1 from public.voice_phone_calls where id=c.id and state='connected') then raise exception 'late ringing regressed connection';end if;
 if not exists(select 1 from public.voice_call_sessions where id=c.id and status='live' and started_at is not null) then raise exception 'actual connection date not recorded';end if;
 begin
  perform public.apply_voice_phone_event(c.id,'wrong-leg','customer_join','CA'||repeat('9',32),room);
  raise exception 'another customer leg accepted';
 exception when others then if sqlerrm<>'phone_leg_conflict' then raise;end if;end;
 r:=public.apply_voice_phone_event(c.id,'ended','customer_completed',customer);
 if not (r->>'close')::boolean then raise exception 'cleanup not requested';end if;
 perform public.apply_voice_phone_event(c.id,'late-join','customer_join',customer,room);
 if not exists(select 1 from public.voice_phone_calls where id=c.id and state='completed' and ended_at is not null and cleanup_pending) then raise exception 'late join reopened completed call';end if;
 if not exists(select 1 from public.voice_call_sessions where id=c.id and status='completed' and ended_at is not null) then raise exception 'history end missing';end if;
 begin
  perform public.reserve_voice_phone_call(d2,a,gen_random_uuid(),'+493055501234');
  raise exception 'new call before cleanup accepted';
 exception when others then if sqlerrm<>'phone_staff_busy' then raise;end if;end;
 update public.voice_phone_calls set cleanup_pending=false where id=c.id;
 -- Revocation invalidates a previously reserved call at the actual provider join.
 select * into c from public.reserve_voice_phone_call(d,a,gen_random_uuid(),'+493055501234');
 update public.voice_staff_devices set revoked_at=now() where id=d;
 begin
  perform public.bind_voice_phone_call(c.id,d,agent);
  raise exception 'revoked identity joined';
 exception when others then if sqlerrm<>'phone_identity_required' then raise;end if;end;
 perform public.apply_voice_phone_event(c.id,'cancel','cancel');
 update public.voice_phone_calls set cleanup_pending=false where id=c.id;
 -- An ambiguous provider result stays claimed; it must never redial.
 select * into c from public.reserve_voice_phone_call(d2,a,gen_random_uuid(),'+493055501234');
 perform public.bind_voice_phone_call(c.id,d2,'CA'||repeat('a',32));
 perform public.apply_voice_phone_event(c.id,'join','agent_join','CA'||repeat('a',32),'CF'||repeat('b',32));
 perform public.apply_voice_phone_event(c.id,'uncertain','dispatch_uncertain');
 r:=public.apply_voice_phone_event(c.id,'join-again','agent_join','CA'||repeat('a',32),'CF'||repeat('b',32));
 if (r->>'dial')::boolean or r->'call'->>'state'<>'uncertain' then raise exception 'uncertain dispatch was repeated';end if;
 perform public.apply_voice_phone_event(c.id,'cancel','cancel');
 r:=public.apply_voice_phone_event(c.id,'late-ack','dispatch_ack','CA'||repeat('c',32));
 if not (r->>'close')::boolean or r->'call'->>'customer_call_sid'<>'CA'||repeat('c',32) then raise exception 'late provider leg escaped cleanup';end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.voice_phone_calls','SELECT') or
    has_function_privilege('anon','public.reserve_voice_phone_call(uuid,uuid,uuid,text,uuid,text)','EXECUTE')
 then raise exception 'public phone ledger access';end if;
end $$;
rollback;
