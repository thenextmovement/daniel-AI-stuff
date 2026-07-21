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
  safe_request_id text := nullif(btrim(p_request_id), '');
  safe_message_id text := nullif(btrim(p_message_id), '');
  safe_internet_message_id text := nullif(btrim(p_internet_message_id), '');
  safe_conversation_id text := nullif(btrim(p_conversation_id), '');
  current_lock public.email_locks%rowtype;
  lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 1800);
  inserted boolean := false;
  identity_conflict boolean := false;
begin
  if safe_request_id is null or safe_message_id is null then
    raise exception 'request_id and message_id are required';
  end if;
  if length(safe_request_id) > 2400
     or length(safe_message_id) > 2000
     or length(coalesce(safe_internet_message_id, '')) > 1000
     or length(coalesce(safe_conversation_id, '')) > 2000 then
    raise exception 'Email-agent lock identity exceeds safe length';
  end if;

  select lock.*
    into current_lock
  from public.email_locks as lock
  where lock.request_id = safe_request_id
     or (
       safe_internet_message_id is not null
       and lock.internet_message_id = safe_internet_message_id
     )
  order by case when lock.request_id = safe_request_id then 0 else 1 end
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
      safe_request_id,
      safe_message_id,
      safe_internet_message_id,
      safe_conversation_id,
      'processing',
      1,
      now(),
      now() + make_interval(secs => lease_seconds),
      now()
    )
    on conflict do nothing
    returning * into current_lock;

    inserted := found;

    if not inserted then
      select lock.*
        into current_lock
      from public.email_locks as lock
      where lock.request_id = safe_request_id
         or (
           safe_internet_message_id is not null
           and lock.internet_message_id = safe_internet_message_id
         )
      order by case when lock.request_id = safe_request_id then 0 else 1 end
      limit 1
      for update;

      if not found then
        raise exception 'Concurrent email-agent identity conflict could not be resolved';
      end if;
    end if;
  end if;

  if inserted then
    return jsonb_build_object(
      'claimed', true,
      'reason', 'new',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  select exists (
    select 1
    from public.email_locks as other_lock
    where other_lock.request_id <> current_lock.request_id
      and (
        other_lock.request_id = safe_request_id
        or (
          safe_internet_message_id is not null
          and other_lock.internet_message_id = safe_internet_message_id
        )
      )
  ) into identity_conflict;

  if identity_conflict then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'identity_conflict',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  if current_lock.status = 'draft_created' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'draft_already_created',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  if current_lock.status = 'failed_final' or current_lock.attempt_count >= 5 then
    if current_lock.status <> 'failed_final' then
      update public.email_locks
      set status = 'failed_final', updated_at = now()
      where request_id = current_lock.request_id;
    end if;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'attempt_limit',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  if current_lock.status = 'processing'
     and current_lock.lease_until is not null
     and current_lock.lease_until > now() then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'active_lease',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  if current_lock.status = 'failed_retryable'
     and current_lock.next_retry_at is not null
     and current_lock.next_retry_at > now() then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'retry_not_due',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id,
      'automatic_send_allowed', false,
      'human_approval_required', true
    );
  end if;

  begin
    update public.email_locks
    set request_id = safe_request_id,
        message_id = safe_message_id,
        internet_message_id = coalesce(safe_internet_message_id, internet_message_id),
        conversation_id = coalesce(safe_conversation_id, conversation_id),
        status = 'processing',
        attempt_count = attempt_count + 1,
        locked_at = now(),
        lease_until = now() + make_interval(secs => lease_seconds),
        next_retry_at = null,
        last_error = null,
        updated_at = now()
    where request_id = current_lock.request_id
    returning * into current_lock;
  exception
    when unique_violation then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'identity_conflict',
        'attempt_count', current_lock.attempt_count,
        'request_id', current_lock.request_id,
        'automatic_send_allowed', false,
        'human_approval_required', true
      );
  end;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'retry',
    'attempt_count', current_lock.attempt_count,
    'request_id', current_lock.request_id,
    'automatic_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

revoke all on function public.claim_email_agent_message(text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_agent_message(text, text, text, text, integer)
  to service_role;

comment on function public.claim_email_agent_message(text, text, text, text, integer) is
  'Atomically claims an email by request or immutable internet-message identity, resolves concurrent uniqueness races, and never authorizes automatic sending.';
