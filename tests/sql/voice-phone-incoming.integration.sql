\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;i uuid;j uuid;t uuid;r jsonb;c jsonb;customer text:='CA'||repeat('b',32);room text:='CF'||repeat('b',32);agent text:='CA'||repeat('c',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Incoming Alpha','incoming-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Incoming Beta','incoming-beta@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('b',64),'Incoming A',null,'incoming-alpha@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('c',64),'Incoming B',null,'incoming-beta@example.test');
 update public.voice_staff_devices set registered=true,available=true,last_seen_at=now() where id in(da,db);
 r:=public.receive_voice_phone_incoming(customer,'+493055501234','+493055500000',null,'request-fixture','Example contact');
 i:=(r->>'id')::uuid;
 if (public.receive_voice_phone_incoming(customer,'+493055501234','+493055500000')->>'id')::uuid<>i then raise exception 'callback replay duplicated arrival';end if;
 if (select count(*) from public.voice_call_sessions where id=i and mode='internal_test' and status='created' and started_at is null)<>1 then raise exception 'arrival history wrong';end if;
 begin
  perform public.receive_voice_phone_incoming(customer,'+493055509999','+493055500000');
  raise exception 'changed caller replay accepted';
 exception when others then if sqlerrm<>'incoming_binding_conflict' then raise;end if;end;
 if jsonb_array_length(public.personal_voice_phone_incoming(da,'list')->'incoming')<>0 then raise exception 'offer before customer joins';end if;
 begin
  perform public.personal_voice_phone_incoming(da,'accept',i);
  raise exception 'accepted before caller arrival';
 exception when others then if sqlerrm<>'incoming_accept_ineligible' then raise;end if;end;
 begin
  perform public.event_voice_phone_incoming(i,'wrong-leg','customer_join',agent,room);
  raise exception 'wrong incoming leg allowed';
 exception when others then if sqlerrm<>'incoming_call_mismatch' then raise;end if;end;
 perform public.event_voice_phone_incoming(i,'conf:1','customer_join',customer,room);
 if jsonb_array_length(public.personal_voice_phone_incoming(da,'list')->'incoming')<>1 or
    jsonb_array_length(public.personal_voice_phone_incoming(db,'list')->'incoming')<>1 then raise exception 'available team not ringing';end if;
 update public.voice_staff_devices set last_seen_at=now()-interval '46 seconds' where id=da;
 if jsonb_array_length(public.personal_voice_phone_incoming(da,'list')->'incoming')<>0 then raise exception 'offline device offered call';end if;
 begin
  perform public.personal_voice_phone_incoming(da,'accept',i);
  raise exception 'stale device accepted';
 exception when others then if sqlerrm<>'incoming_accept_ineligible' then raise;end if;end;
 update public.voice_staff_devices set last_seen_at=now() where id=da;
 perform public.personal_voice_phone_incoming(da,'decline',i);
 if jsonb_array_length(public.personal_voice_phone_incoming(da,'list')->'incoming')<>0 or
    jsonb_array_length(public.personal_voice_phone_incoming(db,'list')->'incoming')<>1 then raise exception 'decline affected another employee';end if;
 begin
  perform public.personal_voice_phone_incoming(da,'accept',i);
  raise exception 'declined employee accepted';
 exception when others then if sqlerrm<>'incoming_accept_ineligible' then raise;end if;end;
 c:=public.personal_voice_phone_incoming(db,'accept',i)->'call';
 if c->>'direction'<>'inbound' or c->>'state'<>'connecting' or c->>'customer_dispatch'<>'acknowledged' or (c->>'agent_joined')::boolean
  or (c->>'id')::uuid<>i or (c->>'staff_id')::uuid<>b then raise exception 'incoming call binding wrong';end if;
 if public.personal_voice_phone_incoming(db,'accept',i)->'call'->>'id'<>i::text then raise exception 'accept retry duplicated call';end if;
 begin
  perform public.personal_voice_phone_incoming(da,'accept',i);
  raise exception 'second person accepted same call';
 exception when others then if sqlerrm<>'incoming_no_longer_available' then raise;end if;end;
 if jsonb_array_length(public.personal_voice_phone_incoming(da,'list')->'incoming')<>0 then raise exception 'claimed call still offered to someone else';end if;
 -- A replayed customer join or conference start must not mark an unanswered call live.
 r:=public.event_voice_phone_incoming(i,'conf:1','customer_join',customer,room);
 perform public.event_voice_phone_incoming(i,'conf:2','conference_start',null,room);
 if (select status from public.voice_call_sessions where id=i)<>'created' or
    (select started_at from public.voice_call_sessions where id=i) is not null then raise exception 'caller wait counted as employee conversation';end if;
 perform public.bind_voice_phone_call(i,db,agent);
 r:=public.apply_voice_phone_event(i,'conf:3','agent_join',agent,room);
 if (r->>'dial')::boolean or r->'call'->>'state'<>'connected' then raise exception 'incoming accept dialed a second customer or failed to connect';end if;
 perform public.event_voice_phone_incoming(i,'sync:3','sync');
 if (select state from public.voice_phone_incoming where id=i)<>'connected' or
    (select status from public.voice_call_sessions where id=i)<>'live' then raise exception 'actual employee join missing';end if;
 update public.voice_phone_incoming set expires_at=now()-interval '1 second' where id=i;
 perform public.event_voice_phone_incoming(i,'expire:joined','expire');
 if (select ended_at from public.voice_phone_calls where id=i) is not null then raise exception 'answered call expired';end if;
 -- The incoming callback remains authoritative after a regular team transfer.
 t:=(public.begin_voice_phone_transfer(i,db,a,gen_random_uuid())->>'id')::uuid;
 perform public.advance_voice_phone_transfer(t,'held','held');
 perform public.advance_voice_phone_transfer(t,'dial','claim_dial');
 perform public.bind_voice_phone_transfer_device(t,da,'CA'||repeat('a',32));
 perform public.advance_voice_phone_transfer(t,'joined','target_joined','CA'||repeat('a',32));
 perform public.advance_voice_phone_transfer(t,'commit','request_commit',null,db);
 perform public.advance_voice_phone_transfer(t,'guard','target_guards');
 perform public.advance_voice_phone_transfer(t,'unguard','source_releases');
 perform public.advance_voice_phone_transfer(t,'adopt','adopt');
 r:=public.apply_voice_phone_event(i,'former:left','agent_leave',agent,room);
 if (r->>'close')::boolean then raise exception 'incoming wrapper lost former-owner protection';end if;
 perform public.advance_voice_phone_transfer(t,'resumed','resumed');
 perform public.advance_voice_phone_transfer(t,'complete','complete');
 perform public.event_voice_phone_incoming(i,'sync:transferred','sync');
 if not exists(select 1 from public.voice_phone_calls where id=i and staff_id=a and device_id=da and direction='inbound'
  and request_id='request-fixture' and customer_call_sid=customer and ended_at is null) then raise exception 'incoming transfer split conversation';end if;
 r:=public.event_voice_phone_incoming(i,'dial:end','dial_end',customer);
 if not (r->>'closeCall')::boolean or r->'incoming'->>'state'<>'ended' then raise exception 'ended incoming call cleanup missing';end if;
 perform public.event_voice_phone_incoming(i,'late:join','customer_join',customer,room);
 if (select ended_at from public.voice_phone_calls where id=i) is null then raise exception 'late callback reopened incoming call';end if;
 update public.voice_phone_calls set cleanup_pending=false where id=i;
 -- A claimant that never connects must not reserve a caller indefinitely.
 j:=(public.receive_voice_phone_incoming('CA'||repeat('d',32),'+493055501234','+493055500000')->>'id')::uuid;
 perform public.event_voice_phone_incoming(j,'join','customer_join','CA'||repeat('d',32),'CF'||repeat('d',32));
 perform public.personal_voice_phone_incoming(db,'accept',j);
 update public.voice_phone_calls set expires_at=now()-interval '1 second' where id=j;
 update public.voice_phone_incoming set expires_at=now()-interval '1 second' where id=j;
 begin
  perform public.bind_voice_phone_call(j,db,'CA'||repeat('e',32));
  raise exception 'late browser joined expired incoming claim';
 exception when others then if sqlerrm<>'phone_call_forbidden' then raise;end if;end;
 begin
  perform public.personal_voice_phone_incoming(db,'accept',j);
  raise exception 'late claim retry accepted';
 exception when others then if sqlerrm<>'incoming_no_longer_available' then raise;end if;end;
 r:=public.event_voice_phone_incoming(j,'expired','expire');
 if not (r->>'closeCall')::boolean or r->'incoming'->>'state'<>'missed' then raise exception 'abandoned claim not closed';end if;
 if exists(select 1 from public.voice_call_sessions where id=j and (status<>'cancelled' or started_at is not null)) then raise exception 'unanswered call stored as conversation';end if;
 update public.voice_phone_calls set cleanup_pending=false where id=j;
 -- A pending, unclaimed caller has its own cleanup path; an early expiry does not consume its event key.
 j:=(public.receive_voice_phone_incoming('CA'||repeat('f',32),'+493055501234','+493055500000')->>'id')::uuid;
 r:=public.event_voice_phone_incoming(j,'expired','expire');
 if (r->>'close')::boolean then raise exception 'early timeout ended caller';end if;
 update public.voice_phone_incoming set expires_at=now()-interval '1 second' where id=j;
 r:=public.event_voice_phone_incoming(j,'expired','expire');
 if not (r->>'close')::boolean or r->'incoming'->>'state'<>'missed' or exists(select 1 from public.voice_phone_calls where id=j) then raise exception 'pending timeout not cleaned';end if;
 perform public.event_voice_phone_incoming(j,'late','customer_join','CA'||repeat('f',32),'CF'||repeat('f',32));
 if (select ended_at from public.voice_phone_incoming where id=j) is null then raise exception 'late pending callback revived call';end if;
 -- Revoked personal identity cannot list or accept.
 update public.voice_staff_devices set revoked_at=now() where id=da;
 begin
  perform public.personal_voice_phone_incoming(da,'list');
  raise exception 'revoked person accessed incoming calls';
 exception when others then if sqlerrm<>'phone_identity_required' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.voice_phone_incoming','SELECT') or
    has_function_privilege('anon','public.personal_voice_phone_incoming(uuid,text,uuid)','EXECUTE') or
    has_function_privilege('service_role','public.apply_voice_phone_event_before_incoming(uuid,text,text,text,text)','EXECUTE')
 then raise exception 'incoming access grants too broad';end if;
end $$;
rollback;
