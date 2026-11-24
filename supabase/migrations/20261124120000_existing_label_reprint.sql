-- A reprint reuses an existing DPD label; it never authorizes a carrier purchase.
alter table public.arrival_label_browser_purchase_jobs
  add column reuse_existing_dpd_tracking text
  check (reuse_existing_dpd_tracking is null or (parcel_kind = 'main' and reuse_existing_dpd_tracking ~ '^[0-9]{14}$'));
CREATE OR REPLACE FUNCTION public.arrival_labels_enqueue_browser_purchase(p_case_id uuid)
 RETURNS SETOF arrival_label_browser_purchase_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Recover only the exact confirmed pre-purchase zero-selection hold after a
  -- fresh application decision has supplied the existing DPD reference.
  if v_case.source_snapshot ->> 'reuseExistingDpdTracking' ~ '^[0-9]{14}$'
    and v_case.status = 'manual_review' and v_case.existing_dpd_tracking is null then
    update public.arrival_label_browser_purchase_jobs
      set status='queued', attempts=0, lease_owner=null, lease_expires_at=null,
          last_error=null, updated_at=now(),
          reuse_existing_dpd_tracking=v_case.source_snapshot ->> 'reuseExistingDpdTracking'
      where case_id=v_case.id and parcel_kind='main' and status='manual_review'
        and dispatching_at is null and purchased_at is null and print_job_id is null
        and original_pdf_sha256 is null
        and last_error='EasyDPD-Artikelmenge ist null; Artikelauswahl manuell pruefen, kein Kauf.';
    if found then
      update public.arrival_label_cases set status='label_planned', manual_review_reason=null,
        updated_at=now() where id=v_case.id returning * into v_case;
    else
      return query select * from public.arrival_label_browser_purchase_jobs where case_id=v_case.id and parcel_kind='main';
      return;
    end if;
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
    incoming_dhl_last_six,
    reuse_existing_dpd_tracking
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
    v_case.incoming_dhl_last_six,
    v_case.source_snapshot ->> 'reuseExistingDpdTracking'
  )
  on conflict (case_id, parcel_kind) do nothing
  returning * into v_job;

  if not found then
    select * into v_job from public.arrival_label_browser_purchase_jobs where case_id = v_case.id and parcel_kind = 'main';
    if v_job.shopify_order_id <> v_case.shopify_order_id
      or v_job.selected_dpd_product <> v_case.selected_dpd_product
      or v_job.incoming_dhl_tracking_number <> v_case.incoming_dhl_tracking_number then
      raise exception 'browser purchase idempotency boundary belongs to different input';
    end if;
    if v_case.source_snapshot ->> 'reuseExistingDpdTracking' ~ '^[0-9]{14}$'
      and v_job.status in ('queued','retryable_error') and v_job.dispatching_at is null
      and v_job.purchased_at is null and v_job.print_job_id is null
      and v_job.lease_owner is null then
      update public.arrival_label_browser_purchase_jobs
        set reuse_existing_dpd_tracking=v_case.source_snapshot ->> 'reuseExistingDpdTracking'
        where id=v_job.id returning * into v_job;
    end if;
  else
    -- Only a newly created primary purchase can plan the add-on. No historical backfill.
    if v_job.reuse_existing_dpd_tracking is null and v_case.source_snapshot ->> 'acrylicTableDeviceRequired' = 'true'
      and not exists (select 1 from public.arrival_label_first_parcels where trello_card_id = v_case.trello_card_id) then
      insert into public.arrival_label_browser_purchase_jobs (
        case_id, parcel_kind, parent_purchase_job_id, idempotency_key,
        shop_domain, shopify_order_id, shopify_order_numeric_id, shopify_order_name, order_url,
        selected_dpd_product, easydpd_product_label, maximum_purchase_cents,
        incoming_dhl_tracking_number, incoming_dhl_last_six
      ) values (
        v_case.id, 'acrylic_table_device', v_job.id,
        'arrival-acrylic-parcel:' || v_job.shop_domain || ':' || v_numeric_order_id,
        v_job.shop_domain, v_job.shopify_order_id, v_numeric_order_id, v_job.shopify_order_name, v_job.order_url,
        v_job.selected_dpd_product, v_job.easydpd_product_label, v_job.maximum_purchase_cents,
        v_job.incoming_dhl_tracking_number, v_job.incoming_dhl_last_six
      )
      on conflict (shop_domain, shopify_order_numeric_id) where parcel_kind = 'acrylic_table_device' do nothing;
    end if;
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
$function$;

