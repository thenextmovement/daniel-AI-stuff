begin;

do $$
begin
  if not exists (
    select 1 from public.arrival_label_product_config
    where version = 'live-b2c-a6-v1'
      and enabled
      and standard_product_code = 'DPD_DE_B2C'
      and printer_key = 'shipping-a6'
      and delivery_note_printer_key = 'shipping-a4-delivery-note'
      and delivery_note_print_media = 'A4'
  ) then
    raise exception 'live product configuration is incomplete';
  end if;
  if not exists (
    select 1 from public.arrival_label_browser_worker_settings
    where singleton
      and not worker_enabled
      and not live_purchase_enabled
      and maximum_purchase_cents = 1500
      and (select count(*) from jsonb_object_keys(approved_products)) = 6
  ) then
    raise exception 'staged browser configuration is incomplete or prematurely live';
  end if;
end;
$$;

insert into public.arrival_label_runs (
  id, correlation_id, trigger_type, mode, local_date, config_version, status
) values (
  '10000000-0000-4000-8000-000000000001',
  'arrival-live-rollout-sql-test',
  'fixture_test',
  'dry_run',
  '2026-07-22',
  'live-b2c-a6-v1',
  'completed'
);

insert into public.arrival_label_cases (
  id, run_id, idempotency_key, incoming_dhl_tracking_number,
  destination_country_code, destination_class, delivery_note_required,
  delivery_note_status, existing_dpd_tracking, original_pdf_path,
  annotated_pdf_path, rendered_preview_path, status
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'arrival-live-rollout-preserve-progress-0001',
  '1234567890',
  'DE',
  'domestic_de',
  false,
  'not_required',
  '01476817678011',
  'storage://arrival-labels-private/original.pdf',
  'storage://arrival-labels-private/annotated.pdf',
  'storage://arrival-labels-private/preview.png',
  'completed'
);

update public.arrival_label_cases
set existing_dpd_tracking = null,
    original_pdf_path = null,
    annotated_pdf_path = null,
    rendered_preview_path = null,
    status = 'label_planned'
where id = '20000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.arrival_label_cases
    where id = '20000000-0000-4000-8000-000000000001'
      and existing_dpd_tracking = '01476817678011'
      and original_pdf_path is not null
      and annotated_pdf_path is not null
      and rendered_preview_path is not null
      and status = 'completed'
  ) then
    raise exception 'case progress regressed during a replayed upsert';
  end if;
end;
$$;

insert into public.arrival_label_cases (
  id, run_id, idempotency_key, incoming_dhl_tracking_number,
  destination_country_code, destination_class, delivery_note_required,
  delivery_note_status, status
) values (
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'arrival-live-rollout-eu-delivery-note-0002',
  '1234567891',
  'AT',
  'eu',
  true,
  'planned',
  'label_planned'
);

insert into public.arrival_label_artifacts (
  id, case_id, artifact_kind, storage_bucket, storage_key, sha256,
  content_type, byte_size, page_width_points, page_height_points, qa_result
) values (
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'delivery_note_pdf',
  'arrival-labels-private',
  'sql-test/delivery-note.pdf',
  repeat('a', 64),
  'application/pdf',
  1024,
  595.28,
  841.89,
  '{"ok":true,"a4":true,"containsPriceFields":false,"pageCount":1,"renderedPageCount":1}'::jsonb
);

select public.arrival_labels_mark_delivery_note_qa_approved(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002'
);

select public.arrival_labels_enqueue_print_job(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  'shipping-a4-delivery-note',
  'arrival-delivery-note-sql-test-000000000002'
);

update public.arrival_label_cases
set delivery_note_status = 'planned'
where id = '20000000-0000-4000-8000-000000000002';

do $$
begin
  if not exists (
    select 1 from public.arrival_label_cases
    where id = '20000000-0000-4000-8000-000000000002'
      and delivery_note_status = 'print_queued'
  ) or not exists (
    select 1 from public.arrival_label_print_jobs
    where case_id = '20000000-0000-4000-8000-000000000002'
      and document_kind = 'delivery_note'
      and printer_key = 'shipping-a4-delivery-note'
      and status = 'queued'
  ) then
    raise exception 'EU delivery note did not pass QA into the A4 print queue';
  end if;
end;
$$;

insert into public.arrival_label_cases (
  id, run_id, idempotency_key, incoming_dhl_tracking_number,
  destination_country_code, destination_class, delivery_note_required,
  delivery_note_status, status
) values (
  '20000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'arrival-live-rollout-wrong-bucket-0003',
  '1234567892',
  'AT',
  'eu',
  true,
  'planned',
  'label_planned'
);

insert into public.arrival_label_artifacts (
  id, case_id, artifact_kind, storage_bucket, storage_key, sha256,
  content_type, byte_size, page_width_points, page_height_points, qa_result
) values (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003',
  'delivery_note_pdf',
  'wrong-bucket',
  'sql-test/wrong-bucket.pdf',
  repeat('b', 64),
  'application/pdf',
  1024,
  595.28,
  841.89,
  '{"ok":true,"a4":true,"containsPriceFields":false,"pageCount":1,"renderedPageCount":1}'::jsonb
);

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.arrival_labels_mark_delivery_note_qa_approved(
      '20000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000003'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'delivery-note QA accepted an artifact outside the private configured bucket';
  end if;
end;
$$;

rollback;
