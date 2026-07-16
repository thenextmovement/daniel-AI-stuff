create or replace function public.begin_email_agent_sent_sync_v1(
  p_mailbox_key text,
  p_execution_id text
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  mailbox_value text := lower(left(btrim(coalesce(p_mailbox_key, '')), 320));
  execution_value text := left(btrim(coalesce(p_execution_id, '')), 200);
  correlation_value text;
  claimed_state public.email_agent_mail_sync_state%rowtype;
  current_state public.email_agent_mail_sync_state%rowtype;
  skip_reason text;
begin
  if mailbox_value = '' or position('@' in mailbox_value) = 0 then
    raise exception 'valid mailbox_key is required';
  end if;
  if execution_value = '' then
    raise exception 'execution_id is required';
  end if;

  correlation_value := 'email-sent-delta:' || execution_value;

  insert into public.email_agent_mail_sync_state (mailbox_key)
  values (mailbox_value)
  on conflict (mailbox_key) do nothing;

  select *
  into current_state
  from public.email_agent_mail_sync_state
  where mailbox_key = mailbox_value;

  if current_state.lease_owner = execution_value
    and current_state.lease_until > now()
    and current_state.last_execution_id = execution_value
    and current_state.last_correlation_id = correlation_value then
    return jsonb_build_object(
      'version', 'email-sent-delta-request-v1',
      'should_request', true,
      'replayed', true,
      'mailbox_key', mailbox_value,
      'execution_id', execution_value,
      'correlation_id', correlation_value,
      'folder_name', current_state.folder_name,
      'cursor_url', current_state.cursor_url,
      'cursor_kind', current_state.cursor_kind,
      'initial_since', current_state.initial_since,
      'lease_until', current_state.lease_until
    );
  end if;

  update public.email_agent_mail_sync_state
  set lease_owner = execution_value,
      lease_until = now() + interval '2 minutes',
      last_attempt_at = now(),
      last_correlation_id = correlation_value,
      last_execution_id = execution_value,
      updated_at = now()
  where mailbox_key = mailbox_value
    and (lease_until is null or lease_until <= now())
    and (next_retry_at is null or next_retry_at <= now())
  returning * into claimed_state;

  if found then
    insert into public.email_agent_mail_sync_runs (
      correlation_id,
      mailbox_key,
      execution_id,
      status,
      request_kind
    ) values (
      correlation_value,
      mailbox_value,
      execution_value,
      'running',
      claimed_state.cursor_kind
    )
    on conflict (correlation_id) do update
    set status = 'running',
        request_kind = excluded.request_kind,
        http_status = null,
        message_count = 0,
        upserted_count = 0,
        cursor_kind = null,
        retry_after_seconds = null,
        error_code = null,
        error_message = null,
        completed_at = null,
        started_at = now();

    return jsonb_build_object(
      'version', 'email-sent-delta-request-v1',
      'should_request', true,
      'mailbox_key', mailbox_value,
      'execution_id', execution_value,
      'correlation_id', correlation_value,
      'folder_name', claimed_state.folder_name,
      'cursor_url', claimed_state.cursor_url,
      'cursor_kind', claimed_state.cursor_kind,
      'initial_since', claimed_state.initial_since,
      'lease_until', claimed_state.lease_until
    );
  end if;

  select *
  into current_state
  from public.email_agent_mail_sync_state
  where mailbox_key = mailbox_value;

  skip_reason := case
    when current_state.next_retry_at is not null and current_state.next_retry_at > now()
      then 'backoff'
    else 'leased'
  end;

  return jsonb_build_object(
    'version', 'email-sent-delta-request-v1',
    'should_request', false,
    'reason', skip_reason,
    'mailbox_key', mailbox_value,
    'execution_id', execution_value,
    'next_retry_at', current_state.next_retry_at,
    'lease_until', current_state.lease_until
  );
end;
$function$;

revoke all on function public.begin_email_agent_sent_sync_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.begin_email_agent_sent_sync_v1(text, text)
  to service_role;

comment on function public.begin_email_agent_sent_sync_v1(text, text) is
  'Claims an idempotent Sent Items delta lease for the feedback collector.';