drop function public.arrival_labels_claim_browser_purchase(text,integer,timestamptz,boolean);
CREATE OR REPLACE FUNCTION public.arrival_labels_claim_browser_purchase(p_worker_id text, p_lease_seconds integer DEFAULT 300, p_now timestamp with time zone DEFAULT now(), p_acrylic_capable boolean DEFAULT false, p_reprint_capable boolean DEFAULT false)
 RETURNS SETOF arrival_label_browser_purchase_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_live boolean;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then raise exception 'invalid browser worker id'; end if;
  if p_lease_seconds < 120 or p_lease_seconds > 900 then raise exception 'browser lease seconds must be between 120 and 900'; end if;
  if p_worker_id is distinct from 'hermes-server-easydpd-01' then return; end if;
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
  where (reuse_existing_dpd_tracking is null or p_reprint_capable is true)
    and (parcel_kind = 'main' or p_acrylic_capable is true)
    and lease_owner = p_worker_id
    and status in ('claimed', 'validated')
    and lease_expires_at > p_now
    and (parcel_kind = 'main' or exists (
      select 1 from public.arrival_label_cases c
      join public.arrival_label_browser_purchase_jobs primary_job on primary_job.case_id = c.id and primary_job.parcel_kind = 'main'
      join public.arrival_label_print_jobs printed on printed.id = primary_job.print_job_id
      where c.id = arrival_label_browser_purchase_jobs.case_id
        and primary_job.id = arrival_label_browser_purchase_jobs.parent_purchase_job_id
        and primary_job.status = 'completed' and printed.status = 'printed'
        and primary_job.dpd_tracking_number = arrival_label_browser_purchase_jobs.expected_primary_dpd_tracking
        and c.existing_dpd_tracking = primary_job.dpd_tracking_number
        and c.status in ('completed', 'existing_label', 'pdf_processed') and c.manual_review_reason is null
        and c.source_snapshot ->> 'acrylicTableDeviceRequired' = 'true'
    ))
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
  where (j.reuse_existing_dpd_tracking is null or p_reprint_capable is true)
    and j.status in ('queued', 'claimed', 'validated', 'retryable_error')
    and j.attempts < j.max_attempts
    and (j.lease_expires_at is null or j.lease_expires_at <= p_now)
    and (
      (j.parcel_kind = 'main' and c.status = 'label_planned' and c.existing_dpd_tracking is null)
      or (j.parcel_kind = 'acrylic_table_device' and p_acrylic_capable is true
        and c.status in ('completed', 'existing_label', 'pdf_processed')
        and c.manual_review_reason is null
        and c.source_snapshot ->> 'acrylicTableDeviceRequired' = 'true'
        and exists (
          select 1 from public.arrival_label_browser_purchase_jobs primary_job
          join public.arrival_label_print_jobs printed on printed.id = primary_job.print_job_id
          where primary_job.id = j.parent_purchase_job_id
            and primary_job.case_id = j.case_id and primary_job.parcel_kind = 'main'
            and primary_job.shopify_order_numeric_id = j.shopify_order_numeric_id
            and primary_job.status = 'completed' and printed.status = 'printed'
            and printed.cups_job_id is not null and printed.printed_at is not null
            and primary_job.dpd_tracking_number = c.existing_dpd_tracking
        ))
    )
    and (not c.delivery_note_required or c.delivery_note_status = 'printed')
  order by j.created_at asc limit 1 for update of j skip locked;
  if not found then return; end if;

  update public.arrival_label_browser_purchase_jobs
  set status = 'claimed',
      expected_primary_dpd_tracking = case when parcel_kind = 'acrylic_table_device'
        then (select primary_job.dpd_tracking_number from public.arrival_label_browser_purchase_jobs primary_job where primary_job.id = v_job.parent_purchase_job_id)
        else null end,
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      claimed_at = p_now,
      last_error = null,
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end;
$function$;

