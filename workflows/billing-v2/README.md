# NEONTRIP Billing v2 (inactive implementation bundle)

This bundle contains the Easybill document worker, the isolated customer-document delivery worker, a signed intake adapter for Shopify orders outside the offer flow, passive Shopify-event and payment-match adapters, payment projection, and the internal VAT-review alert with direct Ops/VIES links for the new BillingCase ledger. Generated workflows are intentionally inactive until their documented cutover gate is complete.

The document worker claims exactly one leased job from Ops, maps the locked BillingCase snapshot to Easybill, checks customer and document number before creating anything, finalizes the Easybill draft without sending it, and completes the Ops job with the Easybill document ID. The external document number is always the prepared BillingCase number: `PF-NEONT5012`, then `PF-NEONT5012-1`; the final invoice number is exactly `#NEONT5012`; `NT-NEONT5012` remains only the separate Easybill customer number.

The separate delivery worker sends only an already finalized Easybill document. Recipient selection is deterministic: an explicit invoice email wins, otherwise the retained customer/order email is used. Missing or invalid recipients are queued and retried instead of being silently skipped; after four failed attempts Billing-v2 creates an urgent incident and the n8n error workflow raises a FATAL billing alert. The first Pro-forma is sent as one combined order-confirmation/Pro-forma email; later revisions, invoices, credits and cancellations use explicit document-specific subjects. The Easybill PDF is attached, the permanent billing portal and AGB are linked, and retries reload `last_postbox_id` before sending to prevent duplicate mail.

The cutover migration never backfills already finalized documents. Existing unsent documents require a reviewed, explicit backfill so a deployment cannot produce an uncontrolled historical mass mailing.

The optional project number is stored independently, shown in Ops and the customer portal, mapped to Easybill's structured `buyer_reference`, and also printed as `Projektnummer: …` in every supported billing document. A pre-invoice project-number change creates the next Pro-forma revision. The contractual order confirmation still goes to the signer; the invoice email governs billing documents only.

Tax mapping is deterministic: German taxable and EU B2C use `NULL`, verified or provisional foreign-EU B2B uses `IG`, and Switzerland/other third countries use `AL`. A final invoice job cannot be queued while tax review is open.

The Shopify adapter is called only by an authenticated existing source workflow after that workflow has loaded the authoritative post-refund Shopify totals and line items. A full Shopify cancellation without a final invoice first queues exactly one invoice under the Shopify order number. Only after that invoice has finalized does the database queue its linked `ST-…` cancellation; a case becomes `CANCELLED` only after the cancellation document has finalized. An already invoiced order queues only the linked cancellation. The automatic intermediate invoice for an unpaid cancellation is never sent; the finalized cancellation document produces the single customer message. A partial pre-invoice refund still voids the superseded Easybill Pro-forma and creates a new revision only from the complete post-refund Shopify line snapshot; post-invoice refunds still create `GS-…` jobs. No age-based unpaid-order cancellation exists. An unresolved VAT review blocks this accounting chain for manual resolution instead of creating a potentially incorrect final invoice.

The payment adapter is called by the existing bank/Qonto matching workflow. Only an exact cumulative full payment creates the invoice job automatically. Partial or excess payments remain manual review. Payment projection into Shopify and Easybill is handled by separate idempotent jobs, never by marking an unpaid order paid merely to unlock a refund.

## Active production refund recovery and reconciliation

The production Shopify cancel/refund adapter is n8n workflow `I5kUtHRBOuXXl3zg` (`NEONTRIP Billing v2 - Shopify Cancel + Refund Event Adapter`). Shopify is authoritative for order, refund and cancellation events. The adapter resolves the exact original Easybill invoice, derives its VAT rate, and creates or reuses the linked credit/cancellation document. Replayed events are idempotent by their immutable Shopify event ID and exact Easybill document number. A missing BillingCase does not suppress historical Shopify refunds: scheduled reconciliation may use the guarded legacy fallback, but only after an exact source-invoice lookup succeeds.

The universal Shopify order intake polls the 50 newest production orders every minute. It covers offers, configurator sales, duplicated orders and manually converted Draft Orders through the immutable Shopify order ID. Unpaid orders start with a Pro-forma; orders already paid in Shopify start atomically with the final invoice. A successful intake is fingerprinted only after Ops accepts it, while BillingCase, document and delivery jobs remain independently idempotent.

The production daily watchdog is n8n workflow `pp3hOVlqekA00ymn` (`NEONTRIP Shopify ↔ Easybill Daily Reconciliation v2.0`). It runs daily at `12:00 Europe/Berlin` and compares the ten newest Shopify orders with Easybill using exact document numbers:

- invoice: `#NEONT...`
- Pro-forma: `PF-NEONT...`
- credit: `GS-NEONT...`
- cancellation: the Easybill cancellation linked to the source invoice

The watchdog compares original and current gross totals, successful Shopify refunds, Easybill credit totals and cancellation state. It never mutates accounting documents and never contacts customers. A mismatch sends one deduplicated urgent internal message to `info@neontrip.de`; healthy runs remain silent. Every external request has a bounded timeout, retry policy and explicit failure path.

Production evidence from 2026-08-24:

- adapter version 15, successful creation of `GS-NEONT4534` (EUR 7.69) and `GS-NEONT4575` (EUR 7.64)
- replay execution `5447149` reused both existing credits and created no duplicate
- watchdog version 8, exact ten-order reconciliation execution `5447320` completed successfully

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
