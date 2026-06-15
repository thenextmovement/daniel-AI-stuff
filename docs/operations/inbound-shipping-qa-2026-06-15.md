# Inbound Shipping QA - 2026-06-15

Scope: `/ops/customer-records/inbound-shipping` and `/api/ops/customer-records/inbound-shipping`.

This audit was performed against the local codebase plus read-only unauthenticated production checks. No production data was modified, no customer communication was triggered, and no production workflow was changed.

## Findings

### High - Customer Records quicklinks did not filter Inbound Shipping

`/ops/customer-records/inbound-shipping?requestId=...` was linked from Customer Records, but the Inbound Shipping page and API ignored `requestId`. Operators could land on an apparently empty or broad board and miss the intended inbound shipment.

Fix:

- Server page now passes the initial `requestId` to the client.
- Client includes `requestId` in board loads and exposes the filter.
- API forwards `requestId` to `listInboundBoard`.
- `listInboundBoard` resolves the request to Trello card IDs and filters `inbound_shipments` by `trello_card_id`.

Verification:

- `listInboundBoard filters inbound shipments by linked requestId`
- Local Playwright smoke verified `requestId=REQ-1` pre-fills the filter.

### High - Production localhost bypass could be trusted from host-derived state

Localhost bypass logic was host-based and did not explicitly disable itself in `NODE_ENV=production`. Ops access must not rely on a client-controlled host-like signal for production bypass behavior.

Fix:

- `isLocalOpsHost` now returns false in production in both the route auth helper and middleware copy.

Verification:

- `isOpsPortalBypassed only trusts localhost outside production`
- Unauthenticated production checks returned `401` for page and API.

### High - Incident task creation was not strongly idempotent

The `create_task` action checked for existing tasks through a bounded active task list and the fallback task table used random idempotency keys. Parallel requests could create duplicates when the existing task was outside the fetched window or when two inserts raced.

Fix:

- `OpsInternalTaskListOptions` supports `sourceRef`.
- `findOpsInternalTaskBySourceRef` performs direct lookup.
- Fallback `sales_tasks` path derives deterministic `idempotency_key` from `sourceRef`.
- Insert conflict recovery returns the existing task.
- Migration prepared to enforce unique active source refs in Postgres.

Verification:

- `createOpsInternalTask uses sourceRef as fallback idempotency key`
- `createOpsInternalTask returns existing sourceRef task after idempotency conflict`

### Medium - Unsupported filters silently returned misleading data

Unsupported query values such as `scope=stale-ish` were accepted and effectively mapped into broad active filtering. A broken link or manipulated query could look valid while showing the wrong board.

Fix:

- API validates `scope` and `carrier`, returning `400` with clear issues.

Verification:

- `inbound shipping route rejects unsupported scope filters`
- `inbound shipping route rejects unsupported carrier filters`

### Medium - Sensitive Ops API responses lacked explicit no-store headers

The route is dynamic, but responses did not explicitly prevent browser/proxy storage of shipment and incident data.

Fix:

- All route JSON responses include `Cache-Control: private, no-store, max-age=0`.
- Responses vary by `Cookie` and `Cf-Access-Jwt-Assertion`.

Verification:

- `inbound shipping route rejects unsupported actions with no-store headers`
- Local runtime check confirmed `cache-control: private, no-store, max-age=0`.

### Medium - Supabase raw details were exposed to clients

`SupabaseRestError.details` could be returned to the browser. This can expose table names, SQL details, or backend diagnostics to operators and client-side logs.

Fix:

- Raw Supabase details are logged server-side only.
- Client response keeps only the generic error message and status.

Verification:

- `inbound shipping route does not expose raw Supabase details to clients`

### Low - Filter controls lacked explicit accessible names

The filter controls relied on visible placeholders/options. This is weaker for keyboard/screen-reader operation.

Fix:

- Added `aria-label` for status filter, carrier filter, request filter, and operator input.
- LocalStorage write is guarded for hardened browser contexts.

Verification:

