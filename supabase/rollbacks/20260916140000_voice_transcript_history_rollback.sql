-- Disable capture and preserve authorized transcript exports before destructive rollback.
begin;
drop function if exists public.persist_voice_transcript(uuid,text,jsonb,text);
drop table if exists public.voice_transcript_segments;
alter table public.voice_call_sessions drop constraint if exists voice_capture_status_check,
 drop column if exists transcript_write_token_hash,drop column if exists attempt_id,drop column if exists capture_status,
 drop column if exists summary,drop column if exists summary_source,drop column if exists summary_updated_at;
commit;
