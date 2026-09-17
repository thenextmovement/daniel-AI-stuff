begin;
-- The AI writer owns one segment of a conversation. It must not close or
-- overwrite the human continuation, even when its final callbacks arrive late.
alter table public.voice_call_sessions
 add column ai_capture_status text check(ai_capture_status in ('capturing','complete','interrupted')),
 add column ai_ended_at timestamptz;

-- Caller holds the session lock. Human capture callers lock phone/capture first;
-- this helper never takes those locks in the opposite order.
create function public.refresh_voice_ai_capture(p_session_id uuid)
 returns text language plpgsql security definer set search_path='' as $$
declare s public.voice_call_sessions%rowtype;c public.voice_phone_calls%rowtype;coverage text;
begin
 select * into s from public.voice_call_sessions where id=p_session_id for update;
 if not found then raise exception 'transcript_session_missing';end if;
 if s.attempt_id is null or s.ai_capture_status is null then return s.capture_status;end if;
 select * into c from public.voice_phone_calls where id=s.id;
 coverage:=case
  when s.ai_capture_status='interrupted' or exists(select 1 from public.voice_phone_captures where call_id=s.id and state='interrupted') then 'interrupted'
  when s.ai_capture_status='capturing' then case when s.ai_ended_at is null then 'capturing' else 'interrupted' end
  when exists(select 1 from public.voice_phone_captures where call_id=s.id and ended_at is null) then 'capturing'
  when c.id is not null and c.ended_at is null then 'not_started'
  when c.id is not null and not exists(select 1 from public.voice_phone_captures where call_id=s.id and state='complete') then 'interrupted'
  when exists(select 1 from public.voice_transcript_segments where session_id=s.id and not is_final) then 'interrupted'
  else 'complete' end;
 update public.voice_call_sessions set capture_status=coverage where id=s.id;
 return coverage;
end $$;
revoke all on function public.refresh_voice_ai_capture(uuid) from public,anon,authenticated,service_role;

