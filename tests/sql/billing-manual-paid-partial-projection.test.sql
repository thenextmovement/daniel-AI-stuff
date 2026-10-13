-- Local PostgreSQL integration test, inside a transaction; no external workers.
BEGIN;
DO $test$
DECLARE
  c uuid;
  result jsonb;
  evidence jsonb;
  total integer;
BEGIN
  insert into billing_cases (source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash,final_invoice_at)
  values ('test','test','900001','#NEONT900001','EUR',56350,10706,67056,'DE_STANDARD','NOT_REQUIRED','INVOICED','test-900001',now()) returning id into c;
  insert into billing_documents (billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
  values(c,'INVOICE','#NEONT900001','SENT','900001','test',67056,'EUR');
  evidence:=jsonb_build_object('source','NEONTRIP Manual Shopify Paid Qonto Reconciliation v1',
    'projectionPolicy','EXACT_EXISTING_INVOICE_REMAINDER','manualShopifyTransactionId','900001',
    'easybillDocumentId','900001','easybillPaidCentsBefore',33528,'easybillRemainingCentsBefore',33528,
    'qontoTransactionIds',jsonb_build_array('test-deposit','test-balance'));
  result:=billing_payment_ingest('900001','QONTO','test-deposit',33528,'EUR',now(),'test-deposit',evidence);
  assert result->>'matchStatus'='PARTIAL','deposit bookkeeping mismatch';
  result:=billing_payment_ingest('900001','QONTO','test-balance',33528,'EUR',now(),'test-balance',evidence);
  assert result->>'matchStatus'='MATCHED','balance bookkeeping mismatch';
  select count(*) into total from billing_payments where billing_case_id=c;
  assert total=2,'expected exactly two bank records';
  select count(*) into total from billing_jobs where billing_case_id=c and job_type='PROJECT_PAYMENT_EASYBILL';
  assert total=0,'must not enqueue an additional cumulative Easybill booking';
  select count(*) into total from billing_jobs where billing_case_id=c and job_type in ('CREATE_INVOICE','SEND_CUSTOMER_DOCUMENT');
  assert total=0,'existing invoice and sent mail must not be recreated';
  result:=billing_payment_ingest('900001','QONTO','test-balance',33528,'EUR',now(),'test-balance',evidence);
  assert (result->>'duplicate')::boolean,'same provider payment must be reused';
  begin
    perform billing_payment_ingest('900001','QONTO','test-invalid',1,'EUR',now(),'test-invalid',evidence);
    raise exception 'test_missing_rejection';
  exception when others then
    if SQLERRM<>'BILLING_MANUAL_PARTIAL_PROJECTION_EVIDENCE_INVALID' then raise; end if;
  end;
  begin
    perform billing_payment_ingest('900001','QONTO','test-invalid',1,'EUR',now(),'test-invalid',
      evidence||'{"qontoTransactionIds":["test-invalid"],"easybillDocumentId":"999999"}');
    raise exception 'test_missing_rejection';
  exception when others then
    if SQLERRM<>'BILLING_MANUAL_PARTIAL_PROJECTION_EVIDENCE_INVALID' then raise; end if;
  end;

  -- Neighbour: ordinary full payments still enqueue their existing projection.
  insert into billing_cases (source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash,final_invoice_at)
  values ('test','test','900002','#NEONT900002','EUR',8403,1597,10000,'DE_STANDARD','NOT_REQUIRED','INVOICED','test-900002',now()) returning id into c;
  insert into billing_documents (billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
  values(c,'INVOICE','#NEONT900002','SENT','900002','test',10000,'EUR');
  perform billing_payment_ingest('900002','QONTO','test-full',10000,'EUR',now(),'test-full','{}');
  select count(*) into total from billing_jobs where billing_case_id=c and job_type='PROJECT_PAYMENT_EASYBILL' and (payload->>'amountCents')::integer=10000;
  assert total=1,'ordinary full projection must remain unchanged';

  -- Neighbour: the deployed Skonto policy must survive this bounded function patch.
  insert into billing_cases (source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash,final_invoice_at,payment_policy_code,cash_allowance_percent,cash_allowance_days)
  values ('test','test','900003','#NEONT900003','EUR',8403,1597,10000,'DE_STANDARD','NOT_REQUIRED','INVOICED','test-900003',now(),'UMDASCH_3PCT_30D',3,30) returning id into c;
  insert into billing_documents (billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
  values(c,'INVOICE','#NEONT900003','SENT','900003','test',10000,'EUR');
  result:=billing_payment_ingest('900003','QONTO','test-skonto',9700,'EUR',now(),'test-skonto','{}');
  assert result->>'settlementType'='SKONTO','Skonto policy changed';
  select count(*) into total from billing_jobs where billing_case_id=c and job_type='PROJECT_PAYMENT_EASYBILL' and (payload->>'amountCents')::integer=9700 and (payload->>'markPaid')::boolean;
  assert total=1,'Skonto projection changed';
END;
$test$;
ROLLBACK;
