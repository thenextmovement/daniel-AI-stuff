-- Replace the pilot allowlist with deterministic recipient selection. This
-- migration deliberately does not backfill finalized documents: existing
-- recipients must be reviewed before any historical customer delivery.

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
  v_recipient_source text;
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

  v_recipient := lower(btrim(coalesce(
    nullif(v_case.billing_address->>'invoiceEmail', ''),
    nullif(v_case.customer_email, ''),
    nullif(v_case.customer->>'email', ''),
    ''
  )));
  v_recipient_source := case
    when nullif(btrim(v_case.billing_address->>'invoiceEmail'), '') is not null then 'INVOICE_EMAIL'
    when nullif(btrim(v_case.customer_email), '') is not null then 'BILLING_CASE_EMAIL'
    when nullif(btrim(v_case.customer->>'email'), '') is not null then 'CUSTOMER_EMAIL_FALLBACK'
    else 'MISSING'
  end;

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
    'send-customer-document:' || new.id::text,
    'SEND_CUSTOMER_DOCUMENT',
    jsonb_build_object(
      'billingDocumentId', new.id,
      'easybillDocumentId', new.easybill_document_id,
      'documentNumber', new.document_number,
      'documentType', new.document_type,
      'deliveryKind', v_delivery_kind,
      'recipient', v_recipient,
      'recipientSource', v_recipient_source,
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

-- Keep the original customer address as a delivery fallback when an explicit
-- invoice address is approved later through the customer portal or Ops.
create or replace function public.billing_preserve_customer_email_fallback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_customer_email text;
begin
  v_previous_customer_email := lower(btrim(coalesce(old.customer->>'email', '')));

  if new.customer_email is distinct from old.customer_email
    and v_previous_customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(btrim(coalesce(new.customer_email, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(btrim(coalesce(new.customer_email, ''))) <> v_previous_customer_email then
    new.customer := coalesce(new.customer, '{}'::jsonb)
      || jsonb_build_object(
        'email', v_previous_customer_email,
        'invoiceEmail', lower(btrim(new.customer_email))
      );
  end if;

  return new;
end;
$$;

drop trigger if exists billing_preserve_customer_email_fallback_trigger on public.billing_cases;
create trigger billing_preserve_customer_email_fallback_trigger
before update of customer_email on public.billing_cases
for each row execute function public.billing_preserve_customer_email_fallback();

revoke all on function public.billing_preserve_customer_email_fallback() from public, anon, authenticated;
grant execute on function public.billing_preserve_customer_email_fallback() to service_role;
