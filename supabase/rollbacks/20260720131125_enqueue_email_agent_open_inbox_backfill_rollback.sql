drop function if exists public.enqueue_email_agent_open_inbox_candidate(text, text, text, text);

delete from public.email_locks
where status = 'failed_retryable'
  and attempt_count = 0
  and draft_id is null
  and last_error = 'open_inbox_backfill_candidate';

delete from public.email_agent_retry_events
where event_type = 'backfill_enqueued';

alter table public.email_agent_retry_events
  drop constraint if exists email_agent_retry_events_event_type_check;

alter table public.email_agent_retry_events
  add constraint email_agent_retry_events_event_type_check check (
    event_type in (
      'claimed',
      'recovered',
      'suppressed_existing_draft',
      'failed_retryable',
      'failed_final'
    )
  );

alter table public.email_agent_retry_events
  drop constraint if exists email_agent_retry_events_attempt_count_check;

alter table public.email_agent_retry_events
  add constraint email_agent_retry_events_attempt_count_check check (
    attempt_count >= 1 and attempt_count <= 20
  );
