create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

select pg_temp.assert_true(
  (
    select status = 'failed_retryable'
      and attempt_count = 1
      and last_error = 'Retry requeued for immutable internet-message-id lookup'
    from public.email_locks
    where request_id = 'incident-moved-source'
  ),
  'moved Outlook source incident must be requeued for immutable identity lookup'
);
select pg_temp.assert_true(
  (
    select status = 'draft_created'
      and draft_id = 'existing-outlook-draft'
      and last_error is null
    from public.email_locks
    where request_id = 'incident-known-draft'
  ),
  'known Outlook draft incident must reconcile without another draft'
);
select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.email_agent_retry_events
    where request_id = 'incident-known-draft'
      and event_type = 'suppressed_existing_draft'
      and reason = 'known_outlook_draft_reconciled'
  ),
  'known Outlook draft reconciliation must be audited'
);

delete from public.email_agent_retry_events
where request_id in ('incident-moved-source', 'incident-known-draft');
delete from public.email_locks
where request_id in ('incident-moved-source', 'incident-known-draft');

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, next_retry_at
) values (
  'retry-1', 'message-1', '<internet-1>', 'conversation-1',
  'failed_retryable', 1, now() - interval '1 minute'
);

select pg_temp.assert_true(
  (public.claim_due_email_agent_retry('worker-1', 900)->>'claimed')::boolean,
  'due retry must be claimed'
);
select pg_temp.assert_true(
  (select status = 'processing' and attempt_count = 2 from public.email_locks where request_id = 'retry-1'),
  'claim must increment attempt and establish processing state'
);
select pg_temp.assert_true(
  public.claim_due_email_agent_retry('worker-2', 900)->>'reason' = 'retry_worker_busy',
  'only one retry worker may be active'
);

select public.finalize_email_agent_retry_without_new_draft(
  'retry-1',
  'existing_reply_draft',
  'outlook-draft-1',
  'worker-1'
);
select pg_temp.assert_true(
  (select status = 'draft_created' and draft_id = 'outlook-draft-1' from public.email_locks where request_id = 'retry-1'),
  'existing Outlook draft must suppress duplicate creation'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.email_agent_retry_events where request_id = 'retry-1' and event_type = 'suppressed_existing_draft'),
  'existing draft suppression must be audited'
);

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, next_retry_at
) values (
  'retry-2', 'message-2', '<internet-2>', 'conversation-2',
  'failed_retryable', 1, now() - interval '1 minute'
);

select public.claim_due_email_agent_retry('worker-2', 900);
select public.fail_email_agent_message(
  'retry-2',
  jsonb_build_object(
    'message_id', 'message-2',
    'conversation_id', 'conversation-2',
    'from_email', 'customer@example.org',
    'draft_created', false,
    'order_found', false,
    'order_count', 0,
    'error_message', 'temporary timeout',
    'context_snapshot', jsonb_build_object(
      'retry_recovery',
      jsonb_build_object('worker_execution_id', 'worker-2')
    )
  ),
  true
);
select pg_temp.assert_true(
  (select status = 'failed_retryable' and next_retry_at > now() from public.email_locks where request_id = 'retry-2'),
  'transient failure must be rescheduled'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.email_agent_retry_events where request_id = 'retry-2' and event_type = 'failed_retryable'),
  'transient retry failure must be audited'
);

update public.email_locks
set status = 'processing',
    attempt_count = 1,
    lease_until = now() - interval '1 minute',
    next_retry_at = null
