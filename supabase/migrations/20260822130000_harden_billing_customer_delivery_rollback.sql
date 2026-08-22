drop trigger if exists billing_preserve_customer_email_fallback_trigger on public.billing_cases;
drop function if exists public.billing_preserve_customer_email_fallback();

-- Restore the original pilot allowlist without touching finalized documents or
-- the separate SENT-status trigger.
create or replace function public.billing_queue_customer_document_after_finalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.billing_cases;
  v_origin_payload jsonb := '{}'::jsonb;
  v_initial_payload jsonb := '{}'::jsonb;
  v_recipient text;
  v_delivery_kind text;
  v_portal_url text;
begin
  if new.status <> 'FINALIZED'
    or (tg_op = 'UPDATE' and old.status = 'FINALIZED') then
    return new;
  end if;

  select * into v_case
  from public.billing_cases
  where id = new.billing_case_id;

  if not found then
    return new;
  end if;

  v_recipient := lower(btrim(coalesce(v_case.customer_email, '')));
  if v_recipient not in ('rahim.hedayati@icloud.com', 'info@riesenobjekte.de') then
    return new;
  end if;

  select coalesce(j.payload, '{}'::jsonb) into v_origin_payload
  from public.billing_jobs j
  where j.billing_case_id = new.billing_case_id
    and j.job_type = case new.document_type
      when 'PROFORMA' then 'CREATE_PROFORMA'
      when 'INVOICE' then 'CREATE_INVOICE'
      when 'CREDIT' then 'CREATE_CREDIT'
      when 'CANCELLATION' then 'CREATE_CANCELLATION'
    end
    and j.payload->>'documentNumber' = new.document_number
  order by j.created_at desc
  limit 1;

  if new.document_type = 'INVOICE'
    and lower(coalesce(v_origin_payload->>'customerEmailSuppressed', 'false')) = 'true' then
    return new;
  end if;

  select coalesce(j.payload, '{}'::jsonb) into v_initial_payload
  from public.billing_jobs j
  where j.billing_case_id = new.billing_case_id
    and j.job_type = 'CREATE_PROFORMA'
    and coalesce((j.payload->>'revision')::integer, 0) = 0
  order by j.created_at asc
  limit 1;

  v_portal_url := coalesce(nullif(v_origin_payload->>'portalUrl', ''), nullif(v_initial_payload->>'portalUrl', ''));
  if v_portal_url !~ '^https://rechnung\.neontrip\.de/[A-Za-z0-9_-]+$' then
    raise exception 'BILLING_CUSTOMER_DELIVERY_PORTAL_URL_INVALID';
  end if;

  v_delivery_kind := case new.document_type
    when 'PROFORMA' then case when new.revision = 0 then 'ORDER_CONFIRMATION_PROFORMA' else 'PROFORMA_UPDATE' end
    when 'INVOICE' then 'INVOICE'
    when 'CREDIT' then 'CREDIT'
    when 'CANCELLATION' then 'CANCELLATION'
  end;

  insert into public.billing_jobs (billing_case_id, idempotency_key, job_type, payload)
  values (
    new.billing_case_id,
    'send-customer-document:' || new.id::text || ':' || v_recipient,
    'SEND_CUSTOMER_DOCUMENT',
    jsonb_build_object(
      'billingDocumentId', new.id,
      'easybillDocumentId', new.easybill_document_id,
      'documentNumber', new.document_number,
      'documentType', new.document_type,
      'deliveryKind', v_delivery_kind,
      'recipient', v_recipient,
      'portalUrl', v_portal_url,
      'shopifyOrderName', v_case.shopify_order_name,
      'sourceOfferId', v_case.source_offer_id,
      'projectNumber', v_case.project_number
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.billing_queue_customer_document_after_finalize() from public, anon, authenticated;
grant execute on function public.billing_queue_customer_document_after_finalize() to service_role;
