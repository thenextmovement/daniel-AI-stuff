\set ON_ERROR_STOP on
begin;
set local role service_role;
create function pg_temp.ai_fixture(label text,human boolean default false) returns jsonb language plpgsql as $$
declare prompt uuid;model uuid;consent uuid;campaign uuid;target uuid;attempt uuid;sid uuid;staff uuid;device uuid;cap uuid;
 tag text:=gen_random_uuid()::text;agent text:='CA'||replace(gen_random_uuid()::text,'-','');customer text:='CA'||replace(gen_random_uuid()::text,'-','');
 room text:='CF'||replace(gen_random_uuid()::text,'-','');stream text:='MZ'||replace(gen_random_uuid()::text,'-','');
begin
 insert into public.voice_prompt_versions(prompt_key,version_number,mode,instructions_template,content_hash,authored_by)
 values(tag,1,'lead_qualification',repeat('Synthetic test. ',10),tag,'fixture') returning id into prompt;
 insert into public.voice_model_releases(release_key,model_id,voice) values(tag,'gpt-live-1','marin') returning id into model;
 insert into public.voice_call_campaigns(name,mode,prompt_version_id,created_by) values(label,'lead_qualification',prompt,'fixture') returning id into campaign;
 insert into public.voice_contact_consents(request_id,phone_e164,phone_hash,purposes,consent_wording,form_version,source,evidence_hash,granted_at,evidence_retain_until,idempotency_key)
 values(tag,'+493055501234',tag,array['lead_qualification'],'Synthetic transcript fixture consent','fixture','fixture',tag,now(),now()+interval '6 years',tag) returning id into consent;
 insert into public.voice_call_targets(campaign_id,request_id,consent_id,phone_e164,phone_hash,idempotency_key,status,attempt_count)
 values(campaign,tag,consent,'+493055501234',tag,tag,'live',1) returning id into target;
 insert into public.voice_call_attempts(target_id,attempt_number,idempotency_key,model_release_id,prompt_version_id,provider,provider_call_id,status)
 values(target,1,tag,model,prompt,'twilio',customer,'live') returning id into attempt;
 insert into public.voice_call_sessions(idempotency_key,attempt_id,operator_name,mode,bound_request_id,consent_status,transcript_storage_enabled,transcript_write_token_hash,status,started_at,context_snapshot)
 values(tag,attempt,'AI fixture','internal_test',null,'confirmed',true,repeat('f',64),'live',now()-interval '1 minute',
 jsonb_build_object('interaction_mode','voice_agent','context_request_id',tag)) returning id into sid;
 perform public.persist_voice_runtime_transcript(attempt,'[{"id":"ai1","speaker":"assistant","text":"Wie kann ich helfen?","revision":1,"final":true,"startMs":0,"endMs":1000}]');
 if human then
  insert into public.voice_staff(display_name,access_email,enabled) values(label,tag||'@example.test',true) returning id into staff;
  select device_id into device from public.enroll_voice_staff_device(replace(tag,'-','')||replace(tag,'-',''),'Fixture',null,tag||'@example.test');
  -- Models the result of a future provider-confirmed handoff. It does not
  -- pretend this storage test establishes a real call or authorizes adoption.
  insert into public.voice_phone_calls(id,device_id,staff_id,request_key,phone,agent_call_sid,customer_call_sid,conference_sid,customer_dispatch,agent_joined,customer_joined,state)
  values(sid,device,staff,gen_random_uuid(),'+493055501234',agent,customer,room,'acknowledged',true,true,'connected');
  update public.voice_call_sessions set operator_name=label,summary='Employee summary',summary_source='human_confirmed' where id=sid;
  cap:=(public.reserve_voice_phone_capture(sid,device,gen_random_uuid(),repeat('e',64))->>'id')::uuid;
  perform public.claim_voice_phone_capture(cap);perform public.bind_voice_phone_capture(cap,customer,stream);
 end if;
 return jsonb_build_object('attempt',attempt,'session',sid,'capture',cap,'stream',stream,'customer',customer,'room',room,'device',device);
end $$;

