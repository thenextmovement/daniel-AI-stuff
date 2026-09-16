begin;
alter table public.voice_call_targets
 add column call_brief text not null default '' check(char_length(call_brief)<=1200),
 add column context_request_id text,
 add column transcript_consent jsonb;
create function public.snapshot_voice_call_brief() returns trigger language plpgsql set search_path=public as $$
declare target public.voice_call_targets%rowtype;
begin
 select * into strict target from public.voice_call_targets where id=new.target_id;
 new.context_snapshot := new.context_snapshot || jsonb_build_object('call_brief',target.call_brief,'context_request_id',target.context_request_id,'transcript_consent',target.transcript_consent);
 return new;
end $$;
create trigger voice_attempt_snapshot_brief before insert on public.voice_call_attempts for each row execute function public.snapshot_voice_call_brief();
-- Register only. Provider access, audio tests and an explicit release are still required.
insert into public.voice_model_releases(release_key,model_id,voice,transport,session_config,capabilities,enabled,lifecycle,eval_status,release_notes)
values('gpt-live-1-sip-v1','gpt-live-1','marin','sip','{"protocol":"live","delegation_model":"gpt-5.6-terra"}',
'{"full_duplex":true,"transcript_events":true}',false,'available','pending','GPT-Live transport contract; requires project SIP enablement and end-to-end evaluation.')
on conflict(release_key) do nothing;
commit;
