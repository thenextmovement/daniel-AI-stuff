-- Run only in an isolated database with the existing billing schema and triggers.
begin;
do $test$
declare
  c uuid;
  j uuid;
  n integer;
  result jsonb;
  actual text;
  scenario text;
  seq integer := 0;
  expected text;
begin
  foreach scenario in array array['unpaid','tax_review','paid','invoiced','invoice_on_terms'] loop
    seq := seq + 1;
    expected := case scenario when 'unpaid' then 'PAYMENT_PENDING'
      when 'tax_review' then 'MANUAL_REVIEW' when 'paid' then 'INVOICE_PENDING' else 'INVOICED' end;
    insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,
      customer_email,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,
      tax_review_status,status,paid_at,final_invoice_at,portal_token_hash)
    values ('isolated-test','fixture','test-race-'||seq,'#NEONT'||(99000+seq),'test@example.invalid',
      'EUR',1000,190,1190,'DE_STANDARD',case when scenario='tax_review' then 'REVIEW_REQUIRED' else 'NOT_REQUIRED' end,
      expected,case when scenario in ('paid','invoiced') then now() end,
      case when scenario in ('invoiced','invoice_on_terms') then now() end,'test-token-'||seq)
    returning id into c;

    -- Tax sync finishes after the payment/invoice. Only unpaid cases get a revision.
    insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload)
      values(c,'tax-'||seq,'SYNC_SHOPIFY_TAX','PROCESSING',
        jsonb_build_object('nextJobType','CREATE_PROFORMA','documentNumber','PF-NEONT'||(99000+seq)||'-1',
          'revision',1,'portalUrl','https://rechnung.neontrip.de/test')) returning id into j;
    update billing_jobs set status='DONE' where id=j;
    update billing_jobs set status='DONE' where id=j;
    select count(*) into n from billing_jobs where billing_case_id=c and idempotency_key='tax-'||seq||':easybill';
    if n <> (case when scenario in ('unpaid','tax_review') then 1 else 0 end) then
      raise exception 'tax-sync queue failure: %, count %',scenario,n;
    end if;

    -- Already claimed proforma completes later. Preserve provider evidence and paid state.
    insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload,lease_token,lease_expires_at,attempt_count)
      values(c,'late-proforma-'||seq,'CREATE_PROFORMA','PROCESSING',
        jsonb_build_object('documentNumber','PF-NEONT'||(99000+seq),'revision',0,
          'portalUrl','https://rechnung.neontrip.de/test'),
        'test-lease',now()+interval '5 minutes',1) returning id into j;
    result := billing_job_complete(j,'test-lease',true,jsonb_build_object(
      'documentNumber','PF-NEONT'||(99000+seq),'easybillDocumentId','test-pf-'||seq,'payloadHash','test'));
    select status into actual from billing_cases where id=c;
    if actual <> expected then raise exception 'case status regression: %, %',scenario,actual; end if;
    select count(*) into n from billing_documents where billing_case_id=c and document_type='PROFORMA' and status='FINALIZED';
    if n<>1 then raise exception 'provider evidence lost: %',scenario; end if;
    select count(*) into n from billing_jobs where billing_case_id=c and job_type='SEND_CUSTOMER_DOCUMENT';
    if n <> (case when scenario in ('unpaid','tax_review') then 1 else 0 end) then
      raise exception 'delivery guard failure: %, count %',scenario,n;
    end if;
    -- An unchanged finalized document does not duplicate its existing delivery.
    update billing_documents set status='FINALIZED' where billing_case_id=c;
    select count(*) into n from billing_jobs where billing_case_id=c and job_type='SEND_CUSTOMER_DOCUMENT';
    if n <> (case when scenario in ('unpaid','tax_review') then 1 else 0 end) then
      raise exception 'delivery dedup failure: %',scenario;
    end if;
    -- Completed lease cannot be replayed.
    begin
      perform billing_job_complete(j,'test-lease',true,'{}');
      raise exception 'lease replay accepted';
    exception when others then
      if sqlerrm <> 'BILLING_JOB_LEASE_INVALID' then raise; end if;
    end;
    -- Neighbor: final invoices still queue delivery; payment projection only when paid.
    insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload,lease_token,lease_expires_at,attempt_count)
      values(c,'invoice-'||seq,'CREATE_INVOICE','PROCESSING',
        jsonb_build_object('documentNumber','#NEONT'||(99000+seq),'portalUrl','https://rechnung.neontrip.de/test'),
        'invoice-lease',now()+interval '5 minutes',1) returning id into j;
    perform billing_job_complete(j,'invoice-lease',true,jsonb_build_object(
      'documentNumber','#NEONT'||(99000+seq),'easybillDocumentId','test-invoice-'||seq,'payloadHash','test'));
    select count(*) into n from billing_jobs where billing_case_id=c and job_type='SEND_CUSTOMER_DOCUMENT' and payload->>'documentType'='INVOICE';
    if n<>1 then raise exception 'invoice delivery changed: %',scenario; end if;
    select count(*) into n from billing_jobs where billing_case_id=c and job_type='PROJECT_PAYMENT_EASYBILL';
    if n <> (case when scenario in ('paid','invoiced') then 1 else 0 end) then
      raise exception 'invoice payment projection changed: %',scenario;
    end if;
    raise notice 'PASS %: queue, completion, delivery, dedup, lease, invoice neighbor',scenario;
  end loop;
end;
$test$;
rollback;
