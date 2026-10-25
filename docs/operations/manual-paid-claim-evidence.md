# Manual-Paid claim evidence (NEONTRIP)

## Incident and limits

Error executions `10085629` (22 October 2026, 21:01:34 UTC) and
`10129008` (23 October, 09:06:31 UTC) failed in
`Admit or Claim Manual Paid Reconciliation`, workflow `6NZnfGpyfUVikqpf`,
at POST `/api/internal/billing/jobs/claim`.

Both original executions are no longer retained. The messages do not contain
order/job IDs. Current job, event and audit searches provide no immutable binding.
The claim function overwrites `payload.claim` on later ownership. Deployment
timing overlaps the second failure, but does not prove the gateway's root cause.
The existing availability GET/65-second wait predates both incidents.

Do not attribute either message to #NEONT4768 or interpret healthy later polls
as a historical completion. Both messages remain open. Original execution/request
evidence or a historical database backup is required to establish those bindings;
this change does not reconstruct missing history.

## Bounded correction

- Add an append-only, service-role-only receipt for each committed Manual-Paid
  admit/claim request, in the same database transaction. Store execution ID,
  operation, request fingerprint, offered order identifiers, intake dispositions
  and **actual** selected job/case/order. A scheduled claim may select a different
  due order from its supplied handoff. Canonical, legacy and no-selection results
  are distinguished. Do not store lease tokens, provider credentials, customer
  details, addresses or full request/response bodies.
- Keep the existing selection, locks, grace periods, retry backoff, freshness
  reuse, completion and financial write paths unchanged. Receipt persistence
  failure rolls back admission/claim as well: no ownership without its evidence.
  Receipts survive future claims and the supplied rollback.
- Route the existing claim HTTP error outlet to a terminal Code node with bounded,
  sanitized execution/input context. It always raises an error and has no outgoing
  business connection. Candidate IDs are explicitly not a selected-order proof.
  Missing receipts mean **unknown**, never authorization to retry. POST retries
  stay disabled. No automatic recovery or payment replay is introduced.
- Add only Manual-Paid workflow ID to the existing support@neontrip.de recipient
  allowlist. Existing alert suppression limits and other routing stay unchanged.

Receipts document selection, not invoice/payment completion or delivery of a
notification. Absence of a receipt can also mean the request never reached or
committed in the database; do not turn that absence into a success claim.
No historical receipts are fabricated or backfilled.

## Verification

```sh
MANUAL_PAID_PATCH=workflows/manual-paid/claim-evidence.patch.json \
MANUAL_PAID_ALERT_PATCH=workflows/manual-paid/alert-recipient.patch.json \
node --test tests/manual-paid-claim-evidence.test.mjs
python3 scripts/test_manual_paid_claim_receipts_db.py
```

The PostgreSQL runner uses a disposable PostgreSQL 17 container with no network
or exposed ports, reconstructed current claim/completion functions, and synthetic
orders. It verifies lost-response binding, input versus selected order, future
claim immutability, canonical/legacy/empty/admit receipts, atomic rollback on a
receipt-write failure, RLS/grants, and unchanged invoice/payment/customer-send
records. The existing read-rate-limit/unknown-outcome regression also runs.
Rollback preserves receipts, restores the exact prior claim function, and reapply
is tested. Both workflow patch sets must also pass MCP validateOnly.

The checked baseline claim MD5 is `fc007fbabfde868c6df063777801fb68`.
Migration aborts on source drift. No generic billing function is changed.

## Approval and release

Approval is required for the exact full Git commit and this scope. It includes
the Supabase migration and two localized n8n patches; it does **not** include
recovery/replay or archival of the two unresolved historical messages.

1. Recheck origin/main and review any drift before final SHA approval. Use the
   repository's codex-predeploy/codex-safe-push-main release workflow if publishing
   main. Confirm the exact Ops app/repository/branch/environment first.
2. Capture original claim definition/privileges and current workflow versions for
   this schema change. Apply only
   `20261025220000_manual_paid_claim_receipts.sql` with the source guard; read back
   the function, schema, RLS and permissions.
3. Re-fetch both full active workflows. Require matching expected version,
   activeVersionId and activation in each patch file, unchanged affected nodes,
   and no draft drift. Apply and publish only the listed operations. Preserve all
   other nodes, credentials, schedules, static data and connections.
4. Wait for a natural Manual-Paid execution. Read its receipt by execution_id
   and compare its selected job with n8n output and persisted job state. Do not
   trigger a production claim or deliberately create a gateway failure as a test.
   Verify the published recipient expression; an offline test is not a delivery
   receipt. Only a real future alert can establish actual email delivery.
5. Historical messages stay visible until original binding and the relevant
   business outcome are independently proven. Then move only the exact resolved
   mail and reread it in the actual archive folder.

Rollback the n8n changes against a fresh version check, then run the matching SQL
rollback. It restores the old function and makes receipts read-only for the
service role, retaining all historical rows. Do not remove the table or reset
jobs. Normal schema backup/release discipline still applies.
