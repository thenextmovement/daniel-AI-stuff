BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.assert_ok(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label; END IF; END$$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF position(expected in SQLERRM)>0 THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'TEST FAILED: missing error %',expected;
END$$;
INSERT INTO billing_cases(id,source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,customer,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash,created_at)
SELECT ('00000000-0000-4000-8000-00000000000'||i)::uuid,'test','snapshot-'||i,i::text,'#NEONT500'||i,'{"company":"Muster GmbH"}','EUR',i*10000,0,i*10000,'DE_STANDARD','NOT_REQUIRED','PAYMENT_PENDING','test-token-'||i,'2026-09-01'
FROM generate_series(1,2) i;
INSERT INTO billing_documents(billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
SELECT id,'PROFORMA','PF-'||replace(shopify_order_name,'#',''),'SENT','doc-'||shopify_order_id,'hash',total_gross_cents,'EUR' FROM billing_cases;
CREATE TEMP TABLE inputs AS SELECT
'{"id":"11111111-1111-4111-8111-111111111111","transactionId":"bank-alias","amountCents":30000,"currency":"EUR","bookedAt":"2026-09-22T10:00:00Z","reference":"PF-NEONT5001,PF-NEONT5002","payer":"Muster.GmbH"}'::jsonb payment,
(SELECT jsonb_agg(jsonb_build_object('caseId',id,'orderId',shopify_order_id,'orderName',shopify_order_name,'amountCents',total_gross_cents,'lockVersion',lock_version,'company','Muster GmbH') ORDER BY shopify_order_id) FROM billing_cases) allocations;
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment||'{"amountCents":29999}',allocations) FROM inputs$q$,'COLLECTIVE_TOTAL_INVALID');
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment||'{"currency":"USD"}',allocations) FROM inputs$q$,'COLLECTIVE_INPUT_INVALID');
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment||'{"reference":"PF-NEONT5001,PF-NEONT5999"}',allocations) FROM inputs$q$,'COLLECTIVE_REFERENCES_INVALID');
UPDATE billing_cases SET cancelled_at=now() WHERE shopify_order_id='2';
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment,allocations) FROM inputs$q$,'COLLECTIVE_CASE_CHANGED_OR_UNSAFE');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM billing_payments),'all-or-none on cancelled second case');
UPDATE billing_cases SET cancelled_at=null WHERE shopify_order_id='2';
UPDATE billing_cases SET lock_version=1 WHERE shopify_order_id='2';
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment,allocations) FROM inputs$q$,'COLLECTIVE_CASE_CHANGED_OR_UNSAFE');
UPDATE billing_cases SET lock_version=0 WHERE shopify_order_id='2';
UPDATE billing_cases SET customer='{"company":"Andere GmbH"}' WHERE shopify_order_id='2';
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment,allocations) FROM inputs$q$,'COLLECTIVE_CASE_CHANGED_OR_UNSAFE');
UPDATE billing_cases SET customer='{"company":"Muster GmbH"}' WHERE shopify_order_id='2';
INSERT INTO billing_payments(billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status) VALUES('00000000-0000-4000-8000-000000000002','QONTO','foreign',1,'EUR',now(),'PARTIAL');
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment,allocations) FROM inputs$q$,'COLLECTIVE_CASE_CHANGED_OR_UNSAFE');
DELETE FROM billing_payments;
CREATE FUNCTION pg_temp.fail_second() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF new.billing_case_id='00000000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'TEST_INJECTED_SECOND_FAILURE'; END IF; RETURN new; END$$;
CREATE TRIGGER injected_second BEFORE INSERT ON billing_payments FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second();
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment,allocations) FROM inputs$q$,'TEST_INJECTED_SECOND_FAILURE');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM billing_payments),'rollback first allocation when second fails');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM billing_jobs),'rollback all invoice/shopify jobs when second fails');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM processed_transactions),'rollback root receipt when second fails');
DROP TRIGGER injected_second ON billing_payments;
CREATE TEMP TABLE receipt AS SELECT billing_collective_payment_ingest(payment,allocations) result FROM inputs;
SELECT pg_temp.assert_ok((SELECT (result->>'ok')::boolean AND NOT (result->>'duplicate')::boolean FROM receipt),'initial receipt');
SELECT pg_temp.assert_ok((SELECT count(*)=2 AND sum(amount_cents)=30000 AND bool_and(match_status='MATCHED') FROM billing_payments),'exact conserved bank amount');
SELECT pg_temp.assert_ok((SELECT count(*)=4 FROM billing_jobs),'two shopify jobs plus two invoice jobs');
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM processed_transactions),'one original bank receipt');
SELECT pg_temp.assert_ok((SELECT (billing_collective_payment_ingest(payment,allocations)->>'duplicate')::boolean FROM inputs),'identical replay');
SELECT pg_temp.assert_ok((SELECT (billing_collective_payment_ingest(payment,(SELECT jsonb_agg(a||'{"lockVersion":999}'::jsonb) FROM jsonb_array_elements(allocations) a))->>'duplicate')::boolean FROM inputs),'replay ignores changed assertion version');
SELECT pg_temp.assert_ok((SELECT count(*)=2 FROM billing_payments),'no duplicate allocation after replay');
SELECT pg_temp.expect_error($q$SELECT billing_collective_payment_ingest(payment||'{"payer":"Muster GmbH "}',allocations) FROM inputs$q$,'COLLECTIVE_REPLAY_CONFLICT');
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['CREATE_INVOICE'],120) IS NULL,'no invoice before Shopify');
UPDATE billing_payments SET shopify_projection_status='DONE' WHERE amount_cents=10000;
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['CREATE_INVOICE'],120) IS NULL,'no invoice after only one Shopify');
UPDATE billing_payments SET shopify_projection_status='DONE' WHERE amount_cents=20000;
UPDATE billing_cases SET cancelled_at=now() WHERE shopify_order_id='2';
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['CREATE_INVOICE'],120) IS NULL,'cancelled group after Shopify blocks invoices');
UPDATE billing_cases SET cancelled_at=null WHERE shopify_order_id='2';
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['CREATE_INVOICE'],120)->'job'->>'job_type'='CREATE_INVOICE','invoice allowed after both Shopify');
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['CREATE_INVOICE'],120)->'job'->>'job_type'='CREATE_INVOICE','second invoice allowed');
INSERT INTO billing_jobs(billing_case_id,idempotency_key,job_type,payload) VALUES('00000000-0000-4000-8000-000000000001','test-eb','PROJECT_PAYMENT_EASYBILL','{"documentId":999,"amountCents":10000,"paidAt":"2026-09-22T10:00:00Z"}');
SELECT pg_temp.assert_ok(billing_job_claim('test-worker',ARRAY['PROJECT_PAYMENT_EASYBILL'],120)->'job'->'payload'->>'collectiveAllocationId'='11111111-1111-4111-8111-111111111111:allocation:1','future easybill job carries stable allocation marker');
SELECT pg_temp.assert_ok(NOT has_function_privilege('anon','billing_collective_payment_ingest(jsonb,jsonb)','EXECUTE'),'anonymous cannot allocate');
SELECT pg_temp.assert_ok(NOT has_function_privilege('authenticated','billing_collective_payment_ingest(jsonb,jsonb)','EXECUTE'),'customers cannot allocate');
SELECT pg_temp.assert_ok(has_function_privilege('service_role','billing_collective_payment_ingest(jsonb,jsonb)','EXECUTE'),'service can allocate');
SELECT 'ALL COLLECTIVE DATABASE CHECKS PASSED' result;
ROLLBACK;