where request_id = 'retry-2';
select pg_temp.assert_true(
  (public.claim_due_email_agent_retry('worker-stale', 900)->>'claimed')::boolean,
  'expired processing lease must be recoverable'
);
select public.finalize_email_agent_retry_without_new_draft(
  'retry-2',
  'source_message_unavailable_http_404',
  null,
  'worker-stale'
);
select pg_temp.assert_true(
  (select status = 'failed_final' from public.email_locks where request_id = 'retry-2'),
  'non-processable source must become a final failure'
);

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, lease_until
) values (
  'retry-draft-known', 'message-draft-known', '<internet-draft-known>', 'conversation-draft-known',
  'processing', 2, now() + interval '10 minutes'
);
select public.fail_email_agent_message(
  'retry-draft-known',
  jsonb_build_object(
    'message_id', 'message-draft-known',
    'conversation_id', 'conversation-draft-known',
    'from_email', 'customer@example.org',
    'draft_created', true,
    'draft_id', 'created-before-log-failure',
    'order_found', false,
    'order_count', 0,
    'error_message', 'database log failed after Outlook createReply',
    'context_snapshot', '{}'::jsonb
  ),
  true
);
select pg_temp.assert_true(
  (select status = 'draft_created' and draft_id = 'created-before-log-failure' from public.email_locks where request_id = 'retry-draft-known'),
  'known created draft must never be scheduled for duplicate creation'
);

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, lease_until
) values (
  'retry-complete', 'message-complete', '<internet-complete>', 'conversation-complete',
  'processing', 2, now() + interval '10 minutes'
);
select public.complete_email_agent_retry_message(
  'retry-complete',
  jsonb_build_object(
    'message_id', 'message-complete',
    'draft_id', 'new-human-review-draft',
    'context_snapshot', jsonb_build_object(
      'retry_recovery',
      jsonb_build_object('worker_execution_id', 'worker-complete')
    )
  )
);
select pg_temp.assert_true(
  (select status = 'draft_created' and draft_id = 'new-human-review-draft' from public.email_locks where request_id = 'retry-complete'),
  'successful retry must complete the original lock'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.email_agent_retry_events where request_id = 'retry-complete' and event_type = 'recovered'),
  'successful retry must be audited'
);

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, next_retry_at
) values (
  'ai-email-v2:AAMkLegacyGraphMessageId', null, null, null,
  'failed_retryable', 1, now() - interval '1 minute'
);
select pg_temp.assert_true(
  public.claim_due_email_agent_retry_v2('worker-legacy', 900)->>'message_id' = 'AAMkLegacyGraphMessageId',
  'v2 claim must recover a legacy Graph message id from the idempotency key'
);
select pg_temp.assert_true(
  (select message_id = 'AAMkLegacyGraphMessageId' from public.email_locks where request_id = 'ai-email-v2:AAMkLegacyGraphMessageId'),
  'recovered legacy Graph message id must be persisted'
);
select public.finalize_email_agent_retry_without_new_draft(
  'ai-email-v2:AAMkLegacyGraphMessageId',
  'source_message_unavailable_http_404',
  null,
  'worker-legacy'
);

insert into public.email_locks (
  request_id, message_id, internet_message_id, conversation_id,
  status, attempt_count, next_retry_at
) values (
  'ai-email-v2:<legacy-internet-message-id>', null, null, null,
  'failed_retryable', 1, now() - interval '1 minute'
);
select pg_temp.assert_true(
  public.claim_due_email_agent_retry_v2('worker-missing', 900)->>'reason' = 'missing_source_message_identity',
  'non-Graph legacy identity without message id must fail closed'
);
select pg_temp.assert_true(
  (select status = 'failed_final' from public.email_locks where request_id = 'ai-email-v2:<legacy-internet-message-id>'),
  'missing source identity must become final without an Outlook side effect'
);

insert into public.email_locks (
  request_id, message_id, status, attempt_count, next_retry_at
) values (
  'retry-limit', 'message-limit', 'failed_retryable', 5, now() - interval '1 minute'
);
select public.claim_due_email_agent_retry('worker-limit', 900);
select pg_temp.assert_true(
  (select status = 'failed_final' from public.email_locks where request_id = 'retry-limit'),
  'attempt limit must become final before another claim'
);

select pg_temp.assert_true(
  (public.get_email_agent_retry_health()->>'automatic_send_allowed')::boolean is false,
  'retry health must confirm automatic send is disabled'
);
select pg_temp.assert_true(
  (public.get_email_agent_retry_health()->>'human_approval_required')::boolean,
  'retry health must require human approval'
);

do $$
begin
  set local role anon;
  begin
    perform public.get_email_agent_retry_health();
    raise exception 'anon unexpectedly executed retry health';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  (select relrowsecurity from pg_class where oid = 'public.email_agent_retry_events'::regclass),
  'retry audit table must have row level security'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.claim_due_email_agent_retry(text,integer)', 'execute'),
  'anon must not claim retries'
);
select pg_temp.assert_true(
  has_function_privilege('service_role', 'public.claim_due_email_agent_retry(text,integer)', 'execute'),
  'service role must be able to claim retries'
);

select 'email retry database tests passed' as result;
