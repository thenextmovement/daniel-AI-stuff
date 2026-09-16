begin;
drop trigger if exists voice_attempt_snapshot_brief on public.voice_call_attempts;
drop function if exists public.snapshot_voice_call_brief();
alter table public.voice_call_targets drop column if exists call_brief,drop column if exists context_request_id,drop column if exists transcript_consent;
-- Keep model release and any attempts as audit evidence; disable the release.
update public.voice_model_releases set enabled=false where release_key='gpt-live-1-sip-v1';
commit;
