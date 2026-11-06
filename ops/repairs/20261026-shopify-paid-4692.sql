-- Issue #231. Session-local admission of ONE existing held Shopify projection.
-- No invocation, migration, provider mutation, bank transfer or customer send.
-- Apply the separately reviewed worker guards before invoking this function.
-- The existing customerEmailSuppressed field is preserved; it does NOT prove
-- suppression of native Shopify mail. That provider behavior is reviewed separately.
--
-- p_preflight is a client-supplied summary of direct provider GETs, NOT fetched
-- by this SQL. Require all reads at checkedAt (ISO8601), <=5 minutes old, and
-- no future timestamp. The exact schema is required_proof below plus checkedAt.
-- Integer fields are JSON numbers; IDs, names and enums are JSON strings.
-- Transactions/payment-history counts refer to COMPLETE provider pagination.
-- This function only validates that explicit proof and the locked database state.
-- It never invents or upgrades unknown provider facts.
create or replace function pg_temp.release_shopify_paid_4692(p_preflight jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $repair$
declare
 case_id constant uuid := '17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588';
 job_id constant uuid := 'c4ebb761-c3d9-47d0-afbe-49c4533a007d';
 payment_id constant uuid := '055b1062-e9fd-4d2a-9c97-147b3c5e1c54';
 easybill_job constant uuid := '66cdafb5-f754-486c-a7de-0119a4c63c06';
 mail_job constant uuid := '89104f0c-670e-42e8-bed0-5e2b6efc29bd';
 invoice_id constant uuid := 'b8e78575-a53a-442c-bd2a-57ecba541ca6';
 proforma_id constant uuid := 'eeeee43c-23c4-4d01-9d93-1de4d980b812';
 qonto_id constant text := '01a17742-cb98-7b8f-af8e-9743ed3ad972';
 event_key constant text := 'repair:20261026:shopify-paid-4692:c4ebb761-c3d9-47d0-afbe-49c4533a007d';
 stage1 constant text := 'repair:20261026:billing-source-alignment:17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588';
 c billing_cases; j billing_jobs; p billing_payments; e billing_events;
 checked timestamptz; admitted_at timestamptz;
 expected_payload jsonb := '{
   "bookedAt":"2026-10-26T08:10:28.51+00:00",
   "paymentId":"055b1062-e9fd-4d2a-9c97-147b3c5e1c54",
   "reviewHold":"VERIFY_SHOPIFY_PAID_NOTIFICATION_EFFECTS",
   "amountCents":116382,"skontoCents":0,
   "repairEventKey":"repair:20261026:billing-source-alignment:17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588",
   "settlementType":"FULL","invoiceGrossCents":116382,
   "customerEmailSuppressed":true,"receivedCumulativeCents":116382
 }';
 required_proof jsonb := '{
   "shopifyOrderId":"8513317896459","shopifyOrderName":"#NEONT4692",
   "shopifyAppId":"290803777537","shopifyFinancialStatus":"PENDING","currency":"EUR",
   "totalCents":116382,"currentTotalCents":116382,"outstandingCents":116382,
   "shopifyTransactionCount":0,"shopifyTransactionsComplete":true,
   "shopifyCanMarkAsPaid":true,"shopifyCancelled":false,"shopifyRefundCount":0,"shopifyGiftCardCount":0,
   "invoiceId":"3717331959","invoiceNumber":"#NEONT4692","invoiceType":"INVOICE",
   "invoiceDraft":false,"invoiceCancelled":false,"invoiceCurrency":"EUR",
   "invoiceAmountCents":116382,"invoicePaidCents":116382,
   "invoiceReceiptId":"3225854832","invoiceReceiptAmountCents":116382,
   "invoiceReceiptQontoId":"01a17742-cb98-7b8f-af8e-9743ed3ad972",
   "invoicePaymentCount":1,"invoicePaymentHistoryComplete":true,"invoicePostboxNull":true
 }';
