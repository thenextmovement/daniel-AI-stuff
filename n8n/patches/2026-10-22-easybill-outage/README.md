# Issue #211: easybill outage recovery and partial-payment warnings

NEONTRIP service patch, applied through n8n MCP on 2026-10-22 under the explicit operational repair authorization. This PR records the already-applied node sources and focused connection changes; it does not require an Ops application deployment. Existing live changes associated with PRs #167, #179 and #203 are preserved.

- Qonto Validate Order: exact-reference, verified-payer settled EUR underpayments produce a colored received/remaining warning. Shortages up to EUR20 request an explicit production and waiver/collection decision. No automatic waiver or full-paid mutation.
- Qonto legacy admission: after a masked API error, a successful exact case lookup must prove absence before the existing invoice identity/tax/amount guard runs. Failed reads and existing cases never qualify.
- Document Worker: read-only easybill availability gate precedes claiming. Unavailable provider does not consume job attempts; internal alert deduplicates identical status for24h and the queue resumes on recovery. Previously blocked jobs still require evidence-based review.
- Document preparation preserves the delivery tax country for EU_B2C_OSS after a billing-address correction.
- Void Worker failure handling retains the claimed job and lease when preparation failed.

The manifest records only changed/new nodes and connection deltas, not a whole-workflow backup. Native n8n versions provide rollback. Settings, credentials, schedules and activation are unchanged.

Validation: 10 isolated node tests pass; production build including TypeScript passes. Readback matches the deployed node code. Native document validation has no errors. Qonto and Void have respectively16 and5 pre-existing validator diagnostics (including unsupported community node and JS-bracket false positives), unchanged by this patch; all connections validate. Actual recovered invoice/payment/cancellation paths were read back from Shopify, easybill and billing records. Two clearly labeled internal alert tests were verified in Outlook, with no test customer sends.

Operational case records and customer data are deliberately outside Git. Only evidenced bank receipts were projected; approved waivers/skonto keep actual cash separate. Settled manual exceptions are excluded from the incompatible exact-full-cash recheck using the existing explicit manual-settlement block convention. This is not a general waiver policy. No money transfers/refunds were initiated.

Run tests: `node --test n8n/patches/2026-10-22-easybill-outage/repair.test.mjs`.
Open `preview.html` for isolated synthetic warning examples.
