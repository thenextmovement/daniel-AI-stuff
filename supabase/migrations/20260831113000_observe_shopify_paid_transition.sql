create or replace function public.billing_case_observe_shopify_paid(
  p_shopify_order_id text,
  p_source_event_id text,
  p_paid_at timestamptz,
  p_currency text,
  p_total_gross_cents bigint,
  p_portal_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case public.billing_cases;
  v_invoice public.billing_documents;
  v_event_id uuid;
  v_replay boolean := false;
  v_job_type text;
  v_job_id uuid;
begin
  if nullif(trim(p_shopify_order_id), '') is null then
    raise exception 'SHOPIFY_ORDER_ID_REQUIRED';
  end if;
  if nullif(trim(p_source_event_id), '') is null then
    raise exception 'SOURCE_EVENT_ID_REQUIRED';
  end if;

  select *
  into v_case
  from public.billing_cases
  where shopify_order_id = p_shopify_order_id
     or replace(shopify_order_id, 'gid://shopify/Order/', '') =
        replace(p_shopify_order_id, 'gid://shopify/Order/', '')
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'BILLING_CASE_NOT_FOUND';
  end if;
  if upper(v_case.currency) <> upper(p_currency) then
    raise exception 'BILLING_PAYMENT_CURRENCY_MISMATCH';
  end if;
  if v_case.total_gross_cents <> p_total_gross_cents then
    raise exception 'BILLING_PAYMENT_AMOUNT_MISMATCH';
  end if;

  insert into public.billing_events (
    billing_case_id,
    idempotency_key,
    event_type,
    source,
    actor,
    correlation_id,
    payload
  ) values (
    v_case.id,
    p_source_event_id || ':payment-observed',
    'SHOPIFY_PAYMENT_OBSERVED',
    'SHOPIFY',
    'shopify-universal-ingress',
    p_source_event_id,
    jsonb_build_object(
      'paidAt', coalesce(p_paid_at, now()),
      'currency', upper(p_currency),
      'totalGrossCents', p_total_gross_cents,
      'portalUrl', p_portal_url
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    v_replay := true;
  end if;

  update public.billing_cases
  set paid_at = coalesce(paid_at, p_paid_at, now()),
      status = case
        when tax_review_status = 'REVIEW_REQUIRED' then 'MANUAL_REVIEW'
        when final_invoice_at is not null then 'INVOICED'
        else 'INVOICE_PENDING'
      end,
      lock_version = lock_version + 1,
      updated_at = now()
  where id = v_case.id
  returning * into v_case;

  if v_case.tax_review_status <> 'REVIEW_REQUIRED' then
    select *
    into v_invoice
    from public.billing_documents
    where billing_case_id = v_case.id
      and document_type = 'INVOICE'
      and status in ('FINALIZED', 'SENT')
      and easybill_document_id is not null
    order by revision desc, created_at desc
    limit 1;

    if found then
      v_job_type := 'PROJECT_PAYMENT_EASYBILL';
      insert into public.billing_jobs (
        billing_case_id,
        idempotency_key,
        job_type,
        status,
        payload
      ) values (
        v_case.id,
        'billing:' || v_case.id || ':project-payment-easybill',
        v_job_type,
        'PENDING',
        jsonb_build_object(
          'easybillDocumentId', v_invoice.easybill_document_id,
          'amountCents', v_case.total_gross_cents,
          'paidAt', v_case.paid_at
        )
      )
      on conflict (idempotency_key) do update
      set status = 'PENDING',
          attempt_count = 0,
          next_attempt_at = null,
          lease_token = null,
          lease_expires_at = null,
          last_error = null,
          updated_at = now()
      where billing_jobs.status in ('FAILED', 'BLOCKED')
      returning id into v_job_id;
    else
      v_job_type := 'CREATE_INVOICE';
      insert into public.billing_jobs (
        billing_case_id,
        idempotency_key,
        job_type,
        status,
        payload
      ) values (
        v_case.id,
        'billing:' || v_case.id || ':invoice',
        v_job_type,
        'PENDING',
        jsonb_build_object(
          'documentNumber', v_case.shopify_order_name,
          'trigger', 'SHOPIFY_PAYMENT_OBSERVED',
          'portalUrl', p_portal_url
        )
      )
      on conflict (idempotency_key) do update
      set status = 'PENDING',
          attempt_count = 0,
          next_attempt_at = null,
          lease_token = null,
          lease_expires_at = null,
          last_error = null,
          updated_at = now()
      where billing_jobs.status in ('FAILED', 'BLOCKED')
      returning id into v_job_id;
    end if;
  end if;

  return jsonb_build_object(
    'billingCaseId', v_case.id,
    'status', v_case.status,
    'paidAt', v_case.paid_at,
    'jobType', v_job_type,
    'jobId', v_job_id,
    'replay', v_replay
  );
end;
$$;

revoke all on function public.billing_case_observe_shopify_paid(text, text, timestamptz, text, bigint, text)
from public, anon, authenticated;
grant execute on function public.billing_case_observe_shopify_paid(text, text, timestamptz, text, bigint, text)
to service_role;
