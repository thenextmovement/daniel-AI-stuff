-- Defines a session-local, one-off admission only. NOT a migration, no invocation.
-- Apply the reviewed worker first; then call both cases in ONE transaction using
-- fresh external reads (<5 minutes). This does not itself book any payment.
create or replace function pg_temp.release_full_qonto_payment(p_case uuid,p_preflight jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $repair$
declare
 c billing_cases; j billing_jobs; p billing_payments; d billing_documents;
 expected_job uuid; expected_payment uuid; qonto_id text; invoice_id text;
 proforma_id text; expected_cents bigint; order_id text; order_name text; paid_time timestamptz;
 expected_shopify text; event_key text; stage1 text; checked timestamptz; bank jsonb;
begin
 if p_case='17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588' then
  expected_job:='66cdafb5-f754-486c-a7de-0119a4c63c06';expected_payment:='055b1062-e9fd-4d2a-9c97-147b3c5e1c54';
  qonto_id:='01a17742-cb98-7b8f-af8e-9743ed3ad972';invoice_id:='3717331959';proforma_id:='3675733235';
  expected_cents:=116382;order_id:='8513317896459';order_name:='#NEONT4692';paid_time:='2026-10-26T08:10:28.510Z';expected_shopify:='PENDING';
 elsif p_case='4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7' then
  expected_job:='79b533c8-5f40-4b32-8375-5e2ea836ae74';expected_payment:='1af5d142-949b-49c4-a2e0-3cbce2fd0b4d';
  qonto_id:='01a16919-e2ff-780e-b230-1496816dc599';invoice_id:='3717333369';proforma_id:='3714029841';
  expected_cents:=147900;order_id:='8618528702731';order_name:='#NEONT4796';paid_time:='2026-10-23T14:11:06Z';expected_shopify:='PAID';
 else raise exception 'FULL_QONTO_CASE'; end if;
 event_key:='repair:20261026:full-qonto-projection:'||p_case;
 stage1:='repair:20261026:billing-source-alignment:'||p_case;
 -- Match the ordinary worker's job-then-case lock order. Other queued work is
 -- observed under row locks; no locks, attempts or states are reset.
 perform 1 from billing_jobs where billing_case_id=p_case order by id for update;
 select * into c from billing_cases where id=p_case for update;
 if not found then raise exception 'FULL_QONTO_CASE'; end if;
 if exists(select 1 from billing_events where idempotency_key=event_key) then
  return jsonb_build_object('duplicate',true,'caseId',p_case);
 end if;
 if c.shopify_order_id is distinct from order_id or c.shopify_order_name is distinct from order_name
  or c.total_gross_cents is distinct from expected_cents or c.currency is distinct from 'EUR'
  or c.status is distinct from 'INVOICED' or c.paid_at is null or c.final_invoice_at is null
  or c.tax_review_status not in ('NOT_REQUIRED','VERIFIED') or c.cancelled_at is not null or c.refunded_at is not null
  or not exists(select 1 from billing_events where idempotency_key=stage1 and event_type='BILLING_SOURCE_ALIGNMENT')
 then raise exception 'FULL_QONTO_CASE_STATE'; end if;
 select * into j from billing_jobs where id=expected_job;
 if not found or j.billing_case_id is distinct from p_case or j.job_type is distinct from 'PROJECT_PAYMENT_EASYBILL'
  or j.status is distinct from 'BLOCKED' or j.attempt_count is distinct from 0
  or j.lease_token is not null or j.lease_expires_at is not null
  or j.payload->>'repairEventKey' is distinct from stage1
  or j.payload->>'providerTransactionId' is distinct from qonto_id
  or j.payload->'customerEmailSuppressed' is distinct from 'true'::jsonb
  or j.payload->>'reviewHold' is distinct from 'VERIFY_EXTERNAL_PAYMENT_HISTORY_BEFORE_ANY_POST'
  or j.payload ?| array['markPaid','collectivePaymentId','manualPaidQontoProof','repairFullPayment']
 then raise exception 'FULL_QONTO_JOB'; end if;
 if exists(select 1 from billing_jobs where billing_case_id=p_case and status='PROCESSING')
  or exists(select 1 from billing_jobs where billing_case_id=p_case and job_type='SEND_CUSTOMER_DOCUMENT' and status<>'BLOCKED')
  or exists(select 1 from billing_change_requests where billing_case_id=p_case and status in ('PENDING','APPROVED'))
 then raise exception 'FULL_QONTO_CONCURRENT_OR_MAIL'; end if;
 if not exists(select 1 from billing_jobs where billing_case_id=p_case and job_type='CREATE_INVOICE'
  and status='DONE' and payload->>'repairEventKey'=stage1 and payload->'customerEmailSuppressed'='true'::jsonb)
 then raise exception 'FULL_QONTO_SUPPRESSION'; end if;
 select * into d from billing_documents where billing_case_id=p_case and document_type='INVOICE' for share;
 if not found or (select count(*) from billing_documents where billing_case_id=p_case and document_type='INVOICE')<>1
  or d.easybill_document_id is distinct from invoice_id or d.document_number is distinct from order_name
  or d.amount_cents is distinct from expected_cents or d.currency is distinct from 'EUR'
  or d.status is distinct from 'FINALIZED' or d.sent_at is not null
 then raise exception 'FULL_QONTO_DOCUMENT'; end if;
 perform 1 from billing_payments where billing_case_id=p_case for share;
 select * into p from billing_payments where id=expected_payment;
 if not found or (select count(*) from billing_payments where billing_case_id=p_case)<>1
  or p.billing_case_id is distinct from p_case or p.provider is distinct from 'QONTO'
  or p.provider_transaction_id is distinct from qonto_id or p.amount_cents is distinct from expected_cents
  or p.booked_at is distinct from paid_time or p.currency is distinct from 'EUR' or p.match_status is distinct from 'MATCHED'
  or p.easybill_projection_status is distinct from 'PENDING' or p.evidence ? 'collectivePaymentId'
 then raise exception 'FULL_QONTO_LEDGER'; end if;
 if (select count(*) from qonto_transactions where raw->>'id'=qonto_id)<>1 then raise exception 'FULL_QONTO_BANK'; end if;
 select raw into bank from qonto_transactions where raw->>'id'=qonto_id for share;
 if bank->>'side' is distinct from 'credit' or bank->>'status' is distinct from 'completed' or bank->>'currency' is distinct from 'EUR'
  or (bank->>'amount')::numeric*100 is distinct from expected_cents::numeric
  or abs(extract(epoch from ((bank->>'settled_at')::timestamptz-paid_time)))>=1
  or nullif(bank->>'settled_at','') is null
  or position(replace(order_name,'#','') in coalesce(bank->>'reference',''))=0
 then raise exception 'FULL_QONTO_BANK'; end if;
 checked:=(p_preflight->>'checkedAt')::timestamptz;
 if checked is null or checked<clock_timestamp()-interval '5 minutes' or checked>clock_timestamp()+interval '1 minute'
  or p_preflight->>'shopifyOrderId' is distinct from order_id
  or p_preflight->>'shopifyFinancialStatus' is distinct from expected_shopify
  or p_preflight->>'totalCents' is distinct from expected_cents::text
  or p_preflight->'shopifyCancelled' is distinct from 'false'::jsonb
  or p_preflight->'shopifyRefundCount' is distinct from '0'::jsonb
  or p_preflight->>'invoiceId' is distinct from invoice_id or p_preflight->>'proformaId' is distinct from proforma_id
  or p_preflight->'invoicePaidCents' is distinct from '0'::jsonb
  or p_preflight->'proformaPaidCents' is distinct from '0'::jsonb
  or p_preflight->'paymentHistoriesCompleteAndEmpty' is distinct from 'true'::jsonb
  or p_preflight->'noActiveEasybillWebhooks' is distinct from 'true'::jsonb
  or p_preflight->'invoicePostboxNull' is distinct from 'true'::jsonb
 then raise exception 'FULL_QONTO_PREFLIGHT'; end if;
 -- Preserve the Shopify no-email hold and the already confirmed #4796 payment.
 if order_name='#NEONT4692' and (p.shopify_projection_status<>'PENDING' or not exists(select 1 from billing_jobs
  where id='c4ebb761-c3d9-47d0-afbe-49c4533a007d' and billing_case_id=p_case and status='BLOCKED'
  and attempt_count=0 and lease_token is null and lease_expires_at is null
  and payload->>'reviewHold'='VERIFY_SHOPIFY_PAID_NOTIFICATION_EFFECTS'))
  or order_name='#NEONT4796' and p.shopify_projection_status<>'DONE'
 then raise exception 'FULL_QONTO_SHOPIFY_HOLD'; end if;
 update billing_jobs set status='PENDING',next_attempt_at=null,last_error=null,
  payload=(payload-'reviewHold')||jsonb_build_object('repairFullPayment','20261026-full-qonto-no-email',
    'repairAdmissionValidUntil',checked+interval '5 minutes',
    'paymentId',p.id,'documentId',invoice_id,'proformaId',proforma_id,'amountCents',expected_cents,
    'paidAt',case when order_name='#NEONT4692' then '2026-10-26T08:10:28.510Z' else '2026-10-23T14:11:06Z' end)
 where id=j.id;
 insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
 values(p_case,event_key,'FULL_QONTO_PROJECTION_ADMITTED','OPS','approved no-email payment repair 2026-10-26',j.id::text,
  jsonb_build_object('jobId',j.id,'paymentId',p.id,'qontoId',qonto_id,'invoiceId',invoice_id,'preflight',p_preflight,
   'beforeJob',to_jsonb(j),'customerEmailSuppressed',true,'externalPaymentConfirmed',false));
 return jsonb_build_object('duplicate',false,'caseId',p_case,'jobId',j.id,'admitted',true);
end;
$repair$;
