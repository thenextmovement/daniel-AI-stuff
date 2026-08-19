# Billing v2 cutover checklist

This checklist is deliberately operational. Completing the implementation or importing an inactive workflow does not authorize a production cutover.

## 1. Preconditions

- [ ] `rechnung.neontrip.de` points to the approved Ops deployment and the permanent token route renders in the NEONTRIP UI.
- [ ] All four BillingCase migrations have passed isolated apply, behavior test, rollback and reapply.
- [ ] Ops and Offers production commits match the two reviewed pull requests.
- [ ] Every billing workflow is imported inactive, uses the intended production credentials and calls the existing error workflow `M4uG1HAtN9Zggxww`.
- [ ] A dedicated Ops worker bearer and Offers-to-Ops HMAC secret are installed without exposing them in workflow JSON or logs.
- [ ] Customer emails are suppressed until the corresponding test explicitly checks them.
- [ ] The existing Easybill Import Manager remains active.

## 2. Required Shopify source correction

The active Offers source workflow inspected during implementation was `SEKwtYAVRR7zeKnl` (`NEONTRIP Offers → Shopify Order v1`). Before every order, the current order's tax treatment must overwrite the customer's current Shopify tax-exempt state. It must never preserve or restore an older state.

Replace the legacy decision equivalent to:

```js
const desiredTaxExempt = ctx.taxExempt ? true : wasManaged ? false : Boolean(customer.tax_exempt);
```

with the order-authoritative decision:

```js
const desiredTaxExempt = Boolean(ctx.taxExempt);
```

Then verify the managed tax tag is added for net orders and removed for taxable orders. This patch needs a separately reviewed production workflow change; this repository artifact does not modify the active workflow.

## 3. Shadow checks without financial writes

- [ ] Connect all signed sources: Offers sale, ordinary Shopify orders, Shopify cancel/refund/delivery events and the existing bank matcher.
- [ ] Keep Easybill document workers inactive and compare computed BillingCase snapshots with actual Shopify orders.
- [ ] Reconcile immutable Shopify order ID, order name, currency, line quantities, discounts, shipping, gross, net, tax and customer address in cents.
- [ ] Confirm unknown, duplicate and out-of-order events are idempotent or enter manual review.
- [ ] Confirm every terminal failure creates one urgent incident with subject/context `Fehler Rechnung Shopify/Easybill`, direct Ops link and retry history.

## 4. Marked EUR 10 canary matrix

Every canary must be unmistakably marked as a test in offer/order metadata and customer-visible text. Use an authorized real EU VAT ID only with the owner's permission; otherwise use an official validation-test value where the authority provides one. Never invent a VAT ID belonging to an unrelated business.

| Case | Expected tax/result |
| --- | --- |
| Germany, no VAT ID | German VAT; PF; exact full payment creates exactly one final invoice |
| Austria, valid matching VAT ID | Provisional net order accepted; VIES result visible; approval permits final net invoice |
| Austria, valid VAT ID with name/address mismatch | Order and production remain possible; urgent review email; final net invoice blocked until approval |
| Austria, missing/invalid VAT ID | Taxable; no silent intra-community exemption |
| Switzerland | Third-country net without VAT-ID requirement |
| Same customer: Austria then Germany | Customer is tax exempt for the AT order and reset to taxable immediately before the DE order |
| Same customer: Germany then Austria | Customer is taxable for the DE order and set tax exempt immediately before the AT order |
| Customer invoice-address change before invoice | Approval creates the next PF revision (`PF-NEONT…-1`) |
| Admin invoice-address change before invoice | Change is immediate, logged with login, next PF revision created |
| Exact full payment | Final `#NEONT…` invoice created once and payment projected idempotently |
| Partial/overpayment | No automatic final invoice; manual review |
| Purchase on account + DHL/DPD delivered | Final invoice automatically on authoritative delivered event; due 14 days after receipt |
| Manual delivered | Requires timestamp, evidence type and reason; creates final invoice once |
| Full refund/cancel before final invoice | PF is voided, case closed; no accounting cancellation document |
| Partial refund before final invoice | Old PF voided; replacement PF uses authoritative post-refund line snapshot |
| Refund after final invoice | Credit note `GS-NEONT…`, then `GS-NEONT…-1` for another one |
| Cancel after final invoice | Cancellation document `ST-NEONT…`, then `ST-NEONT…-1` for another one |
| Duplicate payment/refund/cancel/delivered webhook | No duplicate document or payment |
| Easybill/Shopify timeout and retry | Bounded retry; urgent incident after fourth failure; no duplicate document |

For every case, compare Shopify, Ops, Easybill and the PDF. Shopify's gross presentation is not used as a substitute for comparing the complete cent-level tax snapshot.

## 5. Customer communication proof

- [ ] Signature produces Shopify Sale first, then BillingCase/PF, then one order-confirmation message with the permanent `rechnung.neontrip.de` link.
- [ ] Confirmation clearly accepts the order, states `Zahlbar sofort`, and explains production can begin but may be paused if payment is missing, causing delay.
- [ ] Portal wording says `Änderungen zur Rechnung`; it does not imply product/order changes.
- [ ] Portal remains readable after final invoice but rejects further changes.
- [ ] No duplicate Easybill document email and no customer email is emitted by a retry.

## 6. Cutover and rollback gate

Only after every row above has evidence and explicit approval:

1. Pause the old Easybill Import Manager at an agreed timestamp.
2. Reconcile the final overlap window by immutable Shopify order ID and document number.
3. Activate one Billing v2 worker at a time and execute a new marked canary.
4. Observe at least one complete payment and one delivery-on-account path.
5. Keep rollback ready: deactivate Billing v2 writers first, inspect leased jobs and reconcile Easybill by exact number before changing any database state.

The test orders are cleaned up according to their actual document stage: pre-invoice PFs are voided/closed; issued invoices are corrected with the appropriate credit/cancellation document. Historical legal documents are never deleted or edited.
