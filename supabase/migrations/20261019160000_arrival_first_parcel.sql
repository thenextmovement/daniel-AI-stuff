begin;
-- One immutable ordered selection per card. No historical queue is replayed.
create table public.arrival_label_first_parcels (
  trello_card_id text primary key check (trello_card_id ~ '^[a-fA-F0-9]{24}$'),
  tracking_numbers text[] not null check (cardinality(tracking_numbers) between 2 and 99),
  blocked_reason text,
  purchase_case_id uuid references public.arrival_label_cases(id),
  created_at timestamptz not null default now()
);
alter table public.arrival_label_first_parcels enable row level security;
revoke all on public.arrival_label_first_parcels from public, anon, authenticated;
grant select, insert, update on public.arrival_label_first_parcels to service_role;

create function public.arrival_labels_protect_first_parcel() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'first parcel selection is permanent'; end if;
  if tg_op = 'UPDATE' and (new.trello_card_id <> old.trello_card_id
    or new.tracking_numbers <> old.tracking_numbers
    or new.blocked_reason is distinct from old.blocked_reason
    or new.created_at <> old.created_at
    or (old.purchase_case_id is not null and new.purchase_case_id is distinct from old.purchase_case_id)) then
    raise exception 'first parcel selection is immutable';
  end if;
  if array_position(new.tracking_numbers, null) is not null
    or exists (select 1 from unnest(new.tracking_numbers) n where n !~ '^[0-9]{10}$')
    or cardinality(new.tracking_numbers) <> (select count(distinct n) from unnest(new.tracking_numbers) n) then
    raise exception 'invalid first parcel tracking list';
  end if;
  return new;
end $$;
create trigger protect_first_parcel before insert or update or delete on public.arrival_label_first_parcels
for each row execute function public.arrival_labels_protect_first_parcel();

create function public.arrival_labels_pin_first_parcel(p_card_id text, p_tracking_numbers text[])
returns setof public.arrival_label_first_parcels
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_hold text;
begin
  perform pg_advisory_xact_lock(hashtextextended('arrival-first-parcel:' || p_card_id, 0));
  if not exists (select 1 from public.arrival_label_first_parcels where trello_card_id = p_card_id) then
    if exists (select 1 from public.arrival_label_cases c where c.trello_card_id = p_card_id
      and (c.existing_dpd_tracking is not null
        or exists (select 1 from public.arrival_label_browser_purchase_jobs j where j.case_id = c.id)
        or exists (select 1 from public.arrival_label_artifacts a where a.case_id = c.id)
        or exists (select 1 from public.arrival_label_print_jobs p where p.case_id = c.id))) then
      v_hold := 'Mehrpaket-Karte hat bereits Kauf-/Label-/Druckbelege; Zuordnung manuell pruefen, kein neuer automatischer Kauf.';
    end if;
    insert into public.arrival_label_first_parcels(trello_card_id, tracking_numbers, blocked_reason)
    values (p_card_id, p_tracking_numbers, v_hold);
  end if;
  return query select * from public.arrival_label_first_parcels where trello_card_id = p_card_id;
end $$;
revoke execute on function public.arrival_labels_pin_first_parcel(text,text[]) from public, anon, authenticated;
grant execute on function public.arrival_labels_pin_first_parcel(text,text[]) to service_role;

create function public.arrival_labels_guard_first_parcel_purchase() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_card text; v_selection public.arrival_label_first_parcels%rowtype;
begin
  select trello_card_id into v_card from public.arrival_label_cases where id = new.case_id;
  perform pg_advisory_xact_lock(hashtextextended('arrival-first-parcel:' || v_card, 0));
  select * into v_selection from public.arrival_label_first_parcels where trello_card_id = v_card for update;
  if found then
    if v_selection.blocked_reason is not null or new.parcel_kind <> 'main'
      or new.incoming_dhl_tracking_number <> v_selection.tracking_numbers[1]
      or (v_selection.purchase_case_id is not null and v_selection.purchase_case_id <> new.case_id) then
      raise exception 'only the pinned first parcel may be purchased; remaining parcels are manual';
    end if;
    update public.arrival_label_first_parcels set purchase_case_id = new.case_id where trello_card_id = v_card;
  end if;
  return new;
end $$;
create trigger guard_first_parcel_purchase before insert or update of case_id, parcel_kind, incoming_dhl_tracking_number on public.arrival_label_browser_purchase_jobs
for each row execute function public.arrival_labels_guard_first_parcel_purchase();

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
  on conflict (case_id, parcel_kind) do nothing
  returning * into v_job;

  if not found then
    select * into v_job from public.arrival_label_browser_purchase_jobs where case_id = v_case.id and parcel_kind = 'main';
    if v_job.shopify_order_id <> v_case.shopify_order_id
      or v_job.selected_dpd_product <> v_case.selected_dpd_product
      or v_job.incoming_dhl_tracking_number <> v_case.incoming_dhl_tracking_number then
      raise exception 'browser purchase idempotency boundary belongs to different input';
    end if;
  else
    -- Only a newly created primary purchase can plan the add-on. No historical backfill.
    if v_case.source_snapshot ->> 'acrylicTableDeviceRequired' = 'true'
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
  if exists (select 1 from public.arrival_label_cases c join public.arrival_label_first_parcels p
    on p.trello_card_id = c.trello_card_id where c.id = p_case_id) then return 0; end if;
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
      and not exists (
        select 1 from public.arrival_label_browser_purchase_jobs extra
        left join public.arrival_label_print_jobs extra_print on extra_print.id = extra.print_job_id
        where extra.case_id = c.id and extra.parcel_kind = 'acrylic_table_device'
          and (extra.status <> 'completed' or extra_print.status is distinct from 'printed' or extra_print.cups_job_id is null)
      )
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
-- Require the selected first-parcel overlay; existing artifacts remain untouched.
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
    or coalesce(v_annotated.qa_result ->> 'overlayText', '') <> (case when v_job.parcel_kind = 'acrylic_table_device' then v_job.incoming_dhl_last_six || ' (Tischgerät)' else v_job.incoming_dhl_last_six || coalesce((select ' Paket 1 von ' || cardinality(p.tracking_numbers)::text
      from public.arrival_label_first_parcels p join public.arrival_label_cases c on c.trello_card_id = p.trello_card_id
      where c.id = v_job.case_id and p.tracking_numbers[1] = v_job.incoming_dhl_tracking_number), '') end)
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

notify pgrst, 'reload schema';
commit;
