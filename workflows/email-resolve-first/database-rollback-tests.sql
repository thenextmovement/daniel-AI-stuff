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
  to_regprocedure('public.enqueue_email_agent_open_inbox_candidate(text,text,text,text)') is null,
  'rollback must remove the backfill enqueue RPC'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.email_locks
    where last_error = 'open_inbox_backfill_candidate'
      and status = 'failed_retryable'
      and attempt_count = 0
  ),
  'rollback must remove only still-unprocessed backfill queue rows'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.email_agent_retry_events
    where event_type = 'backfill_enqueued'
  ),
  'rollback must remove backfill-only retry events before restoring constraints'
);

select pg_temp.assert_true(
  (
    select pg_get_constraintdef(oid) not like '%backfill_enqueued%'
    from pg_constraint
    where conrelid = 'public.email_agent_retry_events'::regclass
      and conname = 'email_agent_retry_events_event_type_check'
  ),
  'rollback must restore the previous retry event type allowlist'
);

select pg_temp.assert_true(
  (
    select pg_get_constraintdef(oid) like '%attempt_count >= 1%'
    from pg_constraint
    where conrelid = 'public.email_agent_retry_events'::regclass
      and conname = 'email_agent_retry_events_attempt_count_check'
  ),
  'rollback must restore the previous positive retry attempt constraint'
);

select 'email open-inbox backfill rollback tests passed' as result;
