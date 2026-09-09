# Manual Shopify paid reconciliation — scoped state and separate reuse release

Local implementation, not a deployment or production workflow proof. This contract repairs the existing NEONTRIP child `6NZnfGpyfUVikqpf` with existing canonical BillingCases. The parent remains `evaWllMchZnV4xTh`. No new schedule/service/table, no automatic case creation, no provider calls in either RPC.

## Contract

The existing authenticated POST `/api/internal/billing/jobs/claim` dispatches explicit `scope: MANUAL_SHOPIFY_PAID` to `billing_manual_paid_claim`. `operation` is required: `admit` records identities/input/legacy alert memory without any claim; `claim` admits and selects at most one due case. `worker`, numeric n8n `executionId`, `jobTypes: [RECONCILE]`, optional integer `leaseSeconds` (30–600, default 120) and `candidates` are required/validated by `manual-paid-reconciliation.ts`.

Candidates contain numeric `shopifyOrderId`, `shopifyOrderName`, `origin: handoff|legacy_due`, optional amount/currency/sourceRevision/sourceEventId and legacyAlerts. At most one handoff plus 200 complete prospective legacy candidates; overflow rejects atomically, never truncates. Legacy candidates additionally carry ISO `firstSeenAt`/`nextAttemptAt` and numeric millisecond `lockedUntil`. `legacyAlerts: [{key,markedAt}]` only adds correctly order-bound dedupe memories; it is not proof of sending or delivery.

One unique key `billing:<caseId>:reconcile:manual-shopify-paid:v1` retains state in the existing `RECONCILE` job. Case lookup is exact numeric/GID order identity plus exact order name; missing/mismatched identities create no case/job. The response separates every `intake` binding from `claimed` and `legacySelected`. The latter are mutually exclusive and both null for `admit`. A busy/blocked/mismatched/failed admission never authorizes legacy fallback. Fair selection compares due time, first-seen time and identity among eligible canonical and unmapped legacy cases. Canonically bound legacy entries cannot reopen DONE or overwrite a newer handoff.

`claimed` contains the existing job/Case/invoice context plus `claimContext`. Preserve its `executionId`, `inputGeneration`, `inputFingerprint`, `bindingFingerprint`, and job `lease_token` until the real terminal branch. Do not complete immediately after payment registration if projection/mail still follows.

POST `/api/internal/billing/jobs/<jobId>/complete` receives that claim context, `scope`, `leaseToken`, `outcome` and optional `proof`, `reasonCode`, `alert`. It dispatches to `billing_manual_paid_complete`. Generic claim/complete signatures stay unchanged and explicitly exclude/reject this scope.

| Final outcome | Result |
| --- | --- |
| `EXACT_INVOICE_PAID` | DONE, no due; proof requires numeric Easybill document ID, exact number, equal positive integer invoice/paid/expected Shopify cents, EUR. |
| `NOT_MANUAL_PAID` | DONE without a paid confirmation. |
| `EASYBILL_PROJECTION_VERIFIED` | PENDING, 5 minutes; projection DONE is still not provider payment proof. |
| `BILLING_PAYMENTS_REGISTERED` | PENDING, 15 minutes; only if this is the final branch. |
| `REVIEW_REQUIRED` | PENDING, 60 minutes; requires explicit alert disposition, including gate suppression. |
| `OUTCOME_UNKNOWN` / `EXECUTION_FAILED` | BLOCKED, no automatic retry. |

An alert has the order/transaction `key` and `status: ALREADY_MARKED|GATE_SUPPRESSED|SEND_ACCEPTED|SENT_CONFIRMED|UNKNOWN`. Outlook V2 send returns `{success:true}` without a message ID: the workflow may submit `SEND_ACCEPTED` with `proof:{accepted:true}` only from that direct successful result. It stores API acceptance, not delivery. `SENT_CONFIRMED` additionally requires a concrete response ID when a provider path actually supplies one. Unknown outcome blocks; no automatic resend. The dedicated mail gate keeps its existing 24-hour policy; its empty output must still reach explicit completion.

The DB checks the actual time after acquiring locks. Expired/foreign claims cannot complete. Expired scoped PROCESSING is never re-leased and becomes BLOCKED during a subsequent bounded claim call; no case SYNC_BLOCKED mutation or new recovery mechanism. A new input generation cannot be silently overwritten by an old completion. A safely completed old generation schedules the new input; possible external effect remains BLOCKED. Existing payment/projection idempotency is unchanged.

## Verification and cutover

`python3 scripts/test_manual_paid_reconciliation_db.py` creates an ephemeral networkless PostgreSQL container from the locally available `postgres:17-alpine` image, installs actual billing migrations/functions and runs synthetic atomic/concurrent/ACL checks. It removes only its own container. It never connects to Supabase or provider APIs. Route/validation checks are in `tests/quotes/billing-manual-paid-reconciliation.test.ts`.

Before production: verify active versions and DB function baseline, preserve full backup/diff/rollback, resolve startability of old queued/new child executions, and prove the existing-child admit-only transition before enabling claim. Merely seeing no running execution is insufficient with an asynchronous parent. Do not blanket-deactivate the Shopify webhook parent. Initial alert/pending migration and every early terminal path must be accounted for. Unmapped legacy is an explicit remaining concurrency risk.

The rollback script refuses once scoped state exists. After admission, retain canonical state and guards; plan reconciliation of actual outcomes and ownership before any rollback. Never restore old StaticData or allow generic workers to take these jobs.

## 2B: separately prepared, activation requires natural 2A proof

The second migration `20260909170545_manual_paid_reconciliation_reuse.sql` adds bounded reuse, not a new scheduler. The 2A commit remains a separate release candidate. Before activating 2B, prove natural 2A ownership, terminal completion and independent persistence; prepare the compatible child accepting `FRESH_REUSED` and the existing parent carrying raw revision fields first.

A reusable source has original `updatedAt`, `financialStatus`, explicit `cancelledAt`, integer `refundCount`, boolean `manualPaidObserved`, and `paymentRoute`. Cache eligibility requires a nonfuture timestamp, paid, null cancellation, zero refunds, true manual observation, VORKASSE, positive raw integer cents and explicit EUR. Missing/incomplete source revision is normalized to null and proceeds to a full claim. Normalized/default EUR, a zero amount or the old `<orderId>:paid` fingerprint never creates eligibility. The API strips unrelated volatile source fields before fingerprinting.

A paid completion must match the existing canonical case amount/currency and provider document binding. It stores `reusePolicy:2` and `validUntil=claim.startedAt+5 minutes` only for eligible inputs with a canonical invoice and unchanged generation/binding. A new matching handoff within that original window yields `intake.result=FRESH_REUSED`; the job row, recorded proof, due and expiry are unchanged. Canonical binding and remaining freshness are checked again after any case-row lock wait. Another open due case can still be claimed.

DONE retains `next_attempt_at=null` in both releases. A timer or old legacy entry never reopens it, even after expiry. Only a new relevant handoff can request another real check. Every actual fresh provider confirmation starts its own conservative proof window; a hit never extends one. External Easybill changes are not promised immediate detection.

The second rollback restores the exact 2A functions and preserves every existing job/marker/proof; it cannot roll back actual external effects. The original 2A rollback still refuses once any scoped state exists. No runtime feature flag is used.
