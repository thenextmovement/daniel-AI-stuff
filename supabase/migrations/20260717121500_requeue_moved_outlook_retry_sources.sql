with affected_requests as (
  select distinct retry_event.request_id
  from public.email_agent_retry_events as retry_event
  join public.email_locks as lock
    on lock.request_id = retry_event.request_id
  where retry_event.event_type = 'failed_final'
    and retry_event.reason = 'source_message_unavailable_http_404'
    and retry_event.occurred_at >= timestamp with time zone '2026-07-17 09:40:00+00'
    and retry_event.occurred_at < timestamp with time zone '2026-07-17 09:45:00+00'
    and lock.status = 'failed_final'
    and lock.draft_id is null
)
update public.email_locks as lock
set status = 'failed_retryable',
    attempt_count = greatest(1, lock.attempt_count - 1),
    lease_until = null,
    next_retry_at = now(),
    last_error = 'Retry requeued for immutable internet-message-id lookup',
    updated_at = now()
from affected_requests
where lock.request_id = affected_requests.request_id;
