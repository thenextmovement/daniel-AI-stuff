begin;

-- Internal customer-request conversion. Shares the portal row lock and freeze guards.
create or replace function public.billing_ops_request_invoice(
  p_case_id uuid, p_revision integer, p_updated_at timestamptz,
  p_actor text, p_customer_request_ref text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.billing_cases; confirmed_at timestamptz; recipient text;
begin
  if nullif(trim(p_actor),'') is null or length(p_actor)>500 then raise exception 'BILLING_ACTOR_REQUIRED'; end if;
  if nullif(trim(p_customer_request_ref),'') is null or length(p_customer_request_ref)>1000 then
    raise exception 'BILLING_INVOICE_CUSTOMER_REQUEST_REQUIRED';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' then
    raise exception 'BILLING_IDEMPOTENCY_REQUIRED';
  end if;
  select * into c from public.billing_cases
    where id=p_case_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;

  -- A response may be lost after committing. Replays return the existing request.
  if c.invoice_requested_at is not null then
    return jsonb_build_object('id',c.id,'status',c.status,'duplicate',true,'invoiceRequestedAt',c.invoice_requested_at);
  end if;
  if c.final_invoice_at is not null then raise exception 'BILLING_PORTAL_READ_ONLY'; end if;
  if p_revision is distinct from c.current_revision or p_updated_at is distinct from c.updated_at then
    raise exception 'BILLING_INVOICE_STALE';
  end if;
  if c.cancelled_at is not null or c.refunded_at is not null
    or c.status not in ('PAYMENT_PENDING','PAID','DELIVERED') then
    raise exception 'BILLING_INVOICE_NOT_READY';
  end if;
  if c.tax_review_status='REVIEW_REQUIRED' then raise exception 'BILLING_VAT_REVIEW_REQUIRED'; end if;
  if exists(select 1 from public.billing_change_requests where billing_case_id=c.id and status in ('PENDING','APPROVED')) then
    raise exception 'BILLING_INVOICE_CHANGES_PENDING';
  end if;
  if exists(select 1 from public.billing_jobs where billing_case_id=c.id and
    (job_type='CREATE_INVOICE' or (status<>'DONE' and job_type in
      ('CREATE_PROFORMA','VERIFY_VAT','SYNC_SHOPIFY_TAX','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA')))) then
    raise exception 'BILLING_INVOICE_JOBS_PENDING';
  end if;
  if exists(select 1 from public.billing_documents where billing_case_id=c.id and document_type='INVOICE')
    or not exists(select 1 from public.billing_documents where billing_case_id=c.id
      and document_type='PROFORMA' and revision=c.current_revision and status in ('FINALIZED','SENT')
      and nullif(easybill_document_id,'') is not null and amount_cents=c.total_gross_cents and currency=c.currency) then
    raise exception 'BILLING_INVOICE_PROFORMA_NOT_READY';
  end if;
  recipient := coalesce(nullif(trim(c.billing_address->>'invoiceEmail'),''),nullif(trim(c.customer_email),''),nullif(trim(c.customer->>'email'),''));
  if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or coalesce(trim(c.billing_address->>'street'),'')=''
    or coalesce(trim(c.billing_address->>'zip'),'')=''
    or coalesce(trim(c.billing_address->>'city'),'')=''
    or coalesce(trim(c.billing_address->>'country'),'')=''
    or coalesce(nullif(trim(c.billing_address->>'company'),''),nullif(trim(c.billing_address->>'name'),'')) is null
    or jsonb_array_length(c.line_items)=0 or c.total_gross_cents<=0 then
    raise exception 'BILLING_INVOICE_DATA_INVALID';
  end if;

  confirmed_at := clock_timestamp();
  insert into public.billing_events(billing_case_id,idempotency_key,event_type,source,actor,payload)
    values(c.id,'ops-invoice:'||c.id,'OPS_CUSTOMER_INVOICE_REQUESTED','OPS',p_actor,
      jsonb_build_object('customerRequestRef',p_customer_request_ref,'idempotencyKey',p_idempotency_key,'confirmedRevision',p_revision,'confirmedAt',confirmed_at,
        'confirmedUpdatedAt',p_updated_at,'recipient',recipient,'billingAddress',c.billing_address,
        'deliveryAddress',c.delivery_address,'lineItems',c.line_items,'totals',c.totals,
        'totalGrossCents',c.total_gross_cents,'currency',c.currency,'paymentMethod',c.payment_method,
        'paymentTermsDays',c.payment_terms_days,'projectNumber',c.project_number,'vatId',c.vat_id));
  insert into public.billing_jobs(billing_case_id,idempotency_key,job_type,payload)
    values(c.id,'billing:'||c.id||':invoice','CREATE_INVOICE',
      jsonb_build_object('documentNumber',c.shopify_order_name,'trigger','CUSTOMER_REQUEST',
        'revision',c.current_revision,'requestSource','OPS_CUSTOMER_REQUEST'));
  update public.billing_cases set invoice_requested_at=confirmed_at,status='INVOICE_PENDING',lock_version=lock_version+1 where id=c.id;
  return jsonb_build_object('id',c.id,'status','INVOICE_PENDING','duplicate',false,'invoiceRequestedAt',confirmed_at);
end;
$$;

revoke all on function public.billing_ops_request_invoice(uuid,integer,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_ops_request_invoice(uuid,integer,timestamptz,text,text,text) to service_role;
commit;
