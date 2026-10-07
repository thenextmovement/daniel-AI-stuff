# Delayed proforma after payment — 2026-10-07

Scope: NEONTRIP Billing v2 only. This is an unpublished database-function repair.
No workflow, credentials, trigger topology, tables, schema fields, existing jobs,
customer documents, payments or fulfillment records are changed by the migration.

## Proven failure

Read-only production evidence for #NEONT4746: payment at 08:58:29 UTC,
final invoice completion at 08:58:59 UTC, tax-sync completion at 08:59:10 UTC,
proforma completion at 09:00:01 UTC. The final invoice was sent at 08:59:57 UTC;
the later proforma was sent at 09:00:54 UTC. Both PDFs contain the accepted
billing address. The final invoice states fully paid; the proforma still says
payment is immediately due. The canonical case retained paid_at and
final_invoice_at but regressed to PAYMENT_PENDING.

The live function definitions were read on 2026-10-07:
- billing_queue_proforma_after_shopify_tax_sync trusts the earlier nextJobType,
  without rechecking payment or the finalized invoice.
- billing_job_complete resets every completed proforma to PAYMENT_PENDING
  (or MANUAL_REVIEW), even when payment/final invoice already exists.
- billing_queue_customer_document_after_finalize queues that proforma for mail.

Document worker u48KZyTcU2J9pw2P was published at
22b714f4-3885-44b0-aec5-a6a1183dcd84 when inspected. No n8n write was made.

## Smallest repair and contract

Migration 20261007093500 changes only three existing function fragments:
1. Under the existing billing-case row lock, enqueue a post-tax-sync proforma
   only while both paid_at and final_invoice_at are null.
2. A late proforma completion preserves the existing paid/invoiced case status.
   The completed provider document remains recorded for reconciliation.
3. A proforma finalized after payment/final invoice does not create a delivery job.

Ziel: the observed payment-before-tax-sync/proforma-completion ordering creates
no new proforma demand and does not regress the paid/final-invoice status.
Nachbar: unpaid revisions, existing tax-review behavior, final-invoice mail,
payment projection, delivery idempotency and lease replay rejection stay unchanged.
Wirkung: the isolated database shows the exact case state, finalized provider
record and delivery-job count; no real customer is used as a test.

Plan self-review: guarding only the status would still send a demand; guarding
only enqueue would miss an already claimed document. The three guards cover
the observed ordering without altering the worker or financial documents.

## Verification

Isolated PostgreSQL 17 container, network disabled and no published ports:
- Five SQL scenarios pass: unpaid, tax review, paid awaiting invoice,
  paid+invoiced, and final invoice on payment terms without paid_at.
- Each checks tax-sync enqueue, late completion, provider record retention,
  delivery count/deduplication, completed-lease rejection, final-invoice delivery
  and conditional payment projection.
- The unmodified live functions reproduce the paid-case enqueue failure.
- Migration passes; rollback reproduces that failure; reapplication passes.
- Full function-definition comparison matches exactly the three intended fragment
  replacements, with no unrelated source delta.
- 22 existing Billing worker, change-review/notification, financial-event and
  cancellation tests passed.
- Local setup initially needed terminators for exported function definitions
  and parentheses around CASE expressions in test assertions; neither failure
  occurred in production and both were corrected before the successful run.
- Only database functions/test SQL/docs change; no application build or UI test
  is claimed as evidence.

Run supabase/tests/billing_paid_proforma_race.sql only in an isolated database
with the billing schema and the existing billing triggers, after the migration.
Do not run fixture SQL against production.

## Release and remaining boundary

Not published. Follow AGENTS.md exact-clean-commit approval and codex-predeploy.
A Git deployment alone does not prove the Supabase migration was applied.
Before applying SQL, reread and save the full three live functions, trigger
definitions and ACLs, and check against the reviewed snapshot/diff. Migration
and rollback reject missing/ambiguous patch fragments and preserve other source.

After approved application, verify full function diff/ACLs/trigger state, then
check a normal naturally occurring unpaid correction and the guarded race with
non-sending evidence. No customer canary, resend, invoice void or payment edit.

The already sent #NEONT4746 proforma and regressed case require a separate,
explicitly reviewed accounting reconciliation. This migration has no historical
backfill and will not repair that record automatically. Its final invoice does
not require an address correction based on the inspected PDF.

A proforma already finalized and queued/claimed for delivery *before* a later
payment is outside this bounded repair. Closing the external-send timing window
would require reviewing the existing delivery worker immediately-before-send
contract; this change makes no claim about that different ordering.
