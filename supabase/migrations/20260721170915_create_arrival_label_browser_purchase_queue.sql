create table if not exists public.arrival_label_browser_worker_settings (
  singleton boolean primary key default true,
  worker_enabled boolean not null default false,
  live_purchase_enabled boolean not null default false,
  shop_domain text not null default 'galaxybuzzdk.myshopify.com',
  maximum_purchase_cents integer not null default 1500,
  approved_products jsonb not null default '{}'::jsonb,
  approved_by text null,
  approved_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint arrival_label_browser_worker_singleton_check check (singleton),
  constraint arrival_label_browser_worker_shop_check check (shop_domain = 'galaxybuzzdk.myshopify.com'),
  constraint arrival_label_browser_worker_cap_check check (maximum_purchase_cents between 1 and 1500),
  constraint arrival_label_browser_worker_products_check check (jsonb_typeof(approved_products) = 'object'),
  constraint arrival_label_browser_worker_live_check check (
    not live_purchase_enabled
    or (
      worker_enabled
      and approved_products <> '{}'::jsonb
      and nullif(btrim(approved_by), '') is not null
      and approved_at is not null
    )
  )
);

insert into public.arrival_label_browser_worker_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.arrival_label_browser_purchase_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.arrival_label_cases(id) on delete cascade,
  idempotency_key text not null unique,
  shop_domain text not null,
  shopify_order_id text not null,
  shopify_order_numeric_id text not null,
  shopify_order_name text not null,
  order_url text not null,
  selected_dpd_product text not null,
  easydpd_product_label text not null,
  label_format text not null default 'Einzeln auf A6',
  package_weight_grams integer not null default 500,
  maximum_purchase_cents integer not null,
  observed_purchase_cents integer null,
  incoming_dhl_tracking_number text not null,
  incoming_dhl_last_six text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  dpd_tracking_number text null,
  original_pdf_sha256 text null,
  annotated_pdf_sha256 text null,
  print_job_id uuid null references public.arrival_label_print_jobs(id) on delete restrict,
  last_error text null,
  claimed_at timestamptz null,
  validated_at timestamptz null,
  dispatching_at timestamptz null,
  purchased_at timestamptz null,
  artifact_processed_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_browser_purchase_idempotency_check check (length(idempotency_key) between 20 and 300),
  constraint arrival_label_browser_purchase_shop_check check (shop_domain = 'galaxybuzzdk.myshopify.com'),
  constraint arrival_label_browser_purchase_order_id_check check (shopify_order_numeric_id ~ '^[0-9]{6,30}$'),
  constraint arrival_label_browser_purchase_order_name_check check (length(shopify_order_name) between 2 and 80 and shopify_order_name !~ E'[\\r\\n]'),
  constraint arrival_label_browser_purchase_order_url_check check (
    order_url = 'https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=' || shopify_order_numeric_id || '&shop=galaxybuzzdk.myshopify.com'
  ),
  constraint arrival_label_browser_purchase_product_check check (
    easydpd_product_label in ('B2C', 'B2C Predict', 'DPD Express 8:30', 'DPD Express 12:00', 'DPD Express 18:00')
  ),
  constraint arrival_label_browser_purchase_format_check check (label_format = 'Einzeln auf A6'),
  constraint arrival_label_browser_purchase_weight_check check (package_weight_grams = 500),
  constraint arrival_label_browser_purchase_cap_check check (maximum_purchase_cents between 1 and 1500),
  constraint arrival_label_browser_purchase_observed_cost_check check (
    observed_purchase_cents is null or observed_purchase_cents between 0 and maximum_purchase_cents
  ),
  constraint arrival_label_browser_purchase_inbound_check check (
    incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'
    and incoming_dhl_last_six = right(incoming_dhl_tracking_number, 6)
  ),
  constraint arrival_label_browser_purchase_dpd_check check (dpd_tracking_number is null or dpd_tracking_number ~ '^[0-9]{11,20}$'),
  constraint arrival_label_browser_purchase_hash_check check (
    (original_pdf_sha256 is null or original_pdf_sha256 ~ '^[0-9a-f]{64}$')
    and (annotated_pdf_sha256 is null or annotated_pdf_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint arrival_label_browser_purchase_status_check check (
    status in ('queued', 'claimed', 'validated', 'dispatching', 'purchased', 'artifact_uploaded', 'completed', 'retryable_error', 'manual_review', 'cancelled')
  ),
  constraint arrival_label_browser_purchase_attempts_check check (attempts >= 0 and max_attempts between 1 and 3)
);

create index if not exists arrival_label_browser_purchase_claim_idx
  on public.arrival_label_browser_purchase_jobs (status, created_at)
  where status in ('queued', 'claimed', 'validated', 'retryable_error');

create index if not exists arrival_label_browser_purchase_reconcile_idx
  on public.arrival_label_browser_purchase_jobs (status, updated_at)
  where status in ('dispatching', 'purchased', 'artifact_uploaded', 'manual_review');

alter table public.arrival_label_browser_worker_settings enable row level security;
alter table public.arrival_label_browser_purchase_jobs enable row level security;

revoke all on table public.arrival_label_browser_worker_settings from anon, authenticated;
revoke all on table public.arrival_label_browser_purchase_jobs from anon, authenticated;
grant select, insert, update on table public.arrival_label_browser_worker_settings to service_role;
grant select, insert, update on table public.arrival_label_browser_purchase_jobs to service_role;

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

revoke execute on function public.arrival_labels_enqueue_browser_purchase(uuid) from public, anon, authenticated;
revoke execute on function public.arrival_labels_claim_browser_purchase(text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_update_browser_purchase(uuid, text, text, text, text, integer, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_register_browser_artifacts(uuid, text, text, text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_browser_purchase(uuid) to service_role;
grant execute on function public.arrival_labels_claim_browser_purchase(text, integer, timestamptz) to service_role;
grant execute on function public.arrival_labels_update_browser_purchase(uuid, text, text, text, text, integer, uuid, text, timestamptz) to service_role;
grant execute on function public.arrival_labels_register_browser_artifacts(uuid, text, text, text, uuid, uuid, uuid, timestamptz) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arrival-labels-private', 'arrival-labels-private', false, 10485760, array['application/pdf', 'image/png'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'arrival-labels-private'
      and name = 'arrival-labels-private'
      and public is false
      and file_size_limit between 1 and 10485760
      and allowed_mime_types @> array['application/pdf', 'image/png']::text[]
  ) then
    raise exception 'arrival-labels-private bucket exists without the required private size and MIME controls';
  end if;
end;
$$;

comment on table public.arrival_label_browser_worker_settings is 'Fail-closed human approval and cost boundary for the local EasyDPD browser worker.';
comment on table public.arrival_label_browser_purchase_jobs is 'Postgres source of truth and idempotency boundary for exactly-once EasyDPD purchase dispatch.';
