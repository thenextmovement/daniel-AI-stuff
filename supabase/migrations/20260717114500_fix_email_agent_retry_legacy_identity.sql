with incorrectly_finalized as (
  select distinct retry_event.request_id
  from public.email_agent_retry_events as retry_event
  join public.email_locks as lock
    on lock.request_id = retry_event.request_id
  where retry_event.event_type = 'failed_final'
    and retry_event.reason = 'source_message_unavailable_http_200'
    and lock.status = 'failed_final'
    and lock.draft_id is null
    and lock.message_id is null
    and lock.request_id like 'ai-email-v2:AAM%'
)
update public.email_locks as lock
set message_id = substr(lock.request_id, length('ai-email-v2:') + 1),
    status = 'failed_retryable',
    attempt_count = greatest(1, lock.attempt_count - 1),
    lease_until = null,
    next_retry_at = now(),
    last_error = 'Retry requeued after legacy message identity repair',
    updated_at = now()
from incorrectly_finalized
where lock.request_id = incorrectly_finalized.request_id;

update public.email_locks
set message_id = substr(request_id, length('ai-email-v2:') + 1),
    updated_at = now()
where message_id is null
  and request_id like 'ai-email-v2:AAM%';

create or replace function public.claim_due_email_agent_retry_v2(
  p_worker_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  v_request_id text;
  v_message_id text;
  v_attempt integer;
begin
  result := public.claim_due_email_agent_retry(
    p_worker_execution_id,
    p_lease_seconds
  );

  if coalesce((result->>'claimed')::boolean, false) is not true then
    return result || jsonb_build_object(
      'version', 'email-agent-retry-claim-v2',
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  v_request_id := nullif(result->>'request_id', '');
  v_message_id := nullif(result->>'message_id', '');
  v_attempt := greatest(coalesce((result->>'attempt_count')::integer, 1), 1);

  if v_message_id is null and v_request_id like 'ai-email-v2:AAM%' then
    v_message_id := substr(v_request_id, length('ai-email-v2:') + 1);

    update public.email_locks
    set message_id = v_message_id,
        updated_at = now()
    where email_locks.request_id = v_request_id;
  end if;

  if v_message_id is null then
    update public.email_locks
    set status = 'failed_final',
        lease_until = null,
        next_retry_at = null,
        last_error = 'Retry source message identity is unavailable',
        updated_at = now()
    where email_locks.request_id = v_request_id;

    insert into public.email_agent_retry_events (
      request_id,
      message_id,
      event_type,
      attempt_count,
      worker_execution_id,
      reason
    ) values (
      v_request_id,
      null,
      'failed_final',
      v_attempt,
      nullif(btrim(p_worker_execution_id), ''),
      'missing_source_message_identity'
    );

    return jsonb_build_object(
      'version', 'email-agent-retry-claim-v2',
      'claimed', false,
      'reason', 'missing_source_message_identity',
      'request_id', v_request_id,
      'attempt_count', v_attempt,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  return result
    || jsonb_build_object(
      'version', 'email-agent-retry-claim-v2',
      'message_id', v_message_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
end;
$$;

revoke all on function public.claim_due_email_agent_retry_v2(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_email_agent_retry_v2(text, integer)
  to service_role;

comment on function public.claim_due_email_agent_retry_v2(text, integer) is
  'Claims one retry and safely repairs legacy Graph message IDs stored only in the idempotency key.';
