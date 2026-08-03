create or replace function public.arrival_labels_confirm_cups_completion(
  p_job_id uuid,
  p_worker_id text,
  p_cups_job_id text,
  p_now timestamptz default now()
)
returns setof public.arrival_label_print_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_print_jobs%rowtype;
  v_timeout_error constant text := 'CUPS completion could not be proven; manual check required and no automatic reprint is allowed.';
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid print worker id';
  end if;
  if coalesce(p_cups_job_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}-[0-9]+$' then
    raise exception 'invalid CUPS job id';
  end if;

  select * into v_job
  from public.arrival_label_print_jobs
  where id = p_job_id and lease_owner = p_worker_id
  for update;
  if not found then raise exception 'print job not owned by worker'; end if;
  if v_job.cups_job_id is distinct from p_cups_job_id then raise exception 'CUPS job id mismatch'; end if;

  if v_job.status = 'printed' then
    return next v_job;
    return;
  end if;
  if v_job.status not in ('submitted', 'manual_review') then raise exception 'print job is not awaiting CUPS completion'; end if;
  if v_job.status = 'manual_review' and v_job.last_error is distinct from v_timeout_error then
    raise exception 'manual review reason is not eligible for automatic CUPS reconciliation';
  end if;

  update public.arrival_label_print_jobs
  set status = 'printed',
      printed_at = coalesce(printed_at, p_now),
      last_error = null,
      lease_expires_at = null,
      updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  if v_job.document_kind = 'delivery_note' then
    update public.arrival_label_cases
    set status = case
          when status = 'manual_review' and manual_review_reason = 'Druckstatus ist unklar; physisch pruefen und nicht automatisch erneut drucken.'
            then 'label_planned'
          else status
        end,
        delivery_note_status = 'printed',
        manual_review_reason = case
          when manual_review_reason = 'Druckstatus ist unklar; physisch pruefen und nicht automatisch erneut drucken.' then null
          else manual_review_reason
        end,
        updated_at = p_now
    where id = v_job.case_id;
  else
    update public.arrival_label_cases
    set status = 'completed',
        manual_review_reason = null,
        updated_at = p_now
    where id = v_job.case_id;
  end if;

  insert into public.arrival_label_events (
    run_id, case_id, event_key, event_type, severity, actor, payload
  )
  select
    c.run_id,
    c.id,
    'print:' || v_job.id::text || ':cups_completion_confirmed',
    'print_cups_completion_confirmed',
    'info',
    p_worker_id,
    jsonb_build_object(
      'printJobId', v_job.id,
      'cupsJobId', v_job.cups_job_id,
      'documentKind', v_job.document_kind,
      'printerKey', v_job.printer_key
    )
  from public.arrival_label_cases c
  where c.id = v_job.case_id
  on conflict (event_key) do nothing;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_confirm_cups_completion(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.arrival_labels_confirm_cups_completion(uuid, text, text, timestamptz)
  to service_role;

comment on function public.arrival_labels_confirm_cups_completion(uuid, text, text, timestamptz)
  is 'Marks an already submitted, exact CUPS job as printed after the owning worker proves completion; never resubmits a document.';
