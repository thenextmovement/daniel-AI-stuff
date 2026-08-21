# NEONTRIP Billing v2 (inactive implementation bundle)

This bundle contains the Easybill document worker, a signed intake adapter for Shopify orders outside the offer flow, passive Shopify-event and payment-match adapters, payment projection, and the internal VAT-review alert with direct Ops/VIES links for the new BillingCase ledger. They are intentionally inactive and have not been imported, credential-bound, executed, or deployed.

The worker claims exactly one leased job from Ops, maps the locked BillingCase snapshot to Easybill, checks customer and document number before creating anything, finalizes the Easybill draft, sends the finalized document to the locked invoice email, and completes the Ops job with the Easybill document ID. The external document number is always the prepared BillingCase number: `PF-NEONT5012`, then `PF-NEONT5012-1`; the final invoice is `#NEONT5012`/`NEONT5012` according to Easybill's accepted number format.

The optional invoice email entered during offer acceptance is snapshotted as the dedicated recipient for every Pro-forma, invoice, credit note and cancellation document. If it is initially empty, Offers resolves it once to the signer's email before intake. An approved pre-invoice portal change updates both the top-level destination and the immutable next revision; it cannot be cleared to an undeliverable value. Retries reload the finalized Easybill document and use `last_postbox_id` to avoid sending the same document twice.

The optional project number is stored independently, shown in Ops and the customer portal, mapped to Easybill's structured `buyer_reference`, and also printed as `Projektnummer: …` in every supported billing document. A pre-invoice project-number change creates the next Pro-forma revision. The contractual order confirmation still goes to the signer; the invoice email governs billing documents only.

Tax mapping is deterministic: German taxable and EU B2C use `NULL`, verified or provisional foreign-EU B2B uses `IG`, and Switzerland/other third countries use `AL`. A final invoice job cannot be queued while tax review is open.

The Shopify adapter is called only by an authenticated existing source workflow after that workflow has loaded the authoritative post-refund Shopify totals and line items. A full Shopify cancellation without a final invoice first queues exactly one invoice under the Shopify order number. Only after that invoice has finalized does the database queue its linked `ST-…` cancellation; a case becomes `CANCELLED` only after the cancellation document has finalized. An already invoiced order queues only the linked cancellation. These automatically generated cancel documents are finalized without customer email. A partial pre-invoice refund still voids the superseded Easybill Pro-forma and creates a new revision only from the complete post-refund Shopify line snapshot; post-invoice refunds still create `GS-…` jobs. No age-based unpaid-order cancellation exists. An unresolved VAT review blocks this accounting chain for manual resolution instead of creating a potentially incorrect final invoice.

The payment adapter is called by the existing bank/Qonto matching workflow. Only an exact cumulative full payment creates the invoice job automatically. Partial or excess payments remain manual review. Payment projection into Shopify and Easybill is handled by separate idempotent jobs, never by marking an unpaid order paid merely to unlock a refund.

Before any import or activation:

1. Bind `CONFIGURE_EASYBILL_BEARER` to the existing scoped Easybill REST credential and `CONFIGURE_BILLING_WORKER_BEARER` to a dedicated Ops worker token.
2. Verify the existing n8n error workflow `M4uG1HAtN9Zggxww` still sends the urgent internal email; do not replace or disable it.
3. Apply and rollback/reapply all four BillingCase migrations in an isolated database.
4. Run the worker in manual mode against one explicitly marked €10 test case only.
5. Compare Ops, Shopify and Easybill IDs, number, gross/net/tax cents, country, VAT option, invoice email, project number and PDF before any customer email.
6. Keep the current Easybill import active until the full DE/AT/CH, payment, delivery, refund, cancel and duplicate-event matrix is green. During overlap, the test order must be excluded from one of the two writers to prevent duplicate invoices.

The exact shadow, canary and cutover gates are documented in `CUTOVER-CHECKLIST.md`.

The generated workflow is built with:

```bash
node workflows/billing-v2/build-workflows.mjs
node --test workflows/billing-v2/test-workflows.mjs
```
