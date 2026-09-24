-- Run only in an isolated fixture database, after the arrival-label migrations.
-- All state, including simulated purchases/CUPS completions, rolls back.
begin;

create function pg_temp.check_assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'assertion failed: %', message; end if;
end;
$$;

update public.arrival_label_browser_worker_settings
set worker_enabled = true, live_purchase_enabled = true, approved_by = 'fixture', approved_at = now();
update public.arrival_label_outlook_archive_settings set enabled = true, enabled_after = now() - interval '1 hour';
update public.arrival_label_trello_arrival_settings set enabled = true, enabled_after = now() - interval '1 hour';

do $$
#variable_conflict use_variable
declare
  run_id uuid := gen_random_uuid();
  case_id uuid := gen_random_uuid();
  other_case uuid;
  primary_id uuid;
  extra_id uuid;
  purchase public.arrival_label_browser_purchase_jobs%rowtype;
  print_job public.arrival_label_print_jobs%rowtype;
  primary_print uuid;
  original_id uuid;
  annotated_id uuid;
  preview_id uuid;
  tracking text;
  overlay text;
  rejected boolean;
  i integer;
  signature text := 'public.arrival_labels_claim_browser_purchase(text,integer,timestamptz,boolean)';
begin
  perform pg_temp.check_assert(not has_function_privilege('anon', signature, 'execute')
    and not has_function_privilege('authenticated', signature, 'execute')
    and has_function_privilege('service_role', signature, 'execute'), 'capability RPC grants');
  insert into public.arrival_label_runs (id, correlation_id, trigger_type, mode, local_date)
  values (run_id, 'acrylic-parcel-sql-fixture', 'fixture_test', 'dry_run', current_date);
  insert into public.arrival_label_cases (
    id, run_id, idempotency_key, incoming_dhl_tracking_number, shopify_order_id, shopify_order_name,
    shipping_class, destination_country_code, destination_class, selected_dpd_product, status,
    source_snapshot, outlook_message_ids, outlook_delivery_state, trello_card_id
  ) values (
    case_id, run_id, 'acrylic-fixture-arrival-2619113486', '2619113486', 'gid://shopify/Order/9999999999', '#NEONT9999',
    'express_12', 'DE', 'domestic_de', 'DPD_DE_EXPRESS_1200', 'label_planned',
    '{"acrylicTableDeviceRequired":true}', array['fixture-message-acrylic'], 'delivered_today', repeat('a',24)
  );
  select id into primary_id from public.arrival_labels_enqueue_browser_purchase(case_id);
  perform public.arrival_labels_enqueue_browser_purchase(case_id);
  perform pg_temp.check_assert((select count(*) = 2 from public.arrival_label_browser_purchase_jobs j where j.case_id = case_id), 'replay produces exactly two purchases');
  select id into extra_id from public.arrival_label_browser_purchase_jobs j where j.case_id = case_id and parcel_kind = 'acrylic_table_device';
  perform pg_temp.check_assert((select parent_purchase_job_id = primary_id and easydpd_product_label = 'DPD Express 12:00' and maximum_purchase_cents <= 1500
    from public.arrival_label_browser_purchase_jobs where id = extra_id), 'extra inherits parent, Express and price cap');

  for i in 1..2 loop
    if i = 2 then
      perform pg_temp.check_assert(not exists(select 1 from public.arrival_labels_claim_browser_purchase('fixture-old-bridge')), 'old bridge cannot claim extra');
      perform pg_temp.check_assert(not exists(select 1 from public.arrival_label_outlook_archive_jobs a where a.case_id = case_id), 'primary print cannot archive early');
      perform pg_temp.check_assert(public.arrival_labels_enqueue_trello_arrival(case_id) = 0, 'primary print cannot finish Trello early');
    end if;
    select * into purchase from public.arrival_labels_claim_browser_purchase('fixture-new-bridge', p_acrylic_capable => true);
    perform pg_temp.check_assert(purchase.id = case when i = 1 then primary_id else extra_id end, 'claim expected parcel');
    perform pg_temp.check_assert(not exists(select 1 from public.arrival_labels_claim_browser_purchase('fixture-other-worker', p_acrylic_capable => true)), 'other worker cannot claim same or premature extra');
    if i = 2 then
      perform pg_temp.check_assert(purchase.expected_primary_dpd_tracking = '01476817678011', 'extra binds printed primary tracking');
    end if;
    perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'validated');
    perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'dispatching');
    if i = 2 then
      rejected := false;
      begin
        perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'purchased', '01476817678011', repeat('a',64));
      exception when raise_exception then rejected := true;
      end;
      perform pg_temp.check_assert(rejected, 'extra cannot upload primary PDF tracking');
    end if;
    tracking := case when i = 1 then '01476817678011' else '01476817678012' end;
    overlay := case when i = 1 then '113486' else 'Acryl LED-Tischgerät' end;
    rejected := false;
    begin
      perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'purchased', tracking, repeat('a',64), 1501);
    exception when raise_exception then rejected := true;
    end;
    perform pg_temp.check_assert(rejected, 'price cap remains enforced for each parcel');
    perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'purchased', tracking, repeat('a',64), 1000);
    insert into public.arrival_label_artifacts (case_id, parcel_kind, artifact_kind, storage_bucket, storage_key, sha256, content_type, byte_size, qa_result)
    values (case_id, purchase.parcel_kind, 'original_pdf', 'arrival-labels-private', purchase.id || '/original.pdf', repeat('a',64), 'application/pdf', 1024, '{"ok":true}') returning id into original_id;
    insert into public.arrival_label_artifacts (case_id, parcel_kind, artifact_kind, storage_bucket, storage_key, sha256, content_type, byte_size, qa_result)
    values (case_id, purchase.parcel_kind, 'annotated_pdf', 'arrival-labels-private', purchase.id || '/annotated.pdf', repeat('b',64), 'application/pdf', 1024,
      jsonb_build_object('ok',true,'a6',true,'overlayText',overlay)) returning id into annotated_id;
    insert into public.arrival_label_artifacts (case_id, parcel_kind, artifact_kind, storage_bucket, storage_key, sha256, content_type, byte_size, qa_result)
    values (case_id, purchase.parcel_kind, 'rendered_preview', 'arrival-labels-private', purchase.id || '/preview.png', repeat('c',64), 'image/png', 1024, '{"ok":true}') returning id into preview_id;
    if i = 2 then
      rejected := false;
      begin
        perform public.arrival_labels_register_browser_artifacts(purchase.id, 'fixture-new-bridge', tracking, repeat('a',64),
          (select id from public.arrival_label_artifacts a where a.case_id = case_id and a.parcel_kind = 'main' and a.artifact_kind = 'original_pdf'), annotated_id, preview_id);
      exception when raise_exception then rejected := true;
      end;
      perform pg_temp.check_assert(rejected, 'extra cannot reuse a primary artifact');
    end if;
    perform public.arrival_labels_register_browser_artifacts(purchase.id, 'fixture-new-bridge', tracking, repeat('a',64), original_id, annotated_id, preview_id);
    select * into print_job from public.arrival_labels_enqueue_print_job(case_id, annotated_id, 'shipping-a6', 'acrylic-fixture-print:' || purchase.id);
    if i = 2 then
      rejected := false;
      begin
        perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'completed', p_print_job_id => primary_print);
      exception when raise_exception then rejected := true;
      end;
      perform pg_temp.check_assert(rejected, 'extra cannot complete with primary print proof');
    end if;
    perform public.arrival_labels_update_browser_purchase(purchase.id, 'fixture-new-bridge', 'completed', p_print_job_id => print_job.id);
    perform public.arrival_labels_claim_print_job('fixture-print-worker', 'shipping-a6');
    perform public.arrival_labels_update_print_job(print_job.id, 'fixture-print-worker', 'dispatching');
    perform public.arrival_labels_update_print_job(print_job.id, 'fixture-print-worker', 'submitted', 'Fixture_Brother-' || i);
    if i = 1 then
      primary_print := print_job.id;
      perform pg_temp.check_assert(not exists(select 1 from public.arrival_labels_claim_browser_purchase('fixture-other-worker', p_acrylic_capable => true)), 'submitted primary is not a printed primary');
    end if;
    perform public.arrival_labels_confirm_cups_completion(print_job.id, 'fixture-print-worker', 'Fixture_Brother-' || i);
  end loop;
  perform pg_temp.check_assert((select existing_dpd_tracking = '01476817678011' from public.arrival_label_cases where id = case_id), 'extra preserves case primary tracking');
  perform pg_temp.check_assert((select count(*) = 2 from public.arrival_label_print_jobs p where p.case_id = case_id and status = 'printed'), 'two independent printed jobs');
  perform pg_temp.check_assert((select count(*) = 1 from public.arrival_label_outlook_archive_jobs a where a.case_id = case_id), 'archive queued once after both prints');
  update public.arrival_label_outlook_archive_jobs a set status = 'archived', archived_at = now() where a.case_id = case_id;
  perform pg_temp.check_assert((select count(*) = 1 from public.arrival_label_trello_arrival_jobs t where t.case_id = case_id), 'Trello queued after both prints and archive');
  perform pg_temp.check_assert(not exists(select 1 from public.arrival_labels_claim_browser_purchase('fixture-new-bridge', p_acrylic_capable => true)), 'completed extra cannot be replayed');

  -- Another inbound parcel for this Shopify order must not create another acrylic parcel.
  other_case := gen_random_uuid();
  insert into public.arrival_label_cases (id, run_id, idempotency_key, incoming_dhl_tracking_number, shopify_order_id, shopify_order_name, destination_class, selected_dpd_product, status, source_snapshot)
  values (other_case, run_id, 'acrylic-fixture-other-inbound', '2619113487', 'gid://shopify/Order/9999999999', '#NEONT9999', 'domestic_de', 'DPD_DE_B2C', 'label_planned', '{"acrylicTableDeviceRequired":true}');
  perform public.arrival_labels_enqueue_browser_purchase(other_case);
  perform pg_temp.check_assert((select count(*) = 1 from public.arrival_label_browser_purchase_jobs where parcel_kind = 'acrylic_table_device'), 'order-wide extra deduplication');

  -- An existing primary created without the new feature is never backfilled.
  other_case := gen_random_uuid();
  insert into public.arrival_label_cases (id, run_id, idempotency_key, incoming_dhl_tracking_number, shopify_order_id, shopify_order_name, destination_class, selected_dpd_product, status)
  values (other_case, run_id, 'acrylic-fixture-historical-main', '2619113488', 'gid://shopify/Order/9999999998', '#NEONT9998', 'domestic_de', 'DPD_DE_B2C', 'label_planned');
  perform public.arrival_labels_enqueue_browser_purchase(other_case);
  update public.arrival_label_cases set source_snapshot = '{"acrylicTableDeviceRequired":true}' where id = other_case;
  perform public.arrival_labels_enqueue_browser_purchase(other_case);
  perform pg_temp.check_assert((select count(*) = 1 from public.arrival_label_browser_purchase_jobs j where j.case_id = other_case), 'no historical backfill');

  -- Simulate an interrupted extra dispatch in this fixture only. No automatic retry.
  update public.arrival_label_browser_purchase_jobs set status = 'cancelled' where status = 'queued';
  update public.arrival_label_browser_purchase_jobs
  set status = 'dispatching', lease_owner = 'fixture-crashed', lease_expires_at = now() - interval '1 minute'
  where id = extra_id;
  perform pg_temp.check_assert(not exists(select 1 from public.arrival_labels_claim_browser_purchase('fixture-recovery', p_acrylic_capable => true)), 'stale extra dispatch cannot be reclaimed');
  perform pg_temp.check_assert((select status = 'manual_review' from public.arrival_label_browser_purchase_jobs where id = extra_id), 'stale extra becomes manual review');
  perform pg_temp.check_assert((select existing_dpd_tracking = '01476817678011' from public.arrival_label_cases where id = case_id), 'stale extra preserves primary evidence');
  rejected := false;
  begin
    perform public.arrival_labels_update_browser_purchase(extra_id, 'fixture-crashed', 'retryable_error');
  exception when raise_exception then rejected := true;
  end;
  perform pg_temp.check_assert(rejected, 'manual review cannot retry');
end;
$$;

rollback;
