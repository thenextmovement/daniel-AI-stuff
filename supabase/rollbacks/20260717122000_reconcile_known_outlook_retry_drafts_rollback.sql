delete from public.email_agent_retry_events
where event_type = 'suppressed_existing_draft'
  and reason = 'known_outlook_draft_reconciled';

update public.email_locks as lock
set status = 'failed_final',
    last_error = 'source_message_unavailable_http_404',
    updated_at = now()
where lock.status = 'draft_created'
  and lock.draft_id is not null
  and exists (
    select 1
    from public.email_agent_retry_events as retry_event
    where retry_event.request_id = lock.request_id
      and retry_event.event_type = 'failed_final'
      and retry_event.reason = 'source_message_unavailable_http_404'
      and retry_event.occurred_at >= timestamp with time zone '2026-07-17 09:40:00+00'
      and retry_event.occurred_at < timestamp with time zone '2026-07-17 09:45:00+00'
  );
