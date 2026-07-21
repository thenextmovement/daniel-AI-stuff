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

insert into public.email_locks (
  request_id,
  locked_at,
  message_id,
  internet_message_id,
  conversation_id,
  status,
  attempt_count,
  updated_at
) values (
  'ai-email-v1:legacy-request-id',
  now(),
  'legacy-message-id',
  '<backfill-internet-legacy>',
  'legacy-conversation-id',
  'draft_created',
  1,
  now()
);

select pg_temp.assert_true(
  not (public.enqueue_email_agent_open_inbox_candidate(
    'new-message-id-for-legacy-row',
    '<backfill-internet-legacy>',
    'new-conversation-id-for-legacy-row',
    'backfill-worker-legacy'
  )->>'enqueued')::boolean,
  'legacy internet-message collision must resolve as already known'
);

select pg_temp.assert_true(
  (
    public.enqueue_email_agent_open_inbox_candidate(
      'new-message-id-for-legacy-row',
      '<backfill-internet-legacy>',
      'new-conversation-id-for-legacy-row',
      'backfill-worker-legacy-replay'
    )->>'request_id'
  ) = 'ai-email-v1:legacy-request-id',
  'legacy collision must return the canonical existing request id'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.email_agent_retry_events
    where request_id = 'ai-email-v1:legacy-request-id'
      and event_type = 'backfill_enqueued'
  ),
  'legacy collision must not create a duplicate retry event'
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

select pg_temp.assert_true(
  (public.claim_email_agent_message(
    'ai-email-v2:<claim-internet-new>',
    'claim-message-new',
    '<claim-internet-new>',
    'claim-conversation-new',
    900
  )->>'claimed')::boolean,
  'first email claim must atomically create its lock'
);

select pg_temp.assert_true(
  public.claim_email_agent_message(
    'ai-email-v2:<claim-internet-new>',
    'claim-message-new',
    '<claim-internet-new>',
    'claim-conversation-new',
    900
  )->>'reason' = 'active_lease',
  'an active lease must suppress duplicate processing'
);

insert into public.email_locks (
  request_id,
  message_id,
  internet_message_id,
  conversation_id,
  status,
  attempt_count,
  next_retry_at,
  updated_at
) values (
  'legacy-raw-request-id',
  'legacy-claim-message',
  '<claim-internet-legacy>',
  'legacy-claim-conversation',
  'failed_retryable',
  1,
  now() - interval '1 minute',
  now()
);

select pg_temp.assert_true(
  (public.claim_email_agent_message(
    'ai-email-v2:<claim-internet-legacy>',
    'legacy-claim-message-current',
    '<claim-internet-legacy>',
    'legacy-claim-conversation-current',
    900
  )->>'claimed')::boolean,
  'a due legacy lock must be claimed by immutable internet-message identity'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
      and bool_and(request_id = 'ai-email-v2:<claim-internet-legacy>')
      and bool_and(attempt_count = 2)
    from public.email_locks
    where internet_message_id = '<claim-internet-legacy>'
  ),
  'legacy identity migration must preserve one lock and increment one attempt'
);

insert into public.email_locks (
  request_id,
  message_id,
  internet_message_id,
  conversation_id,
  status,
  attempt_count,
  next_retry_at,
  updated_at
) values
  (
    'ai-email-v2:claim-ambiguous-request',
    'claim-ambiguous-message-a',
    '<claim-ambiguous-internet-a>',
    'claim-ambiguous-conversation-a',
    'failed_retryable',
    1,
    now() - interval '1 minute',
    now()
  ),
  (
    'legacy-claim-ambiguous-request',
    'claim-ambiguous-message-b',
    '<claim-ambiguous-internet-b>',
    'claim-ambiguous-conversation-b',
    'failed_retryable',
    1,
    now() - interval '1 minute',
    now()
  );

select pg_temp.assert_true(
  public.claim_email_agent_message(
    'ai-email-v2:claim-ambiguous-request',
    'claim-ambiguous-message-new',
    '<claim-ambiguous-internet-b>',
    'claim-ambiguous-conversation-new',
    900
  )->>'reason' = 'identity_conflict',
  'ambiguous request and internet identities must fail closed'
);

select pg_temp.assert_true(
  (
    select count(*) = 2 and bool_and(attempt_count = 1)
    from public.email_locks
    where request_id in (
      'ai-email-v2:claim-ambiguous-request',
      'legacy-claim-ambiguous-request'
    )
  ),
  'identity conflict must not mutate either lock'
);

select pg_temp.assert_true(
  (public.claim_email_agent_message(
    'ai-email-v2:claim-safety-flags',
    'claim-safety-message',
    '<claim-safety-internet>',
    'claim-safety-conversation',
    900
  )->>'automatic_send_allowed')::boolean is false,
  'claim responses must never authorize automatic sending'
);

select pg_temp.assert_true(
  (public.claim_email_agent_message(
    'ai-email-v2:claim-safety-flags',
    'claim-safety-message',
    '<claim-safety-internet>',
    'claim-safety-conversation',
    900
  )->>'human_approval_required')::boolean,
  'claim responses must preserve mandatory human approval'
);

select 'email open-inbox backfill database tests passed' as result;
