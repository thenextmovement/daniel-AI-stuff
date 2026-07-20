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
  (public.enqueue_email_agent_open_inbox_candidate(
    'backfill-message-1',
    '<backfill-internet-1>',
    'backfill-conversation-1',
    'backfill-worker-1'
  )->>'enqueued')::boolean,
  'first open-inbox candidate must be queued'
);

select pg_temp.assert_true(
  (
    select status = 'failed_retryable'
      and attempt_count = 0
      and next_retry_at <= now()
      and last_error = 'open_inbox_backfill_candidate'
      and draft_id is null
    from public.email_locks
    where request_id = 'ai-email-v2:<backfill-internet-1>'
  ),
  'queued candidate must enter the bounded retry worker without a draft or send action'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.email_agent_retry_events
    where request_id = 'ai-email-v2:<backfill-internet-1>'
      and event_type = 'backfill_enqueued'
      and attempt_count = 0
      and reason = 'open_inbox_unanswered_candidate_human_review_draft_only'
  ),
  'backfill enqueue must be audited without customer content'
);

select pg_temp.assert_true(
  not (public.enqueue_email_agent_open_inbox_candidate(
    'backfill-message-1',
    '<backfill-internet-1>',
    'backfill-conversation-1',
    'backfill-worker-2'
  )->>'enqueued')::boolean,
  'replay must be idempotent'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.email_agent_retry_events
    where request_id = 'ai-email-v2:<backfill-internet-1>'
      and event_type = 'backfill_enqueued'
  ),
  'idempotent replay must not duplicate the audit event'
);

do $$
begin
  set local role anon;
  begin
    perform public.enqueue_email_agent_open_inbox_candidate('x', '<x>', 'c', 'worker');
    raise exception 'anon unexpectedly enqueued open-inbox work';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_email_agent_open_inbox_candidate(text,text,text,text)',
    'execute'
  ),
  'authenticated users must not enqueue backfill work'
);

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.enqueue_email_agent_open_inbox_candidate(text,text,text,text)',
    'execute'
  ),
  'service role must be able to enqueue backfill work'
);

select 'email open-inbox backfill database tests passed' as result;
