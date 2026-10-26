-- One-off operational repair; NOT a migration. This file only defines a session-local
-- function. Execute calls in one explicit transaction after exact-SHA approval and
-- fresh read-only Shopify/easybill/Qonto/VIES checks described in the runbook.
create or replace function pg_temp.repair_billing_source_alignment(
  p_case_id uuid, p_expected_hash text, p_preflight jsonb
) returns jsonb language plpgsql set search_path=public,extensions,pg_temp as $repair$
declare
  c public.billing_cases;
  before_state jsonb;
  after_state jsonb;
  bank jsonb;
  payment_result jsonb;
  event_key text;
  provider_id text;
  proforma_id text;
  expected_order_id text;
  expected_order_name text;
  expected_cents bigint;
  required_financial_status text;
  checked_at timestamptz;
  snapshot jsonb;
  affected integer;
  invoice_job uuid;
  projection_job uuid;
  actor constant text := 'Codex / approved billing-source-alignment 2026-10-26';
begin
  if p_case_id='17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588' then
    expected_order_id := '8513317896459'; expected_order_name := '#NEONT4692';
    expected_cents := 116382; provider_id := '01a17742-cb98-7b8f-af8e-9743ed3ad972';
    proforma_id := '3675733235'; required_financial_status := 'PENDING';
  elsif p_case_id='4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7' then
    expected_order_id := '8618528702731'; expected_order_name := '#NEONT4796';
    expected_cents := 147900; provider_id := '01a16919-e2ff-780e-b230-1496816dc599';
    proforma_id := '3714029841'; required_financial_status := 'PAID';
  else raise exception 'ALIGNMENT_CASE_NOT_ALLOWLISTED';
  end if;
  event_key := 'repair:20261026:billing-source-alignment:'||p_case_id;
  select * into c from public.billing_cases where id=p_case_id for update;
  if not found then raise exception 'ALIGNMENT_CASE_MISSING'; end if;
  if exists(select 1 from billing_events where idempotency_key=event_key) then
    return jsonb_build_object('duplicate',true,'caseId',c.id,'status',c.status);
  end if;
  before_state := to_jsonb(c)-'portal_token_hash'-'created_at'-'updated_at';
  if encode(extensions.digest(before_state::text,'sha256'),'hex') is distinct from p_expected_hash then
    raise exception 'ALIGNMENT_STALE';
  end if;
  if c.shopify_order_id is distinct from expected_order_id
     or c.shopify_order_name is distinct from expected_order_name
     or c.currency is distinct from 'EUR' or c.total_gross_cents is distinct from expected_cents
     or c.current_revision<>0 or c.invoice_requested_at is not null or c.final_invoice_at is not null
     or c.cancelled_at is not null or c.refunded_at is not null
     or c.payment_method is distinct from 'VORKASSE'
     or c.status not in ('PAYMENT_PENDING','MANUAL_REVIEW') then
    raise exception 'ALIGNMENT_CASE_UNSAFE';
  end if;
  if exists(select 1 from billing_documents where billing_case_id=c.id and document_type<>'PROFORMA')
     or exists(select 1 from billing_change_requests where billing_case_id=c.id and status in ('PENDING','APPROVED'))
     or exists(select 1 from billing_jobs where billing_case_id=c.id and status<>'DONE'
          and not(job_type='RECONCILE' and status='PENDING' and payload->>'scope'='MANUAL_SHOPIFY_PAID')) then
    raise exception 'ALIGNMENT_JOBS_UNSAFE';
  end if;
  -- DONE jobs with absent external documents are unsafe too: never silently reuse a key.
  if exists(select 1 from billing_jobs where idempotency_key in (
      'billing:'||c.id||':invoice','billing:'||c.id||':project-payment-easybill')) then
    raise exception 'ALIGNMENT_CANONICAL_JOB_EXISTS';
  end if;
  begin checked_at := (p_preflight->>'checkedAt')::timestamptz;
  exception when others then raise exception 'ALIGNMENT_PREFLIGHT'; end;
  if checked_at is null or checked_at<now()-interval '5 minutes' or checked_at>now()+interval '1 minute'
     or p_preflight->>'shopifyOrderId' is distinct from expected_order_id
     or p_preflight->>'shopifyFinancialStatus' is distinct from required_financial_status
     or p_preflight->>'shopifyTotalCents' is distinct from expected_cents::text
     or p_preflight->'shopifyCancelled' is distinct from 'false'::jsonb
     or p_preflight->'shopifyRefundCount' is distinct from '0'::jsonb
     or p_preflight->'easybillInvoiceSearchComplete' is distinct from 'true'::jsonb
     or p_preflight->'easybillInvoiceCount' is distinct from '0'::jsonb
     or p_preflight->>'proformaId' is distinct from proforma_id
     or p_preflight->'proformaPaidCents' is distinct from '0'::jsonb then
    raise exception 'ALIGNMENT_PREFLIGHT';
  end if;
  if (select count(*) from qonto_transactions where raw->>'id'=provider_id)<>1 then
    raise exception 'ALIGNMENT_BANK_AMBIGUOUS';
  end if;
  select raw into bank from qonto_transactions where raw->>'id'=provider_id for share;
  if bank->>'status' is distinct from 'completed' or bank->>'side' is distinct from 'credit'
     or bank->>'currency' is distinct from 'EUR'
     or (bank->>'amount')::numeric*100 is distinct from expected_cents::numeric
     or position(replace(expected_order_name,'#','') in coalesce(bank->>'reference',''))=0
     or nullif(bank->>'settled_at','') is null then raise exception 'ALIGNMENT_BANK_UNSAFE';
  end if;
  if expected_order_name='#NEONT4692' then
    if c.paid_at is not null or c.tax_review_status is distinct from 'NOT_REQUIRED'
       or c.tax_treatment is distinct from 'DE_STANDARD' or c.tax_exempt
       or exists(select 1 from processed_transactions where transaction_id=provider_id)
       or exists(select 1 from billing_payments where billing_case_id=c.id
                 or (provider='QONTO' and provider_transaction_id=provider_id)) then
      raise exception 'ALIGNMENT_PAYMENT_UNSAFE';
    end if;
    update billing_cases set
      customer=customer||jsonb_build_object('company','Art-Invest Enterprise Offices GmbH & Co. geschlossene Investment KG','invoiceEmail','aif-invoice@art-invest.de'),
      customer_email='aif-invoice@art-invest.de',
      billing_address=billing_address||jsonb_build_object(
        'company','Art-Invest Enterprise Offices GmbH & Co. geschlossene Investment KG',
        'street','Am Kabellager 11-13','zip','51063','city','Köln','country','Deutschland',
        'invoiceEmail','aif-invoice@art-invest.de','sameAsDelivery',false),
      current_revision=current_revision+1,lock_version=lock_version+1
    where id=c.id returning * into c;
  else
    if c.paid_at is null or c.tax_review_status is distinct from 'REVIEW_REQUIRED'
       or c.tax_treatment is distinct from 'EU_B2B_REVERSE_CHARGE' or not c.tax_exempt
       or c.vat_cents<>0 or c.vat_id is distinct from 'LU34785745'
       or (select count(*) from billing_payments where billing_case_id=c.id)<>1
       or not exists(select 1 from billing_payments where billing_case_id=c.id
          and id='1af5d142-949b-49c4-a2e0-3cbce2fd0b4d'
          and provider='QONTO' and provider_transaction_id=provider_id and amount_cents=expected_cents
          and currency='EUR' and match_status='MATCHED' and shopify_projection_status='DONE'
          and abs(extract(epoch from (booked_at-(bank->>'settled_at')::timestamptz)))<1) then
      raise exception 'ALIGNMENT_PAYMENT_UNSAFE';
    end if;
    if p_preflight->'viesValid' is distinct from 'true'::jsonb
       or p_preflight->>'viesVatId' is distinct from c.vat_id
       or regexp_replace(upper(coalesce(p_preflight->>'viesName','')),'[^A-Z0-9]','','g')<>'ALBONDIGASSARL'
       or regexp_replace(upper(coalesce(p_preflight->>'viesAddress','')),'[^A-Z0-9]','','g')<>'22MONTEEDUGRUNDL1645LUXEMBOURG' then
      raise exception 'ALIGNMENT_VAT';
    end if;
    update billing_cases set
      customer=customer||jsonb_build_object('company','Albondigas S.à r.l.'),
      billing_address=(billing_address-'name'-'firstName'-'lastName')||jsonb_build_object(
        'company','Albondigas S.à r.l.','street','22 Montée du Grund','zip','L-1645',
        'city','Luxembourg','country','LU','invoiceEmail','david@esteichen.eu','sameAsDelivery',false),
      tax_review_status='VERIFIED',
      vat_validation=coalesce(vat_validation,'{}'::jsonb)||jsonb_build_object(
        'valid',true,'checked',true,'source','EU_VIES','checkedAt',checked_at,
        'normalizedVatId',c.vat_id,'name',p_preflight->>'viesName','address',p_preflight->>'viesAddress',
        'identityComparison','MATCH','addressComparison','MATCH',
        'manuallyVerified',true,'verifiedAt',now(),'verifiedBy',actor,
        'reviewNote','Customer correction 2026-10-22 and fresh VIES agree; delivery address retained.'),
      current_revision=current_revision+1,lock_version=lock_version+1
    where id=c.id returning * into c;
    update billing_incidents set status='RESOLVED',resolved_by=actor,resolved_at=now()
      where billing_case_id=c.id and incident_key='vat-review:'||c.id and status<>'RESOLVED';
  end if;
  snapshot := jsonb_build_object('billingAddress',c.billing_address,'deliveryAddress',c.delivery_address,
    'customer',c.customer,'customerEmail',c.customer_email,'totals',c.totals,
    'taxReviewStatus',c.tax_review_status,'vatValidation',c.vat_validation,'revision',c.current_revision);
  insert into billing_case_versions(billing_case_id,revision,snapshot_hash,snapshot,source,actor,reason)
    values(c.id,c.current_revision,encode(extensions.digest(snapshot::text,'sha256'),'hex'),snapshot,
      'OPS',actor,'Verified historical customer instruction; no new proforma');
  -- Prevent ordinary payment POST retries before an external invoice even exists.
  -- This is an honest hold, not a completed financial effect. The normal invoice
  -- completion uses this same key with ON CONFLICT DO NOTHING.
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload,last_error)
    values(c.id,'billing:'||c.id||':project-payment-easybill','PROJECT_PAYMENT_EASYBILL',
      'BLOCKED',jsonb_build_object('repairEventKey',event_key,'providerTransactionId',provider_id,
        'amountCents',expected_cents,'customerEmailSuppressed',true,
        'reviewHold','VERIFY_EXTERNAL_PAYMENT_HISTORY_BEFORE_ANY_POST'),
      'Repair safety hold: external invoice/payment history must be reconciled; do not release into ordinary retrying worker.');

  if expected_order_name='#NEONT4692' then
    payment_result := billing_payment_ingest(c.shopify_order_id,'QONTO',provider_id,expected_cents,'EUR',
      (bank->>'settled_at')::timestamptz,event_key||':payment',
      jsonb_build_object('source','APPROVED_SOURCE_ALIGNMENT','reference',bank->>'reference',
        'qontoTransactionId',provider_id,'proformaDocumentId',proforma_id,
        'customerCorrectionDate','2026-09-16T07:04:31Z','sentCorrectedProformaAt','2026-09-16T07:34:34Z'));
    if payment_result->>'matchStatus' is distinct from 'MATCHED'
       or payment_result->'duplicate' is distinct from 'false'::jsonb then
      raise exception 'ALIGNMENT_PAYMENT_RESULT';
    end if;
    update billing_jobs set status='BLOCKED',next_attempt_at=null,
      last_error='Repair no-email hold: Shopify paid-trigger subscribers have not been proved mail-free.',
      payload=payload||jsonb_build_object('repairEventKey',event_key,'customerEmailSuppressed',true,
        'reviewHold','VERIFY_SHOPIFY_PAID_NOTIFICATION_EFFECTS')
      where billing_case_id=c.id
        and idempotency_key='payment:'||(payment_result->>'id')||':shopify'
        and job_type='PROJECT_PAYMENT_SHOPIFY' and status='PENDING'
        and attempt_count=0 and lease_token is null and lease_expires_at is null
      returning id into projection_job;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'ALIGNMENT_SHOPIFY_JOB_UNSAFE'; end if;
    -- Same early replay guard as the normal Qonto path: registered, not yet projected.
    -- The ledger and downstream invoice remain independently verifiable.
    insert into processed_transactions(transaction_id,neon_number,amount,
      shopify_marked_paid,easybill_payment_created,skip_reason,processed_at)
    values(provider_id,replace(expected_order_name,'#',''),expected_cents/100.0,
      false,false,'billing_v2_registered',now());
  else
    perform billing_case_apply_action(c.id,'CREATE_INVOICE',
      jsonb_build_object('reason','Paid Qonto ledger verified; customer billing correction agrees with fresh VIES'),
      actor,event_key||':invoice');
  end if;
  -- Workers cannot see this new invoice until the containing transaction commits.
  -- Existing document trigger reads this origin payload before queuing any email.
  update billing_jobs set payload=payload||jsonb_build_object(
      'customerEmailSuppressed',true,'customerEmailSuppressionReason',
      'User instruction 2026-10-26: no customer email from this repair.',
      'repairEventKey',event_key)
    where billing_case_id=c.id and idempotency_key='billing:'||c.id||':invoice'
      and job_type='CREATE_INVOICE' and status='PENDING' and attempt_count=0
      and lease_token is null and lease_expires_at is null
      and payload->>'documentNumber'=expected_order_name
    returning id into invoice_job;
  get diagnostics affected = row_count;
  if affected<>1 then raise exception 'ALIGNMENT_INVOICE_JOB_UNSAFE'; end if;
  select to_jsonb(updated)-'portal_token_hash'-'created_at'-'updated_at' into after_state
    from billing_cases updated where id=c.id;
  insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values(c.id,event_key,'BILLING_SOURCE_ALIGNMENT','OPS',actor,event_key,
      jsonb_build_object('before',before_state,'after',after_state,'preflight',p_preflight,
        'providerTransactionId',provider_id,'paymentResult',payment_result,
        'customerEmailSuppressed',true,'invoiceJobId',invoice_job,
        'shopifyReviewJobId',projection_job,'easybillProjectionHeld',true));
  return jsonb_build_object('duplicate',false,'caseId',c.id,'status',after_state->>'status',
    'revision',c.current_revision,'invoiceRecipient',c.customer_email);
end;
$repair$;
