# Full Qonto payment projection: 26 October 2026

Prepared correction only. Apply solely after explicit approval of the exact commit.
Do not merge or push main: that would trigger an unrelated Ops deployment.
Do not change Shopify payment status, send customer mail or replay historical Manual-Paid failures.

## Problem and exact scope

PR224 corrected the two source bindings and created the final invoices without email.
Their existing matched bank credits are already in the internal ledger. External
payment projection was intentionally held pending complete provider history and
notification checks. The ordinary worker cannot safely infer those facts from
the invoice creation result. This change admits only the two held canonical jobs,
with a short-lived proof and a separate read/verify path around the existing POST.
It creates no bank transaction and no additional ledger allocation.

| Order | Case | Qonto credit | Final invoice | Amount EUR |
| --- | --- | --- | --- | --- |
| #NEONT4692 | 17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588 | 01a17742-cb98-7b8f-af8e-9743ed3ad972 | 3717331959 | 1,163.82 |
| #NEONT4796 | 4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7 | 01a16919-e2ff-780e-b230-1496816dc599 | 3717333369 | 1,479.00 |

Payment jobs: 66cdafb5-f754-486c-a7de-0119a4c63c06 and
79b533c8-5f40-4b32-8375-5e2ea836ae74, currently BLOCKED / attempt 0.
The #4692 Shopify job c4ebb761-c3d9-47d0-afbe-49c4533a007d remains BLOCKED.
The #4796 Shopify projection remains DONE. Invoice jobs and documents remain unchanged.

## Validation

- 33 pure and generated-workflow tests: `node --test --test-reporter=tap workflows/billing-v2/full-qonto-repair/payment-recovery.test.mjs`.
- CI invokes those checks through `tests/quotes/full-qonto-repair.test.ts`.
- 22 PostgreSQL checks in a disposable PostgreSQL 17 container without network:
  `LIVE_FUNCTIONS=/path/to/read-only-function-snapshot.sql python3 scripts/test_full_qonto_repair_db.py`.
  Capture the current definitions of billing_job_claim, billing_job_complete,
  billing_payment_ingest and resolve_recovered_billing_job_incidents using pg_get_functiondef.
  The optional snapshot overlays repository migration definitions. Without it,
  the suite checks migration-defined functions, not current deployed functions.
- A transaction delay regression rejects evidence that expires while the transaction
  is open; admission uses clock_timestamp() after acquiring locks.
- The exact nested PostgREST ledger/case/document GET was exercised read-only against
  production and returned the expected relationship. Temporary probe was deleted.
- MCP validateOnly accepts 48 payment-workflow operations and one alarm-route operation.

## Apply after exact-SHA approval

1. Fetch workflow K9poQw3a1DOO16Vd and alarm workflow M4uG1HAtN9Zggxww through MCP.
   Compare payment nodes/connections/settings with baseline SHA256
   aadf51de61553fc1061a592715f232730f10a1da61c94abe6789af5e923b1dbb.
   Stop on drift; preserve credentials, active state, minute schedule and 180-second lease.
2. Use buildPatch and patchAlarm from patch-workflow.mjs to generate the candidate.
   Review exactly the delta, validateOnly, then apply scoped MCP operations. If the
   known partial-API schema error occurs, re-read to prove no mutation and use full
   MCP only for the exact fresh candidate. Read both top-level and published versions.
   The alarm change adds only this worker to the existing support@neontrip.de route;
   preserve five-minute throttling. Do not generate a test alarm.
3. Immediately before admission, read each original Shopify order directly, both
   easybill final invoices and proformas, all four document-payment histories, and
   easybill webhooks. Require exact IDs, amounts, currency and customer IDs, no
   cancellations/refunds, #4692 PENDING / #4796 PAID, all histories complete and empty,
   paid_amount 0, paid_at null, final-invoice last_postbox_id null and no active or
   unknown webhook. Verify internal ledger, bank raw data and customer-mail jobs.
   Do not reuse the preparation-time evidence from 26 October 18:37–18:38Z.
4. In one transaction, load ops/repairs/20261026-full-qonto-payments.sql and invoke
   pg_temp.release_full_qonto_payment separately for each case with the freshly
   observed preflight JSON. Required keys are checkedAt, shopifyOrderId,
   shopifyFinancialStatus, totalCents, shopifyCancelled, shopifyRefundCount,
   invoiceId, proformaId, invoicePaidCents, proformaPaidCents,
   paymentHistoriesCompleteAndEmpty, noActiveEasybillWebhooks, invoicePostboxNull.
   Values must reflect actual reads, never assumed booleans. If either admission
   fails, roll back both. No schema migration is needed; the function is session-local.
   Capture before/after and the unique FULL_QONTO_PROJECTION_ADMITTED event.
5. Allow the normal scheduled worker to claim. Do not trigger a manual execution.
   Before POST it re-reads documents, complete histories, webhook state and the fresh
   ledger/case/invoice. It allows only attempt 1 within five minutes of preflight.
   A later attempt can only reuse an exact existing receipt; an empty or ambiguous
   history blocks another POST. After POST, status 201 plus the exact paid invoice
   and matching payment receipt are required before ordinary job completion.

## Completion and archive

Read actual easybill payment IDs, notice/Qonto ID, amount and date, final invoice
paid state, DONE job and durable completion event, and unchanged customer-mail queue
and final-invoice sent_at/last_postbox_id. Verify exactly one existing internal bank
allocation per case and no added bank/ledger row. Do not infer customer delivery.
Check the normal #4796 reconciliation follow-up and its permanent incident state.
Archive its single-case error plus unambiguous duplicates only after full closure.
Read each moved message in the actual Archive folder and compare its original body.

#4692 remains financially open in Shopify. Its allocation warning stays visible
until that separate hold is resolved with verified notification behavior and a
separately authorized scope. Daily watchdog digests containing any other open case
stay visible. Historical Manual-Paid errors remain separate and untouched.

## Failure, rollback and limits

A network failure after POST is ambiguous; never retry the POST manually or reset
attempt_count. Inspect provider history for the exact receipt. Retain existing
locks/holds and internal alarms. Admission's unique event makes re-running it a no-op.
If configuration rollback is required, first ensure neither repair job is processing;
preserve its receipt/history and place any unstarted repair job under a reviewed
hold before restoring the two prior n8n versions. Never release a flagged job into
the older worker or undo a completed financial receipt. Do not delete audit evidence.

Provider reads and POST are not a single atomic external transaction. Concurrent
manual provider edits or webhook changes in that interval cannot be ruled out by
these guards. An ambiguous result remains blocked for inspection. This is a scoped
recovery for two verified bank credits, not a general payment rule or a claim that
the historical 502 root cause has been fixed.
