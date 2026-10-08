-- Preserve the existing claim, retry and uncertain-dispatch boundaries.
CREATE OR REPLACE FUNCTION public.arrival_labels_claim_print_job(p_worker_id text, p_printer_key text, p_lease_seconds integer DEFAULT 180, p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF arrival_label_print_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.arrival_label_print_jobs%rowtype;
  v_exhausted_case_ids uuid[];
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid print worker id';
  end if;
  if coalesce(p_printer_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'invalid printer key';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'print lease seconds must be between 60 and 900';
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where lease_owner = p_worker_id
    and printer_key = p_printer_key
    and status = 'claimed'
    and lease_expires_at > p_now
  order by claimed_at desc
  limit 1
  for update skip locked;

  if found then
    return next v_job;
    return;
  end if;

  with exhausted as (
    update public.arrival_label_print_jobs
    set status = 'manual_review',
        lease_owner = null,
        lease_expires_at = null,
        last_error = 'Print worker stopped before dispatch and exhausted safe retry attempts.',
        updated_at = p_now
    where printer_key = p_printer_key
      and status in ('claimed', 'retryable_error')
      and attempts >= max_attempts
      and (lease_expires_at is null or lease_expires_at <= p_now)
    returning id, case_id
  )
  select coalesce(array_agg(case_id), array[]::uuid[])
  into v_exhausted_case_ids
  from exhausted;

  if cardinality(v_exhausted_case_ids) > 0 then
    update public.arrival_label_cases
    set status = 'manual_review',
        delivery_note_status = case
          when exists (
            select 1 from public.arrival_label_print_jobs j
            where j.case_id = arrival_label_cases.id and j.document_kind = 'delivery_note' and j.status = 'manual_review'
          ) then 'manual_review'
          else delivery_note_status
        end,
        manual_review_reason = 'Druck fehlgeschlagen; maximale Anzahl sicherer Vorab-Versuche erreicht.',
        updated_at = p_now
    where id = any(v_exhausted_case_ids);

    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      j.case_id,
      'print:' || j.id::text || ':retry_exhausted',
      'print_retry_exhausted',
      'warning',
      'arrival-label-print-queue',
      jsonb_build_object('printJobId', j.id, 'printerKey', j.printer_key, 'attempts', j.attempts)
    from public.arrival_label_print_jobs j
    join public.arrival_label_cases c on c.id = j.case_id
    where j.case_id = any(v_exhausted_case_ids) and j.status = 'manual_review'
    on conflict (event_key) do nothing;
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where printer_key = p_printer_key
    and status in ('queued', 'claimed', 'retryable_error')
    and attempts < max_attempts
    -- Daniel polls first; Rahim may only claim a safe job after five minutes.
    and (
      p_worker_id not in ('rahims-mac-arrival-label-a6-fallback-01', 'rahims-mac-arrival-delivery-note-a4-fallback-01')
      or created_at <= p_now - interval '5 minutes'
    )
    and (lease_expires_at is null or lease_expires_at <= p_now)
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then return; end if;

  update public.arrival_label_print_jobs
  set status = 'claimed',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      claimed_at = p_now,
      last_error = null,
      updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$function$
;