- Local Playwright smoke confirmed all labels exist on mobile and desktop.

## Test Matrix

| Case | Status | Evidence |
| --- | --- | --- |
| Normal board load | Covered locally | API tests and local runtime route smoke |
| Empty list | Covered locally | Local board with missing Supabase config showed empty/handled state in UI smoke |
| Missing request link | Covered | `requestId` with no Trello card returns empty board in code path |
| Linked request | Covered | Regression test for `requestId -> trello_card_id -> inbound_shipments` |
| Invalid scope/carrier | Covered | Route tests assert 400 |
| Duplicate task click / race | Covered at code level | Deterministic idempotency and conflict recovery tests |
| Reload during action | Partially covered | Client reload state not E2E-auth tested |
| Parallel users | Covered at code/DB-prep level | Source-ref lookup, deterministic key, unique migration prepared |
| Carrier/API outage | Covered in parser/RPC-adjacent tests only | 17TRACK and status parser tests pass; no live carrier calls |
| Many records | Partially covered | Query limit bounded to 500; no load test against real DB |
| Mobile viewport | Covered locally | Playwright 390x844 no horizontal overflow |
| Desktop viewport | Covered locally | Playwright 1440x900 no horizontal overflow |
| Unauthorized access | Covered read-only live | Production page/API returned 401 unauthenticated |
| Secrets in frontend/logs | Partially covered | No client secret exposure found; Supabase details no longer sent to client |

## Verification Commands

Latest verification:

```bash
npm run test:quotes
npm run build
```

Results:

- `npm run test:quotes`: 170 passing tests.
- `npm run build`: successful production build.

Runtime checks:

- `https://ops.neontrip.de/ops/customer-records/inbound-shipping` without login returned `401`.
- `https://ops.neontrip.de/api/ops/customer-records/inbound-shipping` without login returned `401`.
- Local API invalid filter returned `400` with no-store headers.
- Local mobile and desktop smoke had no horizontal overflow.

## Safety Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4 | Request filtering and invalid filters fixed; live authenticated data not exercised. |
| reliability | 4 | LocalStorage, error handling, and no-store response behavior hardened. |
| idempotency | 4 | SourceRef idempotency fixed in code; DB unique migration prepared but not applied. |
| observability | 4 | Incident actions now log PII-light action context; no durable audit table for manual status actions yet. |
| security | 4 | Production local bypass disabled, unauth 401 checked, Supabase details no longer returned. |
| tracking impact | 5 | No tracking changes. |
| cost risk | 4 | No live carrier calls; 17TRACK path covered only by tests. |

## Required Follow-Up Before Production Migration

The DB uniqueness migration is prepared but intentionally not applied during this audit.

Before applying:

1. Back up affected tables or confirm recent Supabase backup.
2. Run duplicate checks for `ops_internal_tasks(source_app, source_ref)` and `sales_tasks(source='ops_internal', source_ref)`.
3. Apply `supabase/migrations/20260615180000_unique_ops_internal_task_source_ref.sql`.
4. Verify incident task creation twice for the same test incident in a controlled environment.
5. Roll back with `supabase/rollbacks/20260615180000_unique_ops_internal_task_source_ref_rollback.sql` if needed.

## Rollback

Application rollback:

- Revert the Inbound Shipping/auth/internal-task changes in the app commit and redeploy the previous revision.

Database rollback, only if the prepared migration was applied:

```bash
supabase/rollbacks/20260615180000_unique_ops_internal_task_source_ref_rollback.sql
```

Operational rollback:

- Do not change n8n workflow activation as part of this app-only audit.
- If incident actions misbehave after deploy, disable use of the `Aufgabe`, `Gesehen`, `Erledigt`, and `Ignorieren` controls operationally and roll back the app revision.

## Open Risks

- Authenticated live side-effect actions were not executed against production data.
- DB unique migration was not applied.
- Carrier/17TRACK live outages were not simulated against production.
- No full load test with 500 real inbound rows was run.
- No durable audit table exists for manual inbound incident status changes; current observability is server logging.
