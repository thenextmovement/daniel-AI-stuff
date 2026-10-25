-- Disposable PostgreSQL only; no provider calls.
BEGIN;
DO $test$
DECLARE
 c uuid; other_case uuid; old_job uuid; picked jsonb; receipt jsonb; old_receipt jsonb;
 count_before int; protected_before jsonb; protected_after jsonb; failed boolean;
 request jsonb:='{"scope":"MANUAL_SHOPIFY_PAID","operation":"claim","worker":"isolated-test","executionId":"101","jobTypes":["RECONCILE"],"leaseSeconds":120,"candidates":[]}';
BEGIN
 assert to_regclass('public.billing_manual_paid_claim_receipts') is not null,
   'A committed claim must leave durable execution/order evidence after its HTTP response is lost';
 insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash)
 values('test','snapshot','900001','#NEONT900001','EUR',840,160,1000,'DE_STANDARD','NOT_REQUIRED','INVOICED','isolated-token') returning id into c;
 insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash)
 values('test','other','900002','#NEONT900002','EUR',840,160,1000,'DE_STANDARD','NOT_REQUIRED','INVOICED','isolated-other') returning id into other_case;
 insert into billing_documents(billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
 values(c,'INVOICE','#NEONT900001','SENT','123','snapshot',1000,'EUR');
 insert into billing_payments(billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status,shopify_projection_status,easybill_projection_status)
 values(c,'QONTO','isolated-paid',1000,'EUR',now(),'MATCHED','DONE','DONE');
 insert into billing_jobs(billing_case_id,idempotency_key,job_type,status) values(c,'isolated-sent','SEND_CUSTOMER_DOCUMENT','DONE');
 select jsonb_build_object('cases',(select jsonb_agg(to_jsonb(x) order by id) from billing_cases x),
 'documents',(select jsonb_agg(to_jsonb(x) order by id) from billing_documents x),
 'payments',(select jsonb_agg(to_jsonb(x) order by id) from billing_payments x),
 'events',(select jsonb_agg(to_jsonb(x) order by id) from billing_events x),
 'other_jobs',(select jsonb_agg(to_jsonb(x) order by id) from billing_jobs x where job_type<>'RECONCILE')) into protected_before;
 -- Admission and a later poll have separate immutable receipts.
 picked:=billing_manual_paid_claim(request||'{"operation":"admit","candidates":[{"origin":"handoff","shopifyOrderId":"900001","shopifyOrderName":"#NEONT900001","amountCents":1000,"currency":"EUR"}]}');
 select evidence into receipt from billing_manual_paid_claim_receipts where execution_id='101';
 assert receipt->>'selection'='none' and receipt#>>'{intake,0,billingCaseId}'=c::text,'admission is not a claim';
 select id into old_job from billing_jobs where billing_case_id=c and payload->>'scope'='MANUAL_SHOPIFY_PAID';
 update billing_jobs set next_attempt_at=now()-interval '1 minute' where id=old_job;
 -- Supplied handoff is NOT necessarily the selected order. Lost response must be reconstructible.
 perform billing_manual_paid_claim(request||'{"executionId":"102","candidates":[{"origin":"handoff","shopifyOrderId":"900002","shopifyOrderName":"#NEONT900002","amountCents":1000,"currency":"EUR"}]}');
 select evidence into receipt from billing_manual_paid_claim_receipts where execution_id='102';
 assert receipt#>>'{candidates,0,shopifyOrderId}'='900002','retain offered input separately';
 assert receipt->>'selection'='canonical' and receipt#>>'{selected,shopifyOrderId}'='900001'
   and receipt#>>'{selected,billingCaseId}'=c::text and receipt#>>'{selected,jobId}'=old_job::text,'persist actual selected job/order';
 old_receipt:=receipt;
 assert receipt::text !~ '(lease_token|leaseToken|portal_token|email|address|customer_name)','never persist authorization or customer payload';
 assert (select request_fingerprint ~ '^[a-f0-9]{64}$' from billing_manual_paid_claim_receipts where execution_id='102'),'bind exact request without storing it';
 -- An unknown HTTP outcome remains blocked on expiry; audit is no replay authorization.
 update billing_jobs set lease_expires_at=now()-interval '1 second' where id=old_job;
 perform billing_manual_paid_claim(request||'{"executionId":"103"}');
 assert (select status='BLOCKED' and last_error='LEASE_EXPIRED_REVIEW_REQUIRED' from billing_jobs where id=old_job),'expiry remains review-only';
 assert (select evidence=old_receipt from billing_manual_paid_claim_receipts where execution_id='102'),'later polls cannot overwrite historical evidence';
 -- Simulate later separately authorized reconciliation; still preserve the old execution binding.
 update billing_jobs set status='PENDING',next_attempt_at=now()-interval '2 minutes' where id=old_job;
 picked:=billing_manual_paid_claim(request||'{"executionId":"104"}');
 assert picked#>>'{claimed,job,id}'=old_job::text,'fixture reclaims same job';
 assert (select evidence=old_receipt from billing_manual_paid_claim_receipts where execution_id='102'),'new claim must not erase old execution';
 -- No-work is positively recorded, not inferred from absence of a receipt.
 perform billing_manual_paid_claim(request||'{"executionId":"105"}');
 assert (select evidence->>'selection'='none' from billing_manual_paid_claim_receipts where execution_id='105'),'record no selection';
 perform billing_manual_paid_claim(request||'{"executionId":"106","candidates":[{"origin":"handoff","shopifyOrderId":"900003","shopifyOrderName":"#NEONT900003"}]}');
 assert (select evidence->>'selection'='legacy' and evidence#>>'{selected,shopifyOrderId}'='900003' from billing_manual_paid_claim_receipts where execution_id='106'),'legacy selection is explicitly distinguished';
 select count(*) into count_before from billing_manual_paid_claim_receipts;
 begin
   perform billing_manual_paid_claim(request||'{"executionId":"107","candidates":[{"origin":"handoff","shopifyOrderId":"900004","shopifyOrderName":"#NEONT900004","currency":"USD"}]}');
   raise exception 'expected invalid currency rejection';
 exception when others then if SQLERRM<>'MANUAL_PAID_CURRENCY_INVALID' then raise; end if; end;
 assert (select count(*)=count_before from billing_manual_paid_claim_receipts),'rejected transaction must not leave false success receipt';
 -- Same execution may call admit and claim (legacy binding); no uniqueness change to the claim contract.
 perform billing_manual_paid_claim(request||'{"executionId":"105","operation":"admit"}');
 assert (select count(*)=2 from billing_manual_paid_claim_receipts where execution_id='105'),'append distinct requests, never overwrite or suppress calls';
 select jsonb_build_object('cases',(select jsonb_agg(to_jsonb(x) order by id) from billing_cases x),
 'documents',(select jsonb_agg(to_jsonb(x) order by id) from billing_documents x),
 'payments',(select jsonb_agg(to_jsonb(x) order by id) from billing_payments x),
 'events',(select jsonb_agg(to_jsonb(x) order by id) from billing_events x),
 'other_jobs',(select jsonb_agg(to_jsonb(x) order by id) from billing_jobs x where job_type<>'RECONCILE')) into protected_after;
 assert protected_before=protected_after,'receipts must not modify payments, invoices, cases, events or customer-send jobs';
 assert not has_table_privilege('anon','billing_manual_paid_claim_receipts','SELECT')
 and not has_table_privilege('authenticated','billing_manual_paid_claim_receipts','SELECT'),'receipt data is internal';
 assert has_table_privilege('service_role','billing_manual_paid_claim_receipts','SELECT')
 and has_table_privilege('service_role','billing_manual_paid_claim_receipts','INSERT')
 and not has_table_privilege('service_role','billing_manual_paid_claim_receipts','UPDATE')
 and not has_table_privilege('service_role','billing_manual_paid_claim_receipts','DELETE'),'service receipts are append-only';
 raise notice 'PASS: durable lost-response binding, actual selection, empty/legacy/admit outcomes, immutable history, unchanged locks and financial records';
END $test$;
-- A receipt write failure must roll back the selected lease in the same transaction.
CREATE FUNCTION pg_temp.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN IF NEW.execution_id='109' THEN RAISE EXCEPTION 'ISOLATED_RECEIPT_WRITE_FAILURE'; END IF; RETURN NEW; END $fn$;
CREATE TRIGGER isolated_receipt_failure BEFORE INSERT ON billing_manual_paid_claim_receipts
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_receipt();
DO $atomic$
DECLARE j uuid; before_row jsonb;
BEGIN
 select id into j from billing_jobs where payload->>'scope'='MANUAL_SHOPIFY_PAID' order by id limit 1;
 update billing_jobs set status='PENDING',next_attempt_at=now()-interval '1 minute' where id=j;
 select to_jsonb(x) into before_row from billing_jobs x where id=j;
 begin
  perform billing_manual_paid_claim('{"scope":"MANUAL_SHOPIFY_PAID","operation":"claim","worker":"isolated-test","executionId":"109","jobTypes":["RECONCILE"],"candidates":[]}');
  raise exception 'Expected receipt failure';
 exception when others then if SQLERRM<>'ISOLATED_RECEIPT_WRITE_FAILURE' then raise; end if; end;
 assert (select to_jsonb(x)=before_row from billing_jobs x where id=j),'receipt failure must roll back lease/status/attempt changes';
 assert not exists(select 1 from billing_manual_paid_claim_receipts where execution_id='109');
END $atomic$;
-- Real service role RPC traverses RLS; cannot merely assert grants.
SET LOCAL ROLE service_role;
DO $$ BEGIN PERFORM public.billing_manual_paid_claim('{"scope":"MANUAL_SHOPIFY_PAID","operation":"claim","worker":"isolated-test","executionId":"108","jobTypes":["RECONCILE"],"candidates":[]}'); END $$;
RESET ROLE;
DO $$ BEGIN assert exists(select 1 from billing_manual_paid_claim_receipts where execution_id='108'),'service role must persist receipt through RLS'; END $$;
ROLLBACK;
