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

create function pg_temp.handoff_fixture(label text) returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.ai_fixture(label,false);a uuid:=(f->>'attempt')::uuid;person uuid;device uuid;
begin
 update public.voice_call_attempts set model_snapshot='{"model_id":"gpt-live-1"}',context_snapshot='{"allowlist_only":true}' where id=a;
 perform public.record_voice_call_event(a,'telephony','media.connected','media:'||a,null,jsonb_build_object('call_id',f->>'customer'));
 insert into public.voice_staff(display_name,access_email,enabled) values(label,a||'@example.test',true) returning id into person;
 select device_id into device from public.enroll_voice_staff_device(replace(a::text,'-','')||replace(a::text,'-',''),label,null,a||'@example.test');
 update public.voice_staff_devices set registered=true,last_seen_at=now() where id=device;
 return f||jsonb_build_object('device',device,'staff',person,'key',gen_random_uuid(),'agent','CA'||replace(gen_random_uuid()::text,'-',''));
end $$;
do $$
declare f jsonb:=pg_temp.handoff_fixture('Confirmed handoff');a uuid:=(f->>'attempt')::uuid;sid uuid:=(f->>'session')::uuid;
 device uuid:=(f->>'device')::uuid;h jsonb;r jsonb;hid uuid;cap uuid;began timestamptz;
begin
 select started_at into began from public.voice_call_sessions where id=sid;
 h:=public.begin_voice_ai_handoff(a,device,(f->>'key')::uuid,array['+493055501234']);hid:=(h->>'id')::uuid;
 if public.begin_voice_ai_handoff(a,device,(f->>'key')::uuid,array['+493055501234'])->>'id'<>hid::text then raise exception 'duplicate preparation';end if;
 if exists(select 1 from public.voice_phone_calls where id=sid) then raise exception 'customer owned before employee ready';end if;
 r:=public.advance_voice_ai_handoff(hid,'early','redirect');
 if (r->>'redirect')::boolean then raise exception 'redirect before employee';end if;
 begin
  perform public.advance_voice_ai_handoff(hid,'wrong','bind',f->>'agent',null,gen_random_uuid());
  raise exception 'foreign device accepted';
 exception when others then if sqlerrm<>'ai_handoff_owner_required' then raise;end if;end;
 r:=public.advance_voice_ai_handoff(hid,'bind','bind',f->>'agent',null,device);
 if (r->>'join')::boolean is not true then raise exception 'employee join refused';end if;
 if (public.advance_voice_ai_handoff(hid,'bind','bind',f->>'agent',null,device)->>'join')::boolean is not true then raise exception 'provider retry disconnected employee';end if;
 begin
  perform public.reserve_voice_phone_call(device,(f->>'staff')::uuid,gen_random_uuid(),'+493055501234');
  raise exception 'second call while taking over';
 exception when others then if sqlerrm<>'phone_staff_busy' then raise;end if;end;
 perform public.advance_voice_ai_handoff(hid,'ready','agent_join',f->>'agent',f->>'room');
 r:=public.advance_voice_ai_handoff(hid,'redirect','redirect');
 if (r->>'redirect')::boolean is not true then raise exception 'ready redirect missing';end if;
 cap:=(r->'handoff'->>'capture_id')::uuid;
 if (public.advance_voice_ai_handoff(hid,'retry','redirect')->>'redirect')::boolean then raise exception 'duplicate provider redirect';end if;
 if (public.claim_voice_ai_stop(a)->>'allowed')::boolean then raise exception 'old AI stop stole customer';end if;
 if not exists(select 1 from public.voice_phone_calls where id=sid and state='connecting' and not customer_joined and customer_call_sid=f->>'customer') then raise exception 'wrong preliminary phone binding';end if;
 if not exists(select 1 from public.voice_phone_captures where id=cap and call_id=sid and state='dispatching') then raise exception 'capture was not prepared before redirect announcement';end if;
 perform public.bind_voice_phone_capture(cap,f->>'customer',f->>'stream');
 perform public.persist_voice_phone_capture(cap,f->>'stream',jsonb_build_array(jsonb_build_object('id',cap||':inbound:before-join','speaker','customer','text','Ja, danke.','revision',1,'final',true,'startMs',61000,'endMs',62000)));
 perform public.persist_voice_runtime_transcript(a,'[]','complete');
 perform public.finalize_voice_call_attempt(a,'completed','no_clear_outcome','AI socket closed');
 if not exists(select 1 from public.voice_call_sessions where id=sid and status='live' and ended_at is null and started_at=began) then raise exception 'old AI closed handoff';end if;
 if not exists(select 1 from public.voice_call_attempts where id=a and status='live' and control_owner='handoff') then raise exception 'claimed connected without customer';end if;
 r:=public.advance_voice_ai_handoff(hid,'connected','customer_join',f->>'customer',f->>'room');
 if r->'handoff'->>'state'<>'connected' then raise exception 'customer join did not connect';end if;
 if not exists(select 1 from public.voice_call_attempts where id=a and status='handed_off' and control_owner='human') or
 not exists(select 1 from public.voice_call_outcomes where attempt_id=a and human_handoff_completed and human_handoff_requested)
 then raise exception 'missing confirmed outcome';end if;
 if (public.claim_voice_ai_stop(a)->>'allowed')::boolean then raise exception 'AI stop allowed after connected';end if;
 perform public.advance_voice_ai_handoff(hid,'late-cancel','cancel',null,null,device);
 perform public.finalize_voice_call_attempt(a,'failed','technical_failure','Late AI failure');
 if not exists(select 1 from public.voice_phone_calls where id=sid and state='connected' and ended_at is null and customer_call_sid=f->>'customer') then raise exception 'late cancellation ended adopted call';end if;
 if (select count(*) from public.voice_transcript_segments where session_id=sid)<>2 then raise exception 'transcript split';end if;
 if not exists(select 1 from public.voice_call_sessions where id=sid and mode='internal_test' and bound_request_id is null and started_at=began and operator_name='Confirmed handoff') then raise exception 'test/date/operator binding changed';end if;