do $$
declare f jsonb:=pg_temp.ai_fixture('Continuation',true);sid uuid:=(f->>'session')::uuid;attempt uuid:=(f->>'attempt')::uuid;
 cap uuid:=(f->>'capture')::uuid;r jsonb;original_start timestamptz;ai_end timestamptz;ended timestamptz;
begin
 select started_at into original_start from public.voice_call_sessions where id=sid;
 r:=public.persist_voice_runtime_transcript(attempt,'[]','complete');
 if r->>'captureStatus'<>'capturing' or (r->>'humanContinuation')::boolean is not true then raise exception 'AI finish ended human coverage';end if;
 select ai_ended_at into ai_end from public.voice_call_sessions where id=sid;
 perform public.finalize_voice_call_attempt(attempt,'handed_off','needs_human_followup','AI segment ended',null,null,'{}',null,true,true);
 perform public.finalize_voice_call_attempt(attempt,'failed','technical_failure','Late stale AI failure');
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='live' and ended_at is null and started_at=original_start
  and operator_name='Continuation' and summary='Employee summary' and summary_source='human_confirmed' and mode='internal_test' and bound_request_id is null)
 then raise exception 'AI finalization overwrote shared conversation';end if;
 if not exists(select 1 from public.voice_call_attempts where id=attempt and status='handed_off') then raise exception 'duplicate changed attempt';end if;
 perform public.persist_voice_runtime_transcript(attempt,'[{"id":"ai2","speaker":"customer","text":"Ja, gerne.","revision":1,"final":true,"startMs":2000,"endMs":2200}]','complete');
 if (select ai_ended_at from public.voice_call_sessions where id=sid)<>ai_end then raise exception 'retry extended AI write window';end if;
 r:=public.persist_voice_phone_capture(cap,f->>'stream',jsonb_build_array(jsonb_build_object(
  'id',cap||':outbound:human','speaker','operator','text','Ich übernehme.','revision',1,'final',true,'startMs',60000,'endMs',62000)));
 if r->>'captureStatus'<>'capturing' then raise exception 'human continuation missing';end if;
 if (select count(*) from public.voice_transcript_segments where session_id=sid)<>3 then raise exception 'history split or lost';end if;
 perform public.apply_voice_phone_event(sid,'customer:end','customer_leave',f->>'customer',f->>'room');
 select ended_at into ended from public.voice_call_sessions where id=sid;
 r:=public.persist_voice_phone_capture(cap,f->>'stream','[]','complete');
 if r->>'captureStatus'<>'complete' then raise exception 'shared transcript not complete';end if;
 perform public.finalize_voice_call_attempt(attempt,'cancelled','no_clear_outcome','Repeated old shutdown');
 perform public.persist_voice_runtime_transcript(attempt,'[]','complete');
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='completed' and ended_at=ended and capture_status='complete' and summary='Employee summary')
 then raise exception 'late AI callback changed human conclusion';end if;
 update public.voice_call_sessions set ai_ended_at=now()-interval '6 minutes' where id=sid;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[]','complete');
  raise exception 'expired AI writer accepted';
 exception when others then if sqlerrm<>'transcript_session_closed' then raise;end if;end;
end $$;

do $$
declare f jsonb:=pg_temp.ai_fixture('AI gap',true);sid uuid:=(f->>'session')::uuid;attempt uuid:=(f->>'attempt')::uuid;r jsonb;
begin
 perform public.persist_voice_runtime_transcript(attempt,'[]','interrupted');
 perform public.persist_voice_runtime_transcript(attempt,'[]','complete');
 perform public.apply_voice_phone_event(sid,'end','customer_leave',f->>'customer',f->>'room');
 r:=public.persist_voice_phone_capture((f->>'capture')::uuid,f->>'stream','[]','complete');
 if r->>'captureStatus'<>'interrupted' then raise exception 'human completion concealed AI gap';end if;
 if not exists(select 1 from public.voice_call_sessions where id=sid and ai_capture_status='interrupted') then raise exception 'AI interruption erased';end if;
end $$;

