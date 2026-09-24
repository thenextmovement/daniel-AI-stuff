begin;
-- Safe schema rollback only before any additional parcel has been planned.
-- Never discard a queued, ambiguous, purchased or printed add-on to roll back.
do $$
begin
  if exists(select 1 from public.arrival_label_browser_purchase_jobs where parcel_kind <> 'main')
    or exists(select 1 from public.arrival_label_artifacts where parcel_kind <> 'main') then
    raise exception 'additional parcel data exists: retain this schema and reconcile manually; no destructive rollback';
  end if;
end;
$$;

drop function public.arrival_labels_claim_browser_purchase(text, integer, timestamptz, boolean);
create or replace function public.arrival_labels_enqueue_browser_purchase(p_case_id uuid)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.arrival_label_cases%rowtype;
  v_settings public.arrival_label_browser_worker_settings%rowtype;
  v_product jsonb;
  v_product_label text;
  v_product_cap integer;
  v_numeric_order_id text;
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
begin
  select * into v_case from public.arrival_label_cases where id = p_case_id for update;
  if not found then raise exception 'arrival-label case not found'; end if;
  select * into v_settings from public.arrival_label_browser_worker_settings where singleton is true for share;
  if not found or not v_settings.worker_enabled or not v_settings.live_purchase_enabled then
    raise exception 'browser purchase worker is not live-approved';
  end if;
  if v_case.status <> 'label_planned'
    or nullif(btrim(v_case.shopify_order_id), '') is null
    or nullif(btrim(v_case.shopify_order_name), '') is null
    or nullif(btrim(v_case.selected_dpd_product), '') is null
    or v_case.existing_dpd_tracking is not null then
    raise exception 'case is not eligible for browser purchase';
  end if;
  if v_case.destination_class not in ('domestic_de', 'eu')
    or (v_case.delivery_note_required and v_case.delivery_note_status <> 'printed') then
    raise exception 'destination or delivery note gate blocks browser purchase';
  end if;

  v_product := v_settings.approved_products -> v_case.selected_dpd_product;
  if jsonb_typeof(v_product) <> 'object' then raise exception 'DPD product is not browser-approved'; end if;
  v_product_label := nullif(btrim(v_product ->> 'label'), '');
  if v_product_label not in ('B2C', 'B2C Predict', 'DPD Express 8:30', 'DPD Express 12:00', 'DPD Express 18:00') then
    raise exception 'invalid approved EasyDPD product label';
  end if;
  if coalesce(v_product ->> 'maxPurchaseCents', '') !~ '^[0-9]{1,5}$' then
    raise exception 'approved DPD product has no deterministic price cap';
  end if;
  v_product_cap := (v_product ->> 'maxPurchaseCents')::integer;
  if v_product_cap < 1 or v_product_cap > v_settings.maximum_purchase_cents or v_product_cap > 1500 then
    raise exception 'approved DPD product exceeds purchase cap';
  end if;

  v_numeric_order_id := substring(v_case.shopify_order_id from '([0-9]{6,30})$');
  if v_numeric_order_id is null then raise exception 'Shopify numeric order id is missing'; end if;

  insert into public.arrival_label_browser_purchase_jobs (
    case_id,
    idempotency_key,
    shop_domain,
    shopify_order_id,
    shopify_order_numeric_id,
    shopify_order_name,
    order_url,
    selected_dpd_product,
    easydpd_product_label,
    maximum_purchase_cents,
    incoming_dhl_tracking_number,
    incoming_dhl_last_six
  ) values (
    v_case.id,
    'arrival-browser-purchase:' || v_case.idempotency_key,
    v_settings.shop_domain,
    v_case.shopify_order_id,
    v_numeric_order_id,
    v_case.shopify_order_name,
    'https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=' || v_numeric_order_id || '&shop=galaxybuzzdk.myshopify.com',
    v_case.selected_dpd_product,
    v_product_label,
    v_product_cap,
    v_case.incoming_dhl_tracking_number,
    v_case.incoming_dhl_last_six
  )
  on conflict (case_id) do nothing
  returning * into v_job;

  if not found then
    select * into v_job from public.arrival_label_browser_purchase_jobs where case_id = v_case.id;
    if v_job.shopify_order_id <> v_case.shopify_order_id
      or v_job.selected_dpd_product <> v_case.selected_dpd_product
      or v_job.incoming_dhl_tracking_number <> v_case.incoming_dhl_tracking_number then
      raise exception 'browser purchase idempotency boundary belongs to different input';
    end if;
  else
    insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
    values (
      v_case.run_id,
      v_case.id,
      'browser-purchase:' || v_job.id::text || ':queued',
      'browser_purchase_queued',
      'info',
      'arrival-label-browser-queue',
      jsonb_build_object('jobId', v_job.id, 'orderName', v_job.shopify_order_name, 'product', v_job.easydpd_product_label, 'maxPurchaseCents', v_job.maximum_purchase_cents)
    )
    on conflict (event_key) do nothing;
  end if;
  return next v_job;
