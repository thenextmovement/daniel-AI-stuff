-- Only the expected extra-parcel overlay changes; existing artifacts remain untouched.
create or replace function public.arrival_labels_register_browser_artifacts(
  p_job_id uuid,
  p_worker_id text,
  p_dpd_tracking_number text,
  p_original_pdf_sha256 text,
  p_original_artifact_id uuid,
  p_annotated_artifact_id uuid,
  p_preview_artifact_id uuid,
  p_now timestamptz default now()
)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_original public.arrival_label_artifacts%rowtype;
  v_annotated public.arrival_label_artifacts%rowtype;
  v_preview public.arrival_label_artifacts%rowtype;
begin
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = p_job_id and lease_owner = p_worker_id for update;
  if not found or v_job.status not in ('dispatching', 'purchased', 'artifact_uploaded') then
    raise exception 'browser purchase job is not ready for artifact registration';
  end if;
  if p_dpd_tracking_number !~ '^[0-9]{11,20}$' or p_original_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid purchased-label proof';
  end if;
  select * into v_original from public.arrival_label_artifacts where id = p_original_artifact_id and case_id = v_job.case_id and artifact_kind = 'original_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_annotated from public.arrival_label_artifacts where id = p_annotated_artifact_id and case_id = v_job.case_id and artifact_kind = 'annotated_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_preview from public.arrival_label_artifacts where id = p_preview_artifact_id and case_id = v_job.case_id and artifact_kind = 'rendered_preview' and parcel_kind = v_job.parcel_kind;
  if v_original.id is null or v_annotated.id is null or v_preview.id is null
    or v_original.sha256 <> p_original_pdf_sha256
    or v_original.content_type <> 'application/pdf'
    or v_annotated.content_type <> 'application/pdf'
    or coalesce(v_annotated.qa_result ->> 'ok', 'false') <> 'true'
    or coalesce(v_annotated.qa_result ->> 'overlayText', '') <> (case when v_job.parcel_kind = 'acrylic_table_device' then v_job.incoming_dhl_last_six || ' (Tischgerät)' else v_job.incoming_dhl_last_six end)
    or v_preview.content_type <> 'image/png' then
    raise exception 'browser artifacts are incomplete or failed QA';
  end if;

  if v_job.parcel_kind = 'acrylic_table_device' and (
    v_job.expected_primary_dpd_tracking is null or p_dpd_tracking_number = v_job.expected_primary_dpd_tracking
  ) then raise exception 'additional parcel cannot reuse primary tracking'; end if;
  if v_job.dpd_tracking_number is not null and v_job.dpd_tracking_number <> p_dpd_tracking_number then
    raise exception 'artifact tracking differs from purchased tracking';
  end if;

  update public.arrival_label_cases
  set existing_dpd_tracking = p_dpd_tracking_number,
      original_pdf_path = 'storage://' || v_original.storage_bucket || '/' || v_original.storage_key,
      annotated_pdf_path = 'storage://' || v_annotated.storage_bucket || '/' || v_annotated.storage_key,
      rendered_preview_path = 'storage://' || v_preview.storage_bucket || '/' || v_preview.storage_key,
      status = 'pdf_processed',
      manual_review_reason = null,
      updated_at = p_now
  where id = v_job.case_id and v_job.parcel_kind = 'main';

  update public.arrival_label_browser_purchase_jobs
  set status = 'artifact_uploaded',
      dpd_tracking_number = p_dpd_tracking_number,
      original_pdf_sha256 = p_original_pdf_sha256,
      annotated_pdf_sha256 = v_annotated.sha256,
      purchased_at = coalesce(purchased_at, p_now),
      artifact_processed_at = coalesce(artifact_processed_at, p_now),
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;
