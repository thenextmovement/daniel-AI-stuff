begin;
-- Only explicit, consented OPS dial sessions enter the provider recording queue.
create table public.voice_placetel_calls (
  session_id uuid primary key references public.voice_call_sessions(id) on delete cascade,
  staff_id uuid not null references public.voice_staff(id),
  phone text not null check (phone ~ '^[+][1-9][0-9]{6,14}$'),
  source_phone text check (source_phone ~ '^[+][1-9][0-9]{6,14}$'),
  dispatch_key uuid not null unique default gen_random_uuid(),
  reserved_at timestamptz not null default now(),
  dialed_at timestamptz,
  dispatch_status text not null default 'reserved' check (dispatch_status in ('reserved','dispatched','accepted','uncertain','rejected')),
  provider_id text check (length(provider_id) between 1 and 200),
  recording_id text unique check (length(recording_id) between 1 and 200),
  recording_status text not null default 'pending' check (recording_status in ('pending','missing','failed','ambiguous','expired','complete','single_speaker')),
  failure_reported boolean not null default false,
  next_check timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz
);
create index voice_placetel_queue_idx on public.voice_placetel_calls(next_check)
  where dialed_at is not null and recording_status in ('pending','missing','failed');
create index voice_placetel_matching_idx on public.voice_placetel_calls(phone,dialed_at);
alter table public.voice_placetel_calls enable row level security;
revoke all on public.voice_placetel_calls from public, anon, authenticated, service_role;
grant select on public.voice_placetel_calls to service_role;

alter table public.voice_transcript_segments drop constraint voice_transcript_segments_speaker_check;
alter table public.voice_transcript_segments add constraint voice_transcript_segments_speaker_check
  check (speaker in ('customer','operator','assistant','speaker_1','speaker_2'));

