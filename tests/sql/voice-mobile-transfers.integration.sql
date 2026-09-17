\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;l uuid:=gen_random_uuid();c public.voice_phone_calls%rowtype;t public.voice_phone_transfers%rowtype;m uuid;r jsonb;
 agent text:='CA'||repeat('1',32);customer text:='CA'||repeat('2',32);target text:='CA'||repeat('3',32);conf text:='CF'||repeat('4',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Transfer source','mobile-transfer-source@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile recipient','mobile-transfer-target@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('1',64),'Source browser',null,'mobile-transfer-source@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('2',64),'Recipient browser',null,'mobile-transfer-target@example.test');
 -- Mobile reachability needs personal proof and explicit opt-in, not browser presence.
 begin perform public.set_voice_mobile_receiving(db,true);raise exception 'unverified receiver enabled';
 exception when raise_exception then if sqlerrm<>'mobile_link_required' then raise;end if;end;
 insert into public.voice_mobile_links(id,staff_id,staff_revision,device_id,phone,code_hash,state,verified_at,ended_at)
 values(l,b,1,db,'+493055501999',repeat('f',64),'verified',now(),now());
 if exists(select 1 from public.voice_mobile_receivers(b)) then raise exception 'proof alone enabled receiving';end if;
 perform public.set_voice_mobile_receiving(db,true);
 if not exists(select 1 from public.voice_mobile_receivers(b) where device_id=db and link_id=l) then raise exception 'mobile not reachable';end if;
 c:=public.reserve_voice_phone_call(da,a,gen_random_uuid(),'+493055501234');
 perform public.bind_voice_phone_call(c.id,da,agent);
 perform public.apply_voice_phone_event(c.id,'agent','agent_join',agent,conf);
 perform public.apply_voice_phone_event(c.id,'ack','dispatch_ack',customer);
 perform public.apply_voice_phone_event(c.id,'customer','customer_join',customer,conf);
 begin perform public.begin_voice_phone_transfer(c.id,da,b,gen_random_uuid());raise exception 'mobile without feature accepted';
 exception when raise_exception then if sqlerrm<>'mobile_transfers_disabled' then raise;end if;end;
 r:=public.begin_voice_phone_transfer_routed(c.id,da,b,gen_random_uuid(),true,true);
 select * into t from public.voice_phone_transfers where id=(r->>'id')::uuid;m:=t.mobile_leg_id;
 if t.to_transport<>'mobile' or t.to_device_id<>db or m is null then raise exception 'wrong mobile binding';end if;
 r:=public.advance_voice_phone_mobile(m,'claim');
 if r->>'dial'<>'false' then raise exception 'handset rang before customer hold';end if;
 perform public.advance_voice_phone_transfer(t.id,'held','held');
 perform public.advance_voice_phone_transfer(t.id,'dial','claim_dial');
 r:=public.advance_voice_phone_mobile(m,'claim');if r->>'dial'<>'true' then raise exception 'no handset dispatch';end if;
 r:=public.advance_voice_phone_mobile(m,'claim');if r->>'dial'<>'false' then raise exception 'handset redialed';end if;
 begin perform public.bind_voice_phone_transfer_device(t.id,db,target);raise exception 'browser stole mobile invitation';
 exception when raise_exception then if sqlerrm<>'mobile_transfer_requires_callback' then raise;end if;end;
 perform public.advance_voice_phone_mobile(m,'prompt',target);
 begin perform public.advance_voice_phone_transfer(t.id,'early','target_joined',target);raise exception 'unconfirmed handset joined';
 exception when raise_exception then if sqlerrm<>'mobile_transfer_not_confirmed' then raise;end if;end;
 r:=public.advance_voice_phone_mobile(m,'confirm',target);
 if r->>'join'<>'true' or r->'transfer'->>'to_call_sid'<>target then raise exception 'confirmation not bound to invitation';end if;
 perform public.advance_voice_phone_transfer(t.id,'joined','target_joined',target);
 perform public.advance_voice_phone_transfer(t.id,'commit','request_commit',null,da);
 perform public.advance_voice_phone_transfer(t.id,'guard','target_guards');
 perform public.advance_voice_phone_transfer(t.id,'release','source_releases');
 perform public.advance_voice_phone_transfer(t.id,'adopt','adopt');
 select * into c from public.voice_phone_calls where id=c.id;
 if c.device_id<>db or c.agent_transport<>'mobile' or c.mobile_leg_id<>m or c.customer_call_sid<>customer then raise exception 'mobile adoption lost call binding';end if;
 perform public.advance_voice_phone_transfer(t.id,'removed','source_removed');
 perform public.advance_voice_phone_transfer(t.id,'resumed','resumed');
 perform public.advance_voice_phone_transfer(t.id,'complete','complete');
 -- Stopping future reachability leaves the active adopted conversation intact.
 perform public.set_voice_mobile_receiving(db,false);
 r:=public.advance_voice_phone_mobile(m,'expire');
 if r->'leg'->>'ended_at' is not null or r->'call'->>'ended_at' is not null then raise exception 'availability switch ended active call';end if;
 -- An onward handover from the received mobile call preserves the same
 -- customer leg. The old mobile callback cannot hang up the new browser owner.
 update public.voice_staff_devices set registered=true,available=true,last_seen_at=now() where id=da;
 r:=public.begin_voice_phone_transfer(c.id,db,a,gen_random_uuid());
 select * into t from public.voice_phone_transfers where id=(r->>'id')::uuid;
 perform public.advance_voice_phone_transfer(t.id,'held','held');
 perform public.advance_voice_phone_transfer(t.id,'dial','claim_dial');
 perform public.bind_voice_phone_transfer_device(t.id,da,'CA'||repeat('9',32));
 perform public.advance_voice_phone_transfer(t.id,'joined','target_joined','CA'||repeat('9',32));
 perform public.advance_voice_phone_transfer(t.id,'commit','request_commit',null,db);
 perform public.advance_voice_phone_transfer(t.id,'guard','target_guards');
 perform public.advance_voice_phone_transfer(t.id,'release','source_releases');
 perform public.advance_voice_phone_transfer(t.id,'adopt','adopt');
 perform public.advance_voice_phone_transfer(t.id,'removed','source_removed');
 perform public.advance_voice_phone_transfer(t.id,'resumed','resumed');
 perform public.advance_voice_phone_transfer(t.id,'complete','complete');
 r:=public.advance_voice_phone_mobile(m,'terminal',target);
 if r->'call'->>'ended_at' is not null or r->>'closeCall'<>'false' then raise exception 'former handset ended onward transfer';end if;
 select * into c from public.voice_phone_calls where id=c.id;
 if c.agent_transport<>'browser' or c.device_id<>da or c.customer_call_sid<>customer then raise exception 'onward handover lost binding';end if;
 perform public.apply_voice_phone_event(c.id,'end','cancel',c.agent_call_sid);
 select * into c from public.voice_phone_calls where id=c.id;perform public.ack_voice_phone_cleanup(c.id,c.updated_at);
 -- A cancelled/unconfirmed invitation returns to the source, with cleanup tracked.
 perform public.set_voice_mobile_receiving(db,true);
 c:=public.reserve_voice_phone_call(da,a,gen_random_uuid(),'+493055501234');
 agent:='CA'||repeat('5',32);customer:='CA'||repeat('6',32);target:='CA'||repeat('7',32);conf:='CF'||repeat('8',32);
 perform public.bind_voice_phone_call(c.id,da,agent);
 perform public.apply_voice_phone_event(c.id,'agent','agent_join',agent,conf);
 perform public.apply_voice_phone_event(c.id,'ack','dispatch_ack',customer);
 perform public.apply_voice_phone_event(c.id,'customer','customer_join',customer,conf);
 r:=public.begin_voice_phone_transfer_routed(c.id,da,b,gen_random_uuid(),true,true);
 select * into t from public.voice_phone_transfers where id=(r->>'id')::uuid;m:=t.mobile_leg_id;
 perform public.advance_voice_phone_transfer(t.id,'held','held');
 perform public.advance_voice_phone_transfer(t.id,'dial','claim_dial');
 perform public.advance_voice_phone_mobile(m,'claim');
 perform public.advance_voice_phone_mobile(m,'prompt',target);
 perform public.set_voice_mobile_receiving(db,false);
 r:=public.advance_voice_phone_mobile(m,'confirm',target);
 if r->>'join'<>'false' or r->'transfer'->>'state'<>'cancelling' or r->'call'->>'ended_at' is not null then raise exception 'withdrawn receiving admitted or ended source';end if;
 perform public.advance_voice_phone_transfer(t.id,'removed','target_removed');
 perform public.advance_voice_phone_transfer(t.id,'resumed','rollback_resumed');
 perform public.advance_voice_phone_transfer(t.id,'complete','rollback_complete');
 select * into t from public.voice_phone_transfers where id=t.id;
 perform public.ack_voice_transfer_cleanup(t.id,t.updated_at);
 if not (select cleanup_pending from public.voice_phone_transfers where id=t.id) then raise exception 'transfer cleanup acknowledged before handset end';end if;
 perform public.advance_voice_phone_mobile(m,'terminal',target);
 select * into t from public.voice_phone_transfers where id=t.id;
 perform public.ack_voice_transfer_cleanup(t.id,t.updated_at);
 if (select cleanup_pending from public.voice_phone_transfers where id=t.id) then raise exception 'transfer cleanup did not finish';end if;
 if (select agent_call_sid from public.voice_phone_calls where id=c.id)<>agent then raise exception 'cancel changed source';end if;
 if has_function_privilege('anon','public.set_voice_mobile_receiving(uuid,boolean)','EXECUTE') or
  has_function_privilege('authenticated','public.begin_voice_phone_transfer_routed(uuid,uuid,uuid,uuid,boolean,boolean)','EXECUTE') or
  has_function_privilege('service_role','public.bind_voice_phone_transfer_before_mobile(uuid,uuid,text)','EXECUTE')
 then raise exception 'private receiving or admission exposed';end if;
end $$;
rollback;
