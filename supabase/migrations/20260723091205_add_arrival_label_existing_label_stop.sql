begin;

create or replace function public.arrival_labels_block_browser_purchase_existing_label(
  p_job_id uuid,
  p_worker_id text,
  p_existing_dpd_tracking text default null,
  p_evidence jsonb default '{}'::jsonb,
  p_error text default null,
  p_now timestamptz default now()
)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid browser worker id';
  end if;
  if p_existing_dpd_tracking is not null and p_existing_dpd_tracking !~ '^[0-9]{11,20}$' then
    raise exception 'invalid existing DPD tracking number';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object'
    or not coalesce(p_evidence, '{}'::jsonb) @> '{"found": true}'::jsonb
    or pg_column_size(coalesce(p_evidence, '{}'::jsonb)) > 4096 then
    raise exception 'invalid existing-label evidence';
  end if;

  select * into v_job
  from public.arrival_label_browser_purchase_jobs
  where id = p_job_id and lease_owner = p_worker_id
  for update;
  if not found then raise exception 'browser purchase job not owned by worker'; end if;
  if v_job.status not in ('claimed', 'validated', 'manual_review') then
    raise exception 'existing label can block only before purchase dispatch';
  end if;

  update public.arrival_label_browser_purchase_jobs
  set status = 'manual_review',
      dpd_tracking_number = coalesce(p_existing_dpd_tracking, dpd_tracking_number),
      lease_owner = null,
      lease_expires_at = null,
      last_error = left(coalesce(nullif(p_error, ''), 'EasyDPD history contains an existing label; no second purchase.'), 500),
      updated_at = p_now
  where id = p_job_id
  returning * into v_job;

  update public.arrival_label_cases
  set status = 'manual_review',
      existing_dpd_tracking = coalesce(p_existing_dpd_tracking, existing_dpd_tracking),
      manual_review_reason = 'EasyDPD-History enthält bereits ein Label; keinen zweiten Carrier-Kauf ausführen und händisch zuordnen.',
      updated_at = p_now
  where id = v_job.case_id;

  insert into public.arrival_label_events (
    run_id,
    case_id,
    event_key,
    event_type,
    severity,
    actor,
    payload
  )
  select
    c.run_id,
    c.id,
    'browser-purchase:' || v_job.id::text || ':existing-label-blocked',
    'browser_purchase_existing_label_blocked',
    'warning',
    'arrival-label-browser-worker:' || left(p_worker_id, 96),
    jsonb_build_object(
      'jobId', v_job.id,
      'dpdTrackingNumber', p_existing_dpd_tracking,
      'evidence', p_evidence
    )
  from public.arrival_label_cases c
  where c.id = v_job.case_id
  on conflict (event_key) do nothing;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_block_browser_purchase_existing_label(uuid, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.arrival_labels_block_browser_purchase_existing_label(uuid, text, text, jsonb, text, timestamptz)
  to service_role;

comment on function public.arrival_labels_block_browser_purchase_existing_label(uuid, text, text, jsonb, text, timestamptz)
  is 'Fail-closed pre-dispatch stopper when the live EasyDPD history already contains a label.';

commit;
