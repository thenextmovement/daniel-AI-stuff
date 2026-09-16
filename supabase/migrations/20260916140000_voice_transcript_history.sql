begin;
alter table public.voice_call_sessions
 add column if not exists transcript_write_token_hash text,
 add column if not exists attempt_id uuid references public.voice_call_attempts(id),
 add column if not exists capture_status text not null default 'not_started',
 add column if not exists summary text,
 add column if not exists summary_source text,
 add column if not exists summary_updated_at timestamptz;
create unique index if not exists voice_call_sessions_attempt_idx on public.voice_call_sessions(attempt_id) where attempt_id is not null;
alter table public.voice_call_sessions add constraint voice_capture_status_check check(capture_status in ('not_started','capturing','complete','interrupted'));
create table public.voice_transcript_segments (
 session_id uuid not null references public.voice_call_sessions(id) on delete cascade,
 source_item_id text not null check(char_length(source_item_id) between 1 and 240),
 speaker text not null check(speaker in ('customer','operator','assistant')),
 text text not null check(char_length(text) between 1 and 16000),
 revision integer not null check(revision between 1 and 1000000),
 is_final boolean not null,
 start_ms integer not null check(start_ms between 0 and 86400000),
 end_ms integer check(end_ms between start_ms and 86400000),
 received_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(session_id,source_item_id)
);
create index voice_transcript_segments_order_idx on public.voice_transcript_segments(session_id,start_ms,source_item_id);
alter table public.voice_transcript_segments enable row level security;
revoke all on public.voice_transcript_segments from public,anon,authenticated;
grant select,insert,update,delete on public.voice_transcript_segments to service_role;
create policy voice_transcript_segments_service on public.voice_transcript_segments for all to service_role using(true) with check(true);

create function public.persist_voice_transcript(p_session_id uuid,p_token_hash text,p_segments jsonb,p_finish text default null)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.voice_call_sessions%rowtype; item jsonb; previous public.voice_transcript_segments%rowtype;
begin
 select * into s from public.voice_call_sessions where id=p_session_id for update;
 if not found or s.transcript_write_token_hash is null or s.transcript_write_token_hash is distinct from p_token_hash then raise exception 'transcript_session_forbidden'; end if;
 if not s.transcript_storage_enabled or s.consent_status<>'confirmed' then raise exception 'transcript_consent_required'; end if;
 if s.status not in ('live','completed','cancelled','failed') or (s.ended_at is not null and s.ended_at<now()-interval '5 minutes') then raise exception 'transcript_session_closed'; end if;
 if p_segments is null or jsonb_typeof(p_segments)<>'array' or jsonb_array_length(p_segments)>50 then raise exception 'invalid_transcript_batch'; end if;
 if p_finish is not null and p_finish not in ('complete','interrupted') then raise exception 'invalid_transcript_finish'; end if;
 for item in select value from jsonb_array_elements(p_segments) loop
  select * into previous from public.voice_transcript_segments where session_id=p_session_id and source_item_id=item->>'id';
  if found then
   if previous.speaker<>item->>'speaker' or previous.start_ms<>(item->>'startMs')::integer then raise exception 'transcript_binding_mismatch'; end if;
   if previous.revision=(item->>'revision')::integer and (previous.text<>item->>'text' or previous.is_final<>(item->>'final')::boolean or previous.end_ms is distinct from (item->>'endMs')::integer) then raise exception 'transcript_revision_conflict'; end if;
   if previous.revision>=(item->>'revision')::integer then continue; end if;
   if previous.is_final then raise exception 'transcript_already_final'; end if;
  end if;
  insert into public.voice_transcript_segments(session_id,source_item_id,speaker,text,revision,is_final,start_ms,end_ms)
   values(p_session_id,item->>'id',item->>'speaker',item->>'text',(item->>'revision')::integer,(item->>'final')::boolean,(item->>'startMs')::integer,(item->>'endMs')::integer)
   on conflict(session_id,source_item_id) do update set text=excluded.text,revision=excluded.revision,is_final=excluded.is_final,end_ms=excluded.end_ms,updated_at=now();
 end loop;
 update public.voice_call_sessions set capture_status=case
  when p_finish='interrupted' then 'interrupted'
  when p_finish='complete' and not exists(select 1 from public.voice_transcript_segments where session_id=p_session_id and not is_final) then 'complete'
  when p_finish='complete' then 'interrupted'
  when capture_status in ('complete','interrupted') then capture_status else 'capturing' end where id=p_session_id;
 return jsonb_build_object('saved',true,'captureStatus',(select capture_status from public.voice_call_sessions where id=p_session_id));
end $$;
revoke all on function public.persist_voice_transcript(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_voice_transcript(uuid,text,jsonb,text) to service_role;
comment on table public.voice_transcript_segments is 'Telephone transcript evidence, never approved company policy. Date and customer binding come from voice_call_sessions. Exclude internal tests from customer history.';
commit;
