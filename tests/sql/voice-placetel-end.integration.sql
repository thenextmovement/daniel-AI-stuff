\set ON_ERROR_STOP on
begin;
do $$
declare actor uuid; sid uuid; stamp timestamptz:=now()-interval '10 minutes';
begin
 insert into voice_staff(display_name,enabled,placetel_target_id) values('End fixture',true,'999999') returning id into actor;
 insert into voice_call_sessions(operator_name,bound_request_id,context_snapshot,status) values('End fixture','fixture-request','{"placetel_direct":true}','created') returning id into sid;
 insert into voice_placetel_calls(session_id,staff_id,phone,dispatch_status,dialed_at) values(sid,actor,'+12025550103','accepted',stamp);
 assert not confirm_voice_placetel_end(sid,'+12025550109',stamp,20);
 assert (select ended_at is null from voice_call_sessions where id=sid);
 assert confirm_voice_placetel_end(sid,'+12025550103',stamp,20);
 assert (select status='completed' and ended_at=stamp+interval '20 seconds' from voice_call_sessions where id=sid), 'provider end must close OPS session';
 assert (select recording_status='pending' from voice_placetel_calls where session_id=sid), 'end must not claim transcript ready';
 assert confirm_voice_placetel_end(sid,'+12025550103',stamp,20);
 assert not confirm_voice_placetel_end(sid,'+12025550103',stamp,21);
 assert (select ended_at=stamp+interval '20 seconds' from voice_call_sessions where id=sid);
end $$;
rollback;
