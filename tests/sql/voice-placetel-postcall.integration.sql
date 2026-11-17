\set ON_ERROR_STOP on
begin;
-- Roll back every fixture. No real phones, network or provider access are used.
do $$
declare
  actor uuid; sid uuid; other_id uuid; phone text:='+12025550103'; source text:='+12025550104'; token text:=repeat('a',64);
  result jsonb; claim jsonb; lease uuid; dial_key uuid; recording jsonb;
  segments jsonb:='[{"speaker":"speaker_1","text":"Guten Tag","startMs":0,"endMs":2000},{"speaker":"speaker_2","text":"Hallo","startMs":3000,"endMs":4000}]';
begin
  assert not has_table_privilege('anon','voice_placetel_calls','select');
  assert not has_function_privilege('authenticated','claim_voice_placetel_dial(uuid)','execute');
  assert has_function_privilege('service_role','claim_voice_placetel_recording()','execute');
  insert into voice_staff(display_name,enabled,placetel_target_id) values('Fixture Operator',true,'91919191') returning id into actor;
  insert into voice_call_sessions(idempotency_key,operator_name,mode,consent_status,transcript_storage_enabled,transcript_write_token_hash,bound_request_id,context_snapshot)
    values('placetel-fixture','Fixture Operator','follow_up','confirmed',true,token,'request-fixture',
      jsonb_build_object('interaction_mode','live_copilot','placetel_staff_id',actor,'placetel_phone',phone)) returning id into sid;
  begin
    perform reserve_voice_placetel_dial(sid,token,source,actor); raise exception 'incorrect destination accepted';
  exception when raise_exception then assert sqlerrm='placetel_binding_invalid'; end;
  begin
    perform reserve_voice_placetel_dial(sid,'wrong token',phone,actor); raise exception 'wrong token accepted';
  exception when raise_exception then assert sqlerrm='placetel_binding_invalid'; end;
  result:=reserve_voice_placetel_dial(sid,token,phone,actor);
  assert result->>'dispatch'='true'; dial_key:=(result->>'dispatch_key')::uuid;
  assert reserve_voice_placetel_dial(sid,token,phone,actor)->>'dispatch'='false';
  result:=claim_voice_placetel_dial(dial_key); assert result->>'target_id'='91919191' and result->>'phone'=phone;
  assert claim_voice_placetel_dial(dial_key)->>'dispatch'='false';
  assert finish_voice_placetel_dial(sid,'accepted',null,source)->>'status'='accepted';
  assert claim_voice_placetel_recording() is null;
  update voice_placetel_calls set dialed_at=now()-interval '6 minutes',next_check=now() where session_id=sid;
  claim:=claim_voice_placetel_recording(); lease:=(claim->>'lease_id')::uuid;
  assert claim->>'session_id'=sid::text and claim->>'source_phone'=source;
  assert claim_voice_placetel_recording() is null;
  result:=finish_voice_placetel_recording(sid,lease,'failed'); assert result->>'notify'='true';
  assert finish_voice_placetel_recording(sid,lease,'failed')->>'notify'='false';
  update voice_placetel_calls set next_check=now() where session_id=sid;
  lease:=(claim_voice_placetel_recording()->>'lease_id')::uuid;
  result:=finish_voice_placetel_recording(sid,lease,'failed'); assert result->>'notify'='false';
  update voice_placetel_calls set next_check=now() where session_id=sid;
  claim:=claim_voice_placetel_recording(); lease:=(claim->>'lease_id')::uuid;
  recording:=jsonb_build_object('to',phone,'from',source,'time',claim->>'dialed_at','direction','out','duration',60,'id','example-recording');
  begin
    perform finish_voice_placetel_recording(sid,lease,'complete',recording||'{"from":"+12025550105"}',segments,'Hello'); raise exception 'source mismatch accepted';
  exception when raise_exception then assert sqlerrm='placetel_recording_mismatch'; end;
  begin
    perform finish_voice_placetel_recording(sid,lease,'complete',recording,jsonb_build_array(segments->0),'Hello'); raise exception 'one speaker accepted as two';
  exception when raise_exception then assert sqlerrm='placetel_transcript_invalid'; end;
  begin
    update voice_call_sessions set consent_status='declined',transcript_storage_enabled=false where id=sid;
    perform finish_voice_placetel_recording(sid,lease,'complete',recording,segments,'Hello'); raise exception 'withdrawn consent accepted';
  exception when raise_exception then assert sqlerrm='placetel_session_ineligible'; end;
  -- A second dispatch to the same number in the time window blocks automatic assignment.
  begin
    insert into voice_call_sessions(idempotency_key,operator_name,mode) values('placetel-fixture-2','Fixture Operator','internal_test') returning id into other_id;
    insert into voice_placetel_calls(session_id,staff_id,phone,source_phone,dispatch_status,dialed_at)
      values(other_id,actor,phone,source,'accepted',(claim->>'dialed_at')::timestamptz);
    result:=finish_voice_placetel_recording(sid,lease,'complete',recording,segments,'Hello');
    assert result->>'status'='ambiguous' and result->>'notify'='true';
    assert not exists(select 1 from voice_transcript_segments where session_id=sid);
    raise exception 'rollback ambiguous fixture';
  exception when raise_exception then assert sqlerrm='rollback ambiguous fixture'; end;
  begin
    result:=finish_voice_placetel_recording(sid,lease,'single_speaker',recording,jsonb_build_array(segments->0),'Nur eine Stimme hörbar.');
    assert result->>'status'='single_speaker' and result->>'notify'='true';
    assert (select capture_status='interrupted' from voice_call_sessions where id=sid);
    raise exception 'rollback single speaker fixture';
  exception when raise_exception then assert sqlerrm='rollback single speaker fixture'; end;
  result:=finish_voice_placetel_recording(sid,lease,'complete',recording,segments,'Eine Begrüßung.');
  assert result->>'status'='complete' and result->>'notify'='false';
  assert finish_voice_placetel_recording(sid,lease,'complete',recording,segments,'Andere Zusammenfassung')->>'status'='complete';
  assert (select count(*)=2 from voice_transcript_segments where session_id=sid and is_final);
  assert (select status='completed' and capture_status='complete' and summary='Eine Begrüßung.' and bound_request_id='request-fixture' from voice_call_sessions where id=sid);
  assert claim_voice_placetel_recording() is null;
end $$;
rollback;