revoke all on function public.arrival_labels_claim_browser_purchase(text,integer,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.arrival_labels_claim_browser_purchase(text,integer,timestamptz,boolean,boolean) to service_role;
CREATE OR REPLACE FUNCTION public.arrival_labels_update_browser_purchase(p_job_id uuid, p_worker_id text, p_result text, p_dpd_tracking_number text DEFAULT NULL::text, p_original_pdf_sha256 text DEFAULT NULL::text, p_observed_purchase_cents integer DEFAULT NULL::integer, p_print_job_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF arrival_label_browser_purchase_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_next_status text;
  v_exhausted boolean;
begin
  if p_result not in ('reprint_ready', 'validated', 'dispatching', 'purchased', 'completed', 'retryable_error', 'uncertain') then
    raise exception 'invalid browser purchase result';
  end if;
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = p_job_id and lease_owner = p_worker_id for update;
  if not found then raise exception 'browser purchase job not owned by worker'; end if;

  if v_job.reuse_existing_dpd_tracking is not null and p_result in ('dispatching','purchased') then
    raise exception 'existing-label reprint cannot dispatch or record a purchase';
  end if;
  if p_result='reprint_ready' and (
    v_job.reuse_existing_dpd_tracking is null or v_job.status <> 'validated'
    or v_job.parcel_kind <> 'main' or v_job.dispatching_at is not null
    or v_job.purchased_at is not null or v_job.print_job_id is not null
    or v_job.lease_expires_at <= p_now
  ) then raise exception 'existing-label reprint is not authorized'; end if;
  if p_result = 'validated' and v_job.status not in ('claimed', 'validated') then raise exception 'invalid transition to validated'; end if;
  if p_result = 'dispatching' and v_job.status <> 'validated' then raise exception 'invalid transition to dispatching'; end if;
  if v_job.parcel_kind = 'acrylic_table_device' and p_result in ('validated', 'dispatching') then
    if not exists (
      select 1 from public.arrival_label_browser_purchase_jobs primary_job
      join public.arrival_label_print_jobs printed on printed.id = primary_job.print_job_id
      join public.arrival_label_cases c on c.id = v_job.case_id
      where primary_job.id = v_job.parent_purchase_job_id and primary_job.status = 'completed'
        and printed.status = 'printed' and printed.cups_job_id is not null
        and primary_job.dpd_tracking_number = v_job.expected_primary_dpd_tracking
        and c.existing_dpd_tracking = v_job.expected_primary_dpd_tracking
        and c.status in ('completed', 'existing_label', 'pdf_processed') and c.manual_review_reason is null
        and c.source_snapshot ->> 'acrylicTableDeviceRequired' = 'true'
    ) then raise exception 'additional parcel primary print or case approval is missing'; end if;
  end if;
  if p_result = 'purchased' then
    if v_job.parcel_kind = 'acrylic_table_device' and (
      v_job.expected_primary_dpd_tracking is null
      or coalesce(p_dpd_tracking_number, v_job.dpd_tracking_number) = v_job.expected_primary_dpd_tracking
    ) then raise exception 'additional parcel cannot reuse primary tracking'; end if;
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
      join public.arrival_label_artifacts a on a.id = p.artifact_id and a.parcel_kind = v_job.parcel_kind
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
    when p_result = 'reprint_ready' then 'purchased' -- acquired existing label; purchased_at remains NULL
    when p_result = 'uncertain' or v_exhausted then 'manual_review'
    else p_result
  end;
  update public.arrival_label_browser_purchase_jobs
  set status = v_next_status,
      dpd_tracking_number = case when p_result='reprint_ready' then reuse_existing_dpd_tracking else coalesce(p_dpd_tracking_number, dpd_tracking_number) end,
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
    case when p_result='reprint_ready' then 'existing_label_reprint_ready' else 'browser_purchase_' || p_result end,
    case when p_result in ('retryable_error', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-browser-worker:' || left(p_worker_id, 96),
    jsonb_build_object('jobId', v_job.id, 'attempts', v_job.attempts, 'dpdTrackingNumber', v_job.dpd_tracking_number, 'printJobId', v_job.print_job_id)
  from public.arrival_label_cases c where c.id = v_job.case_id
  on conflict (event_key) do nothing;
  return next v_job;
end;
$function$;

CREATE OR REPLACE FUNCTION public.arrival_labels_register_browser_artifacts(p_job_id uuid, p_worker_id text, p_dpd_tracking_number text, p_original_pdf_sha256 text, p_original_artifact_id uuid, p_annotated_artifact_id uuid, p_preview_artifact_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF arrival_label_browser_purchase_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if v_job.reuse_existing_dpd_tracking is not null and p_dpd_tracking_number is distinct from v_job.reuse_existing_dpd_tracking then
    raise exception 'reprint artifact does not match existing tracking';
  end if;
  select * into v_original from public.arrival_label_artifacts where id = p_original_artifact_id and case_id = v_job.case_id and artifact_kind = 'original_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_annotated from public.arrival_label_artifacts where id = p_annotated_artifact_id and case_id = v_job.case_id and artifact_kind = 'annotated_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_preview from public.arrival_label_artifacts where id = p_preview_artifact_id and case_id = v_job.case_id and artifact_kind = 'rendered_preview' and parcel_kind = v_job.parcel_kind;
  if v_original.id is null or v_annotated.id is null or v_preview.id is null
    or v_original.sha256 <> p_original_pdf_sha256
    or v_original.content_type <> 'application/pdf'
    or v_annotated.content_type <> 'application/pdf'
    or coalesce(v_annotated.qa_result ->> 'ok', 'false') <> 'true'
    or coalesce(v_annotated.qa_result ->> 'overlayText', '') <> (case when v_job.parcel_kind = 'acrylic_table_device' then v_job.incoming_dhl_last_six || ' (Tischgerät)' else v_job.incoming_dhl_last_six || coalesce((select ' Paket 1 von ' || cardinality(p.tracking_numbers)::text
      from public.arrival_label_first_parcels p join public.arrival_label_cases c on c.trello_card_id = p.trello_card_id
      where c.id = v_job.case_id and p.tracking_numbers[1] = v_job.incoming_dhl_tracking_number and cardinality(p.tracking_numbers) > 1), '') end)
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
      purchased_at = case when reuse_existing_dpd_tracking is null then coalesce(purchased_at, p_now) else null end,
      artifact_processed_at = coalesce(artifact_processed_at, p_now),
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end;
$function$;
