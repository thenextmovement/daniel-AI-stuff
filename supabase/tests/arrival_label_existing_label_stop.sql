begin;

insert into public.arrival_label_runs (
  id,
  correlation_id,
  trigger_type,
  mode,
  local_date,
  status
) values (
  '10000000-0000-4000-8000-000000000001',
  'test-existing-label-stop-20260723',
  'fixture_test',
  'dry_run',
  date '2026-07-23',
  'running'
);

insert into public.arrival_label_cases (
  id,
  run_id,
  idempotency_key,
  incoming_dhl_tracking_number,
  shopify_order_id,
  shopify_order_name,
  shipping_class,
  destination_country_code,
  destination_class,
  selected_dpd_product,
  status
) values (
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'arrival-label:test-existing-label-stop:1234567890',
  '1234567890',
  'gid://shopify/Order/8377107841291',
  '#NEONT4532',
  'standard',
  'DE',
  'domestic_de',
  'classic',
  'label_planned'
);

insert into public.arrival_label_browser_purchase_jobs (
  id,
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
  status,
  attempts,
  lease_owner,
  lease_expires_at
) values (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  'arrival-browser-purchase:test-existing-label-stop:1234567890',
  'galaxybuzzdk.myshopify.com',
  'gid://shopify/Order/8377107841291',
  '8377107841291',
  '#NEONT4532',
  'https://admin.shopify.com/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create?id=8377107841291&shop=galaxybuzzdk.myshopify.com',
  'classic',
  'B2C',
  1500,
  '1234567890',
  '567890',
  'claimed',
  1,
  'test-existing-chrome-bridge',
  now() + interval '5 minutes'
);

select *
from public.arrival_labels_block_browser_purchase_existing_label(
  '30000000-0000-4000-8000-000000000003',
  'test-existing-chrome-bridge',
  '01476817855492',
  '{"found":true,"labelCount":2,"trackingNumbers":["01476817855492"]}'::jsonb,
  'Test evidence: EasyDPD history already has a label.'
);

do $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_case public.arrival_label_cases%rowtype;
  v_event_count integer;
  v_signature text := 'public.arrival_labels_block_browser_purchase_existing_label(uuid,text,text,jsonb,text,timestamptz)';
begin
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = '30000000-0000-4000-8000-000000000003';
  select * into v_case from public.arrival_label_cases
  where id = '20000000-0000-4000-8000-000000000002';
  select count(*) into v_event_count from public.arrival_label_events
  where event_key = 'browser-purchase:30000000-0000-4000-8000-000000000003:existing-label-blocked';

  if v_job.status <> 'manual_review'
    or v_job.lease_owner is not null
    or v_job.lease_expires_at is not null
    or v_job.dpd_tracking_number <> '01476817855492' then
    raise exception 'existing-label stopper did not close the browser purchase safely';
  end if;
  if v_case.status <> 'manual_review'
    or v_case.existing_dpd_tracking <> '01476817855492'
    or v_case.manual_review_reason not like 'EasyDPD-History%' then
    raise exception 'existing-label stopper did not preserve the case evidence';
  end if;
  if v_event_count <> 1 then
    raise exception 'existing-label stopper did not write exactly one audit event';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'existing-label stopper grants are unsafe';
  end if;
end;
$$;

rollback;