create function public.reserve_voice_placetel_dial(p_session_id uuid,p_token_hash text,p_phone text,p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.voice_call_sessions%rowtype; c public.voice_placetel_calls%rowtype;
begin
  select * into s from public.voice_call_sessions where id=p_session_id for update;
  if not found or p_token_hash is null or s.transcript_write_token_hash is distinct from p_token_hash
      or s.mode='internal_test' or s.bound_request_id is null or s.consent_status<>'confirmed'
      or not s.transcript_storage_enabled or s.context_snapshot->>'interaction_mode' is distinct from 'live_copilot'
      or s.context_snapshot->>'placetel_phone' is distinct from p_phone
      or s.context_snapshot->>'placetel_staff_id' is distinct from p_staff_id::text
      or p_phone is null or p_staff_id is null then raise exception 'placetel_binding_invalid'; end if;
  select * into c from public.voice_placetel_calls where session_id=p_session_id;
  if found then return jsonb_build_object('dispatch',false,'status',c.dispatch_status,'session_id',s.id); end if;
  if s.status not in ('created','live') or s.created_at < now()-interval '2 minutes'
      or not exists(select from public.voice_staff where id=p_staff_id and enabled and placetel_target_id is not null)
    then raise exception 'placetel_session_unavailable'; end if;
  insert into public.voice_placetel_calls(session_id,staff_id,phone,source_phone)
    values(s.id,p_staff_id,p_phone,s.context_snapshot->>'placetel_source_phone') returning * into c;
  return jsonb_build_object('dispatch',true,'dispatch_key',c.dispatch_key,'session_id',s.id,'status',c.dispatch_status);
end $$;

create function public.claim_voice_placetel_dial(p_dispatch_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype; st public.voice_staff%rowtype;
begin
  select c0.* into c from public.voice_placetel_calls c0 join public.voice_call_sessions s on s.id=c0.session_id
    where c0.dispatch_key=p_dispatch_key and c0.dispatch_status='reserved' and c0.reserved_at>now()-interval '90 seconds'
      and s.consent_status='confirmed' and s.transcript_storage_enabled and s.status in ('created','live') for update of c0,s;
  if not found then return jsonb_build_object('dispatch',false); end if;
  select * into st from public.voice_staff where id=c.staff_id and enabled and placetel_target_id is not null for share;
  if not found then return jsonb_build_object('dispatch',false); end if;
  update public.voice_placetel_calls set dispatch_status='dispatched',dialed_at=now(),next_check=now()+interval '3 minutes'
    where session_id=c.session_id;
  return jsonb_build_object('dispatch',true,'session_id',c.session_id,'phone',c.phone,'target_id',st.placetel_target_id,
    'employee_id',st.placetel_employee_id,'extension',st.extension);
end $$;

create function public.finish_voice_placetel_dial(p_session_id uuid,p_outcome text,p_provider_id text default null,p_source_phone text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype;
begin
  if p_outcome is null or p_outcome not in ('accepted','uncertain','rejected') then raise exception 'placetel_invalid_outcome'; end if;
  select * into strict c from public.voice_placetel_calls where session_id=p_session_id for update;
  if c.dispatch_status=p_outcome then return jsonb_build_object('status',p_outcome); end if;
  if c.dispatch_status<>'dispatched' then raise exception 'placetel_dispatch_conflict'; end if;
  if c.source_phone is not null and p_source_phone is not null and c.source_phone<>p_source_phone then raise exception 'placetel_source_conflict'; end if;
  update public.voice_placetel_calls set dispatch_status=p_outcome,provider_id=p_provider_id,source_phone=coalesce(p_source_phone,source_phone)
    where session_id=c.session_id;
  if p_outcome='rejected' then
    update public.voice_call_sessions set status='failed',ended_at=now(),updated_at=now(),capture_status='interrupted' where id=c.session_id;
  end if;
  return jsonb_build_object('status',p_outcome);
end $$;

create function public.claim_voice_placetel_recording()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype;
begin
  select q.* into c from public.voice_placetel_calls q join public.voice_call_sessions s on s.id=q.session_id
    where q.dispatch_status in ('dispatched','accepted','uncertain') and q.recording_status in ('pending','failed','missing')
      and q.next_check<=now() and (q.lease_until is null or q.lease_until<=now())
      and s.consent_status='confirmed' and s.transcript_storage_enabled and s.mode<>'internal_test' and s.bound_request_id is not null
      and s.status in ('created','live','completed')
    order by q.next_check,q.session_id limit 1 for update of q skip locked;
  if not found then return null; end if;
  update public.voice_placetel_calls set lease_id=gen_random_uuid(),lease_until=now()+interval '20 minutes'
    where session_id=c.session_id returning * into c;
  return jsonb_build_object('session_id',c.session_id,'phone',c.phone,'dialed_at',c.dialed_at,'lease_id',c.lease_id,
    'source_phone',c.source_phone,'provider_id',c.provider_id);
end $$;

create function public.finish_voice_placetel_recording(p_session_id uuid,p_lease_id uuid,p_outcome text,
    p_recording jsonb default null,p_segments jsonb default null,p_summary text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype; s public.voice_call_sessions%rowtype;
  recording_time timestamptz; duration_seconds integer; recording_start timestamptz; completed boolean;
  speakers text[]; outcome text:=p_outcome;
begin
  select * into strict c from public.voice_placetel_calls where session_id=p_session_id for update;
  if c.lease_id is null or c.lease_id is distinct from p_lease_id then raise exception 'placetel_lease_invalid'; end if;
  if c.lease_until is null then return jsonb_build_object('status',c.recording_status,'notify',false); end if;
  if c.lease_until<=now() then raise exception 'placetel_lease_expired'; end if;
  select * into strict s from public.voice_call_sessions where id=c.session_id for update;
  if s.consent_status<>'confirmed' or not s.transcript_storage_enabled or s.bound_request_id is null or s.mode='internal_test'
      or s.status not in ('created','live','completed') or c.dispatch_status not in ('dispatched','uncertain','accepted')
    then raise exception 'placetel_session_ineligible'; end if;
  if outcome is null or outcome not in ('complete','single_speaker','missing','failed','ambiguous') then raise exception 'placetel_invalid_outcome'; end if;
  if outcome in ('complete','single_speaker') then
    recording_time:=(p_recording->>'time')::timestamptz;
    duration_seconds:=(p_recording->>'duration')::integer;
    recording_start:=recording_time;
    if nullif(trim(p_recording->>'id'),'') is null or p_recording->>'direction' is distinct from 'out'
        or p_recording->>'to' is distinct from c.phone or nullif(p_recording->>'from','') is null
        or (c.source_phone is not null and p_recording->>'from' is distinct from c.source_phone)
        or (p_recording->>'call_id' is not null and c.provider_id is not null and p_recording->>'call_id'<>c.provider_id)
        or (c.source_phone is null and (c.provider_id is null or p_recording->>'call_id' is distinct from c.provider_id))
        or recording_start is null or recording_start not between c.dialed_at-interval '5 seconds' and c.dialed_at+interval '120 seconds'
        or duration_seconds is null or duration_seconds not between 1 and 86400
        or recording_start+make_interval(secs=>duration_seconds)>now()+interval '5 seconds'
      then raise exception 'placetel_recording_mismatch'; end if;
    -- Even an accepted number/time pair cannot distinguish two OPS calls in the same window.
    if exists(select from public.voice_placetel_calls q where q.session_id<>c.session_id and q.phone=c.phone
          and q.dispatch_status<>'rejected' and recording_start between q.dialed_at-interval '5 seconds' and q.dialed_at+interval '120 seconds'
          and (q.source_phone is null or q.source_phone=p_recording->>'from')
          and (p_recording->>'call_id' is null or q.provider_id is null or q.provider_id=p_recording->>'call_id'))
        or exists(select from public.voice_placetel_calls q where q.session_id<>c.session_id and q.recording_id=p_recording->>'id')
      then outcome:='ambiguous';
    else
      if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) not between 1 and 10000
          or length(trim(coalesce(p_summary,''))) not between 1 and 16000 then raise exception 'placetel_transcript_invalid'; end if;
      select array_agg(distinct x->>'speaker' order by x->>'speaker') into speakers from jsonb_array_elements(p_segments) x;
      completed:=outcome='complete';
      if (completed and speakers not in (array['customer','operator'],array['speaker_1','speaker_2']))
          or (not completed and speakers not in (array['speaker_1'],array['customer'],array['operator']))
          or exists(select from jsonb_array_elements(p_segments) x where nullif(trim(x->>'text'),'') is null
             or x->>'startMs' is null or x->>'endMs' is null or (x->>'endMs')::integer > duration_seconds*1000+1000)
          or exists(select from public.voice_transcript_segments where session_id=s.id)
        then raise exception 'placetel_transcript_invalid'; end if;
      insert into public.voice_transcript_segments(session_id,source_item_id,speaker,text,revision,is_final,start_ms,end_ms)
        select s.id,'placetel:'||lpad(ordinality::text,6,'0'),x->>'speaker',x->>'text',1,true,(x->>'startMs')::integer,(x->>'endMs')::integer
        from jsonb_array_elements(p_segments) with ordinality a(x,ordinality);
      update public.voice_call_sessions set started_at=recording_start,ended_at=recording_start+make_interval(secs=>duration_seconds),
        updated_at=now(),status='completed',capture_status=case when completed then 'complete' else 'interrupted' end,
        summary=trim(p_summary),summary_source='placetel_recording',summary_updated_at=now() where id=s.id;
      update public.voice_placetel_calls set recording_id=p_recording->>'id' where session_id=c.session_id;
    end if;
  end if;
  if outcome in ('missing','failed') and c.dialed_at<now()-interval '24 hours' then outcome:='expired'; end if;
  if outcome in ('ambiguous','expired') then
    update public.voice_call_sessions set capture_status='interrupted',updated_at=now() where id=s.id;
  end if;
  update public.voice_placetel_calls set recording_status=outcome,failure_reported=failure_reported or outcome='failed',lease_until=null,next_check=now()+
    case when outcome='failed' then interval '15 minutes' else interval '5 minutes' end where session_id=c.session_id;
  return jsonb_build_object('status',outcome,'notify',outcome in ('ambiguous','expired','single_speaker') or (outcome='failed' and not c.failure_reported));
end $$;

revoke all on function public.reserve_voice_placetel_dial(uuid,text,text,uuid),public.claim_voice_placetel_dial(uuid),
  public.finish_voice_placetel_dial(uuid,text,text,text),public.claim_voice_placetel_recording(),
  public.finish_voice_placetel_recording(uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_voice_placetel_dial(uuid,text,text,uuid),public.claim_voice_placetel_dial(uuid),
  public.finish_voice_placetel_dial(uuid,text,text,text),public.claim_voice_placetel_recording(),
  public.finish_voice_placetel_recording(uuid,uuid,text,jsonb,jsonb,text) to service_role;
commit;