begin
 -- Same lock order as the worker: jobs, then case. Case lock also prevents
 -- a new child job/document/payment insertion while the final checks run.
 perform 1 from billing_jobs where billing_case_id=case_id order by id for update;
 select * into c from billing_cases where id=case_id for update;
 if not found then raise exception 'SHOPIFY_4692_CASE'; end if;
 select * into j from billing_jobs where id=job_id;
 if not found or j.billing_case_id is distinct from case_id
  or j.job_type is distinct from 'PROJECT_PAYMENT_SHOPIFY'
  or j.idempotency_key is distinct from 'payment:'||payment_id::text||':shopify'
 then raise exception 'SHOPIFY_4692_JOB_IDENTITY'; end if;
 select * into e from billing_events where idempotency_key=event_key for share;
 if found then
  if e.billing_case_id is distinct from case_id or e.event_type is distinct from 'SHOPIFY_PAID_4692_ADMITTED'
   or e.payload->>'jobId' is distinct from job_id::text
   or j.payload->>'repairShopifyPaid' is distinct from '20261026-4692'
  then raise exception 'SHOPIFY_4692_ADMISSION_CONFLICT'; end if;
  -- Once admitted, neither stale proof nor a retry may reset/reopen this job.
  return jsonb_build_object('duplicate',true,'caseId',case_id,'jobId',job_id,'status',j.status);
 end if;
 if c.shopify_order_id is distinct from '8513317896459' or c.shopify_order_name is distinct from '#NEONT4692'
  or c.status is distinct from 'INVOICED' or c.total_gross_cents is distinct from 116382 or c.currency is distinct from 'EUR'
  or c.paid_at is distinct from '2026-10-26T08:10:28.510Z'::timestamptz or c.final_invoice_at is null
  or c.cancelled_at is not null or c.refunded_at is not null
  or c.tax_review_status not in ('NOT_REQUIRED','VERIFIED')
 then raise exception 'SHOPIFY_4692_CASE_STATE'; end if;
 if j.status is distinct from 'BLOCKED' or j.attempt_count is distinct from 0
  or j.lease_token is not null or j.lease_expires_at is not null or j.next_attempt_at is not null
  or j.updated_at is distinct from '2026-10-26T11:01:04.877502Z'::timestamptz
  or j.payload is distinct from expected_payload
  or j.last_error is distinct from 'Repair no-email hold: Shopify paid-trigger subscribers have not been proved mail-free.'
 then raise exception 'SHOPIFY_4692_JOB_STATE'; end if;
 if exists(select 1 from billing_jobs where billing_case_id=case_id and id<>job_id and status<>'DONE')
  or exists(select 1 from billing_change_requests where billing_case_id=case_id and status in ('PENDING','APPROVED'))
 then raise exception 'SHOPIFY_4692_CONCURRENT_WORK'; end if;
 if (select count(*) from billing_jobs where billing_case_id=case_id and job_type='SEND_CUSTOMER_DOCUMENT')<>1
  or not exists(select 1 from billing_jobs where id=mail_job and billing_case_id=case_id
   and job_type='SEND_CUSTOMER_DOCUMENT' and status='DONE' and attempt_count=1
   and lease_token is null and lease_expires_at is null and next_attempt_at is null and last_error is null
   and updated_at='2026-09-11T14:36:53.856259Z'::timestamptz
   and payload->>'documentType'='PROFORMA' and payload->>'billingDocumentId'=proforma_id::text
   and payload->>'easybillDocumentId'='3675733235')
 then raise exception 'SHOPIFY_4692_MAIL_STATE'; end if;
 if not exists(select 1 from billing_jobs where id='517d3604-23a1-4307-890d-2ffee823f73d'
   and billing_case_id=case_id and job_type='CREATE_INVOICE' and status='DONE' and attempt_count=1
   and payload->>'repairEventKey'=stage1 and payload->>'documentNumber'='#NEONT4692'
   and payload->'customerEmailSuppressed'='true'::jsonb)
 then raise exception 'SHOPIFY_4692_INVOICE_JOB'; end if;
 perform 1 from billing_documents where billing_case_id=case_id order by id for share;
 if (select count(*) from billing_documents where billing_case_id=case_id)<>2
  or not exists(select 1 from billing_documents where id=invoice_id and billing_case_id=case_id
   and document_type='INVOICE' and document_number='#NEONT4692' and status='FINALIZED'
   and easybill_document_id='3717331959' and amount_cents=116382 and currency='EUR' and sent_at is null)
  or not exists(select 1 from billing_documents where id=proforma_id and billing_case_id=case_id
   and document_type='PROFORMA' and document_number='PF-NEONT4692' and status='SENT'
   and easybill_document_id='3675733235' and amount_cents=116382 and currency='EUR'
   and sent_at='2026-09-11T14:36:53.856259Z'::timestamptz)
 then raise exception 'SHOPIFY_4692_DOCUMENTS'; end if;
 perform 1 from billing_payments where billing_case_id=case_id for share;
 select * into p from billing_payments where id=payment_id;
 if not found or (select count(*) from billing_payments where billing_case_id=case_id)<>1
  or p.billing_case_id is distinct from case_id or p.provider is distinct from 'QONTO'
  or p.provider_transaction_id is distinct from qonto_id or p.amount_cents is distinct from 116382
  or p.currency is distinct from 'EUR' or p.booked_at is distinct from '2026-10-26T08:10:28.510Z'::timestamptz
  or p.match_status is distinct from 'MATCHED' or p.easybill_projection_status is distinct from 'DONE'
  or p.shopify_projection_status is distinct from 'PENDING' or p.evidence ? 'collectivePaymentId'
 then raise exception 'SHOPIFY_4692_LEDGER'; end if;
 if not exists(select 1 from billing_jobs where id=easybill_job and billing_case_id=case_id
   and job_type='PROJECT_PAYMENT_EASYBILL' and status='DONE' and attempt_count=1
   and lease_token is null and lease_expires_at is null and next_attempt_at is null
   and payload->>'paymentId'=payment_id::text and payload->>'documentId'='3717331959'
   and payload->'amountCents'='116382'::jsonb and payload->>'providerTransactionId'=qonto_id)
  or not exists(select 1 from billing_events where billing_case_id=case_id
   and idempotency_key='job-done:'||easybill_job::text and event_type='BILLING_JOB_DONE'
   and correlation_id=easybill_job::text and payload->>'qontoId'=qonto_id
   and payload->>'projection'='PROJECT_PAYMENT_EASYBILL' and payload->>'easybillPaymentId'='3225854832')
 then raise exception 'SHOPIFY_4692_EASYBILL_RECEIPT'; end if;
 if jsonb_typeof(p_preflight) is distinct from 'object'
  or (p_preflight-'checkedAt') is distinct from required_proof
  or jsonb_typeof(p_preflight->'checkedAt') is distinct from 'string'
 then raise exception 'SHOPIFY_4692_PREFLIGHT'; end if;
 begin
  checked:=(p_preflight->>'checkedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'SHOPIFY_4692_PREFLIGHT_TIME';
 end;
 -- Use the wall clock after all locks/checks, never transaction-start now().
 admitted_at:=clock_timestamp();
 if checked is null or not isfinite(checked) or checked<admitted_at-interval '5 minutes' or checked>admitted_at
 then raise exception 'SHOPIFY_4692_PREFLIGHT_TIME'; end if;
 update billing_jobs set status='PENDING',next_attempt_at=null,last_error=null,
  payload=(payload-'reviewHold')||jsonb_build_object('repairShopifyPaid','20261026-4692',
    'repairShopifyPaidCheckedAt',checked,'repairShopifyPaidExpiresAt',checked+interval '5 minutes')
 where id=job_id and status='BLOCKED' and attempt_count=0 and lease_token is null and lease_expires_at is null
  and updated_at=j.updated_at and payload=j.payload;
 if not found then raise exception 'SHOPIFY_4692_CAS'; end if;
 insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
 values(case_id,event_key,'SHOPIFY_PAID_4692_ADMITTED','OPS','approved repair issue 231',job_id::text,
  jsonb_build_object('jobId',job_id,'paymentId',payment_id,'qontoId',qonto_id,'invoiceId','3717331959',
   'easybillReceiptId','3225854832','preflight',p_preflight,
   'beforeJob',jsonb_build_object('status',j.status,'attemptCount',j.attempt_count,'updatedAt',j.updated_at,'payload',j.payload),
   'shopifyPaymentConfirmed',false,'nativeEmailSuppressionProvenByThisSql',false));
 return jsonb_build_object('duplicate',false,'admitted',true,'caseId',case_id,'jobId',job_id,
   'expiresAt',checked+interval '5 minutes');
end;
$repair$;

-- Separate invocation ONLY after the natural worker completion. This closes
-- the exact historical payment-review incident; it never invokes the worker.
-- p_proof is a fresh direct Shopify GET summary. Schema: required_proof below,
-- checkedAt and shopifyTransactionCreatedAt ISO8601 strings, plus numeric-ID
-- string shopifyTransactionId, explicitly normalized below to the Shopify GID
-- stored by the worker in BILLING_JOB_DONE. Order/app proof IDs are also numeric.
-- Provider timestamps have second precision; the admitted zero-transaction
-- read permits a successful receipt created in the same second as that read.
-- The canonical transition and its current triggers write only incident/audit
-- rows (payment_review skips the workflow-failure trigger branch).
create or replace function pg_temp.finalize_shopify_paid_4692(p_proof jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $repair$
declare
 case_id constant uuid := '17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588';
 job_id constant uuid := 'c4ebb761-c3d9-47d0-afbe-49c4533a007d';
 payment_id constant uuid := '055b1062-e9fd-4d2a-9c97-147b3c5e1c54';
 incident_id constant uuid := '70d7f8ee-c565-4c69-ad52-09f355cdacd2';
 qonto_id constant text := '01a17742-cb98-7b8f-af8e-9743ed3ad972';
 admission_key constant text := 'repair:20261026:shopify-paid-4692:c4ebb761-c3d9-47d0-afbe-49c4533a007d';
 event_key constant text := 'repair:20261026:shopify-paid-4692-resolved:70d7f8ee-c565-4c69-ad52-09f355cdacd2';
 c billing_cases; j billing_jobs; p billing_payments;
 a billing_events; d billing_events; e billing_events;
 i company_brain_operational_incidents;
 canonical_event_id uuid; transaction_id text; resolution_note text; before_digest text;
 admitted_checked timestamptz; checked timestamptz; receipt_created timestamptz; inspected_at timestamptz;
 required_proof jsonb := '{
   "shopifyOrderId":"8513317896459","shopifyOrderName":"#NEONT4692","shopifyAppId":"290803777537",
   "shopifyFinancialStatus":"PAID","currency":"EUR","totalCents":116382,"currentTotalCents":116382,
   "outstandingCents":0,"shopifyTransactionCount":1,"shopifyTransactionsComplete":true,
   "shopifyCancelled":false,"shopifyRefundCount":0,"shopifyGiftCardCount":0,
   "shopifyTransactionKind":"SALE","shopifyTransactionStatus":"SUCCESS","shopifyTransactionGateway":"manual",
   "shopifyTransactionAmountCents":116382,"shopifyTransactionCurrency":"EUR"
 }';
begin
 select * into j from billing_jobs where id=job_id for update;
 if not found or j.billing_case_id is distinct from case_id
  or j.job_type is distinct from 'PROJECT_PAYMENT_SHOPIFY'
  or j.idempotency_key is distinct from 'payment:'||payment_id::text||':shopify'
  or j.status is distinct from 'DONE' or j.attempt_count<1
  or j.lease_token is not null or j.lease_expires_at is not null or j.next_attempt_at is not null
  or j.payload->>'repairShopifyPaid' is distinct from '20261026-4692'
  or j.payload->>'paymentId' is distinct from payment_id::text
  or j.payload->'amountCents' is distinct from '116382'::jsonb
  or j.payload->>'settlementType' is distinct from 'FULL'
  or j.payload->'customerEmailSuppressed' is distinct from 'true'::jsonb
 then raise exception 'SHOPIFY_4692_FINAL_JOB'; end if;
 select * into c from billing_cases where id=case_id for update;
 if not found or c.status is distinct from 'INVOICED'
  or c.shopify_order_id is distinct from '8513317896459' or c.shopify_order_name is distinct from '#NEONT4692'
  or c.total_gross_cents is distinct from 116382 or c.currency is distinct from 'EUR'
  or c.cancelled_at is not null or c.refunded_at is not null
 then raise exception 'SHOPIFY_4692_FINAL_CASE'; end if;
 select * into p from billing_payments where id=payment_id for share;
 if not found or p.billing_case_id is distinct from case_id or p.provider is distinct from 'QONTO'
  or p.provider_transaction_id is distinct from qonto_id or p.amount_cents is distinct from 116382
  or p.currency is distinct from 'EUR' or p.match_status is distinct from 'MATCHED'
  or p.easybill_projection_status is distinct from 'DONE' or p.shopify_projection_status is distinct from 'DONE'
 then raise exception 'SHOPIFY_4692_FINAL_LEDGER'; end if;
 select * into a from billing_events where idempotency_key=admission_key for share;
 if not found or a.billing_case_id is distinct from case_id or a.event_type is distinct from 'SHOPIFY_PAID_4692_ADMITTED'
  or a.correlation_id is distinct from job_id::text or a.payload->>'jobId' is distinct from job_id::text
  or a.payload->>'paymentId' is distinct from payment_id::text or a.payload->>'qontoId' is distinct from qonto_id
  or a.payload#>'{preflight,shopifyTransactionCount}' is distinct from '0'::jsonb
  or a.payload#>'{preflight,shopifyTransactionsComplete}' is distinct from 'true'::jsonb
  or jsonb_typeof(j.payload->'repairShopifyPaidCheckedAt') is distinct from 'string'
  or jsonb_typeof(j.payload->'repairShopifyPaidExpiresAt') is distinct from 'string'
 then raise exception 'SHOPIFY_4692_FINAL_ADMISSION'; end if;
 begin
  admitted_checked:=(j.payload->>'repairShopifyPaidCheckedAt')::timestamptz;
  if admitted_checked is null or not isfinite(admitted_checked)
   or admitted_checked is distinct from (a.payload#>>'{preflight,checkedAt}')::timestamptz
   or (j.payload->>'repairShopifyPaidExpiresAt')::timestamptz is distinct from admitted_checked+interval '5 minutes'
  then raise exception 'SHOPIFY_4692_FINAL_ADMISSION_TIME'; end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'SHOPIFY_4692_FINAL_ADMISSION_TIME';
 end;
 select * into d from billing_events where idempotency_key='job-done:'||job_id::text for share;
 if not found or d.billing_case_id is distinct from case_id or d.event_type is distinct from 'BILLING_JOB_DONE'
  or d.correlation_id is distinct from job_id::text
  or d.payload->>'repairShopifyPaid' is distinct from '20261026-4692'
  or d.payload->>'paymentId' is distinct from payment_id::text
  or d.payload->>'shopifyOrderId' is distinct from 'gid://shopify/Order/8513317896459'
  or d.payload->'amountCents' is distinct from '116382'::jsonb
  or jsonb_typeof(d.payload->'reused') is distinct from 'boolean'
  or jsonb_typeof(d.payload->'shopifyTransactionId') is distinct from 'string'
  or coalesce(d.payload->>'shopifyTransactionId','') !~ '^gid://shopify/OrderTransaction/[1-9][0-9]*$'
 then raise exception 'SHOPIFY_4692_FINAL_RESULT'; end if;
 transaction_id:=d.payload->>'shopifyTransactionId';
 resolution_note:='Issue #231: #NEONT4692 Shopify paid confirmed; job '||job_id::text||
  ', payment '||payment_id::text||', order 8513317896459, manual SALE receipt '||transaction_id||', EUR 1163.82.';
 select * into i from company_brain_operational_incidents where id=incident_id for update;
 if not found or i.incident_type is distinct from 'payment_review'
  or i.fingerprint is distinct from 'qonto-payment-review:'||qonto_id
  or i.root_cause_code is distinct from 'shopify_rematch_unresolved'
  or i.case_key is distinct from 'qonto:'||qonto_id or i.source_ref is distinct from 'qonto:'||qonto_id
  or i.source_key is distinct from 'n8n' or i.metadata->>'transaction_id' is distinct from qonto_id
  or i.metadata->>'possible_order' is distinct from 'NEONT4692'
  or i.metadata->'amount' is distinct from '1163.82'::jsonb or i.metadata->>'currency' is distinct from 'EUR'
 then raise exception 'SHOPIFY_4692_FINAL_INCIDENT_IDENTITY'; end if;
 select * into e from billing_events where idempotency_key=event_key for share;
 if found then
  if e.billing_case_id is distinct from case_id or e.event_type is distinct from 'SHOPIFY_PAID_4692_INCIDENT_RESOLVED'
   or e.correlation_id is distinct from job_id::text or e.payload->>'incidentId' is distinct from incident_id::text
   or e.payload->>'paymentId' is distinct from payment_id::text
   or e.payload->>'shopifyTransactionId' is distinct from transaction_id
   or e.payload->>'doneReceiptDigest' is distinct from md5(to_jsonb(d)::text)
   or e.payload->>'afterIncidentDigest' is distinct from md5(to_jsonb(i)::text)
   or i.status is distinct from 'resolved' or i.resolved_by is distinct from 'ops-repair-231'
   or i.resolved_at is null or i.resolution_note is distinct from resolution_note
   or not exists(select 1 from company_brain_incident_events ce
    where ce.id::text=e.payload->>'canonicalIncidentEventId' and ce.incident_id=i.id
     and ce.event_type='resolved' and ce.previous_status='open' and ce.new_status='resolved'
     and ce.actor='ops-repair-231' and ce.note=resolution_note)
  then raise exception 'SHOPIFY_4692_FINAL_DUPLICATE_CONFLICT'; end if;
  return jsonb_build_object('duplicate',true,'resolved',true,'incidentId',incident_id);
 end if;
 if i.status is distinct from 'open' or i.updated_at is distinct from '2026-10-26T08:10:30.922903Z'::timestamptz
  or i.resolved_at is not null or i.resolved_by is not null or i.resolution_note is not null
 then raise exception 'SHOPIFY_4692_FINAL_INCIDENT_CAS'; end if;
 if jsonb_typeof(p_proof) is distinct from 'object'
  or p_proof-array['checkedAt','shopifyTransactionCreatedAt','shopifyTransactionId'] is distinct from required_proof
  or jsonb_typeof(p_proof->'shopifyTransactionId') is distinct from 'string'
  or coalesce(p_proof->>'shopifyTransactionId','') !~ '^[1-9][0-9]*$'
  or 'gid://shopify/OrderTransaction/'||(p_proof->>'shopifyTransactionId') is distinct from transaction_id
  or jsonb_typeof(p_proof->'checkedAt') is distinct from 'string'
  or jsonb_typeof(p_proof->'shopifyTransactionCreatedAt') is distinct from 'string'
 then raise exception 'SHOPIFY_4692_FINAL_PROVIDER_PROOF'; end if;
 begin
  checked:=(p_proof->>'checkedAt')::timestamptz;
  receipt_created:=(p_proof->>'shopifyTransactionCreatedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'SHOPIFY_4692_FINAL_PROVIDER_TIME';
 end;
 inspected_at:=clock_timestamp();
 if checked is null or receipt_created is null or not isfinite(checked) or not isfinite(receipt_created)
  or checked<inspected_at-interval '5 minutes' or checked>inspected_at
  or checked<admitted_checked or checked<d.created_at
  or receipt_created<date_trunc('second',admitted_checked) or receipt_created>checked
 then raise exception 'SHOPIFY_4692_FINAL_PROVIDER_TIME'; end if;
 before_digest:=md5(to_jsonb(i)::text);
 select * into i from transition_company_brain_incident(incident_id,'resolved','ops-repair-231',resolution_note);
 if i.status is distinct from 'resolved' or i.resolved_by is distinct from 'ops-repair-231'
  or i.resolution_note is distinct from resolution_note or i.resolved_at is null
 then raise exception 'SHOPIFY_4692_FINAL_TRANSITION'; end if;
 select ce.id into canonical_event_id from company_brain_incident_events ce
 where ce.incident_id=i.id and ce.event_type='resolved' and ce.actor='ops-repair-231'
  and ce.previous_status='open' and ce.new_status='resolved' and ce.note=resolution_note
 order by ce.occurred_at desc limit 1;
 if canonical_event_id is null then raise exception 'SHOPIFY_4692_FINAL_TRANSITION_EVENT'; end if;
 insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
 values(case_id,event_key,'SHOPIFY_PAID_4692_INCIDENT_RESOLVED','OPS','ops-repair-231',job_id::text,
  jsonb_build_object('incidentId',incident_id,'jobId',job_id,'paymentId',payment_id,'qontoId',qonto_id,
   'shopifyTransactionId',transaction_id,'providerProof',p_proof,'canonicalIncidentEventId',canonical_event_id,
   'doneReceiptDigest',md5(to_jsonb(d)::text),'beforeIncidentDigest',before_digest,'afterIncidentDigest',md5(to_jsonb(i)::text)));
 return jsonb_build_object('duplicate',false,'resolved',true,'incidentId',incident_id,'shopifyTransactionId',transaction_id);
end;
$repair$;
