\set ON_ERROR_STOP on
begin;
do $$
declare sid uuid; result jsonb; row_count int;
begin
 insert into voice_call_sessions(idempotency_key,operator_name,mode,consent_status,transcript_storage_enabled,transcript_write_token_hash,status,started_at)
 values('history-test','Fixture Operator','internal_test','confirmed',true,'test-hash','live',now()) returning id into sid;
 result:=persist_voice_transcript(sid,'test-hash','[{"id":"event_1","speaker":"customer","text":" RAL 9031 ","revision":1,"final":false,"startMs":0,"endMs":100}]');
 perform persist_voice_transcript(sid,'test-hash','[{"id":"event_1","speaker":"customer","text":" RAL 9031 ","revision":1,"final":false,"startMs":0,"endMs":100}]');
 select count(*) into row_count from voice_transcript_segments where session_id=sid;
 if row_count<>1 then raise exception 'duplicate created rows'; end if;
 begin
  perform persist_voice_transcript(sid,'wrong','[]');
  raise exception 'wrong token accepted';
 exception when raise_exception then if sqlerrm<>'transcript_session_forbidden' then raise; end if; end;
 begin
  perform persist_voice_transcript(sid,'test-hash','[{"id":"event_1","speaker":"operator","text":" RAL 9031 ","revision":2,"final":false,"startMs":0,"endMs":100}]');
  raise exception 'speaker change accepted';
 exception when raise_exception then if sqlerrm<>'transcript_binding_mismatch' then raise; end if; end;
 result:=persist_voice_transcript(sid,'test-hash','[]','complete');
 if result->>'captureStatus'<>'interrupted' then raise exception 'partial capture claimed complete'; end if;
 perform persist_voice_transcript(sid,'test-hash','[{"id":"event_1","speaker":"customer","text":" RAL 9013 ","revision":2,"final":true,"startMs":0,"endMs":120}]');
 result:=persist_voice_transcript(sid,'test-hash','[]','complete');
 if result->>'captureStatus'<>'complete' then raise exception 'final capture missing'; end if;
 begin
  perform persist_voice_transcript(sid,'test-hash','[{"id":"event_1","speaker":"customer","text":"changed","revision":3,"final":true,"startMs":0,"endMs":120}]');
  raise exception 'final text overwritten';
 exception when raise_exception then if sqlerrm<>'transcript_already_final' then raise; end if; end;
 update voice_call_sessions set ended_at=now()-interval '6 minutes',status='completed' where id=sid;
 begin
  perform persist_voice_transcript(sid,'test-hash','[]');
  raise exception 'expired write accepted';
 exception when raise_exception then if sqlerrm<>'transcript_session_closed' then raise; end if; end;
 if has_table_privilege('anon','voice_transcript_segments','select') then raise exception 'public transcript access'; end if;
 if has_function_privilege('authenticated','persist_voice_transcript(uuid,text,jsonb,text)','execute') then raise exception 'browser RPC access'; end if;
end $$;
rollback;
