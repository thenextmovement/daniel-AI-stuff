\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;d_a uuid;d_b uuid;c public.voice_phone_calls%rowtype;t jsonb;r jsonb;transfer_id uuid;k uuid:=gen_random_uuid();
 room text:='CF'||repeat('1',32);ca text:='CA'||repeat('2',32);cc text:='CA'||repeat('3',32);cb text:='CA'||repeat('4',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Transfer Alpha','transfer-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Transfer Beta','transfer-beta@example.test',true) returning id into b;
 select device_id into d_a from public.enroll_voice_staff_device(repeat('a',64),'Transfer A',null,'transfer-alpha@example.test');
 select device_id into d_b from public.enroll_voice_staff_device(repeat('b',64),'Transfer B',null,'transfer-beta@example.test');
 update public.voice_staff_devices set available=true,registered=true,last_seen_at=now() where id in(d_a,d_b);
 select * into c from public.reserve_voice_phone_call(d_a,a,gen_random_uuid(),'+493055501234',null,'unchanged-customer-request');
 perform public.bind_voice_phone_call(c.id,d_a,ca);
 perform public.apply_voice_phone_event(c.id,'join:alpha','agent_join',ca,room);
 perform public.apply_voice_phone_event(c.id,'join:customer','customer_join',cc,room);
 t:=public.begin_voice_phone_transfer(c.id,d_a,b,k);transfer_id:=(t->>'id')::uuid;
 if t->>'to_device_id'<>d_b::text then raise exception 'wrong target device';end if;
 if public.begin_voice_phone_transfer(c.id,d_a,b,k)->>'id'<>transfer_id::text then raise exception 'transfer replay created duplicate';end if;
 begin
  perform public.reserve_voice_phone_call(d_b,b,gen_random_uuid(),'+493055501234');
  raise exception 'target placed another call while being called';
 exception when others then if sqlerrm<>'phone_staff_busy' then raise;end if;end;
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'early:dial','claim_dial');
  raise exception 'target dialed before customer held';
 exception when others then if sqlerrm<>'transfer_wrong_stage' then raise;end if;end;
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'early:commit','request_commit',null,d_a);
  raise exception 'transferred before target joined';
 exception when others then if sqlerrm<>'transfer_target_not_connected' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'held','held');
 r:=public.advance_voice_phone_transfer(transfer_id,'dial','claim_dial');
 if not (r->>'dial')::boolean then raise exception 'missing transfer dial claim';end if;
 if (public.advance_voice_phone_transfer(transfer_id,'dial:duplicate','claim_dial')->>'dial')::boolean then raise exception 'transfer dial repeated';end if;
 begin
  perform public.bind_voice_phone_transfer_device(transfer_id,d_a,cb);
  raise exception 'wrong browser admitted';
 exception when others then if sqlerrm<>'transfer_invitation_not_current' then raise;end if;end;
 perform public.bind_voice_phone_transfer_device(transfer_id,d_b,cb);
 begin
  perform public.bind_voice_phone_transfer_device(transfer_id,d_b,'CA'||repeat('9',32));
  raise exception 'second recipient leg admitted';
 exception when others then if sqlerrm<>'transfer_leg_conflict' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'joined','target_joined',cb);
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'spoofed:commit','request_commit',null,d_b);
  raise exception 'recipient committed source transfer';
 exception when others then if sqlerrm<>'transfer_actor_forbidden' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'commit','request_commit',null,d_a);
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'early:adopt','adopt');
  raise exception 'owner changed before exit behavior acknowledged';
 exception when others then if sqlerrm<>'transfer_wrong_stage' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'target-guards','target_guards');
 perform public.advance_voice_phone_transfer(transfer_id,'source-releases','source_releases');
 update public.voice_staff_devices set revoked_at=now() where id=d_b;
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'revoked:adopt','adopt');
  raise exception 'revoked recipient became owner';
 exception when others then if sqlerrm<>'transfer_target_unavailable' then raise;end if;end;
 update public.voice_staff_devices set revoked_at=null where id=d_b;
 perform public.advance_voice_phone_transfer(transfer_id,'adopt','adopt');
 begin
  perform public.reserve_voice_phone_call(d_a,a,gen_random_uuid(),'+493055501234');
  raise exception 'source started another call before transfer cleanup';
 exception when others then if sqlerrm<>'phone_staff_busy' then raise;end if;end;
 if not exists(select 1 from public.voice_phone_calls where id=c.id and device_id=d_b and staff_id=b and agent_call_sid=cb and request_id='unchanged-customer-request' and customer_call_sid=cc) then raise exception 'transfer lost conversation binding';end if;
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'early:resume','resumed');
  raise exception 'customer rejoined while previous operator still present';
 exception when others then if sqlerrm<>'transfer_wrong_stage' then raise;end if;end;
 r:=public.apply_voice_phone_event(c.id,'source:left','agent_leave',ca,room);
 if (r->>'close')::boolean then raise exception 'previous operator ended transferred conversation';end if;
 perform public.advance_voice_phone_transfer(transfer_id,'resumed','resumed');
 perform public.advance_voice_phone_transfer(transfer_id,'complete','complete');
 if (select state from public.voice_phone_transfers where id=transfer_id)<>'transferred' then raise exception 'transfer not complete';end if;
 r:=public.apply_voice_phone_event(c.id,'reconcile:ended','conference_end',ca);
 if (r->>'close')::boolean then raise exception 'stale worker ended new owner call';end if;
 r:=public.apply_voice_phone_event(c.id,'operator:cancel','cancel',ca);
 if (r->>'close')::boolean then raise exception 'former owner cancellation ended new owner call';end if;
 perform public.apply_voice_phone_event(c.id,'source:left:late','agent_leave',ca,room);
 if not exists(select 1 from public.voice_call_sessions where id=c.id and status='live' and bound_request_id='unchanged-customer-request' and operator_name='Transfer Alpha') then raise exception 'history was split or overwritten';end if;
 -- The new owner can hand back, and cancel the consultation without losing
 -- their existing customer leg. A late created target is queued for cleanup.
 t:=public.begin_voice_phone_transfer(c.id,d_b,a,gen_random_uuid());transfer_id:=(t->>'id')::uuid;
 perform public.advance_voice_phone_transfer(transfer_id,'held','held');
 perform public.advance_voice_phone_transfer(transfer_id,'dial','claim_dial');
 perform public.advance_voice_phone_transfer(transfer_id,'intent:cancel','intent_cancel',null,d_b);
 begin
  perform public.bind_voice_phone_transfer_device(transfer_id,d_a,'CA'||repeat('5',32));
  raise exception 'withdrawn invitation admitted';
 exception when others then if sqlerrm<>'transfer_invitation_not_current' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'cancel','request_cancel',null,d_b);
 begin
  perform public.advance_voice_phone_transfer(transfer_id,'early:rollback','rollback_resumed');
  raise exception 'customer resumed before recipient was removed';
 exception when others then if sqlerrm<>'transfer_wrong_stage' then raise;end if;end;
 perform public.advance_voice_phone_transfer(transfer_id,'target-removed','target_removed');
 perform public.advance_voice_phone_transfer(transfer_id,'rollback-resumed','rollback_resumed');
 perform public.advance_voice_phone_transfer(transfer_id,'rollback-complete','rollback_complete');
 r:=public.advance_voice_phone_transfer(transfer_id,'late:bound','target_bound','CA'||repeat('5',32));
 if not (r->'transfer'->>'cleanup_pending')::boolean or r->'transfer'->>'state'<>'cancelled' then raise exception 'late created target escaped cleanup';end if;
 if not exists(select 1 from public.voice_phone_calls where id=c.id and staff_id=b and ended_at is null) then raise exception 'cancelled consultation lost original call';end if;
 -- The current owner's final departure still ends the conversation.
 r:=public.apply_voice_phone_event(c.id,'current:left','agent_leave',cb,room);
 if not (r->>'close')::boolean then raise exception 'current operator could not end call';end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('service_role','public.apply_voice_phone_event_base(uuid,text,text,text,text)','EXECUTE') or
  has_function_privilege('anon','public.begin_voice_phone_transfer(uuid,uuid,uuid,uuid)','EXECUTE') or
  has_table_privilege('authenticated','public.voice_phone_transfers','SELECT') then raise exception 'transfer security bypass';end if;
end $$;
rollback;
