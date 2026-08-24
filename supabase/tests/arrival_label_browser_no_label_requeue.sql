begin;

insert into public.arrival_label_runs (
  id, correlation_id, trigger_type, mode, local_date, status
) values (
  '11000000-0000-4000-8000-000000000001',
  'test-browser-no-label-requeue-20260824',
  'fixture_test',
  'dry_run',
  date '2026-08-24',
  'running'
);

insert into public.arrival_label_cases (
  id, run_id, idempotency_key, incoming_dhl_tracking_number,
  shopify_order_id, shopify_order_name, shipping_class,
  destination_country_code, destination_class, selected_dpd_product,
  status, manual_review_reason
) values (
  '21000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001',
  'arrival-label:test-browser-no-label-requeue:1234567890',
  '1234567890',
  'gid://shopify/Order/8377107841291',
  '#NEONT4560',
  'standard',
  'DE',
  'domestic_de',
  'classic',
  'manual_review',
  'EasyDPD-Buchungsstatus ist unklar; händisch prüfen.'
);

insert into public.arrival_label_browser_purchase_jobs (
  id, case_id, idempotency_key, shop_domain, shopify_order_id,
  shopify_order_numeric_id, shopify_order_name, order_url,
  selected_dpd_product, easydpd_product_label, maximum_purchase_cents,
  incoming_dhl_tracking_number, incoming_dhl_last_six, status,
  attempts, lease_owner, dispatching_at, last_error
) values (
  '31000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000002',
  'arrival-browser-purchase:test-browser-no-label-requeue:1234567890',
  'galaxybuzzdk.myshopify.com',
  'gid://shopify/Order/8377107841291',
  '8377107841291',
  '#NEONT4560',
  'https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=8377107841291&shop=galaxybuzzdk.myshopify.com',
  'classic',
  'B2C',
  1500,
  '1234567890',
  '567890',
  'manual_review',
  3,
  'test-existing-chrome-bridge',
  timestamptz '2026-08-24 17:55:00+02',
  'EasyDPD-PDF-Download wurde nicht bestätigt.'
);

select *
from public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(
  '31000000-0000-4000-8000-000000000003',
  '{"source":"easydpd_live_history_after_forced_reload","operatorConfirmation":"no_label_no_tracking","extensionBuildCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","orderName":"#NEONT4560","labelCount":0,"trackingNumbers":[],"observedAt":"2026-08-24T18:00:00+02:00"}'::jsonb,
  'test-arrival-recovery',
  timestamptz '2026-08-24 18:00:00+02'
);

do $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_case public.arrival_label_cases%rowtype;
  v_event_count integer;
  v_signature text := 'public.arrival_labels_requeue_browser_purchase_after_confirmed_no_label(uuid,jsonb,text,timestamptz)';
begin
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = '31000000-0000-4000-8000-000000000003';
  select * into v_case from public.arrival_label_cases
  where id = '21000000-0000-4000-8000-000000000002';
  select count(*) into v_event_count from public.arrival_label_events
  where event_key = 'browser-purchase:31000000-0000-4000-8000-000000000003:confirmed-no-label-requeue';

  if v_job.status <> 'queued'
    or v_job.attempts <> 0
    or v_job.lease_owner is not null
    or v_job.dispatching_at is not null
    or v_job.last_error is not null then
    raise exception 'confirmed-no-label recovery did not reset only the retryable browser state';
  end if;
  if v_case.status <> 'label_planned' or v_case.manual_review_reason is not null then
    raise exception 'confirmed-no-label recovery did not release the case';
  end if;
  if v_event_count <> 1 then
    raise exception 'confirmed-no-label recovery did not write exactly one audit event';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'confirmed-no-label recovery grants are unsafe';
  end if;
end;
$$;

rollback;
