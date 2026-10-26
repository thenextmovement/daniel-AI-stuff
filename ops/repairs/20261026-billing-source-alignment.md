# Reviewed repair: #NEONT4692 and #NEONT4796

This is a one-off NEONTRIP data repair, not an application/schema release.
The SQL only defines a session-local function. Loading it performs no business writes.
Do not add it to Supabase migrations or change a worker, credential, schedule, or activation.

## Exact scope and downstream effects

- #NEONT4692 / Shopify 8513317896459 / case 17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588:
  align billing identity with the customer's 16 September correction and the already-correct
  easybill proforma 3675733235. Invoice recipient is aif-invoice@art-invest.de.
  Ingest only completed Qonto credit 01a17742-cb98-7b8f-af8e-9743ed3ad972 (116382 EUR cents)
  through the existing ledger RPC. It creates one canonical invoice job and one Shopify
  payment-projection job. No bank transfer is initiated. The existing processed_transactions replay guard is recorded as billing_v2_registered, with both external-completion flags false until real evidence exists.
- #NEONT4796 / Shopify 8618528702731 / case 4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7:
  use the customer's 22 October billing address, corroborated by fresh VIES for LU34785745:
  Albondigas S.à r.l., 22 Montée du Grund, L-1645 Luxembourg.
  Delivery stays at the existing Kehlen address. Recipient remains david@esteichen.eu.
  Preserve payment 1af5d142-949b-49c4-a2e0-3cbce2fd0b4d; never ingest it again.
  Preserve existing net/zero-VAT amounts and verified reverse-charge treatment, then queue
  the single canonical invoice via the existing action RPC.

Both operations increment the case revision, retain original documents, append a version
and before/after audit evidence, and leave unrelated cases and all dunning holds alone.
They create no replacement proforma and do not relax general matching or VAT guards.
The cause is stale canonical billing data after a customer correction, not an unsafe
identity check. Aligning that source lets the existing idempotent workers finish.

**After commit**, normal document workers create/finalize the paid invoices, project
payment into easybill, and the delivery worker emails each invoice to the listed recipient.
That customer delivery must be included explicitly in approval. The invoices state that
payment is received; the existing worker disables another payment link.
No historical Manual-Paid recovery is included.

## Preflight before execution

1. Obtain approval of the exact commit and both cases, including the normal invoice emails.
   No Coolify deployment or persistent database function/migration is needed.
2. Re-read full live cases, jobs, documents and pending customer changes through Supabase MCP.
   Inspect the relevant active n8n workers and ensure they still match the reviewed paths:
   u48KZyTcU2J9pw2P document, wqaTsVKuKqKnp2AG delivery, K9poQw3a1DOO16Vd projection.
3. Refresh production Shopify through its existing n8n credential. Confirm immutable IDs,
   original/current totals equal the target amounts, no cancellation/refund, #4692 pending
   and #4796 paid. Stop for any drift.
4. Refresh each easybill proforma by immutable ID. Confirm type, finalization, amount,
   paid_amount=0, canonical external_id and customer binding. For #4692 also compare its
   already-correct address to the exact intended correction.
   Search all pages for the final invoice numbers (with and without #), both associated
   customer document lists, and the canonical invoice external IDs. Any existing or
   ambiguous invoice stops this repair for investigation.
5. Refresh Qonto evidence and the mirror; compare exact provider ID, completed credit,
   EUR amount, settled_at and original reference. #4796 must still have exactly its one
   matching ledger payment with Shopify projection DONE.
6. Refresh VIES for #4796; name, address and VAT ID must match the reviewed entity.
   Build the preflight JSON from the actual reads, never by declaring an unperformed
   check complete. All external checks must be within five minutes at commit.
7. Compute each case hash using the exact projection below. Keep customer data and portal
   credentials out of committed test fixtures. Execute function definition and both calls
   in one explicit transaction with statement/lock timeouts; an error must roll everything back.

State hash:
```sql
select id, encode(extensions.digest(
  (to_jsonb(c)-'portal_token_hash'-'created_at'-'updated_at')::text,'sha256'),'hex')
from billing_cases c where id in
 ('17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588','4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7');
```

Required preflight properties: checkedAt, shopifyOrderId, shopifyFinancialStatus,
shopifyTotalCents, shopifyCancelled=false, shopifyRefundCount=0,
easybillInvoiceSearchComplete=true, easybillInvoiceCount=0,
proformaId and proformaPaidCents=0. For #4796 also viesValid, viesVatId,
viesName and viesAddress. Use the real VIES response, including its punctuation.

## Verification and archive gate

- Let existing workers run; do not force leases, manually execute schedules, or retry
  an uncertain external action. Read actual finalized invoices, amounts/tax/customer,
  payment entries and projection results. Confirm one invoice, one settlement and the
  intended unchanged delivery data.
- Verify actual customer postbox/Sent evidence and visible email/PDF formatting.
  A DONE job by itself is not proof of delivery.
- Reconcile the specific #4796 Manual-Paid row and watchdog facts from real final documents.
  Do not declare all old Manual-Paid gateway alerts fixed by these separate cases.
- After verified completion, resolve Company Brain incident 70d7f8ee-c565-4c69-ad52-09f355cdacd2 with transition_company_brain_incident and a note citing the actual payment, invoice and delivery evidence. This stops the separate daily unresolved-payment reminder; do not resolve it merely because the repair was queued.
- Only after these checks archive the #4692 alert and the #4796 reconciliation/watchdog
  notices, then read them back in the actual archive folder. Keep any unresolved mail visible.
- The operation is idempotent by its audit event. On unexpected state, stop and inspect;
  never delete financial effects or rerun an old plan blindly. Database rollback is valid
  only before commit. After workers create real documents, use the existing reviewed
  financial correction process if required.

## Evidence and tests

At 26 October 2026 09:41Z, exact final-invoice searches returned no documents and both
customer lists contained only their known proforma (one page, one document each).
Fresh Shopify/Qonto and customer-mail checks were completed separately in the case memory.
The original customer-mail bodies and live payloads are not committed.

Run `python3 scripts/test_billing_source_alignment_db.py` on neontrip-dev.
It creates a disposable PostgreSQL 17 container with no network or credentials,
loads the existing billing migrations, and tests both outcomes, duplicate suppression,
stale/ambiguous/locked states, bank/VIES evidence, preservation and rollback after writes.
`BASELINE=1` demonstrates the original missing alignment.
An additional isolated replay of the **current live** document-preparation node with both
private case snapshots confirms the expected recipients, companies, delivery preservation,
net/VAT totals and disabled payment links. It creates/sends nothing.
