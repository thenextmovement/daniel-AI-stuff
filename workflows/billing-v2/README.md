# NEONTRIP Billing v2 (inactive implementation bundle)

This bundle contains the Easybill document worker, a signed intake adapter for Shopify orders outside the offer flow, passive Shopify-event and payment-match adapters, payment projection, and the internal VAT-review alert with direct Ops/VIES links for the new BillingCase ledger. They are intentionally inactive and have not been imported, credential-bound, executed, or deployed.

The worker claims exactly one leased job from Ops, maps the locked BillingCase snapshot to Easybill, checks customer and document number before creating anything, finalizes the Easybill draft, and completes the Ops job with the Easybill document ID. The external document number is always the prepared BillingCase number: `PF-NEONT5012`, then `PF-NEONT5012-1`; the final invoice is `#NEONT5012`/`NEONT5012` according to Easybill's accepted number format.

Tax mapping is deterministic: German taxable and EU B2C use `NULL`, verified or provisional foreign-EU B2B uses `IG`, and Switzerland/other third countries use `AL`. A final invoice job cannot be queued while tax review is open.

The Shopify adapter is called only by an authenticated existing source workflow after that workflow has loaded the authoritative post-refund Shopify totals and line items. Before a final invoice, a full refund/cancel closes the case and voids the Pro-forma in Easybill; it does not create an accounting invoice cancellation document. A partial pre-invoice refund voids the superseded Easybill Pro-forma and creates a new revision only from the complete post-refund Shopify line snapshot. After a final invoice, refunds/cancellations create `GS-…`/`ST-…` jobs. No age-based unpaid-order cancellation exists.

The payment adapter is called by the existing bank/Qonto matching workflow. Only an exact cumulative full payment creates the invoice job automatically. Partial or excess payments remain manual review. Payment projection into Shopify and Easybill is handled by separate idempotent jobs, never by marking an unpaid order paid merely to unlock a refund.

Before any import or activation:

1. Bind `CONFIGURE_EASYBILL_BEARER` to the existing scoped Easybill REST credential and `CONFIGURE_BILLING_WORKER_BEARER` to a dedicated Ops worker token.
2. Verify the existing n8n error workflow `M4uG1HAtN9Zggxww` still sends the urgent internal email; do not replace or disable it.
3. Apply and rollback/reapply all four BillingCase migrations in an isolated database.
4. Run the worker in manual mode against one explicitly marked €10 test case only.
5. Compare Ops, Shopify and Easybill IDs, number, gross/net/tax cents, country, VAT option and PDF before any customer email.
6. Keep the current Easybill import active until the full DE/AT/CH, payment, delivery, refund, cancel and duplicate-event matrix is green. During overlap, the test order must be excluded from one of the two writers to prevent duplicate invoices.

The exact shadow, canary and cutover gates are documented in `CUTOVER-CHECKLIST.md`.

The generated workflow is built with:

```bash
node workflows/billing-v2/build-workflows.mjs
node --test workflows/billing-v2/test-workflows.mjs
```
