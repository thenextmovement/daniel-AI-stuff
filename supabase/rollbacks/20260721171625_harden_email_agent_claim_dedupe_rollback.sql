create or replace function public.claim_email_agent_message(
  p_request_id text,
  p_message_id text,
  p_internet_message_id text,
  p_conversation_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_lock public.email_locks%rowtype;
  lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 1800);
begin
  if nullif(btrim(p_request_id), '') is null or nullif(btrim(p_message_id), '') is null then
    raise exception 'request_id and message_id are required';
  end if;

  select *
    into current_lock
  from public.email_locks
  where request_id = p_request_id
     or (
       nullif(btrim(p_internet_message_id), '') is not null
       and internet_message_id = btrim(p_internet_message_id)
     )
  order by case when request_id = p_request_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    insert into public.email_locks (
      request_id,
      message_id,
      internet_message_id,
      conversation_id,
      status,
      attempt_count,
      locked_at,
      lease_until,
      updated_at
    ) values (
      btrim(p_request_id),
      btrim(p_message_id),
      nullif(btrim(p_internet_message_id), ''),
      nullif(btrim(p_conversation_id), ''),
      'processing',
      1,
      now(),
      now() + make_interval(secs => lease_seconds),
      now()
    )
    returning * into current_lock;

    return jsonb_build_object(
      'claimed', true,
      'reason', 'new',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id
    );
  end if;

  if current_lock.status = 'draft_created' then
    return jsonb_build_object('claimed', false, 'reason', 'draft_already_created', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'failed_final' or current_lock.attempt_count >= 5 then
    if current_lock.status <> 'failed_final' then
      update public.email_locks
      set status = 'failed_final', updated_at = now()
      where request_id = current_lock.request_id;
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'attempt_limit', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'processing' and current_lock.lease_until is not null and current_lock.lease_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'active_lease', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'failed_retryable' and current_lock.next_retry_at is not null and current_lock.next_retry_at > now() then
    return jsonb_build_object('claimed', false, 'reason', 'retry_not_due', 'attempt_count', current_lock.attempt_count);
  end if;

  update public.email_locks
  set request_id = btrim(p_request_id),
      message_id = btrim(p_message_id),
      internet_message_id = coalesce(nullif(btrim(p_internet_message_id), ''), internet_message_id),
      conversation_id = coalesce(nullif(btrim(p_conversation_id), ''), conversation_id),
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      lease_until = now() + make_interval(secs => lease_seconds),
      next_retry_at = null,
      last_error = null,
      updated_at = now()
  where request_id = current_lock.request_id
  returning * into current_lock;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'retry',
    'attempt_count', current_lock.attempt_count,
    'request_id', current_lock.request_id
  );
end;
$$;

revoke all on function public.claim_email_agent_message(text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_agent_message(text, text, text, text, integer)
  to service_role;
