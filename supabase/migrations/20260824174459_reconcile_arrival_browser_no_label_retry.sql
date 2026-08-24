begin;

create or replace function public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(
  p_job_id uuid,
  p_evidence jsonb,
  p_actor text,
  p_now timestamptz default now()
)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_case public.arrival_label_cases%rowtype;
  v_observed_at timestamptz;
  v_event_key text := 'browser-purchase:' || p_job_id::text || ':confirmed-no-label-requeue';
begin
  if coalesce(p_actor, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid browser purchase recovery actor';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object'
    or pg_column_size(coalesce(p_evidence, '{}'::jsonb)) > 4096
    or coalesce(p_evidence ->> 'source', '') <> 'easydpd_live_history_after_forced_reload'
    or coalesce(p_evidence ->> 'operatorConfirmation', '') <> 'no_label_no_tracking'
    or coalesce(p_evidence ->> 'extensionBuildCommit', '') !~ '^[0-9a-f]{40}$'
    or coalesce(jsonb_typeof(p_evidence -> 'labelCount'), '') <> 'number'
    or (p_evidence ->> 'labelCount')::numeric <> 0
    or coalesce(jsonb_typeof(p_evidence -> 'trackingNumbers'), '') <> 'array'
    or jsonb_array_length(p_evidence -> 'trackingNumbers') <> 0 then
    raise exception 'invalid confirmed-no-label evidence';
  end if;
  begin
    v_observed_at := (p_evidence ->> 'observedAt')::timestamptz;
  exception when others then
    raise exception 'invalid confirmed-no-label observation time';
  end;
  if v_observed_at is null
    or v_observed_at < p_now - interval '30 minutes'
    or v_observed_at > p_now + interval '5 minutes' then
    raise exception 'confirmed-no-label evidence is not fresh';
  end if;

  select * into v_job
  from public.arrival_label_browser_purchase_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'browser purchase job not found'; end if;
  if v_job.status <> 'manual_review' then raise exception 'browser purchase job is not in manual review'; end if;
  if coalesce(p_evidence ->> 'orderName', '') <> v_job.shopify_order_name then
    raise exception 'confirmed-no-label evidence belongs to another order';
  end if;

  select * into v_case
  from public.arrival_label_cases
  where id = v_job.case_id
  for update;
  if not found or v_case.status <> 'manual_review' then
    raise exception 'arrival-label case is not in manual review';
  end if;
  if v_case.existing_dpd_tracking is not null
    or v_job.dpd_tracking_number is not null
    or v_job.original_pdf_sha256 is not null
    or v_job.annotated_pdf_sha256 is not null
    or v_job.print_job_id is not null
    or v_job.purchased_at is not null
    or v_job.artifact_processed_at is not null
    or v_job.completed_at is not null then
    raise exception 'browser purchase already has downstream purchase evidence';
  end if;
  if exists (
    select 1 from public.arrival_label_artifacts a
    where a.case_id = v_job.case_id
      and a.artifact_kind in ('original_pdf', 'annotated_pdf', 'rendered_preview')
  ) or exists (
    select 1 from public.arrival_label_print_jobs p
    where p.case_id = v_job.case_id and p.document_kind = 'label'
  ) then
    raise exception 'arrival-label case already has label artifact or print evidence';
  end if;
  if exists (
    select 1 from public.arrival_label_events e
    where e.event_key in (
      v_event_key,
      'browser-purchase:' || v_job.id::text || ':existing-label-blocked'
    )
  ) then
    raise exception 'browser purchase recovery was already used or an existing label was recorded';
  end if;

  insert into public.arrival_label_events (
    run_id,
    case_id,
    event_key,
    event_type,
    severity,
    actor,
    payload
  ) values (
    v_case.run_id,
    v_case.id,
    v_event_key,
    'browser_purchase_requeued_after_confirmed_no_label',
    'warning',
    p_actor,
    jsonb_build_object(
      'jobId', v_job.id,
      'previousAttempts', v_job.attempts,
      'previousClaimedAt', v_job.claimed_at,
      'previousValidatedAt', v_job.validated_at,
      'previousDispatchingAt', v_job.dispatching_at,
      'previousError', v_job.last_error,
      'evidence', p_evidence
    )
  );

  update public.arrival_label_browser_purchase_jobs
  set status = 'queued',
      attempts = 0,
      lease_owner = null,
      lease_expires_at = null,
      last_error = null,
      claimed_at = null,
      validated_at = null,
      dispatching_at = null,
      purchased_at = null,
      artifact_processed_at = null,
      completed_at = null,
      updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  update public.arrival_label_cases
  set status = 'label_planned',
      manual_review_reason = null,
      updated_at = p_now
  where id = v_case.id;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(uuid, jsonb, text, timestamptz)
  to service_role;

comment on function public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(uuid, jsonb, text, timestamptz)
  is 'One-time operator recovery after a fresh forced EasyDPD reload proves zero labels and zero tracking; refuses any downstream purchase, artifact or print evidence.';

commit;
