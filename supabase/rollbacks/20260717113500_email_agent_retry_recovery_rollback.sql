drop function if exists public.get_email_agent_retry_health();
drop function if exists public.complete_email_agent_retry_message(text, jsonb);
drop function if exists public.finalize_email_agent_retry_without_new_draft(text, text, text, text);
drop function if exists public.claim_due_email_agent_retry(text, integer);

create or replace function public.fail_email_agent_message(
  p_request_id text,
  p_record jsonb,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  attempt integer;
  final_status text;
begin
  select attempt_count into attempt
  from public.email_locks
  where request_id = p_request_id
  for update;

  attempt := coalesce(attempt, 1);
  final_status := case when p_retryable and attempt < 5 then 'failed_retryable' else 'failed_final' end;

  update public.email_locks
  set status = final_status,
      lease_until = null,
      next_retry_at = case
        when final_status = 'failed_retryable' then now() + make_interval(mins => least(30, greatest(2, attempt * 3)))
        else null
      end,
      last_error = left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
      updated_at = now()
  where request_id = p_request_id;

  insert into public.email_agent_log (
    message_id, conversation_id, from_email, from_name, subject, body_preview,
    category, confidence, order_found, order_count, draft_created, draft_id,
    draft_body_preview, error_message, processing_time_ms, request_id,
    internet_message_id, message_source, latest_message_fingerprint,
    reply_length_class, risk_level, validation_reasons, context_snapshot,
    review_status, updated_at
  ) values (
    p_record->>'message_id', nullif(p_record->>'conversation_id', ''), p_record->>'from_email',
    nullif(p_record->>'from_name', ''), nullif(p_record->>'subject', ''), nullif(p_record->>'body_preview', ''),
    coalesce(nullif(p_record->>'category', ''), 'general'), nullif(p_record->>'confidence', '')::double precision,
    coalesce((p_record->>'order_found')::boolean, false), coalesce((p_record->>'order_count')::integer, 0),
    coalesce((p_record->>'draft_created')::boolean, false), nullif(p_record->>'draft_id', ''),
    nullif(p_record->>'draft_body_preview', ''), left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
    nullif(p_record->>'processing_time_ms', '')::integer, p_request_id,
    nullif(p_record->>'internet_message_id', ''), nullif(p_record->>'message_source', ''),
    nullif(p_record->>'latest_message_fingerprint', ''), nullif(p_record->>'reply_length_class', ''),
    nullif(p_record->>'risk_level', ''), '{}', coalesce(p_record->'context_snapshot', '{}'::jsonb),
    'failed', now()
  )
  on conflict (message_id) do update
  set draft_created = excluded.draft_created,
      draft_id = excluded.draft_id,
      draft_body_preview = excluded.draft_body_preview,
      error_message = excluded.error_message,
      processing_time_ms = excluded.processing_time_ms,
      request_id = excluded.request_id,
      internet_message_id = excluded.internet_message_id,
      message_source = excluded.message_source,
      latest_message_fingerprint = excluded.latest_message_fingerprint,
      reply_length_class = excluded.reply_length_class,
      risk_level = excluded.risk_level,
      context_snapshot = excluded.context_snapshot,
      review_status = 'failed',
      updated_at = now();

  return jsonb_build_object('failed', true, 'status', final_status, 'attempt_count', attempt);
end;
$$;

revoke all on function public.fail_email_agent_message(text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_email_agent_message(text, jsonb, boolean)
  to service_role;

drop table if exists public.email_agent_retry_events;
