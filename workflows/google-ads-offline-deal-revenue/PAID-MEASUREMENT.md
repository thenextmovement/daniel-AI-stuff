# NEONTRIP paid purchase measurement — release candidate

Status: implemented locally on 2026-10-20; not migrated, installed, published or enabled in production.

## Contract and sources

- **Ziel:** one paid business order per Google purchase conversion, with verified payment time/value and consented attribution. Internally retain visibility of paid orders without advertising consent or Google IDs.
- **Nachbar:** existing offer conversions, B2B paid-deal matching, provider receipts/leases, refund adjustments, payment and fulfillment remain on the existing paths. Konfigurator orders cannot fall back to a prior inquiry's consent.
- **Wirkung:** `master_orders` plus the existing financial resolver establish payment; the existing upload-attempt receipt with a provider job ID establishes Google acceptance. Neither a checkout event nor a green polling execution proves either.
- **Scope:** one migration, two nodes each in the existing producer/uploader, checkout attribution capture, a revoke-only Shopify custom pixel, tests and the exact two-campaign goal change. No new service, workflow, schedule or provider.

Database: `klibiejfisijpagzkxls`. Ads customer: `4396424947`.
Producer: `vCDQuqaWOALmMd56`, observed active version `0247c805-de82-4d16-b4e2-68ec8018992d`.
Uploader: `1EjFCTTp84otDKgG`, observed active version `6fd2e79e-cef0-4e2b-a875-70fbc0f551dc`.
Shopify sync `I9vCp27sS3jcH1am` already persists `_Entwurf` in line properties and is unchanged.

## Implementation

The matching Offers backend saves validated consent/IDs using the service-only RPC `record_configurator_measurement_v1`. Private context is frozen at first capture, expires after 90 days and cannot be restored after withdrawal. Cleanup occurs during later measurement writes; this is not a scheduled purge guarantee. No contact data is added to the measurement context.

The new configurator reads GA IDs through `gtag('get')` with a bounded 250 ms wait. It never fabricates IDs or reads private cookie formats. Consent changes stop stale checkout handoffs and request revocation. A storage outage does not block checkout; the order remains visible internally as unlinked.

`tracking/shopify/measurement-consent.pixel.js` carries only the checkout reference and its revoke-only capability to Offers. Install it as a separate custom pixel without an analytics/marketing permission prerequisite, because it needs to process withdrawal. Do not change the Google app pixel's permissions. The candidate does not emit purchase events or send data to Google. It handles denial conservatively: either denied category withdraws all measurement identifiers for that checkout.

The v3 candidate/claim RPCs extend the existing ledger:

- Only canonical payment evidence and an actual payment timestamp qualify. Creation-time fallbacks, unpaid/cancelled orders, invalid refunds and zero remaining net value do not qualify.
- `_Entwurf` links attribution; it is never the deduplication key. A second real order for the same design remains a second purchase.
- A unique canonical acceptance ID is the business key when available, otherwise the Shopify order ID. Ambiguous multiple paid orders for one acceptance are held for reconciliation. Existing ledger rows and a unique partial index prevent a second export.
- Konfigurator orders always require checkout context, marketing consent, verified revoke capability, an actual Google click and capture before order creation. They cannot bypass those conditions through an older inquiry link.
- Claim time rechecks payment, refunds, consent and deduplication. Existing leases and receipt/retry handling remain. The Google order ID stays the existing ledger UUID.
- Only four existing n8n node parameters change. Triggers, schedules, credential references, other nodes and adjustment paths stay unchanged.

`paid_purchase_reconciliation_v1(from,to)` is an order-level internal read. It includes paid orders even without Google eligibility and reports payment-time certainty, net/remaining value, cancellation/refund status, measurement status, business key and actual provider receipt. Do not sum rows blindly: multiple Shopify records for one business key require reconciliation, and unknown payment time is a separate bucket. This repair does not create a new analytics dashboard.

## Google Ads cutover

Fresh readback on 2026-10-20:

- Custom goal `6459376937`, “NT · Konfigurator · Online-Kauf”, contains only `761935343` (“Google Shopping App Purchase”).
- Campaigns `24337811446` and `24339083713` use that custom goal. All 32 standard campaign goal rows are non-biddable.
- Existing `7533078197` (“Offline: Deal gewonnen”) is enabled, primary, UPLOAD_CLICKS, MANY_PER_CLICK, 90-day click window.

After operational payment/export proof, replace the custom goal's sole action with `7533078197`. Keep the campaign association and non-biddable standard goals. No budget, bid, ad text, B2B goal or native diagnostic action changes. A secondary action is still biddable inside a custom goal, so changing its primary/secondary label alone is insufficient.

