\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;c public.voice_phone_calls%rowtype;v jsonb;r jsonb;cap uuid;key uuid:=gen_random_uuid();
 ca text:='CA'||repeat('2',32);cc text:='CA'||repeat('3',32);mz text:='MZ'||repeat('4',32);room text:='CF'||repeat('5',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Capture Alpha','capture-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Capture Beta','capture-beta@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('c',64),'Capture A',null,'capture-alpha@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('d',64),'Capture B',null,'capture-beta@example.test');
 select * into c from public.reserve_voice_phone_call(da,a,gen_random_uuid(),'+493055501234',null,'capture-test-request');
 perform public.bind_voice_phone_call(c.id,da,ca);
 begin
  perform public.reserve_voice_phone_capture(c.id,da,key,repeat('a',64));
  raise exception 'capture started before customer joined';
 exception when others then if sqlerrm<>'capture_call_not_eligible' then raise;end if;end;
 perform public.apply_voice_phone_event(c.id,'agent','agent_join',ca,room);
 perform public.apply_voice_phone_event(c.id,'customer','customer_join',cc,room);
 begin
  perform public.reserve_voice_phone_capture(c.id,db,key,repeat('a',64));
  raise exception 'foreign employee enabled capture';
 exception when others then if sqlerrm<>'capture_call_not_eligible' then raise;end if;end;
 v:=public.reserve_voice_phone_capture(c.id,da,key,repeat('a',64));cap:=(v->>'id')::uuid;
 if public.reserve_voice_phone_capture(c.id,da,key,repeat('b',64))->>'id'<>cap::text then raise exception 'duplicate capture';end if;
 if not exists(select 1 from public.voice_call_sessions where id=c.id and consent_status='confirmed' and transcript_storage_enabled and transcript_write_token_hash=repeat('a',64)) then raise exception 'consent or credential changed';end if;
 begin
  perform public.reserve_voice_phone_capture(c.id,da,gen_random_uuid(),repeat('a',64));
  raise exception 'parallel capture';
 exception when others then if sqlerrm<>'capture_already_active' then raise;end if;end;
 if (public.claim_voice_phone_capture(cap)->>'dispatch')::boolean is not true then raise exception 'first dispatch missing';end if;
 if (public.claim_voice_phone_capture(cap)->>'dispatch')::boolean is true then raise exception 'duplicate dispatch';end if;
 begin
  perform public.bind_voice_phone_capture(cap,ca,mz);
  raise exception 'captured wrong call leg';
 exception when others then if sqlerrm<>'capture_binding_rejected' then raise;end if;end;
 perform public.bind_voice_phone_capture(cap,cc,mz);
 begin
  perform public.bind_voice_phone_capture(cap,cc,mz);
  raise exception 'socket replay accepted';
 exception when others then if sqlerrm<>'capture_binding_rejected' then raise;end if;end;
 begin
  perform public.persist_voice_phone_capture(cap,mz,jsonb_build_array(jsonb_build_object('id',cap||':inbound:x','speaker','operator','text','Wrong','revision',1,'final',true,'startMs',0,'endMs',20)));
  raise exception 'forged speaker';
 exception when others then if sqlerrm<>'capture_speaker_binding_mismatch' then raise;end if;end;
 begin
  perform public.persist_voice_phone_capture(cap,mz,'[{}]');
  raise exception 'missing speaker accepted';
 exception when others then if sqlerrm<>'capture_speaker_binding_mismatch' then raise;end if;end;
 perform public.persist_voice_phone_capture(cap,mz,jsonb_build_array(jsonb_build_object('id',cap||':inbound:x','speaker','customer','text','RAL 90','revision',1,'final',false,'startMs',100,'endMs',null)));
 perform public.persist_voice_phone_capture(cap,mz,jsonb_build_array(jsonb_build_object('id',cap||':inbound:x','speaker','customer','text','RAL 9031','revision',2,'final',true,'startMs',100,'endMs',120)));
 -- The customer stream and history remain bound through a staff owner change.
 update public.voice_phone_calls set device_id=db,staff_id=b where id=c.id;
 begin
  perform public.interrupt_voice_phone_capture(cap,da);
  raise exception 'former owner stopped capture';
 exception when others then if sqlerrm<>'capture_owner_required' then raise;end if;end;
 perform public.persist_voice_phone_capture(cap,mz,jsonb_build_array(jsonb_build_object('id',cap||':outbound:y','speaker','operator','text','Wir prüfen das','revision',1,'final',true,'startMs',130,'endMs',200)));
 if (select count(*) from public.voice_transcript_segments where session_id=c.id)<>2 then raise exception 'history split';end if;
 perform public.apply_voice_phone_event(c.id,'customer:left','customer_leave',cc,room);
 r:=public.persist_voice_phone_capture(cap,mz,'[]','complete');
 if r->>'captureStatus'<>'complete' then raise exception 'ended capture not complete';end if;
 if not exists(select 1 from public.voice_call_sessions where id=c.id and bound_request_id='capture-test-request') then raise exception 'customer binding lost';end if;
end $$;
do $$
declare staff uuid;device uuid;c public.voice_phone_calls%rowtype;cap uuid;again uuid;v jsonb;key uuid:=gen_random_uuid();
 ca text:='CA'||repeat('6',32);cc text:='CA'||repeat('7',32);mz text:='MZ'||repeat('8',32);room text:='CF'||repeat('9',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Coverage','coverage@example.test',true) returning id into staff;
 select device_id into device from public.enroll_voice_staff_device(repeat('e',64),'Coverage',null,'coverage@example.test');
 select * into c from public.reserve_voice_phone_call(device,staff,gen_random_uuid(),'+493055501234');
 perform public.bind_voice_phone_call(c.id,device,ca);
 perform public.apply_voice_phone_event(c.id,'agent','agent_join',ca,room);
 perform public.apply_voice_phone_event(c.id,'customer','customer_join',cc,room);
 cap:=(public.reserve_voice_phone_capture(c.id,device,key,repeat('a',64))->>'id')::uuid;
 perform public.claim_voice_phone_capture(cap);perform public.bind_voice_phone_capture(cap,cc,mz);
 -- Stale recovery must not terminate a capture that has since saved a heartbeat.
 v:=public.interrupt_voice_phone_capture(cap,null,now()-interval '1 minute');
 if v->>'state'<>'active' then raise exception 'stale recovery ended active capture';end if;
 perform public.interrupt_voice_phone_capture(cap,device);
 if not exists(select 1 from public.voice_phone_calls where id=c.id and ended_at is null) then raise exception 'transcription stop ended telephone call';end if;
 begin
  perform public.reserve_voice_phone_capture(c.id,device,gen_random_uuid(),repeat('a',64));
  raise exception 'restart before provider stop acknowledgment';
 exception when others then if sqlerrm<>'capture_already_active' then raise;end if;end;
 update public.voice_phone_captures set cleanup_pending=false where id=cap;
 again:=(public.reserve_voice_phone_capture(c.id,device,gen_random_uuid(),repeat('b',64))->>'id')::uuid;
 perform public.claim_voice_phone_capture(again);perform public.bind_voice_phone_capture(again,cc,'MZ'||repeat('9',32));
 perform public.apply_voice_phone_event(c.id,'end','customer_leave',cc,room);
 v:=public.persist_voice_phone_capture(again,'MZ'||repeat('9',32),'[]','complete');
 if v->>'captureStatus'<>'interrupted' then raise exception 'restart concealed prior missing coverage';end if;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.persist_voice_phone_capture(uuid,text,jsonb,text)','EXECUTE')
 or has_table_privilege('authenticated','public.voice_phone_captures','SELECT') then raise exception 'capture privilege leak';end if;
end $$;
rollback;
