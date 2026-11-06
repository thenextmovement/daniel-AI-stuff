# NEONTRIP n8n availability repair — 20 October 2026

Issue: #201. Scope: existing Shopify mirror, Customer Match dispatch and manual-paid reconciliation workflows only. The user authorized repair of the four incident emails and archival after recovery.

## Incident and change

At 13:00 UTC the Shopify mirror sent a 250-order batch through parallel database calls. Supabase reported PGRST003 pool-acquisition timeouts; Customer Match and manual-paid completion requests timed out. Blind completion retries subsequently returned BILLING_JOB_LEASE_INVALID although the earlier request had committed. A fourth email at 13:10 UTC reported a 502 during an Ops application rollout.

- Shopify mirror: process one order at a time through the existing customer, matching and order nodes; use the existing global error-mail workflow.
- Customer Match: raise only the claim request timeout from 30 to 75 seconds, beyond its 60-second SQL budget. Do not add a claim retry.
- Manual-paid: check application availability before admission; on transport failure wait once for 65 seconds, recheck and restore the original intake. Disable blind retries of admission and completion. Allow 75 seconds for completion. On ambiguous completion, read the exact job and accept only an already persisted EXACT_INVOICE_PAID receipt matching the job, execution, input generation, fingerprints, timestamps and exact invoice proof. Otherwise fail and preserve the existing alert path.

Application health is an availability check, not proof of database health. This change does not write payments, replay jobs, broaden the existing Shopify fetch or repair older unrelated Customer Match batches.

## Native version history

| Workflow | Previous version | Published version |
|---|---|---|
| I9vCp27sS3jcH1am | b49e7dce-380c-4c91-ad90-010e76ed7499 | 560602e4-bc5d-4f1f-b795-5f8b2dc334c2 |
| iyd9dKfm5YWlV6jw | defaeb89-a31a-49f5-8692-f6d906c03ef4 | cce83b48-a67e-403b-b9dd-12ed7dad5258 |
| 6NZnfGpyfUVikqpf | 37edc068-2b13-4422-a8bf-1ca1d81f222f | 11665376-28b2-40c0-87dd-24d55b0f2f87 |

All remained active. Fresh full readback matched the intended nodes, connections and settings; n8n supplied the new Wait node's webhookId. Previous versions were verified available. For rollback, inspect current versions for intervening edits and restore only this repair's changes from native history; do not overwrite subsequent work. The patch builder rejects workflows whose source version has changed.

## Verification

- 28 focused Node tests, syntax check and production build passed.
- Credential-free n8n fixture processed 250 synthetic orders serially, verified unique IDs and original-order/customer/request pairing, and passed actual 409, 502 and timeout error-output recovery through the existing completion verifier.
- A read-only projection verified the database receipt shape without selecting a lease token.
- Actual n8n error output, Wait for 65 seconds, application-health recheck and original-intake restoration succeeded.
- The temporary fixture was deleted after completion.
- Natural manual-paid executions after publication passed the new health nodes and existing completion checks. All five jobs affected by the two incident windows were DONE with EXACT_INVOICE_PAID and no last error.
- The existing error-mail route and received incident messages were checked; all four specific incident emails were found in Archiv. No new delivery test was sent. The working route remains unchanged; the previously invalid hyphenated recipient was not introduced.
- No new workflow-validation errors; the two larger workflows retain their pre-existing validator findings.
- The next scheduled full hourly Shopify run was not yet observed at handoff; the 250-item runtime fixture covers the changed loop. Existing alert throttling/deduplication remains unchanged.

Only the workflow source and regression tests are proposed for repository review. No Ops application deployment was triggered by this repair.
