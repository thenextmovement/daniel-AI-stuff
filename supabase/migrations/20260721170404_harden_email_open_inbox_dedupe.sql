
create or replace function public.enqueue_email_agent_open_inbox_candidate(
  p_message_id text,
  p_internet_message_id text,
  p_conversation_id text,
  p_worker_execution_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_message_id text := nullif(btrim(p_message_id), '');
  safe_internet_message_id text := nullif(btrim(p_internet_message_id), '');
  safe_conversation_id text := nullif(btrim(p_conversation_id), '');
  safe_worker_execution_id text := left(nullif(btrim(p_worker_execution_id), ''), 240);
  v_request_id text;
  existing_request_id text;
  existing_status text;
  inserted boolean := false;
begin
  if safe_message_id is null then
    raise exception 'Open-inbox backfill requires message_id';
  end if;
  if safe_conversation_id is null then
    raise exception 'Open-inbox backfill requires conversation_id';
  end if;
  if length(safe_message_id) > 2000
     or length(coalesce(safe_internet_message_id, '')) > 1000
     or length(safe_conversation_id) > 2000 then
    raise exception 'Open-inbox backfill identity exceeds safe length';
  end if;

  v_request_id := 'ai-email-v2:' || coalesce(safe_internet_message_id, safe_message_id);

  select lock.request_id, lock.status
    into existing_request_id, existing_status
  from public.email_locks as lock
  where lock.request_id = v_request_id
     or (
       safe_internet_message_id is not null
       and lock.internet_message_id = safe_internet_message_id
     )
  order by case when lock.request_id = v_request_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    insert into public.email_locks (
      request_id,
      locked_at,
      message_id,
      internet_message_id,
      conversation_id,
      status,
      attempt_count,
      lease_until,
      next_retry_at,
      last_error,
      draft_id,
      updated_at
    ) values (
      v_request_id,
      now(),
      safe_message_id,
      safe_internet_message_id,
      safe_conversation_id,
      'failed_retryable',
      0,
      null,
      now(),
      'open_inbox_backfill_candidate',
      null,
      now()
    )
    on conflict do nothing
    returning request_id, status
      into existing_request_id, existing_status;

    inserted := found;

    if not inserted then
      select lock.request_id, lock.status
        into existing_request_id, existing_status
      from public.email_locks as lock
      where lock.request_id = v_request_id
         or (
           safe_internet_message_id is not null
           and lock.internet_message_id = safe_internet_message_id
         )
      order by case when lock.request_id = v_request_id then 0 else 1 end
      limit 1;
    end if;
  end if;

  if inserted then
    insert into public.email_agent_retry_events (
      request_id,
      message_id,
      event_type,
      attempt_count,
      worker_execution_id,
      reason
    ) values (
      existing_request_id,
      safe_message_id,
      'backfill_enqueued',
      0,
      safe_worker_execution_id,
      'open_inbox_unanswered_candidate_human_review_draft_only'
    );
  end if;

  return jsonb_build_object(
    'enqueued', inserted,
    'reason', case when inserted then 'queued_for_draft_review' else 'already_known' end,
    'existing_status', existing_status,
    'request_id', coalesce(existing_request_id, v_request_id),
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

revoke all on function public.enqueue_email_agent_open_inbox_candidate(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_email_agent_open_inbox_candidate(text, text, text, text)
  to service_role;
