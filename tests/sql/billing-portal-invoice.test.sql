begin;
do $$ begin
  if to_regprocedure('public.billing_portal_request_invoice(text,boolean,integer,timestamp with time zone,text)') is null then
    raise exception 'Customer invoice request is not implemented';
  end if;
end $$;

create function pg_temp.fixture(n integer) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,
    customer_email,billing_address,delivery_address,line_items,totals,currency,
    subtotal_net_cents,vat_cents,total_gross_cents,payment_method,tax_treatment,tax_review_status,
    status,portal_token_hash)
  values('test','test-'||n,n::text,'#NEONT'||n,'accounts@example.com',
    '{"company":"Testkommune","street":"Testweg 1","zip":"10115","city":"Berlin","country":"DE","invoiceEmail":"accounts@example.com"}',
    '{"street":"Testweg 1","zip":"10115","city":"Berlin","country":"DE"}',
    '[{"title":"Testschild","quantity":1,"unitPriceNet":100,"unitPriceGross":119,"lineGross":119}]',
    '{"subtotalNet":100,"vatAmount":19,"totalGross":119,"currency":"EUR"}','EUR',
    10000,1900,11900,'VORKASSE','DE_STANDARD','NOT_REQUIRED','PAYMENT_PENDING','test-token-'||n)
    returning id into c;
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload)
    values(c,'initial-'||n,'CREATE_PROFORMA','DONE',
      jsonb_build_object('revision',0,'documentNumber','PF-NEONT'||n,'portalUrl','https://rechnung.neontrip.de/'||repeat('a',43)));
  insert into billing_documents(billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
    values(c,'PROFORMA',0,'PF-NEONT'||n,'SENT','test-proforma-'||n,'test',11900,'EUR');
  return c;
end $$;

create function pg_temp.request(n integer, confirmed boolean default true) returns jsonb language plpgsql as $$
declare c billing_cases;
begin
  select * into c from billing_cases where portal_token_hash='test-token-'||n;
  return billing_portal_request_invoice('test-token-'||n,confirmed,c.current_revision,c.updated_at,'2026-10-23');
end $$;

create function pg_temp.reject(sql text, expected text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm=expected then return; end if;
    raise exception 'Expected %, got %',expected,sqlerrm;
  end;
  raise exception 'Expected rejection: %',expected;
end $$;

do $$
declare c uuid; result jsonb; original billing_cases; accepted billing_cases; doc uuid; n integer;
begin
  c:=pg_temp.fixture(98001);
  select * into original from billing_cases where id=c;
  perform pg_temp.reject('select pg_temp.request(98001,false)','BILLING_INVOICE_CONSENT_REQUIRED');
  perform pg_temp.reject('select pg_temp.request(98001,null)','BILLING_INVOICE_CONSENT_REQUIRED');
  perform pg_temp.reject(format('select billing_portal_request_invoice(%L,true,0,%L,%L)','test-token-98001',original.updated_at,'wrong'),'BILLING_INVOICE_CONSENT_REQUIRED');
  perform pg_temp.reject(format('select billing_portal_request_invoice(%L,true,1,%L,%L)','test-token-98001',original.updated_at,'2026-10-23'),'BILLING_INVOICE_STALE');
  perform pg_temp.reject(format('select billing_portal_request_invoice(%L,true,0,%L,%L)','test-token-98001',original.updated_at - interval '1 second','2026-10-23'),'BILLING_INVOICE_STALE');
  result:=pg_temp.request(98001);
  if result->>'status'<>'INVOICE_PENDING' or result->>'duplicate'<>'false' then raise exception 'Invoice not queued'; end if;
  select * into accepted from billing_cases where id=c;
  if accepted.invoice_requested_at is null or accepted.final_invoice_at is not null or accepted.paid_at is not null
    or accepted.payment_method<>'VORKASSE' or accepted.total_gross_cents<>11900 then
    raise exception 'Confirmation changed payment/amount/finalization or failed to lock';
  end if;
  if (select count(*) from billing_events where billing_case_id=c and event_type='CUSTOMER_INVOICE_REQUESTED'
    and payload->>'consentVersion'='2026-10-23' and payload->>'confirmedRevision'='0')<>1 then raise exception 'Missing consent audit'; end if;
  result:=billing_portal_request_invoice('test-token-98001',true,0,original.updated_at,'2026-10-23');
  if result->>'duplicate'<>'true' then raise exception 'Replay not idempotent'; end if;
  if (select count(*) from billing_jobs where billing_case_id=c and job_type='CREATE_INVOICE')<>1 then raise exception 'Duplicate invoice job'; end if;
  perform pg_temp.reject($q$select billing_portal_submit_change('test-token-98001','late-portal-change','{"billingAddress":{"city":"Hamburg"}}','accounts@example.com')$q$,'BILLING_PORTAL_READ_ONLY');
  perform pg_temp.reject(format('update billing_cases set billing_address=%L::jsonb where id=%L','{"city":"Hamburg"}',c),'BILLING_PORTAL_READ_ONLY');
  perform pg_temp.reject(format('update billing_cases set line_items=%L::jsonb where id=%L','[]',c),'BILLING_PORTAL_READ_ONLY');
  perform pg_temp.reject(format('update billing_cases set invoice_requested_at=null where id=%L',c),'BILLING_PORTAL_READ_ONLY');
  perform pg_temp.reject(format('select billing_case_apply_action(%L,%L,%L,%L,%L)',c,'CREATE_PROFORMA','{"reason":"late edit"}','tester','late-new-proforma'),'BILLING_PORTAL_READ_ONLY');
  -- A real payment and finalization must remain possible.
  update billing_cases set paid_at=now() where id=c;
  update billing_cases set final_invoice_at=now(),status='INVOICED' where id=c;
  insert into billing_documents(billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
    values(c,'INVOICE','#NEONT98001','FINALIZED','test-invoice-98001','test',11900,'EUR') returning id into doc;
  if (select count(*) from billing_jobs where billing_case_id=c and job_type='SEND_CUSTOMER_DOCUMENT'
    and payload->>'recipient'='accounts@example.com' and payload->>'billingDocumentId'=doc::text)<>1 then raise exception 'Invoice delivery not queued'; end if;
  perform pg_temp.request(98001);
  if (select count(*) from billing_jobs where billing_case_id=c and job_type='CREATE_INVOICE')<>1 then raise exception 'Replay after finalization duplicates job'; end if;

  c:=pg_temp.fixture(98002);
  insert into billing_change_requests(billing_case_id,idempotency_key,source,requested_changes)
    values(c,'pending-change','OPS','{"billingAddress":{"city":"Hamburg"}}');
  perform pg_temp.reject('select pg_temp.request(98002)','BILLING_INVOICE_CHANGES_PENDING');
  c:=pg_temp.fixture(98003);
  update billing_cases set tax_review_status='REVIEW_REQUIRED' where id=c;
  perform pg_temp.reject('select pg_temp.request(98003)','BILLING_VAT_REVIEW_REQUIRED');
  c:=pg_temp.fixture(98004);
  update billing_cases set portal_revoked_at=now() where id=c;
  perform pg_temp.reject('select pg_temp.request(98004)','BILLING_PORTAL_NOT_FOUND');
  c:=pg_temp.fixture(98005);
  update billing_cases set cancelled_at=now(),status='CANCELLED' where id=c;
  perform pg_temp.reject('select pg_temp.request(98005)','BILLING_INVOICE_NOT_READY');
  c:=pg_temp.fixture(98006);
  update billing_cases set status='SYNC_BLOCKED' where id=c;
  perform pg_temp.reject('select pg_temp.request(98006)','BILLING_INVOICE_NOT_READY');
  c:=pg_temp.fixture(98007);
  update billing_documents set amount_cents=11899 where billing_case_id=c;
  perform pg_temp.reject('select pg_temp.request(98007)','BILLING_INVOICE_PROFORMA_NOT_READY');
  c:=pg_temp.fixture(98008);
  update billing_jobs set status='PROCESSING' where billing_case_id=c;
  perform pg_temp.reject('select pg_temp.request(98008)','BILLING_INVOICE_JOBS_PENDING');
  c:=pg_temp.fixture(98009);
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,payload)
    values(c,'billing:'||c||':invoice','CREATE_INVOICE','{"customerEmailSuppressed":true}');
  perform pg_temp.reject('select pg_temp.request(98009)','BILLING_INVOICE_JOBS_PENDING');
  c:=pg_temp.fixture(98010);
  update billing_cases set payment_method='KAUF_AUF_RECHNUNG',payment_terms_days=30 where id=c;
  perform pg_temp.request(98010);
  if (select payment_terms_days from billing_cases where id=c)<>30 then raise exception 'Payment terms changed'; end if;
  -- Payment-triggered invoice already queued: do not add or alter its job.
  c:=pg_temp.fixture(98011);
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,payload)
    values(c,'billing:'||c||':invoice','CREATE_INVOICE','{"trigger":"PAYMENT_RECEIVED"}');
  perform pg_temp.reject('select pg_temp.request(98011)','BILLING_INVOICE_JOBS_PENDING');
  if has_function_privilege('anon','billing_portal_request_invoice(text,boolean,integer,timestamptz,text)','EXECUTE')
    or has_function_privilege('authenticated','billing_portal_request_invoice(text,boolean,integer,timestamptz,text)','EXECUTE') then raise exception 'Public RPC access'; end if;
end $$;
rollback;
