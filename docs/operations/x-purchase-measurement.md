# NEONTRIP X purchase measurement

Prepared only. The database migration, backend routes and Shopify pixel are not released. The n8n draft is inactive. No purchase has been sent to X by this implementation.

## Contract and ownership

- Ziel: one X Purchase event for an explicitly consented X click and a canonically paid Shopify order, with gross EUR amount and actual payment time.
- Nachbar: leave Shopify checkout, Google Ads/GA4/Clarity, billing, invoices, Qonto reconciliation, customer messages and RIESENOBJEKTE unchanged.
- Wirkung: X HTTP 200 **and** `data.conversions_processed = 1` **and** `debug_id`, stored in the private ledger. A successful node or account-access check is insufficient.
- Systems: NEONTRIP store `galaxybuzzdk.myshopify.com`, Ops `ops.neontrip.de`, Supabase `klibiejfisijpagzkxls`, X account `18ce55xv4u4`, pixel `rhd4k`, purchase event `rhd5x`.
- Existing n8n billing `evaWllMchZnV4xTh` is not edited. The new isolated draft is `WdQ766qEeFKPv3Z3`. Credentials remain in encrypted n8n storage; files contain references only.

## Data path

1. Existing landing-page/configurator candidate passes a consented `twclid` to Shopify. Shopify's custom pixel requires Marketing consent and allows processing only while both `marketingAllowed` and `saleOfDataAllowed` are true.
2. Pixel captures the click and checkout token through Shopify standard events. No browser purchase event is sent. `checkout_completed` is only another opportunity to associate the checkout.
3. Public intake bounds JSON, hashes the token and records click/consent. It never accepts an amount or payment claim. Its opaque-origin CORS support is necessary for Shopify's sandbox, not authentication. Anonymous intake is capped at 1,000 new hashes/hour; no IP retention.
4. Every five minutes, only when pending contexts exist, the isolated n8n workflow reads minimal paid-order associations updated in the last 30 days. It follows pagination, rejects incomplete pagination and associates only hashes already captured with consent. No unconsented historical order is inserted.
5. One job is leased for three minutes. Fresh REST and GraphQL Shopify reads must agree on order, checkout token, non-test/non-cancelled PAID status, EUR gross total and full successful SALE/CAPTURE funds. AUTHORIZATION, partial funds, failed transactions, refunds and truncated transaction lists fail closed. Manual gateways additionally require existing canonical matched QONTO payments. No billing repair or write occurs.
6. Backend rechecks consent, expiry, lease and timestamp order before returning the X payload. Its event ID and conversion ID are fixed. Retries cannot change payment time/amount. A known permanent 4xx rejection blocks; timeouts, 429 and transient failures use bounded backoff with the same conversion ID, at most 12 attempts within 24 hours. Expired leases recover failed reads. The scheduled scan covers context/payment timing races.
7. Receipt records only X debug ID/status plus canonical payment facts. No customer names, emails, phone, address, design, source URL, IP or user agent is forwarded by this CAPI path. X browser lead measurement separately sees browser network metadata.

Consent revocation creates a tombstone, clears the click, invalidates a lease and beats an out-of-order grant. Browser revocation is transmitted with bounded retries. A request already in flight to X cannot be recalled; a network failure can prevent a revocation reaching the backend. A successful API receipt is not proof of ad attribution in reporting.

Coverage is intentionally limited to consented, unexpired X-click sessions and EUR payments. Organic/no-click visits, denied consent, blocked pixels, late consent after payment and data unavailable from Shopify are not fabricated or backfilled. Pending contexts expire after 30 days; non-delivered rows are removed after 31 days; receipt records after 90 days. Test/QA traffic is excluded. Existing declined or organic historical purchases are not test conversions.

## Prepared files and checks

- `integrations/shopify/neontrip-x-custom-pixel.js`: paste as a custom pixel, not as theme Liquid or an app pixel. Privacy settings: Marketing required; data sale qualifies. Read back the saved source and configuration before connecting.
- `integrations/shopify/x-privacy-addendum.html`: append once to the existing Shopify privacy policy after a fresh drift check. Preserve the existing policy. Current policy ID: `gid://shopify/ShopPolicy/22916956310`; no X section was present in the read on 2026-10-16.
- `supabase/migrations/20261016112233_x_ads_purchase_measurement.sql`: one private table, no public RLS access, service-role-only RPCs. Apply this migration alone, not all pending repository migrations.
- `scripts/build_x_measurement_workflow.mjs`: deterministic inactive graph; generated JSON under `workflows/x-measurement/`.
- `tests/quotes/x-purchase-measurement.test.ts`: payment/receipt/input boundary tests.
- `tests/x-shopify-pixel.test.mjs`: consent, payload minimization, withdrawal across reload, QA/cross-campaign checks.
- `tests/x-measurement-ledger.sql`: execute after migration in a disposable PostgreSQL database only. Exercised with PGlite (local PostgreSQL/WASM), not production Supabase.

The OAuth1 access check is confirmed by n8n execution `9531216`: X returned `ACCOUNT_ADMIN` for the expected account. This does not prove the conversion endpoint has accepted a purchase. The unused OAuth2 secret was rotated by the user after an accidental display; it is not referenced here.

## Release order and remaining proof

Obtain exact clean commit approval under repository AGENTS.md. Backend baseline is the live Ops commit `4f48a70fd0af200c2eb489525d3e4182cdc1c07a`. The landing-page candidate has a separate, newer Cloudflare baseline; do not push its unrelated history as an Ops release.

1. Recheck source/runtime drift and clean state. Run `codex-predeploy ops` on the approved backend commit; use `codex-safe-push-main` only with the matching full SHA. Verify actual Ops health SHA after release.
2. Apply only the approved X migration; verify RLS/function grants and column contract read-only. Verify public OPTIONS, denied-origin response, and unauthenticated internal 401 without submitting real/fake conversions.
3. Release the separately approved landing-page commit through its existing Cloudflare workflow. Verify deployed source and actual served X files on affected pages.
4. Append the exact approved Shopify privacy addition and install/connect the exact custom pixel. Use Shopify's pixel testing view to verify standard-event token shape, consent transitions and capture response. Do not place a fake order or submit fake customer inquiries into production.
5. Re-read the complete n8n draft and ensure exact graph/settings/credential references, active=false and activeVersionId=null match the saved candidate. Publish this workflow only after database/backend/pixel checks pass. Keep execution payload persistence off. Verify published `activeVersionId`, exact graph and activation state.
6. Observe the next genuine eligible saved inquiry and paid purchase: persisted lead receipt to X event; canonical Shopify payment + consented checkout hash to one ledger receipt. Reconcile amount/currency/time and stable conversion ID with X's debug ID and Events Manager. A natural n8n run without an eligible order proves only scheduler health. Missing eligible traffic leaves end-to-end acceptance open.

Stop on non-200/no processing receipt, repeated failures, unmatched canonical checkout tokens, incorrect consent, or draft drift. Do not change invoices, create customer canaries, blindly replay financial operations or enable campaign spend.

## Rollback

Unpublish only the new X delivery workflow and disconnect only the new Shopify custom pixel. Revert only X tracking hooks/entry on the landing pages if necessary. Keep billing untouched. Preserve delivered receipt/dedup records for reconciliation; do not drop the new table or reset event IDs to retry. The draft's original two-node read-only graph is backed up in this task's `work/x-draft-before-expansion.json`. Restoring it is a separate exact diff; inactive state stays inactive.
