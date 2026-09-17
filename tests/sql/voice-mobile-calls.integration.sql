\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;l uuid:=gen_random_uuid();rk uuid:=gen_random_uuid();c public.voice_phone_calls%rowtype;m uuid;r jsonb;t uuid;
 agent text:='CA'||repeat('a',32);customer text:='CA'||repeat('b',32);target text:='CA'||repeat('c',32);conf text:='CF'||repeat('d',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile Caller','mobile-caller@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Browser Colleague','browser-colleague@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('a',64),'Caller browser',null,'mobile-caller@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('b',64),'Colleague browser',null,'browser-colleague@example.test');
 update public.voice_staff_devices set available=true,registered=true,last_seen_at=now() where id=db;
 insert into public.voice_mobile_links(id,staff_id,staff_revision,device_id,phone,code_hash,state,verified_at,ended_at)
 values(l,a,1,da,'+493055501999',repeat('1',64),'verified',now(),now());
 begin perform public.reserve_voice_mobile_call(da,a,rk,'+493055501999',l);raise exception 'same source and destination accepted';
 exception when raise_exception then if sqlerrm<>'mobile_target_invalid' then raise;end if;end;
 begin perform public.reserve_voice_mobile_call(db,b,rk,'+493055501234',l);raise exception 'foreign phone link accepted';
 exception when raise_exception then if sqlerrm<>'mobile_target_invalid' then raise;end if;end;
 c:=public.reserve_voice_mobile_call(da,a,rk,'+493055501234',l);m:=c.mobile_leg_id;
 if c.agent_transport<>'mobile' or m is null then raise exception 'mobile reservation missing';end if;
 if (public.reserve_voice_mobile_call(da,a,rk,'+493055501234',l)).id<>c.id then raise exception 'mobile replay duplicated';end if;
 begin perform public.reserve_voice_phone_call(da,a,rk,'+493055501234');raise exception 'browser reused mobile reservation';
 exception when raise_exception then if sqlerrm<>'phone_transport_conflict' then raise;end if;end;
 begin perform public.bind_voice_phone_call(c.id,da,agent);raise exception 'browser joined mobile reservation';
 exception when raise_exception then if sqlerrm<>'mobile_call_requires_callback' then raise;end if;end;
 begin perform public.advance_voice_phone_mobile(m,'prompt',agent);raise exception 'unclaimed leg accepted';
 exception when raise_exception then if sqlerrm<>'mobile_leg_conflict' then raise;end if;end;
 r:=public.advance_voice_phone_mobile(m,'claim');if r->>'dial'<>'true' then raise exception 'first claim failed';end if;
 r:=public.advance_voice_phone_mobile(m,'claim');if r->>'dial'<>'false' then raise exception 'repeat claim dialed';end if;
 perform public.advance_voice_phone_mobile(m,'prompt',agent);
 if (select agent_transport from public.voice_phone_calls where id=c.id)<>'mobile' then raise exception 'trigger lost mobile transport';end if;
 begin perform public.advance_voice_phone_mobile(m,'bind',target);raise exception 'second provider leg accepted';
 exception when raise_exception then if sqlerrm<>'mobile_leg_conflict' then raise;end if;end;
 begin perform public.apply_voice_phone_event(c.id,'early-join','agent_join',agent,conf);raise exception 'customer dialed before confirmation';
 exception when raise_exception then if sqlerrm<>'mobile_confirmation_required' then raise;end if;end;
 if (select customer_dispatch from public.voice_phone_calls where id=c.id)<>'ready' then raise exception 'customer already dispatched';end if;
 r:=public.advance_voice_phone_mobile(m,'confirm',agent);if r->>'join'<>'true' then raise exception 'mobile confirmation failed';end if;
 r:=public.apply_voice_phone_event(c.id,'agent-join','agent_join',agent,conf);if r->>'dial'<>'true' then raise exception 'confirmed agent did not dispatch';end if;
 r:=public.apply_voice_phone_event(c.id,'agent-join','agent_join',agent,conf);if r->>'dial'<>'false' then raise exception 'join replay redialed';end if;
 perform public.apply_voice_phone_event(c.id,'ack','dispatch_ack',customer);
 perform public.apply_voice_phone_event(c.id,'customer-join','customer_join',customer,conf);
 select * into c from public.voice_phone_calls where id=c.id;
 if not c.agent_joined or not c.customer_joined then raise exception 'call not connected';end if;
 r:=public.begin_voice_phone_transfer(c.id,da,b,gen_random_uuid());t:=(r->>'id')::uuid;
 perform public.advance_voice_phone_transfer(t,'held','held');
 perform public.advance_voice_phone_transfer(t,'dial','claim_dial');
 perform public.bind_voice_phone_transfer_device(t,db,target);
 perform public.advance_voice_phone_transfer(t,'joined','target_joined',target);
 perform public.advance_voice_phone_transfer(t,'commit','request_commit',null,da);
 perform public.advance_voice_phone_transfer(t,'guard','target_guards');
 perform public.advance_voice_phone_transfer(t,'source','source_releases');
 perform public.advance_voice_phone_transfer(t,'adopt','adopt');
 select * into c from public.voice_phone_calls where id=c.id;
 if c.agent_transport<>'browser' or c.mobile_leg_id is not null or c.device_id<>db then raise exception 'mobile to browser ownership not updated';end if;
 -- Old handset completion never closes the transferred customer conversation.
 r:=public.advance_voice_phone_mobile(m,'terminal',agent);
 if r->>'closeCall'<>'false' or (r->'call'->>'ended_at') is not null then raise exception 'old handset ended transferred call';end if;
 begin perform public.reserve_voice_mobile_call(da,a,rk,'+493055501234',l);raise exception 'retry after handoff redialed customer';
 exception when raise_exception then if sqlerrm<>'phone_reservation_transferred' then raise;end if;end;
 perform public.advance_voice_phone_transfer(t,'source-removed','source_removed');
 perform public.advance_voice_phone_transfer(t,'resumed','resumed');
 perform public.advance_voice_phone_transfer(t,'complete','complete');
 perform public.apply_voice_phone_event(c.id,'end','cancel',target);
 select * into c from public.voice_phone_calls where id=c.id;perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 -- Rejected screening closes the whole request without ever dialing the customer.
 c:=public.reserve_voice_mobile_call(da,a,gen_random_uuid(),'+493055501234',l);m:=c.mobile_leg_id;
 perform public.advance_voice_phone_mobile(m,'claim');
 r:=public.advance_voice_phone_mobile(m,'reject','CA'||repeat('e',32));
 if r->>'join'<>'false' or r->'call'->>'ended_at' is null or r->'call'->>'customer_dispatch'<>'ready' then raise exception 'rejected screening leaked customer call';end if;
 select * into c from public.voice_phone_calls where id=c.id;perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 if not (select cleanup_pending from public.voice_phone_calls where id=c.id) then raise exception 'call cleaned while handset not confirmed ended';end if;
 perform public.advance_voice_phone_mobile(m,'terminal','CA'||repeat('e',32));
 select * into c from public.voice_phone_calls where id=c.id;perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 -- Cancellation with an unknown dispatch and a late leg remains closed.
 c:=public.reserve_voice_mobile_call(da,a,gen_random_uuid(),'+493055501234',l);m:=c.mobile_leg_id;
 perform public.advance_voice_phone_mobile(m,'claim');perform public.advance_voice_phone_mobile(m,'cancel');
 r:=public.advance_voice_phone_mobile(m,'bind','CA'||repeat('f',32));
 if r->'leg'->>'ended_at' is null or r->>'join'<>'false' then raise exception 'late binding reopened handset';end if;
 perform public.advance_voice_phone_mobile(m,'terminal','CA'||repeat('f',32));
 select * into c from public.voice_phone_calls where id=c.id;perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 -- Removing the verified destination prevents admission even after a prompt.
 c:=public.reserve_voice_mobile_call(da,a,gen_random_uuid(),'+493055501234',l);m:=c.mobile_leg_id;
 perform public.advance_voice_phone_mobile(m,'claim');perform public.advance_voice_phone_mobile(m,'prompt','CA'||repeat('9',32));
 perform public.unlink_voice_mobile(da,l);
 r:=public.advance_voice_phone_mobile(m,'confirm','CA'||repeat('9',32));
 if r->>'join'<>'false' or r->'call'->>'ended_at' is null then raise exception 'unlinked mobile joined';end if;
 if has_table_privilege('anon','public.voice_phone_mobile_legs','SELECT') or
  has_function_privilege('authenticated','public.advance_voice_phone_mobile(uuid,text,text,timestamptz)','EXECUTE') or
  has_function_privilege('service_role','public.bind_voice_phone_call_before_mobile(uuid,uuid,text)','EXECUTE')
 then raise exception 'private mobile admission exposed';end if;
end $$;
rollback;
