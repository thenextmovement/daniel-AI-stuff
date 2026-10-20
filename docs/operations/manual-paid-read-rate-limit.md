# Manual-paid reconciliation: Shopify read rate limit

NEONTRIP only. Repair the existing `MANUAL_SHOPIFY_PAID` completion contract and
workflow `6NZnfGpyfUVikqpf`; do not create another workflow or queue.

## Contract

- **Ziel:** A structured HTTP 429 from the existing Shopify transactions GET,
  before payment effects, releases the existing lease and defers the same job
  for 300–900 seconds. Three deferred retries are allowed for the same input;
  a fourth 429 blocks for review. Respect a longer Retry-After by blocking,
  never by retrying earlier. New observations retain an active backoff; normal
  pending work still gets its existing immediate recheck after an input change.
- **Nachbar:** Successful reads, exact-paid invoice completion, payment guards,
  mail gates, credentials, activation and normal output connections are preserved.
  Other HTTP failures, missing evidence, legacy mode and unknown effect outcomes
  remain failures requiring review.
- **Wirkung:** Only the reconcile job's completion metadata, status, lease and due
  time change. No payment, invoice or customer-send record is written by the
  retry completion. A future execution enters the existing guarded read path.

The API validates the proof; the database independently validates it and binds it
to the leased order and execution. The retry counter belongs to `lastCheck` only
for this outcome. Existing lease, generation, fingerprint and canonical binding
checks remain in force. The migration checks the full current function's MD5
before applying its bounded changes to claim and completion.

`scripts/manual_paid_read_rate_limit.mjs` generates three existing-workflow patch
operations from a fresh full read: add the transactions GET's error outlet,
interpret only its structured 429 in the existing completion Code node, and
connect that error outlet directly to completion. Original short HTTP retries
remain unchanged; their exhaustion now records a durable backoff.

## Verification

- `npm run verify`: full repository tests, type checks and production build.
- `tests/quotes/billing-manual-paid-reconciliation.test.ts`: strict 429 proof,
  invalid/write-side evidence, unknown failures and Retry-After boundaries.
- `tests/sql/billing-manual-paid-read-rate-limit.test.sql`: disposable PostgreSQL
  transaction using the actual claim/completion functions. Verifies persistent
  backoff, not-due exclusion, old-lease replay rejection, retry exhaustion,
  input-change behavior, exact-paid completion, unknown-outcome blocking, and byte-equivalent payment,
  invoice, case and customer-send rows with no additional jobs.
- Offline execution of the actual completion Code node: normal exact-paid
  output unchanged; only structured 429 uses the new outcome. Full workflow
  diff contains two node changes and one error connection. Settings, static
  data, credential references and activation are unchanged.

Local tests do not prove deployment or provider recovery. Do not manufacture a
provider throttle or customer-send canary.

## Release and rollback

1. Obtain approval for the exact clean Ops commit. Run `codex-predeploy ops` and
   `codex-safe-push-main` from that task worktree; verify the deployed health SHA.
2. Re-read and back up the complete live claim/completion functions and job.
   Apply only migration `20261020101455_manual_paid_read_rate_limit.sql`.
   Abort on source drift. Read back the complete function and compare with the
   reviewed claim and completion candidates, preserving invoker security, search
   paths and privileges.
3. Capture the complete current workflow, `versionId`, `activeVersionId` and
   activation state. Recheck immediately before the bounded patch. Reject
   draft/active drift or any unrelated full-diff change. Publish using the
   supported n8n path and verify full active readback, credentials and activation.
4. Recover only the independently verified job below. Wait for a natural
   execution and reconcile its final database/provider evidence.

Rollback the workflow first, restoring only these three changes against a fresh
version check, then restore the captured original claim and completion functions. Remove
the API allowance only with an approved release. A blocked job remains blocked
until reviewed. Never roll back financial records or replay an invoice send.

## Single-job recovery: #NEONT4777

Known incident: execution `9863883`, Shopify order `8601448349963`, job
`af411480-40fd-4809-90ef-fbd82413f4cb`, case
`95655eeb-f722-48fb-acab-3ffc651324ed`. The GET failed with HTTP 429 before any
payment node; the lease expired and the job became `BLOCKED`.

Before any reset, refresh the current records and provider proof. The existing
86751-cent payment must remain MATCHED with completed projections; Easybill
invoice `3710784327` must still be fully paid and already sent, and customer-send
job `5cb2a625-4c80-4671-83f1-af40d27cf72f` must remain DONE. Confirm no later or
parallel execution has changed these facts.

Only after the deployed repair is verified, use a transaction with a row lock
and compare-and-set on this exact reconcile job: expected `BLOCKED`,
`LEASE_EXPIRED_REVIEW_REQUIRED`, claim execution `9863883`, unchanged generation,
input and binding fingerprints, and unchanged update timestamp from the fresh
read. Save its full before state. Set it PENDING/due, release stale lease fields
and clear the technical error; preserve its input, history and idempotency key.
Abort on any mismatch. Never reset other jobs or replay the failed execution.

The natural existing poll must reach `EXACT_INVOICE_PAID` and DONE using the same
job. Verify unchanged payment/document/send IDs, counts and financial/send
timestamps; inspect the actual executed node set to exclude payment registration
and invoice dispatch. A green unrelated execution is not recovery proof.