end;
$$;

create or replace function public.arrival_labels_claim_browser_purchase(
  p_worker_id text,
  p_lease_seconds integer default 300,
  p_now timestamptz default now()
)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_live boolean;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then raise exception 'invalid browser worker id'; end if;
  if p_lease_seconds < 120 or p_lease_seconds > 900 then raise exception 'browser lease seconds must be between 120 and 900'; end if;
  select worker_enabled and live_purchase_enabled into v_live
  from public.arrival_label_browser_worker_settings where singleton is true;
  if not coalesce(v_live, false) then return; end if;

  update public.arrival_label_browser_purchase_jobs j
  set status = 'manual_review',
      lease_owner = null,
      lease_expires_at = null,
      last_error = 'Browser worker lease expired after purchase dispatch; do not automatically purchase again.',
      updated_at = p_now
  where j.status in ('dispatching', 'purchased', 'artifact_uploaded')
    and j.lease_expires_at <= p_now;

  update public.arrival_label_cases c
  set status = 'manual_review',
      manual_review_reason = 'EasyDPD-Buchung wurde begonnen, aber nicht sicher abgeschlossen; nicht automatisch erneut kaufen.',
      updated_at = p_now
  where exists (
    select 1 from public.arrival_label_browser_purchase_jobs j
    where j.case_id = c.id and j.status = 'manual_review'
      and j.last_error like 'Browser worker lease expired after purchase dispatch;%'
  );

  select * into v_job
  from public.arrival_label_browser_purchase_jobs
  where lease_owner = p_worker_id
    and status in ('claimed', 'validated')
    and lease_expires_at > p_now
  order by claimed_at desc limit 1 for update skip locked;
  if found then return next v_job; return; end if;

  update public.arrival_label_browser_purchase_jobs
  set status = 'manual_review',
      lease_owner = null,
      lease_expires_at = null,
      last_error = 'Browser worker exhausted all safe attempts before purchase dispatch.',
      updated_at = p_now
  where status in ('claimed', 'validated', 'retryable_error')
    and attempts >= max_attempts
    and (lease_expires_at is null or lease_expires_at <= p_now);

  update public.arrival_label_cases c
  set status = 'manual_review',
      manual_review_reason = 'EasyDPD-Browser-Worker hat alle sicheren Vorab-Versuche ausgeschöpft.',
      updated_at = p_now
  where exists (
    select 1 from public.arrival_label_browser_purchase_jobs j
    where j.case_id = c.id and j.status = 'manual_review'
      and j.last_error = 'Browser worker exhausted all safe attempts before purchase dispatch.'
  );

  select j.* into v_job
  from public.arrival_label_browser_purchase_jobs j
  join public.arrival_label_cases c on c.id = j.case_id
  where j.status in ('queued', 'claimed', 'validated', 'retryable_error')
    and j.attempts < j.max_attempts
    and (j.lease_expires_at is null or j.lease_expires_at <= p_now)
    and c.status = 'label_planned'
    and c.existing_dpd_tracking is null
    and (not c.delivery_note_required or c.delivery_note_status = 'printed')
  order by j.created_at asc limit 1 for update of j skip locked;
  if not found then return; end if;

  update public.arrival_label_browser_purchase_jobs
  set status = 'claimed',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      claimed_at = p_now,
      last_error = null,
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;

