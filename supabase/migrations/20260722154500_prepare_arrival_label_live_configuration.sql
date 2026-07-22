create or replace function public.arrival_labels_preserve_case_progress()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_rank integer;
  new_rank integer;
begin
  old_rank := case old.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  new_rank := case new.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  if old.delivery_note_required and new.delivery_note_required and old_rank > new_rank then
    new.delivery_note_status := old.delivery_note_status;
  end if;
  new.existing_dpd_tracking := coalesce(new.existing_dpd_tracking, old.existing_dpd_tracking);
  new.original_pdf_path := coalesce(new.original_pdf_path, old.original_pdf_path);
  new.annotated_pdf_path := coalesce(new.annotated_pdf_path, old.annotated_pdf_path);
  new.rendered_preview_path := coalesce(new.rendered_preview_path, old.rendered_preview_path);
  if old.status in ('label_created', 'pdf_processed', 'completed')
    and new.status in ('discovered', 'trello_matched', 'shopify_matched', 'validated', 'label_planned', 'existing_label', 'already_fulfilled') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists arrival_label_cases_00_preserve_delivery_note_progress on public.arrival_label_cases;
create trigger arrival_label_cases_00_preserve_delivery_note_progress
before update on public.arrival_label_cases
for each row execute function public.arrival_labels_preserve_case_progress();

revoke execute on function public.arrival_labels_preserve_case_progress() from public, anon, authenticated;
grant execute on function public.arrival_labels_preserve_case_progress() to service_role;

create or replace function public.arrival_labels_mark_delivery_note_qa_approved(
  p_case_id uuid,
  p_artifact_id uuid,
  p_now timestamptz default now()
)
returns setof public.arrival_label_cases
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.arrival_label_cases%rowtype;
  v_artifact public.arrival_label_artifacts%rowtype;
begin
  select * into v_case from public.arrival_label_cases where id = p_case_id for update;
  if not found or not v_case.delivery_note_required or v_case.destination_class <> 'eu' then
    raise exception 'case is not eligible for an EU delivery note';
  end if;
  select * into v_artifact
  from public.arrival_label_artifacts
  where id = p_artifact_id and case_id = p_case_id and artifact_kind = 'delivery_note_pdf'
  for share;
  if not found or v_artifact.content_type <> 'application/pdf'
    or v_artifact.storage_bucket <> coalesce((
      select storage_bucket from public.arrival_label_product_config where enabled limit 1
    ), '')
    or coalesce(v_artifact.qa_result ->> 'ok', 'false') <> 'true'
    or coalesce(v_artifact.qa_result ->> 'a4', 'false') <> 'true'
    or coalesce(v_artifact.qa_result ->> 'containsPriceFields', 'true') <> 'false'
    or coalesce(v_artifact.qa_result ->> 'renderedPageCount', '') !~ '^[1-9][0-9]*$'
    or coalesce(v_artifact.qa_result ->> 'pageCount', '') !~ '^[1-9][0-9]*$' then
    raise exception 'delivery note artifact has no complete A4 and render QA proof';
  end if;
  if (v_artifact.qa_result ->> 'renderedPageCount')::integer <> (v_artifact.qa_result ->> 'pageCount')::integer then
    raise exception 'delivery note artifact has no complete A4 and render QA proof';
  end if;
  if v_case.delivery_note_status in ('planned', 'qa_approved') then
    update public.arrival_label_cases
    set delivery_note_status = 'qa_approved', updated_at = p_now
    where id = p_case_id returning * into v_case;
  elsif v_case.delivery_note_status not in ('print_queued', 'printed') then
    raise exception 'delivery note case is not in a safe QA transition';
  end if;
  return next v_case;
end;
$$;

revoke execute on function public.arrival_labels_mark_delivery_note_qa_approved(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_mark_delivery_note_qa_approved(uuid, uuid, timestamptz) to service_role;

do $$
begin
  if exists (select 1 from public.arrival_label_product_config where enabled and version <> 'live-b2c-a6-v1') then
    raise exception 'a different arrival-label product configuration is already enabled';
  end if;
end;
$$;

insert into public.arrival_label_product_config (
  version, enabled, standard_product_code, express_product_mapping, eu_product_mapping,
  pdf_layout_config, storage_bucket, printer_key, print_media,
  delivery_note_printer_key, delivery_note_print_media, approved_by, approved_at
) values (
  'live-b2c-a6-v1', true, 'DPD_DE_B2C',
  '{"express":"DPD_DE_EXPRESS_18","express_09":"DPD_DE_EXPRESS_0830","express_12":"DPD_DE_EXPRESS_1200","express_18":"DPD_DE_EXPRESS_1800","urgent":"DPD_DE_EXPRESS_18"}'::jsonb,
  '{"standard":"DPD_EU_B2C"}'::jsonb,
  '{"version":"easydpd-a6-2026-07-22-v1","orientation":"portrait","safeArea":{"x":18,"y":190,"width":130,"height":38},"protectedAreas":[{"name":"address_and_sender","x":8,"y":285,"width":281,"height":126},{"name":"reference_and_weight","x":8,"y":245,"width":170,"height":40},{"name":"qr_code","x":175,"y":175,"width":114,"height":112},{"name":"tracking_and_barcode","x":8,"y":0,"width":281,"height":180}],"fontSize":24}'::jsonb,
  'arrival-labels-private', 'shipping-a6', '4x6',
  'shipping-a4-delivery-note', 'A4', 'Daniel Klesse - Chatfreigabe 2026-07-22', now()
)
on conflict (version) do update set
  enabled = excluded.enabled,
  standard_product_code = excluded.standard_product_code,
  express_product_mapping = excluded.express_product_mapping,
  eu_product_mapping = excluded.eu_product_mapping,
  pdf_layout_config = excluded.pdf_layout_config,
  storage_bucket = excluded.storage_bucket,
  printer_key = excluded.printer_key,
  print_media = excluded.print_media,
  delivery_note_printer_key = excluded.delivery_note_printer_key,
  delivery_note_print_media = excluded.delivery_note_print_media,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  updated_at = now();

update public.arrival_label_browser_worker_settings
set maximum_purchase_cents = 1500,
    approved_products = '{"DPD_DE_B2C":{"label":"B2C","maxPurchaseCents":1500},"DPD_EU_B2C":{"label":"B2C","maxPurchaseCents":1500},"DPD_DE_EXPRESS_18":{"label":"DPD Express 18:00","maxPurchaseCents":1500},"DPD_DE_EXPRESS_0830":{"label":"DPD Express 8:30","maxPurchaseCents":1500},"DPD_DE_EXPRESS_1200":{"label":"DPD Express 12:00","maxPurchaseCents":1500},"DPD_DE_EXPRESS_1800":{"label":"DPD Express 18:00","maxPurchaseCents":1500}}'::jsonb,
    approved_by = 'Daniel Klesse - Chatfreigabe bis 15 EUR 2026-07-22',
    approved_at = now(),
    worker_enabled = false,
    live_purchase_enabled = false,
    updated_at = now()
where singleton is true;

comment on function public.arrival_labels_mark_delivery_note_qa_approved(uuid, uuid, timestamptz) is
  'Moves an EU delivery note to QA-approved only after private artifact, A4, price-free and rendered-page proof.';
