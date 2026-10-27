# Supabase incident repair, 2026-10-27

Scope: NEONTRIP project `klibiejfisijpagzkxls`. The user approved the existing repair plan, beginning with the two exposed views. Application deployment still requires the exact clean commit approval.

## Contract and changes

- Goal: eliminate the two measured lookup bottlenecks and rejected audit events.
- Neighbor: exact customer/company matching, payment/refund/consent/Ads deduplication, customer communication and task reservation rules remain unchanged.
- Effect: the existing read-only function returns identical JSON; three expression indexes accelerate the unchanged order/request resolver; the existing event whitelist includes seven types already emitted by the deployed writer.
- Allowed systems/files: the named Supabase function/indexes/constraint, `insertEvent` in `src/lib/ops/supplier-sales.ts`, focused tests and this documentation.

The autoreply function previously evaluated the shared-provider domain rules for every customer in a materialized CTE. It now evaluates them only for the current contact and contacts with the same tenant and exact normalized company. No matching rule changed.

EXPLAIN showed a full scan of 7,624 requests for each explicit supplier reference (30 ms for one). Indexing the exact `lower(request_id)`, `lower(btrim(request_id))` and `lower(id::text)` expressions accelerates the existing resolver without rewriting the Ads candidate or financial functions.

The event writer uses `ON CONFLICT(idempotency_key) DO NOTHING` through PostgREST and requests only returned IDs. Only one newly returned ID counts as a successful reservation. An ignored duplicate, failed request or ambiguous response remains false; confirmation emails and deadline tasks cannot be repeated because of the change. Existing event payloads are never overwritten.

## Verified database changes

Applied separately on 2026-10-27, with short lock timeouts, source/constraint drift checks and a check after each change:

- `v_easybill_invoice` and `v_orders_dash`: `security_invoker=true`; all privileges revoked from `anon` and `authenticated`. Definitions unchanged. Service-role row counts and full content hashes matched before/after in repeatable-read transactions (3,385 invoices / 3,806 orders). Actual unauthorized SELECTs failed with 42501. Advisor ERROR findings cleared.
- Autoreply real-case JSON identical in one repeatable-read transaction: 11,394.69 ms before / 71.65 ms after. Unknown email and invalid input unchanged. Existing local company-context fixtures and rollback comparison pass.
- Ads v3 candidate set identical in one repeatable-read transaction: 7,245.95 ms before / 870.68 ms after; zero eligible candidates at this snapshot. A service-role read completes within two seconds. No conversion upload or ledger mutation was performed.
- Event constraint validated, RLS remains enabled, all 1,421 existing audit rows retained. No historical event replay.
- Natural verification: supplier sync `10484861` succeeded at 12:50–12:51 UTC and persisted 20 previously rejected `source_trello_order_title_synced` events. A natural Ads v3 API request returned HTTP 200 (2,646 ms). Existing duplicate-event HTTP 409 responses remain until the prepared application writer is deployed.

Migration: `20261027123707_repair_supabase_incident_queries_events.sql`. The database statements are already applied; the application writer change is pending release. View hardening is recorded below because those legacy views are not created by the Ops repository migrations:

```sql
ALTER VIEW public.v_easybill_invoice SET (security_invoker=true);
REVOKE ALL PRIVILEGES ON public.v_easybill_invoice FROM anon, authenticated;
ALTER VIEW public.v_orders_dash SET (security_invoker=true);
REVOKE ALL PRIVILEGES ON public.v_orders_dash FROM anon, authenticated;
```

The only n8n reference found was an inactive invoice draft. No references appeared in 159 published active workflows or deployed application runtime code. Existing backend health stayed green after both view changes.

## Verification and rollback

- Isolated PostgreSQL 17 test: existing autoreply assertions, complete before/after fixture JSON comparison, seven additional allowed events, rejection of unknown events, duplicate reservation prevention, unchanged grants, rollback retaining audit history.
- Supplier-sales tests: 98 passing, including no resend for duplicate/unknown/failed reservations.
- Full `test:quotes`: 1,585 passed, two skipped. Node 24 needs `NODE_OPTIONS=--test-reporter=tap` because an existing nested test checks TAP summary text; the default reporter caused a formatting-only failure.
- TypeScript and production build passed. No UI change.
- Application rollback: previous deployed Ops commit `0f96c82e7481482130f483eef2c737e941dd0a20`.
- SQL rollback restores the prior function and removes only the three new indexes. Keep the additive event whitelist and accepted events: removing newly accepted history is not a rollback.
- View rollback backup is in the incident workspace; restoring public permissions would reintroduce the exposure and is not a routine application rollback.

## Separate incident paths

Docker logged Supabase AAAA resolution timing out through host stub `127.0.0.53` at 09:01:21 UTC and later Trello AAAA timeouts at 10:16 UTC. Upstream vs local-stub cause remains unresolved. The bounded DNS capture reuses the existing capture implementation, with 15-minute runtime, 50 MB capture limit, 10% CPU and 128 MiB memory. No resolver configuration was changed.

The capture automatically stopped after 899.49 seconds, at 12:52:06 UTC (12,436 packets / 1,769,839 bytes). All 1,702 Supabase and 304 Trello A/AAAA stub queries had matched replies; maximum target-query latency was 52.39 ms. No Docker DNS error occurred in the window. This bounds the observation and does not establish the cause of the earlier intermittent timeout. The stopped diagnostic is not a watchdog or a permanent service.

The interrupted Shopify hourly sync was followed by successful execution `10472047`; the affected order was later updated in the canonical database at 12:01:18 UTC. No workflow retry was initiated in this repair.

The configurator image error is addressed in a separate Offers candidate, preserving geometry verification and the frozen purchase.