create or replace function public.arrival_labels_update_browser_purchase(
  p_job_id uuid,
  p_worker_id text,
  p_result text,
  p_dpd_tracking_number text default null,
  p_original_pdf_sha256 text default null,
  p_observed_purchase_cents integer default null,
  p_print_job_id uuid default null,
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
  v_next_status text;
  v_exhausted boolean;
begin
  if p_result not in ('validated', 'dispatching', 'purchased', 'completed', 'retryable_error', 'uncertain') then
    raise exception 'invalid browser purchase result';
  end if;
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = p_job_id and lease_owner = p_worker_id for update;
  if not found then raise exception 'browser purchase job not owned by worker'; end if;

  if p_result = 'validated' and v_job.status not in ('claimed', 'validated') then raise exception 'invalid transition to validated'; end if;
  if p_result = 'dispatching' and v_job.status <> 'validated' then raise exception 'invalid transition to dispatching'; end if;
  if p_result = 'purchased' then
    if v_job.status not in ('dispatching', 'purchased') then raise exception 'invalid transition to purchased'; end if;
    if coalesce(p_dpd_tracking_number, v_job.dpd_tracking_number, '') !~ '^[0-9]{11,20}$' then raise exception 'valid DPD tracking number is required'; end if;
    if coalesce(p_original_pdf_sha256, v_job.original_pdf_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'valid original PDF sha256 is required'; end if;
    if p_observed_purchase_cents is not null and (p_observed_purchase_cents < 0 or p_observed_purchase_cents > v_job.maximum_purchase_cents) then
      raise exception 'observed purchase price exceeds approved cap';
    end if;
  end if;
  if p_result = 'completed' then
    if v_job.status not in ('artifact_uploaded', 'completed') then raise exception 'invalid transition to completed'; end if;
    if p_print_job_id is null and v_job.print_job_id is null then raise exception 'print job proof is required'; end if;
    if not exists (
      select 1 from public.arrival_label_print_jobs p
      where p.id = coalesce(p_print_job_id, v_job.print_job_id)
        and p.case_id = v_job.case_id
        and p.document_kind = 'label'
        and p.status in ('queued', 'claimed', 'dispatching', 'submitted', 'printed')
    ) then raise exception 'print job proof does not belong to browser purchase case'; end if;
  end if;
  if p_result = 'retryable_error' and v_job.status not in ('claimed', 'validated', 'retryable_error') then
    raise exception 'browser retry is safe only before purchase dispatch';
  end if;
  if p_result = 'uncertain' and v_job.status not in ('dispatching', 'purchased', 'artifact_uploaded', 'manual_review') then
    raise exception 'uncertain is valid only after purchase dispatch';
  end if;

  v_exhausted := p_result = 'retryable_error' and v_job.attempts >= v_job.max_attempts;
  v_next_status := case
    when p_result = 'uncertain' or v_exhausted then 'manual_review'
    else p_result
  end;
  update public.arrival_label_browser_purchase_jobs
  set status = v_next_status,
      dpd_tracking_number = coalesce(p_dpd_tracking_number, dpd_tracking_number),
      original_pdf_sha256 = coalesce(p_original_pdf_sha256, original_pdf_sha256),
      observed_purchase_cents = coalesce(p_observed_purchase_cents, observed_purchase_cents),
      print_job_id = coalesce(p_print_job_id, print_job_id),
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      validated_at = case when p_result = 'validated' then coalesce(validated_at, p_now) else validated_at end,
      dispatching_at = case when p_result = 'dispatching' then coalesce(dispatching_at, p_now) else dispatching_at end,
      purchased_at = case when p_result = 'purchased' then coalesce(purchased_at, p_now) else purchased_at end,
      completed_at = case when p_result = 'completed' then coalesce(completed_at, p_now) else completed_at end,
      lease_expires_at = case when p_result in ('completed', 'uncertain') or v_exhausted then null else lease_expires_at end,
      updated_at = p_now
  where id = p_job_id returning * into v_job;

  if p_result = 'uncertain' or v_exhausted then
    update public.arrival_label_cases
    set status = 'manual_review',
        manual_review_reason = case when p_result = 'uncertain'
          then 'EasyDPD-Buchungsstatus ist unklar; händisch prüfen und nicht automatisch erneut kaufen.'
          else 'EasyDPD-Browser-Worker hat alle sicheren Vorab-Versuche ausgeschöpft.' end,
        updated_at = p_now
    where id = v_job.case_id;
  end if;

  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, c.id,
    'browser-purchase:' || v_job.id::text || ':' || p_result,
    'browser_purchase_' || p_result,
    case when p_result in ('retryable_error', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-browser-worker:' || left(p_worker_id, 96),
    jsonb_build_object('jobId', v_job.id, 'attempts', v_job.attempts, 'dpdTrackingNumber', v_job.dpd_tracking_number, 'printJobId', v_job.print_job_id)
  from public.arrival_label_cases c where c.id = v_job.case_id
  on conflict (event_key) do nothing;
  return next v_job;
end;
$$;

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
  select * into v_original from public.arrival_label_artifacts where id = p_original_artifact_id and case_id = v_job.case_id and artifact_kind = 'original_pdf';
  select * into v_annotated from public.arrival_label_artifacts where id = p_annotated_artifact_id and case_id = v_job.case_id and artifact_kind = 'annotated_pdf';
  select * into v_preview from public.arrival_label_artifacts where id = p_preview_artifact_id and case_id = v_job.case_id and artifact_kind = 'rendered_preview';
  if v_original.id is null or v_annotated.id is null or v_preview.id is null
    or v_original.sha256 <> p_original_pdf_sha256
    or v_original.content_type <> 'application/pdf'
    or v_annotated.content_type <> 'application/pdf'
    or coalesce(v_annotated.qa_result ->> 'ok', 'false') <> 'true'
    or v_preview.content_type <> 'image/png' then
    raise exception 'browser artifacts are incomplete or failed QA';
  end if;

  update public.arrival_label_cases
  set existing_dpd_tracking = p_dpd_tracking_number,
      original_pdf_path = 'storage://' || v_original.storage_bucket || '/' || v_original.storage_key,
      annotated_pdf_path = 'storage://' || v_annotated.storage_bucket || '/' || v_annotated.storage_key,
      rendered_preview_path = 'storage://' || v_preview.storage_bucket || '/' || v_preview.storage_key,
      status = 'pdf_processed',
      manual_review_reason = null,
      updated_at = p_now
  where id = v_job.case_id;

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

create or replace function public.arrival_labels_enqueue_print_job(
  p_case_id uuid,
  p_artifact_id uuid,
  p_printer_key text,
  p_idempotency_key text
)
returns setof public.arrival_label_print_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_artifact public.arrival_label_artifacts%rowtype;
  v_case public.arrival_label_cases%rowtype;
  v_config public.arrival_label_product_config%rowtype;
  v_job public.arrival_label_print_jobs%rowtype;
  v_document_kind text;
begin
  if coalesce(p_printer_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'invalid printer key';
  end if;
  if length(coalesce(p_idempotency_key, '')) not between 20 and 300 then
    raise exception 'invalid print idempotency key';
  end if;

  select * into v_artifact
  from public.arrival_label_artifacts
  where id = p_artifact_id and case_id = p_case_id
  for share;

  if not found
    or v_artifact.artifact_kind not in ('annotated_pdf', 'delivery_note_pdf')
    or v_artifact.content_type <> 'application/pdf'
    or coalesce(v_artifact.qa_result ->> 'ok', 'false') <> 'true' then
    raise exception 'only a QA-approved label or delivery-note PDF can be printed';
  end if;

  select * into v_case from public.arrival_label_cases where id = p_case_id for update;
  if not found then raise exception 'arrival-label case not found'; end if;
  select * into v_config from public.arrival_label_product_config where enabled is true for share;
  if not found then raise exception 'active product configuration not found'; end if;

  if v_artifact.artifact_kind = 'annotated_pdf' then
    v_document_kind := 'label';
    if v_case.status not in ('pdf_processed', 'completed') or p_printer_key <> v_config.printer_key then
      raise exception 'case or printer is not ready for label printing';
    end if;
  else
    v_document_kind := 'delivery_note';
    if not v_case.delivery_note_required
      or v_case.delivery_note_status not in ('qa_approved', 'print_queued')
      or v_case.status not in ('label_planned', 'existing_label')
      or p_printer_key <> v_config.delivery_note_printer_key
      or upper(coalesce(v_config.delivery_note_print_media, '')) <> 'A4' then
      raise exception 'case or printer is not ready for delivery-note printing';
    end if;
  end if;

  insert into public.arrival_label_print_jobs (
    case_id, artifact_id, document_kind, idempotency_key, printer_key, document_sha256
  ) values (
    p_case_id, p_artifact_id, v_document_kind, p_idempotency_key, p_printer_key, v_artifact.sha256
  )
  on conflict (idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job
    from public.arrival_label_print_jobs
    where idempotency_key = p_idempotency_key;
    if v_job.case_id <> p_case_id or v_job.artifact_id <> p_artifact_id or v_job.printer_key <> p_printer_key or v_job.document_kind <> v_document_kind then
      raise exception 'print idempotency key belongs to different input';
    end if;
  end if;

  if v_document_kind = 'delivery_note' and v_case.delivery_note_status = 'qa_approved' then
    update public.arrival_label_cases
    set delivery_note_status = 'print_queued', updated_at = now()
    where id = p_case_id;
  end if;

  return next v_job;
end;
$$;

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

create or replace function public.arrival_labels_enqueue_outlook_archives_for_print(
  p_print_job_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.arrival_label_outlook_archive_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return 0;
  end if;

  with eligible as (
    select
      c.id as case_id,
      c.run_id,
      j.id as print_job_id,
      c.incoming_dhl_tracking_number as tracking_number,
      message_id
    from public.arrival_label_print_jobs j
    join public.arrival_label_cases c on c.id = j.case_id
    cross join lateral unnest(c.outlook_message_ids) as messages(message_id)
    where j.id = p_print_job_id
      and j.document_kind = 'label'
      and j.status = 'printed'
      and j.printed_at >= (
        select s.enabled_after
        from public.arrival_label_outlook_archive_settings s
        where s.singleton and s.enabled
      )
      and length(message_id) between 1 and 2048
      and message_id !~ '[[:cntrl:]]'
      and c.incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'
  ), inserted as (
    insert into public.arrival_label_outlook_archive_jobs (
      case_id,
      print_job_id,
      idempotency_key,
      source_message_id,
      expected_tracking_number
    )
    select
      e.case_id,
      e.print_job_id,
      'arrival-outlook-archive:' || encode(digest(e.case_id::text || E'\n' || e.message_id, 'sha256'), 'hex'),
      e.message_id,
      e.tracking_number
    from eligible e
    on conflict (idempotency_key) do nothing
    returning id, case_id
  ), events as (
    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      i.case_id,
      'outlook-archive:' || i.id::text || ':queued',
      'outlook_archive_queued',
      'info',
      'arrival-label-outlook-archive-outbox',
      jsonb_build_object('archiveJobId', i.id, 'printJobId', p_print_job_id)
    from inserted i
    join public.arrival_label_cases c on c.id = i.case_id
    on conflict (event_key) do nothing
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function public.arrival_labels_enqueue_trello_arrival(
  p_case_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.arrival_label_trello_arrival_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return 0;
  end if;

  with eligible as (
    select c.id, c.run_id, c.incoming_dhl_tracking_number, c.trello_card_id
    from public.arrival_label_cases c
    cross join public.arrival_label_trello_arrival_settings s
    where s.singleton and s.enabled
      and c.id = p_case_id
      and c.updated_at >= s.enabled_after
      and c.outlook_delivery_state = 'delivered_today'
      and c.incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'
      and c.trello_card_id ~ '^[A-Fa-f0-9]{24}$'
      and cardinality(c.outlook_message_ids) > 0
      and exists (
        select 1
        from public.arrival_label_print_jobs p
        where p.case_id = c.id
          and p.document_kind = 'label'
          and p.status = 'printed'
      )
      and exists (
        select 1
        from public.arrival_label_outlook_archive_jobs a
        where a.case_id = c.id
          and a.status = 'archived'
          and a.archived_at >= s.enabled_after
      )
      and not exists (
        select 1
        from unnest(c.outlook_message_ids) as messages(message_id)
        where not exists (
          select 1
          from public.arrival_label_outlook_archive_jobs a
          where a.case_id = c.id
            and a.source_message_id_sha256 = encode(extensions.digest(message_id, 'sha256'), 'hex')
            and a.status = 'archived'
        )
      )
  ), inserted as (
    insert into public.arrival_label_trello_arrival_jobs (
      case_id, idempotency_key, expected_tracking_number, trello_card_id
    )
    select
      e.id,
      'arrival-trello-arrived:' || e.id::text,
      e.incoming_dhl_tracking_number,
      e.trello_card_id
    from eligible e
    on conflict (case_id) do nothing
    returning id, case_id
  ), events as (
    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      i.case_id,
      'trello-arrival:' || i.id::text || ':queued',
      'trello_arrival_queued',
      'info',
      'arrival-label-trello-arrival-outbox',
      jsonb_build_object('trelloArrivalJobId', i.id)
    from inserted i
    join public.arrival_label_cases c on c.id = i.case_id
    on conflict (event_key) do nothing
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;
alter table public.arrival_label_artifacts
  drop constraint arrival_artifact_delivery_note_main,
  drop constraint arrival_artifacts_case_kind_parcel_unique,
  drop column parcel_kind,
  add constraint arrival_label_artifacts_case_kind_unique unique (case_id, artifact_kind);
drop index public.arrival_browser_acrylic_order_unique;
alter table public.arrival_label_browser_purchase_jobs
  drop constraint arrival_browser_parcel_kind_check,
  drop constraint arrival_browser_case_parcel_unique,
  drop column parcel_kind,
  drop column parent_purchase_job_id,
  drop column expected_primary_dpd_tracking,
  add constraint arrival_label_browser_purchase_jobs_case_id_key unique (case_id);
revoke execute on function public.arrival_labels_claim_browser_purchase(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_claim_browser_purchase(text, integer, timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
