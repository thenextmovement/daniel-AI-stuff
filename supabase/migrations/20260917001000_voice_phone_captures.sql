begin;
create table public.voice_phone_captures (
 id uuid primary key default gen_random_uuid(),
 call_id uuid not null references public.voice_phone_calls(id),
 request_key uuid not null,
 customer_call_sid text not null check(customer_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 approved_by_staff_id uuid not null references public.voice_staff(id),
 approved_by_device_id uuid not null references public.voice_staff_devices(id),
 state text not null default 'reserved' check(state in ('reserved','dispatching','active','complete','interrupted')),
 stream_sid text unique check(stream_sid ~ '^MZ[0-9a-fA-F]{32}$'),
 created_at timestamptz not null default now(),
 stream_started_at timestamptz,
 ended_at timestamptz,
 cleanup_pending boolean not null default false,
 updated_at timestamptz not null default now(),
 unique(call_id,request_key)
);
create unique index voice_phone_capture_one_active on public.voice_phone_captures(call_id) where ended_at is null or cleanup_pending;
alter table public.voice_phone_captures enable row level security;
revoke all on public.voice_phone_captures from public,anon,authenticated;
grant select,insert,update,delete on public.voice_phone_captures to service_role;
create policy voice_phone_captures_service on public.voice_phone_captures for all to service_role using(true) with check(true);

create function public.reserve_voice_phone_capture(p_call_id uuid,p_device_id uuid,p_request_key uuid,p_token_hash text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;v public.voice_phone_captures%rowtype;
begin
 select * into c from public.voice_phone_calls where id=p_call_id for update;
 if not found or c.device_id<>p_device_id or c.ended_at is not null or c.cleanup_pending or c.state<>'connected'
  or not c.customer_joined or c.customer_call_sid is null then raise exception 'capture_call_not_eligible';end if;
 if not exists(select 1 from public.voice_staff_devices d join public.voice_staff s on s.id=d.staff_id
  where d.id=p_device_id and d.staff_id=c.staff_id and s.enabled and d.revoked_at is null and d.expires_at>now()
  and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from s.access_email))
 then raise exception 'phone_identity_required';end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_capture_credential';end if;
 select * into v from public.voice_phone_captures where call_id=c.id and request_key=p_request_key;
 if found then return to_jsonb(v);end if;
 if exists(select 1 from public.voice_phone_captures where call_id=c.id and (ended_at is null or cleanup_pending)) then raise exception 'capture_already_active';end if;
 if (select count(*) from public.voice_phone_captures where call_id=c.id)>=8 then raise exception 'capture_restart_limit';end if;
 insert into public.voice_phone_captures(call_id,request_key,customer_call_sid,approved_by_staff_id,approved_by_device_id)
  values(c.id,p_request_key,c.customer_call_sid,c.staff_id,c.device_id) returning * into v;
 update public.voice_call_sessions set consent_status='confirmed',transcript_storage_enabled=true,
  transcript_write_token_hash=coalesce(transcript_write_token_hash,p_token_hash),
  capture_status=case when capture_status='interrupted' then 'interrupted' else 'capturing' end,
  context_snapshot=coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object('transcription_model','gpt-live-transcribe','transcript_timing','audio_windows',
   'transcript_source','customer_call_both_tracks')
 where id=c.id;
 return to_jsonb(v);
end $$;

create function public.claim_voice_phone_capture(p_capture_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;v public.voice_phone_captures%rowtype;v_call uuid;dispatch boolean:=false;
begin
 select call_id into v_call from public.voice_phone_captures where id=p_capture_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into v from public.voice_phone_captures where id=p_capture_id for update;
 if not found then raise exception 'capture_not_found';end if;
 if v.state='reserved' and c.ended_at is null then
  update public.voice_phone_captures set state='dispatching',updated_at=now() where id=v.id returning * into v;
  dispatch:=true;
 elsif v.state='reserved' and c.ended_at is not null then
  update public.voice_phone_captures set state='interrupted',ended_at=now(),updated_at=now() where id=v.id returning * into v;
  update public.voice_call_sessions set capture_status='interrupted' where id=c.id;
 end if;
 return jsonb_build_object('capture',to_jsonb(v),'dispatch',dispatch);
end $$;

create function public.bind_voice_phone_capture(p_capture_id uuid,p_call_sid text,p_stream_sid text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;v public.voice_phone_captures%rowtype;v_call uuid;started timestamptz;
begin
 select call_id into v_call from public.voice_phone_captures where id=p_capture_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into v from public.voice_phone_captures where id=p_capture_id for update;
 if not found or v.state<>'dispatching' or v.ended_at is not null or c.ended_at is not null or
  c.customer_call_sid is distinct from p_call_sid or v.customer_call_sid is distinct from p_call_sid or p_stream_sid !~ '^MZ[0-9a-fA-F]{32}$' or p_stream_sid is null
 then raise exception 'capture_binding_rejected';end if;
 select started_at into started from public.voice_call_sessions where id=c.id and consent_status='confirmed' and transcript_storage_enabled;
 if not found then raise exception 'transcript_consent_required';end if;
 update public.voice_phone_captures set state='active',stream_sid=p_stream_sid,stream_started_at=now(),updated_at=now()
  where id=v.id returning * into v;
 return jsonb_build_object('capture',to_jsonb(v),'offsetMs',greatest(0,floor(extract(epoch from (v.stream_started_at-coalesce(started,c.created_at)))*1000)));
end $$;

create function public.persist_voice_phone_capture(p_capture_id uuid,p_stream_sid text,p_segments jsonb,p_finish text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;v public.voice_phone_captures%rowtype;v_call uuid;token_hash text;item jsonb;v_capture_status text;
begin
 select call_id into v_call from public.voice_phone_captures where id=p_capture_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into v from public.voice_phone_captures where id=p_capture_id for update;
 if not found or v.stream_sid is distinct from p_stream_sid or v.stream_sid is null or v.state not in ('active','complete','interrupted') or
  (v.ended_at is not null and v.ended_at<now()-interval '5 minutes')
 then raise exception 'capture_binding_rejected';end if;
 if p_segments is null or jsonb_typeof(p_segments)<>'array' or jsonb_array_length(p_segments)>50 then raise exception 'invalid_capture_batch';end if;
 if p_finish is not null and p_finish not in ('complete','interrupted') then raise exception 'invalid_capture_finish';end if;
 for item in select value from jsonb_array_elements(p_segments) loop
  if ((item->>'speaker'='customer' and starts_with(item->>'id',v.id::text||':inbound:')) or
          (item->>'speaker'='operator' and starts_with(item->>'id',v.id::text||':outbound:'))) is not true
  then raise exception 'capture_speaker_binding_mismatch';end if;
 end loop;
 select transcript_write_token_hash into token_hash from public.voice_call_sessions where id=c.id;
 perform public.persist_voice_transcript(c.id,token_hash,p_segments,null);
 update public.voice_phone_captures set updated_at=now() where id=v.id;
 if p_finish is not null then
  update public.voice_phone_captures set state=case when p_finish='complete' and c.ended_at is not null and state<>'interrupted' and not exists(select 1 from public.voice_transcript_segments where session_id=c.id and starts_with(source_item_id,v.id::text||':') and not is_final) then 'complete' else 'interrupted' end,
   ended_at=coalesce(ended_at,now()),cleanup_pending=true,updated_at=now() where id=v.id;
 end if;
 v_capture_status:=case
  when exists(select 1 from public.voice_phone_captures where call_id=c.id and state='interrupted') then 'interrupted'
  when exists(select 1 from public.voice_phone_captures where call_id=c.id and ended_at is null) then 'capturing'
  when c.ended_at is not null and not exists(select 1 from public.voice_transcript_segments where session_id=c.id and not is_final) then 'complete'
  else 'interrupted' end;
 update public.voice_call_sessions set capture_status=v_capture_status where id=c.id;
 return jsonb_build_object('saved',true,'captureStatus',v_capture_status,'captureState',(select state from public.voice_phone_captures where id=v.id),'callEnded',c.ended_at is not null);
end $$;

-- A failed/start-uncertain capture can be stopped without ending the telephone
-- conversation. Compare updated_at when recovering a stale worker.
create function public.interrupt_voice_phone_capture(p_capture_id uuid,p_device_id uuid default null,p_expected_updated_at timestamptz default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_phone_calls%rowtype;v public.voice_phone_captures%rowtype;v_call uuid;
begin
 select call_id into v_call from public.voice_phone_captures where id=p_capture_id;
 select * into c from public.voice_phone_calls where id=v_call for update;
 select * into v from public.voice_phone_captures where id=p_capture_id for update;
 if not found then raise exception 'capture_not_found';end if;
 if p_device_id is not null and c.device_id<>p_device_id then raise exception 'capture_owner_required';end if;
 if p_expected_updated_at is not null and v.updated_at<>p_expected_updated_at then return to_jsonb(v);end if;
 if v.ended_at is null then
  update public.voice_phone_captures set state='interrupted',ended_at=now(),cleanup_pending=(state<>'reserved'),updated_at=now()
   where id=v.id returning * into v;
  update public.voice_call_sessions set capture_status='interrupted' where id=c.id;
 end if;
 return to_jsonb(v);
end $$;
revoke all on function public.interrupt_voice_phone_capture(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.interrupt_voice_phone_capture(uuid,uuid,timestamptz) to service_role;
revoke all on function public.reserve_voice_phone_capture(uuid,uuid,uuid,text),public.claim_voice_phone_capture(uuid),
 public.bind_voice_phone_capture(uuid,text,text),public.persist_voice_phone_capture(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_voice_phone_capture(uuid,uuid,uuid,text),public.claim_voice_phone_capture(uuid),
 public.bind_voice_phone_capture(uuid,text,text),public.persist_voice_phone_capture(uuid,text,jsonb,text) to service_role;
comment on table public.voice_phone_captures is 'Explicit operator-confirmed consent, immutable customer call binding and capture coverage. Model output is transcript evidence, never company policy. Pilot sessions remain internal_test.';
commit;