`google-goal-cutover.json` records the exact before/after state and readback conditions. Refresh them immediately before any authorized mutation; stop on drift. Keep an exact cutover timestamp for reporting. Historical “All conversions” can contain both diagnostic and paid actions and must not be summed as sales.

## GA4 limitation

The Shopify app's native GA4 `purchase` remains checkout-completion telemetry, including its server integration. This candidate does not add another GA4 purchase sender, disconnect the app or claim to correct old GA4 purchase totals. Native server events cannot be safely renamed by a browser-only Modify Events rule.

Use canonical paid-order reconciliation as the paid-sales KPI and the existing offline action for Ads optimization. Historical orders without contemporaneous consent/IDs are not backfilled to Google. GA4, Google Ads attribution and internal sales totals will differ by consent, attribution, timing and refunds.

Sources: [Google custom campaign goals](https://developers.google.com/google-ads/api/docs/conversions/goals/campaign-goals), [Shopify native GA4 integration](https://support.google.com/analytics/answer/16947140?hl=en), [GA4 event modification limits](https://support.google.com/analytics/answer/10085872?hl=en-UM), [Shopify pixel privacy API](https://shopify.dev/docs/api/web-pixels-api/pixel-privacy).

## Release sequence after exact approval

1. Recheck both clean commit SHAs with the supported predeploy helpers. Refresh the current Pages deployment, complete artifact, Ads state, SQL definitions and full active n8n graphs. Preserve server-side workflow versions and rollback references; do not write secrets into local backups. Stop if state differs from the reviewed candidate.
2. Apply `20261020173858_configurator_paid_measurement.sql` to the NEONTRIP payment project through the supported migration mechanism. Read back functions, grants and index. No historical order or payment mutation.
3. Publish the matching Offers commit and verify its deployed SHA and existing tracking configuration. Keep existing cart recovery compatible.
4. Install and verify the separate revoke-only Shopify pixel. Its code has local behavioral proof, but Shopify runtime delivery remains unverified before release. Verify the real sandbox origin, checkout attributes and revoke acknowledgement; if unavailable, do not enable the new advertising path.
5. Publish the complete verified Pages artifact, preserving every other route/asset. Current candidate changes ten files within `configurator/`; the remaining 1,859 site files are identical to the captured published baseline. Do not deploy the partial repository directory. Rebuild/merge a newly advanced production baseline before requesting a changed candidate approval.
6. Recheck n8n active versions immediately before writing. Apply the uploader's two nodes, verify the full diff/active version, then the producer's two nodes. Use natural scheduled runs; no forced customer conversion. Retain complete provider responses and receipt correlation through existing mechanisms.
7. For a genuine consented paid order, reconcile immutable checkout reference, stored consent, canonical payment, one business key/ledger row, claim and provider receipt. A second scheduled run must not produce a second conversion. Check no-consent/unlinked sales remain internally visible. Refund/adjustment paths remain existing behavior.
8. Apply the exact Google custom-goal change and read it back, including standard campaign goals. Record the switch time. Only this full chain supports a claim of an operational repair.

Exact-commit approval authorizes this staged sequence; a failed prerequisite stops the dependent stage. Local tests and workflow validation alone do not satisfy steps 4 or 7.

## Recovery

Prefer a forward correction. Stop affected export before attempting recovery if payment/consent/receipt state is uncertain; a pause of the shared uploader also delays B2B exports and must be reported. Never replay uncertain provider calls with another ledger/order ID.

The prior node parameters in `paid-purchase-updates.json` are reference material, not an automatic rollback recipe. **Do not switch the uploader blindly to v2 after new configurator rows exist:** v2 does not enforce their checkout consent. Retain v3's guards or first resolve/hold every affected pending row with an explicitly reviewed recovery.

Keep the compatible Offers cart reader and revoke endpoint. An old Offers binary rejects new carts containing the extra attribute. Reverting the frontend or Ads goal does not remove this compatibility requirement. Do not drop the ledger key, private consent data or provider receipts as rollback.

## Focused verification

Offers: 74 tests across measurement, checkout route/service/ready and Shopify provider; focused ESLint, TypeScript and production build passed.
Ops: 22 checkout-attribution tests, four workflow/pixel tests, complete runtime rebuild/check passed. Existing vendor fontkit `axisIndex` warning is unchanged.
PostgreSQL 17: the actual migration and behavioral SQL passed in an isolated, networkless fixture database. Covered ACL/allowlist, owner collision, frozen attribution, sticky withdrawal, paid/unpaid/cancelled/refunded/time fallback, repeated real purchase, ambiguous acceptance, missing privacy bridge, no later-consent backfill, inquiry fallback exclusion, leases, receipts and B2B/offer neighbors. The unchanged financial resolver is fixture input; these checks do not claim to revalidate all existing billing logic.
Both n8n partial updates passed `validateOnly`; neither has been applied.
