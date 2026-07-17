update public.email_locks
set status = 'failed_final',
    attempt_count = least(5, attempt_count + 1),
    lease_until = null,
    next_retry_at = null,
    last_error = 'Retry source message unavailable before immutable identity lookup',
    updated_at = now()
where status = 'failed_retryable'
  and draft_id is null
  and last_error = 'Retry requeued for immutable internet-message-id lookup';