create function public.persist_voice_runtime_transcript(p_attempt_id uuid,p_segments jsonb,p_finish text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.voice_call_sessions%rowtype;a public.voice_call_attempts%rowtype;item jsonb;coverage text;human boolean;
begin
 select * into s from public.voice_call_sessions where attempt_id=p_attempt_id for update;
 if not found then raise exception 'transcript_session_missing';end if;
 select * into a from public.voice_call_attempts where id=p_attempt_id;
 if not found then raise exception 'voice call attempt not found';end if;
 if (s.ai_ended_at is not null and s.ai_ended_at<now()-interval '5 minutes')
  or (a.ended_at is not null and a.ended_at<now()-interval '5 minutes') then raise exception 'transcript_session_closed';end if;
 if p_segments is null or jsonb_typeof(p_segments)<>'array' or jsonb_array_length(p_segments)>50 then raise exception 'invalid_transcript_batch';end if;
 if p_finish is not null and p_finish not in ('complete','interrupted') then raise exception 'invalid_transcript_finish';end if;
 for item in select value from jsonb_array_elements(p_segments) loop
  -- Human stream IDs are capture-UUID:track:item. A late AI write cannot claim
  -- their namespace or introduce an employee utterance.
  if (item->>'speaker' in ('customer','assistant')) is not true or
   coalesce(item->>'id','') ~ '^[0-9a-fA-F-]{36}:(inbound|outbound):'
   then raise exception 'runtime_transcript_speaker_binding';end if;
 end loop;
 perform public.persist_voice_transcript(s.id,s.transcript_write_token_hash,p_segments,null);
 human:=exists(select 1 from public.voice_phone_calls where id=s.id);
 update public.voice_call_sessions set
  ai_capture_status=case when ai_capture_status='interrupted' or p_finish='interrupted' then 'interrupted'
   when p_finish='complete' then 'complete' else coalesce(ai_capture_status,'capturing') end,
  ai_ended_at=coalesce(ai_ended_at,case when p_finish is not null then now() else a.ended_at end),
  status=case when not human and ended_at is null then
   case when a.status in ('completed','failed','cancelled','handed_off') then case when a.status='handed_off' then 'completed' else a.status end
    when p_finish='complete' then 'completed' when p_finish='interrupted' then 'cancelled' else status end else status end,
  ended_at=case when not human then coalesce(ended_at,a.ended_at,case when p_finish is not null then now() end) else ended_at end
 where id=s.id;
 coverage:=public.refresh_voice_ai_capture(s.id);
 return jsonb_build_object('saved',true,'captureStatus',coverage,'humanContinuation',human);
end $$;
revoke all on function public.persist_voice_runtime_transcript(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_voice_runtime_transcript(uuid,jsonb,text) to service_role;

-- The existing human writer still owns its stream and all its original guards.
-- Its completion must also account for an incomplete AI segment.
alter function public.persist_voice_phone_capture(uuid,text,jsonb,text) rename to persist_voice_phone_capture_before_ai;
revoke all on function public.persist_voice_phone_capture_before_ai(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
create function public.persist_voice_phone_capture(p_capture_id uuid,p_stream_sid text,p_segments jsonb,p_finish text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;sid uuid;coverage text;
begin
 result:=public.persist_voice_phone_capture_before_ai(p_capture_id,p_stream_sid,p_segments,p_finish);
 select call_id into sid from public.voice_phone_captures where id=p_capture_id;
 coverage:=public.refresh_voice_ai_capture(sid);
 return jsonb_set(result,'{captureStatus}',to_jsonb(coverage));
end $$;
revoke all on function public.persist_voice_phone_capture(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_voice_phone_capture(uuid,text,jsonb,text) to service_role;

-- Finalization and transcript-session closure are one transaction. Duplicate
-- callbacks use the stored outcome; they cannot replace a later human summary.
alter function public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text)
 rename to finalize_voice_call_attempt_before_shared_transcript;
revoke all on function public.finalize_voice_call_attempt_before_shared_transcript(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated,service_role;
create function public.finalize_voice_call_attempt(
 p_attempt_id uuid,p_terminal_status text,p_outcome_code text,p_summary_for_human text,
 p_customer_intent text default null,p_product_interest text default null,p_objections text[] default '{}',
 p_callback_at timestamptz default null,p_handoff_requested boolean default false,p_handoff_completed boolean default false,
 p_customer_requested_stop boolean default false,p_unsafe_or_unsupported_request boolean default false,
 p_failure_code text default null,p_failure_detail text default null)
 returns table(attempt_id uuid,target_status text,duplicate boolean)
 language plpgsql security definer set search_path='' as $$
declare s public.voice_call_sessions%rowtype;a public.voice_call_attempts%rowtype;
begin
 return query select * from public.finalize_voice_call_attempt_before_shared_transcript(
  p_attempt_id,p_terminal_status,p_outcome_code,p_summary_for_human,p_customer_intent,p_product_interest,p_objections,
  p_callback_at,p_handoff_requested,p_handoff_completed,p_customer_requested_stop,p_unsafe_or_unsupported_request,p_failure_code,p_failure_detail);
 select * into a from public.voice_call_attempts where id=p_attempt_id;
 select * into s from public.voice_call_sessions v where v.attempt_id=p_attempt_id for update;
 if not found then return;end if;
 update public.voice_call_sessions set ai_capture_status=coalesce(ai_capture_status,'capturing'),ai_ended_at=coalesce(ai_ended_at,a.ended_at)
 where id=s.id;
 if not exists(select 1 from public.voice_phone_calls where id=s.id) then
  update public.voice_call_sessions set
   status=case when ended_at is null then case when a.status='handed_off' then 'completed' else a.status end else status end,
   ended_at=coalesce(ended_at,a.ended_at),
   summary=case when summary_source is null or summary_source='ai_call_outcome'
    then (select summary_for_human from public.voice_call_outcomes where voice_call_outcomes.attempt_id=p_attempt_id) else summary end,
   summary_source=case when summary_source is null or summary_source='ai_call_outcome' then 'ai_call_outcome' else summary_source end,
   summary_updated_at=case when summary_source is null or summary_source='ai_call_outcome' then now() else summary_updated_at end
  where id=s.id;
 end if;
 perform public.refresh_voice_ai_capture(s.id);
end $$;
revoke all on function public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) to service_role;
comment on column public.voice_call_sessions.ai_capture_status is 'Coverage of the AI portion, independent from the shared conversation and later human capture. An explicit interruption remains visible.';
comment on column public.voice_call_sessions.ai_ended_at is 'End of AI portion; bounds late writes without ending a human continuation.';
commit;