do $$
declare f jsonb:=pg_temp.ai_fixture('Human gap',true);sid uuid:=(f->>'session')::uuid;attempt uuid:=(f->>'attempt')::uuid;r jsonb;
begin
 perform public.interrupt_voice_phone_capture((f->>'capture')::uuid,(f->>'device')::uuid);
 r:=public.persist_voice_runtime_transcript(attempt,'[]','complete');
 if r->>'captureStatus'<>'interrupted' then raise exception 'AI completion concealed human gap';end if;
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='live' and ended_at is null) then raise exception 'capture interruption ended call';end if;
end $$;

do $$
declare f jsonb:=pg_temp.ai_fixture('Normal AI');sid uuid:=(f->>'session')::uuid;attempt uuid:=(f->>'attempt')::uuid;r jsonb;
begin
 -- Provider callback can precede the final transcript batch.
 perform public.finalize_voice_call_attempt(attempt,'completed','qualified_lead','Stored AI summary');
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='completed' and ended_at is not null and capture_status='interrupted')
 then raise exception 'missing final transcript claimed complete';end if;
 r:=public.persist_voice_runtime_transcript(attempt,'[{"id":"last","speaker":"customer","text":"Vielen Dank.","revision":1,"final":true,"startMs":3000,"endMs":3400}]','complete');
 if r->>'captureStatus'<>'complete' then raise exception 'late final batch not acknowledged';end if;
 perform public.finalize_voice_call_attempt(attempt,'failed','technical_failure','Conflicting duplicate');
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='completed' and capture_status='complete' and summary='Stored AI summary')
 then raise exception 'normal AI summary or completion overwritten';end if;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[{"id":"forged","speaker":"operator","text":"Forge","revision":1,"final":true,"startMs":0}]');
  raise exception 'AI writer forged operator';
 exception when others then if sqlerrm<>'runtime_transcript_speaker_binding' then raise;end if;end;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[{"id":"11111111-1111-4111-8111-111111111111:inbound:x","speaker":"customer","text":"Forge","revision":1,"final":true,"startMs":0}]');
  raise exception 'AI writer claimed human namespace';
 exception when others then if sqlerrm<>'runtime_transcript_speaker_binding' then raise;end if;end;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[{}]');
  raise exception 'empty segment accepted';
 exception when others then if sqlerrm<>'runtime_transcript_speaker_binding' then raise;end if;end;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[]','bogus');
  raise exception 'invalid finish accepted';
 exception when others then if sqlerrm<>'invalid_transcript_finish' then raise;end if;end;
end $$;

do $$
declare f jsonb:=pg_temp.ai_fixture('Partial AI');sid uuid:=(f->>'session')::uuid;attempt uuid:=(f->>'attempt')::uuid;r jsonb;
begin
 perform public.persist_voice_runtime_transcript(attempt,'[{"id":"partial","speaker":"customer","text":"RAL","revision":1,"final":false,"startMs":5000}]');
 r:=public.persist_voice_runtime_transcript(attempt,'[]','complete');
 if r->>'captureStatus'<>'interrupted' then raise exception 'partial transcript claimed complete';end if;
 r:=public.persist_voice_runtime_transcript(attempt,'[{"id":"partial","speaker":"customer","text":"RAL 9031","revision":2,"final":true,"startMs":5000,"endMs":6000}]');
 if r->>'captureStatus'<>'complete' then raise exception 'final revision not restored';end if;
 update public.voice_call_sessions set transcript_storage_enabled=false,consent_status='declined' where id=sid;
 begin
  perform public.persist_voice_runtime_transcript(attempt,'[]');
  raise exception 'revoked consent ignored';
 exception when others then if sqlerrm<>'transcript_consent_required' then raise;end if;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.persist_voice_runtime_transcript(uuid,jsonb,text)','EXECUTE')
 or has_function_privilege('authenticated','public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text)','EXECUTE')
 or has_function_privilege('service_role','public.persist_voice_phone_capture_before_ai(uuid,text,jsonb,text)','EXECUTE')
 or has_function_privilege('service_role','public.refresh_voice_ai_capture(uuid)','EXECUTE')
 then raise exception 'shared transcript privilege leak';end if;
end $$;
rollback;
