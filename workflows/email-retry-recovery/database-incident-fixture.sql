insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, draft_id, last_error
) values
  (
    'incident-moved-source', 'old-graph-id', '<moved-source>', 'moved-conversation',
    'failed_final', 2, null, 'source_message_unavailable_http_404'
  ),
  (
    'incident-known-draft', 'old-graph-id-with-draft', '<known-draft>', 'draft-conversation',
    'failed_final', 2, 'existing-outlook-draft', 'source_message_unavailable_http_404'
  );
insert into public.email_agent_retry_events (
  request_id, message_id, event_type, attempt_count, worker_execution_id,
  reason, occurred_at
) values
  (
    'incident-moved-source', 'old-graph-id', 'failed_final', 2, 'fixture-worker-moved',
    'source_message_unavailable_http_404', timestamp with time zone '2026-07-17 09:42:00+00'
  ),
  (
    'incident-known-draft', 'old-graph-id-with-draft', 'failed_final', 2, 'fixture-worker-draft',
    'source_message_unavailable_http_404', timestamp with time zone '2026-07-17 09:43:00+00'
  );
