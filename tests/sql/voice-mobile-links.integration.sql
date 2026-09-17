\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare a uuid;b uuid;da uuid;db uuid;i uuid:=gen_random_uuid();j uuid:=gen_random_uuid();k uuid:=gen_random_uuid();r jsonb;v public.voice_mobile_links%rowtype;
 sid text:='CA'||repeat('a',32);sid2 text:='CA'||repeat('b',32);
begin
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile Alpha','mobile-alpha@example.test',true) returning id into a;
 insert into public.voice_staff(display_name,access_email,enabled) values('Mobile Beta','mobile-beta@example.test',true) returning id into b;
 select device_id into da from public.enroll_voice_staff_device(repeat('a',64),'Mobile Alpha browser',null,'mobile-alpha@example.test');
 select device_id into db from public.enroll_voice_staff_device(repeat('b',64),'Mobile Beta browser',null,'mobile-beta@example.test');
 v:=public.reserve_voice_mobile_link(i,da,'+493055501234',repeat('1',64));
 v:=public.reserve_voice_mobile_link(i,da,'+493055501234',repeat('1',64));
 if (select count(*) from public.voice_mobile_links where id=i)<>1 then raise exception 'reservation replay duplicated';end if;
 begin perform public.reserve_voice_mobile_link(i,db,'+493055501234',repeat('1',64));raise exception 'foreign replay accepted';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_request_conflict' then raise;end if;end;
 begin perform public.reserve_voice_mobile_link(j,da,'+493055501234',repeat('1',64));raise exception 'second pending accepted';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_attempt_pending' then raise;end if;end;
 begin perform public.advance_voice_mobile_link(i,'prompt',sid);raise exception 'prompt before dispatch';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_leg_conflict' then raise;end if;end;
 r:=public.advance_voice_mobile_link(i,'claim');if r->>'claimed'<>'true' then raise exception 'first claim failed';end if;
 r:=public.advance_voice_mobile_link(i,'claim');if r->>'claimed'<>'false' then raise exception 'duplicate dispatch';end if;
 if r::text like '%code_hash%' or r::text like '%'||repeat('1',64)||'%' then raise exception 'hash leaked';end if;
 perform public.advance_voice_mobile_link(i,'bind',sid);
 begin perform public.advance_voice_mobile_link(i,'verify',sid,repeat('1',64));raise exception 'verified before prompt';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_prompt_required' then raise;end if;end;
 begin perform public.advance_voice_mobile_link(i,'prompt',sid2);raise exception 'second leg bound';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_leg_conflict' then raise;end if;end;
 perform public.advance_voice_mobile_link(i,'prompt',sid);
 r:=public.advance_voice_mobile_link(i,'verify',sid,repeat('1',64));
 if (r->'attempt'->>'staff_revision')::integer<>1 then raise exception 'profile revision not bound';end if;
 if r->>'accepted'<>'true' or r->'attempt'->>'state'<>'verified' then raise exception 'correct code rejected';end if;
 r:=public.advance_voice_mobile_link(i,'terminal',sid);
 if r->'attempt'->>'state'<>'verified' or (r->'attempt'->>'cleanup_pending')::boolean then raise exception 'terminal downgraded proof';end if;
 begin perform public.unlink_voice_mobile(db,i);raise exception 'foreign unlink accepted';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_link_not_found' then raise;end if;end;
 -- New proof replaces the old phone only after a successful confirmation.
 update public.voice_mobile_links set created_at=now()-interval '2 minutes' where id=i;
 v:=public.reserve_voice_mobile_link(j,da,'+493055505678',repeat('2',64));
 if (select revoked_at from public.voice_mobile_links where id=i) is not null then raise exception 'old link removed too early';end if;
 perform public.advance_voice_mobile_link(j,'claim');perform public.advance_voice_mobile_link(j,'prompt',sid2);
 r:=public.advance_voice_mobile_link(j,'verify',sid2,repeat('3',64));
 if r->>'accepted'<>'false' or r->'attempt'->>'state'<>'failed' then raise exception 'wrong code accepted';end if;
 r:=public.advance_voice_mobile_link(j,'verify',sid2,repeat('2',64));
 if r->>'accepted'<>'false' then raise exception 'second guess accepted';end if;
 perform public.advance_voice_mobile_link(j,'terminal',sid2);
 if (select revoked_at from public.voice_mobile_links where id=i) is not null then raise exception 'failed proof erased prior link';end if;
 update public.voice_mobile_links set created_at=now()-interval '2 minutes' where id=j;
 v:=public.reserve_voice_mobile_link(k,da,'+493055505678',repeat('4',64));
 perform public.advance_voice_mobile_link(k,'claim');
 perform public.advance_voice_mobile_link(k,'prompt','CA'||repeat('c',32));
 update public.voice_staff_devices set revoked_at=now() where id=da;
 r:=public.advance_voice_mobile_link(k,'verify','CA'||repeat('c',32),repeat('4',64));
 if r->>'accepted'<>'false' or r->'attempt'->>'state'<>'cancelled' then raise exception 'revoked device completed verification';end if;
 update public.voice_staff_devices set revoked_at=null where id=da;
 perform public.advance_voice_mobile_link(k,'terminal','CA'||repeat('c',32));
 perform public.unlink_voice_mobile(da,i);
 if (select revoked_at from public.voice_mobile_links where id=i) is null then raise exception 'unlink did not persist';end if;
 -- Three attempts per hour; replay still returns the original without another call.
 begin perform public.reserve_voice_mobile_link(gen_random_uuid(),da,'+493055501234',repeat('5',64));raise exception 'rate bound bypassed';
 exception when invalid_parameter_value then if sqlerrm not in('mobile_rate_limited') then raise;end if;end;
 v:=public.reserve_voice_mobile_link(i,da,'+493055501234',repeat('1',64));
 -- Expired and late provider events remain closed, including after cleanup.
 i:=gen_random_uuid();v:=public.reserve_voice_mobile_link(i,db,'+493055509999',repeat('6',64));
 perform public.advance_voice_mobile_link(i,'claim');
 update public.voice_mobile_links set expires_at=now()-interval '1 minute' where id=i;
 r:=public.advance_voice_mobile_link(i,'prompt','CA'||repeat('d',32));
 if r->'attempt'->>'state'<>'cancelled' then raise exception 'expired prompt reopened';end if;
 r:=public.advance_voice_mobile_link(i,'verify','CA'||repeat('d',32),repeat('6',64));
 if r->>'accepted'<>'false' then raise exception 'expired verification accepted';end if;
 perform public.advance_voice_mobile_link(i,'cleanup',null,null,'2000-01-01'::timestamptz);
 if not (select cleanup_pending from public.voice_mobile_links where id=i) then raise exception 'stale cleanup acknowledged';end if;
 perform public.advance_voice_mobile_link(i,'terminal','CA'||repeat('d',32));
 -- A profile revision change cannot finalize a pending proof.
 update public.voice_mobile_links set created_at=now()-interval '2 minutes' where staff_id=b;
 j:=gen_random_uuid();v:=public.reserve_voice_mobile_link(j,db,'+493055509999',repeat('7',64));
 perform public.advance_voice_mobile_link(j,'claim');perform public.advance_voice_mobile_link(j,'prompt','CA'||repeat('f',32));
 update public.voice_staff set revision=revision+1 where id=b;
 r:=public.advance_voice_mobile_link(j,'verify','CA'||repeat('f',32),repeat('7',64));
 if r->>'accepted'<>'false' then raise exception 'changed profile confirmed stale proof';end if;
 -- Repeated cancellation before any dispatch stays side-effect free.
 perform public.advance_voice_mobile_link(j,'terminal','CA'||repeat('f',32));
 update public.voice_mobile_links set created_at=now()-interval '2 minutes' where staff_id=b;
 k:=gen_random_uuid();v:=public.reserve_voice_mobile_link(k,db,'+493055509999',repeat('8',64));
 perform public.advance_voice_mobile_link(k,'cancel');perform public.advance_voice_mobile_link(k,'cancel');
 if (select cleanup_pending from public.voice_mobile_links where id=k) then raise exception 'undispatched cancellation invented cleanup';end if;
 begin perform public.advance_voice_mobile_link(k,'prompt','CA'||repeat('9',32));raise exception 'undispatched cancelled leg accepted';
 exception when invalid_parameter_value then if sqlerrm<>'mobile_leg_conflict' then raise;end if;end;
 if has_table_privilege('anon','public.voice_mobile_links','SELECT') or has_table_privilege('authenticated','public.voice_mobile_links','SELECT')
 then raise exception 'mobile table accessible publicly';end if;
 if has_function_privilege('authenticated','public.advance_voice_mobile_link(uuid,text,text,text,timestamptz)','EXECUTE')
 then raise exception 'mobile RPC accessible publicly';end if;
end $$;
rollback;
