# Shopify mirror customer totals — 20 November 2026

Scope: NEONTRIP / PROJ-001. Workflow m6VJ0hvDT7I40xy0; Supabase klibiejfisijpagzkxls.
Source: galaxybuzzdk.myshopify.com. No Shopify writes, customer sends, payment actions, or app deployment.

## Root cause
The complete mirror already runs every 15 minutes and verifies Shopify source counts and written immutable IDs.
Its mapper discarded test/current-total/Shopify-update metadata. Neither this workflow nor the separate hourly
I9vCp27sS3jcH1am workflow maintained master_customers.total_orders / total_revenue.
All 8,972 customer counters were zero despite 3,875 mirrored orders.

The hourly workflow imports only the latest 250 orders since 2026-01-01 into master_orders.
That operational table has downstream customer automations; it is deliberately not backfilled here.

## Change
Apply supabase/migrations/20261120102000_shopify_mirror_customer_totals.sql.
Use patch.mjs buildOperations against a fresh workflow read. It inherits the existing credential reference.
Only the mapper changes and one RPC step follows Record Verified Sync.
Existing schedules, settings, connections, credentials, audit and error workflow remain intact.
The partial-update MCP failed validation without changes; full-update MCP applied the exact preserved definition.
Readback confirmed active version f1937cd3-78ee-48e7-9760-e7bb04c9f8ca.

RPC requires a recent verified complete snapshot and rejects partial/newer overlapping snapshots.
Exact normalized email matching, test and cancelled orders excluded. Sum current_total_price; foreign-currency
customers retain count but EUR amount is NULL. No domain grouping or name-based contact merging.
orders_synced_at records freshness. Errors preserve previous customer counters and fail the workflow.
Existing error workflow ArT3LN25Mb1PAuBE routes mirror failures to support@neontrip.de.

## Verification
10 Node tests passed, including existing full-pagination, partial-write and sanitized-alert tests.
Isolated PostgreSQL 16 fixture verifies complete-snapshot guards, test/cancellation exclusion, exact-email separation,
foreign-currency handling, true zero, idempotency, privilege restrictions and failure preservation.
Run: node --test n8n/patches/2026-11-20-shopify-totals/mapping.test.mjs n8n/patches/2026-10-19-ops-mirrors/sync.test.mjs
SQL fixture: supabase/tests/shopify_mirror_customer_totals.sql (isolated DB only).

Rollback: restore mapper from mapping.before.js and remove the new node/connection, preserving other changes.
Additive columns may remain. Do not erase or reset customer totals automatically.
The application's direct Shopify order popup and existing cached summaries are not changed by this patch.