end $$;
do $$
declare f jsonb:=pg_temp.handoff_fixture('Cancel before redirect');a uuid:=(f->>'attempt')::uuid;hid uuid;r jsonb;
begin
 hid:=(public.begin_voice_ai_handoff(a,(f->>'device')::uuid,(f->>'key')::uuid,array['+493055501234'])->>'id')::uuid;
 perform public.advance_voice_ai_handoff(hid,'bind','bind',f->>'agent',null,(f->>'device')::uuid);
 r:=public.advance_voice_ai_handoff(hid,'cancel','cancel',null,null,(f->>'device')::uuid);
 if r->'handoff'->>'state'<>'cancelled' or (r->'handoff'->>'cleanup_customer')::boolean or not (r->'handoff'->>'cleanup_pending')::boolean then raise exception 'cancel touched customer';end if;
 perform public.advance_voice_ai_handoff(hid,'late','agent_join',f->>'agent',f->>'room');
 if exists(select 1 from public.voice_phone_calls where id=(f->>'session')::uuid) or not exists(select 1 from public.voice_call_attempts where id=a and status='live' and control_owner='ai') then raise exception 'cancel ended original AI call';end if;
 r:=public.advance_voice_ai_handoff(hid,'redirect','redirect');
 if (r->>'redirect')::boolean then raise exception 'cancelled redirect';end if;
end $$;
do $$
declare f jsonb:=pg_temp.handoff_fixture('Stop wins');a uuid:=(f->>'attempt')::uuid;hid uuid;r jsonb;
begin
 hid:=(public.begin_voice_ai_handoff(a,(f->>'device')::uuid,(f->>'key')::uuid,array['+493055501234'])->>'id')::uuid;
 perform public.advance_voice_ai_handoff(hid,'bind','bind',f->>'agent',null,(f->>'device')::uuid);
 perform public.advance_voice_ai_handoff(hid,'join','agent_join',f->>'agent',f->>'room');
 r:=public.claim_voice_ai_stop(a);
 if (r->>'allowed')::boolean is not true or r->>'providerCallId'<>f->>'customer' then raise exception 'stop binding missing';end if;
 r:=public.advance_voice_ai_handoff(hid,'redirect','redirect');
 if (r->>'redirect')::boolean or r->'handoff'->>'state'<>'cancelled' then raise exception 'handoff defeated prior stop';end if;
end $$;
do $$
declare f jsonb:=pg_temp.handoff_fixture('Uncertain redirect');a uuid:=(f->>'attempt')::uuid;sid uuid:=(f->>'session')::uuid;hid uuid;r jsonb;c public.voice_phone_calls%rowtype;
begin
 hid:=(public.begin_voice_ai_handoff(a,(f->>'device')::uuid,(f->>'key')::uuid,array['+493055501234'])->>'id')::uuid;
 perform public.advance_voice_ai_handoff(hid,'bind','bind',f->>'agent',null,(f->>'device')::uuid);
 perform public.advance_voice_ai_handoff(hid,'join','agent_join',f->>'agent',f->>'room');
 perform public.advance_voice_ai_handoff(hid,'redirect','redirect');
 r:=public.advance_voice_ai_handoff(hid,'cancel','cancel',null,null,(f->>'device')::uuid);
 if r->'handoff'->>'state'<>'redirecting' then raise exception 'uncertain redirect falsely returned to AI';end if;
 update public.voice_ai_handoffs set expires_at=now()-interval '1 second' where id=hid;
 r:=public.advance_voice_ai_handoff(hid,'expire','expire');
 if r->'handoff'->>'state'<>'failed' or (r->'handoff'->>'cleanup_customer')::boolean is not true then raise exception 'failed redirect not tracked';end if;
 if not exists(select 1 from public.voice_phone_calls where id=sid and ended_at is not null and cleanup_pending) then raise exception 'phone cleanup missing';end if;
 begin
  perform public.advance_voice_ai_handoff(hid,'cleanup-early','cleanup',null,null,null,(r->'handoff'->>'updated_at')::timestamptz);
  raise exception 'unconfirmed cleanup accepted';
 exception when others then if sqlerrm<>'ai_handoff_cleanup_unconfirmed' then raise;end if;end;
 select * into c from public.voice_phone_calls where id=sid;
 perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 r:=public.advance_voice_ai_handoff(hid,'cleanup','cleanup',null,null,null,(r->'handoff'->>'updated_at')::timestamptz);
 if (r->'handoff'->>'cleanup_pending')::boolean then raise exception 'confirmed cleanup retained';end if;
 if not exists(select 1 from public.voice_call_attempts where id=a and status='failed' and control_owner='stopping') then raise exception 'failed handoff not finalized';end if;
end $$;
reset role;
do $$begin
 if has_function_privilege('authenticated','public.begin_voice_ai_handoff(uuid,uuid,uuid,text[])','EXECUTE') or
 has_function_privilege('anon','public.claim_voice_ai_stop(uuid)','EXECUTE') or
 has_table_privilege('authenticated','public.voice_ai_handoffs','SELECT') or
 has_function_privilege('service_role','public.finalize_voice_call_attempt_before_ai_handoff(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text)','EXECUTE')
 then raise exception 'handoff privilege leak';end if;
end $$;
rollback;
