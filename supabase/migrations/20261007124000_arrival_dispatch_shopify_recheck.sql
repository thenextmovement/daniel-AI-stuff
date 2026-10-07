-- Persist a newly observed Shopify instruction before any carrier/print dispatch.
-- No dispatch state, purchased PDF, tracking number or CUPS receipt is reset.
create or replace function public.arrival_labels_hold_before_dispatch(
  p_job_kind text, p_job_id uuid, p_worker_id text,
  p_reason text, p_reason_codes text[], p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_status text;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'Aktuelle Shopify-Hinweise erfordern manuelle Versandbearbeitung.'), 500);
begin
  if p_job_kind = 'browser' then
    select case_id, status into v_case_id, v_status
    from public.arrival_label_browser_purchase_jobs
    where id = p_job_id and lease_owner = p_worker_id
    for update;
    if not found or v_status not in ('claimed', 'validated', 'manual_review') then
      raise exception 'browser job is not owned or already dispatched';
    end if;
    update public.arrival_label_browser_purchase_jobs
    set status = 'manual_review', lease_expires_at = null, last_error = v_reason, updated_at = p_now
    where id = p_job_id;
  elsif p_job_kind = 'print' then
    select case_id, status into v_case_id, v_status
    from public.arrival_label_print_jobs
    where id = p_job_id and lease_owner = p_worker_id
    for update;
    if not found or v_status not in ('claimed', 'manual_review') then
      raise exception 'print job is not owned or already dispatched';
    end if;
    update public.arrival_label_print_jobs
    set status = 'manual_review', lease_expires_at = null, last_error = v_reason, updated_at = p_now
    where id = p_job_id;
  else
    raise exception 'invalid job kind';
  end if;
  update public.arrival_label_cases
  set status = 'manual_review', manual_review_reason = v_reason, updated_at = p_now
  where id = v_case_id;
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, c.id, 'shopify-dispatch-hold:' || p_job_kind || ':' || p_job_id::text,
    'shopify_dispatch_held', 'warning', 'arrival-label-worker:' || left(p_worker_id, 96),
    jsonb_build_object('jobId', p_job_id, 'jobKind', p_job_kind, 'reasonCodes', p_reason_codes,
      'dispatchStarted', false)
  from public.arrival_label_cases c where c.id = v_case_id
  on conflict (event_key) do nothing;
  return jsonb_build_object('status', 'manual_review');
end;
$$;
revoke execute on function public.arrival_labels_hold_before_dispatch(text, uuid, text, text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_hold_before_dispatch(text, uuid, text, text, text[], timestamptz) to service_role;
