with reconciled as (
  update public.email_locks as lock
  set status = 'draft_created',
      lease_until = null,
      next_retry_at = null,
      last_error = null,
      updated_at = now()
  where lock.status = 'failed_final'
    and lock.draft_id is not null
    and exists (
      select 1
      from public.email_agent_retry_events as retry_event
      where retry_event.request_id = lock.request_id
        and retry_event.event_type = 'failed_final'
        and retry_event.reason = 'source_message_unavailable_http_404'
        and retry_event.occurred_at >= timestamp with time zone '2026-07-17 09:40:00+00'
        and retry_event.occurred_at < timestamp with time zone '2026-07-17 09:45:00+00'
    )
  returning lock.request_id, lock.message_id, lock.attempt_count
)
insert into public.email_agent_retry_events (
  request_id,
  message_id,
  event_type,
  attempt_count,
  reason
)
select request_id,
       message_id,
       'suppressed_existing_draft',
       greatest(attempt_count, 1),
       'known_outlook_draft_reconciled'
from reconciled;
