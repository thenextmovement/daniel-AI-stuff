create or replace function public.billing_change_request_decide_silent(
  p_case_id uuid,
  p_change_request_id uuid,
  p_decision text,
  p_approved_changes jsonb,
  p_note text,
  p_actor text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- The existing decision function and this delete run in one transaction.
  -- Workers cannot observe the queued notification before this wrapper removes it.
  v_result := public.billing_change_request_decide(
    p_case_id,
    p_change_request_id,
    p_decision,
    p_approved_changes,
    p_note,
    p_actor,
    p_idempotency_key
  );

  delete from public.billing_jobs
  where billing_case_id = p_case_id
    and job_type = 'NOTIFY_CHANGE_REQUEST'
    and idempotency_key = 'notify-change-decision:' || p_change_request_id::text || ':' || upper(p_decision);

  return v_result || jsonb_build_object(
    'notificationQueued', false,
    'notificationSuppressed', true
  );
end;
$$;

revoke all on function public.billing_change_request_decide_silent(uuid,uuid,text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.billing_change_request_decide_silent(uuid,uuid,text,jsonb,text,text,text)
  to service_role;
