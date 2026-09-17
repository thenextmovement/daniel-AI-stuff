\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;la uuid:=gen_random_uuid();lb uuid:=gen_random_uuid();i uuid;j uuid;oa uuid;ob uuid;r jsonb;c public.voice_phone_calls%rowtype;
 caller text:='CA'||repeat('1',32);sa text:='CA'||repeat('2',32);sb text:='CA'||repeat('3',32);room text:='CF'||repeat('4',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile Alpha','incoming-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile Beta','incoming-beta@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('5',64),'Alpha handset owner',null,'incoming-alpha@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('6',64),'Beta browser and handset',null,'incoming-beta@example.test');
 insert into public.voice_mobile_links(id,staff_id,staff_revision,device_id,phone,code_hash,state,verified_at,ended_at) values
 (la,a,1,da,'+493055501111',repeat('a',64),'verified',now(),now()),(lb,b,1,db,'+493055502222',repeat('b',64),'verified',now(),now());
 r:=public.receive_voice_phone_incoming(caller,'+493055501234','+493055500000');i:=(r->>'id')::uuid;
 perform public.offer_voice_mobile_incoming(i,array['+493055501111','+493055502222']);
 if exists(select 1 from public.voice_phone_mobile_incoming where incoming_id=i) then raise exception 'proof alone or no customer join rang handsets';end if;
 perform public.set_voice_mobile_receiving(da,true);perform public.set_voice_mobile_receiving(db,true);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111','+493055502222']);
 if exists(select 1 from public.voice_phone_mobile_incoming where incoming_id=i) then raise exception 'handsets rang before parked caller';end if;
 perform public.event_voice_phone_incoming(i,'park','customer_join',caller,room);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111']);
 if (select count(*) from public.voice_phone_mobile_incoming where incoming_id=i)<>1 then raise exception 'allowed target list ignored';end if;
 perform public.offer_voice_mobile_incoming(i,array['+493055501111','+493055502222']);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111','+493055502222']);
 if (select count(*) from public.voice_phone_mobile_incoming where incoming_id=i)<>2 then raise exception 'offers duplicated or missing';end if;
 if exists(select 1 from public.voice_phone_calls where id=i) then raise exception 'ringing reserved customer for someone';end if;
 select id into oa from public.voice_phone_mobile_incoming where incoming_id=i and staff_id=a;
 select id into ob from public.voice_phone_mobile_incoming where incoming_id=i and staff_id=b;
 r:=public.advance_voice_mobile_incoming(oa,'claim');if r->>'dial'<>'true' then raise exception 'initial mobile claim failed';end if;
 r:=public.advance_voice_mobile_incoming(oa,'claim');if r->>'dial'<>'false' then raise exception 'duplicate mobile dial';end if;
 perform public.advance_voice_mobile_incoming(ob,'claim');
 begin perform public.advance_voice_mobile_incoming(oa,'confirm',sa);raise exception 'confirm skipped screening';
 exception when raise_exception then if sqlerrm<>'incoming_mobile_screening_required' then raise;end if;end;
 perform public.advance_voice_mobile_incoming(oa,'prompt',sa);
 r:=public.advance_voice_mobile_incoming(oa,'confirm',sa);
 if r->'offer'->>'mobile_leg_id'<>oa::text then raise exception 'not adopted';end if;
 select * into c from public.voice_phone_calls where id=i;
 if c.agent_transport<>'mobile' or c.mobile_leg_id<>oa or c.agent_call_sid<>sa or c.customer_call_sid<>caller or c.device_id<>da or c.direction<>'inbound'
  or c.customer_dispatch<>'acknowledged' or c.agent_joined then raise exception 'inbound handset lost binding or claimed actual join';end if;
 if not (select cleanup_pending from public.voice_phone_mobile_incoming where id=ob) then raise exception 'loser cleanup lost';end if;
 r:=public.advance_voice_mobile_incoming(oa,'confirm',sa);
 if r->'offer'->>'mobile_leg_id'<>oa::text or (select count(*) from public.voice_phone_calls where id=i)<>1 then raise exception 'accepted replay duplicated call';end if;
 begin perform public.bind_voice_phone_call(i,da,sa);raise exception 'SDK stole handset';
 exception when raise_exception then if sqlerrm<>'mobile_call_requires_callback' then raise;end if;end;
 update public.voice_staff_devices set available=true,registered=true,last_seen_at=now() where id=db;
 begin perform public.personal_voice_phone_incoming(db,'accept',i);raise exception 'browser stole mobile winner';
 exception when raise_exception then if sqlerrm<>'incoming_no_longer_available' then raise;end if;end;
 r:=public.advance_voice_mobile_incoming(ob,'prompt',sb);
 if r->'offer'->>'state'<>'ended' or r->'offer'->>'mobile_leg_id' is not null or r->'offer'->>'provider_call_sid'<>sb then raise exception 'late loser reopened';end if;
 perform public.apply_voice_phone_event(i,'join','agent_join',sa,room);
 perform public.event_voice_phone_incoming(i,'sync','sync');
 if (select state from public.voice_phone_incoming where id=i)<>'connected' then raise exception 'real mobile join not reflected';end if;
 -- Existing capture/session binding is the inbound customer session, never a new outbound one.
 if (select id from public.voice_call_sessions where id=i)<>c.id then raise exception 'session split';end if;
 perform public.apply_voice_phone_event(i,'end','cancel',sa);
 perform public.advance_voice_phone_mobile(oa,'terminal',sa);
 select * into c from public.voice_phone_calls where id=i;perform public.ack_voice_phone_cleanup(i,c.updated_at);
 if not (select cleanup_pending from public.voice_phone_calls where id=i) then raise exception 'losing handset not included in call cleanup';end if;
 perform public.advance_voice_mobile_incoming(ob,'terminal',sb);
 select * into c from public.voice_phone_calls where id=i;perform public.ack_voice_phone_cleanup(i,c.updated_at);
 if (select cleanup_pending from public.voice_phone_calls where id=i) then raise exception 'call cleanup stuck';end if;

 -- A browser can win while handsets ring. Delayed DTMF must not create or end another call.
 caller:='CA'||repeat('5',32);room:='CF'||repeat('6',32);sa:='CA'||repeat('7',32);
 r:=public.receive_voice_phone_incoming(caller,'+493055501234','+493055500000');i:=(r->>'id')::uuid;
 perform public.event_voice_phone_incoming(i,'park','customer_join',caller,room);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111']);
 select id into oa from public.voice_phone_mobile_incoming where incoming_id=i;
 perform public.advance_voice_mobile_incoming(oa,'claim');perform public.advance_voice_mobile_incoming(oa,'prompt',sa);
 r:=public.personal_voice_phone_incoming(db,'accept',i);
 r:=public.advance_voice_mobile_incoming(oa,'confirm',sa);
 if r->'offer'->>'state'<>'ended' or r->'offer'->>'mobile_leg_id' is not null then raise exception 'late mobile stole browser';end if;
 if (select device_id from public.voice_phone_calls where id=i)<>db or (select ended_at from public.voice_phone_calls where id=i) is not null then raise exception 'browser winner harmed';end if;
 perform public.apply_voice_phone_event(i,'end','cancel',null);
 perform public.advance_voice_mobile_incoming(oa,'terminal',sa);
 select * into c from public.voice_phone_calls where id=i;perform public.ack_voice_phone_cleanup(i,c.updated_at);

 -- Revocation between prompt and confirmation prevents adoption and leaves the caller waiting.
 caller:='CA'||repeat('8',32);room:='CF'||repeat('9',32);sa:='CA'||repeat('a',32);
 r:=public.receive_voice_phone_incoming(caller,'+493055501234','+493055500000');i:=(r->>'id')::uuid;
 perform public.event_voice_phone_incoming(i,'park','customer_join',caller,room);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111']);
 select id into oa from public.voice_phone_mobile_incoming where incoming_id=i;
 perform public.advance_voice_mobile_incoming(oa,'claim');perform public.advance_voice_mobile_incoming(oa,'prompt',sa);
 perform public.set_voice_mobile_receiving(da,false);
 r:=public.advance_voice_mobile_incoming(oa,'confirm',sa);
 if r->'offer'->>'state'<>'ended' or (select state from public.voice_phone_incoming where id=i)<>'waiting'
  or exists(select 1 from public.voice_phone_calls where id=i) then raise exception 'withdrawn handset claimed or ended caller';end if;
 perform public.advance_voice_mobile_incoming(oa,'terminal',sa);
 perform public.event_voice_phone_incoming(i,'end','customer_leave',caller,room);

 -- Caller hangup before the provider acknowledges the handset cannot reopen it.
 perform public.set_voice_mobile_receiving(da,true);
 caller:='CA'||repeat('b',32);room:='CF'||repeat('c',32);sa:='CA'||repeat('d',32);
 r:=public.receive_voice_phone_incoming(caller,'+493055501234','+493055500000');i:=(r->>'id')::uuid;
 perform public.event_voice_phone_incoming(i,'park','customer_join',caller,room);
 perform public.offer_voice_mobile_incoming(i,array['+493055501111']);
 select id into oa from public.voice_phone_mobile_incoming where incoming_id=i;
 perform public.advance_voice_mobile_incoming(oa,'claim');
 perform public.event_voice_phone_incoming(i,'leave','customer_leave',caller,room);
 r:=public.advance_voice_mobile_incoming(oa,'bind',sa);
 if r->'offer'->>'state'<>'ended' or r->'offer'->>'cleanup_pending'<>'true' then raise exception 'late sid not owned for cleanup';end if;
 perform public.ack_voice_incoming_cleanup(i,(select updated_at from public.voice_phone_incoming where id=i));
 if not (select cleanup_pending from public.voice_phone_incoming where id=i) then raise exception 'incoming cleanup lost ringing handset';end if;
 perform public.advance_voice_mobile_incoming(oa,'terminal',sa);
 perform public.ack_voice_incoming_cleanup(i,(select updated_at from public.voice_phone_incoming where id=i));
 if (select cleanup_pending from public.voice_phone_incoming where id=i) then raise exception 'incoming cleanup stuck';end if;
 if exists(select 1 from public.voice_phone_calls where id=i) then raise exception 'hangup created call';end if;
 if has_function_privilege('anon','public.offer_voice_mobile_incoming(uuid,text[])','EXECUTE') or
  has_function_privilege('authenticated','public.advance_voice_mobile_incoming(uuid,text,text,timestamptz)','EXECUTE') or
  has_table_privilege('authenticated','public.voice_phone_mobile_incoming','SELECT') then raise exception 'private handset data exposed';end if;
end $$;
rollback;
