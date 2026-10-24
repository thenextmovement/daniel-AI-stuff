
# NEONTRIP Repeat Business: pre-send failure repair

Scope: workflow `cW08nxn9ANfGFEou`, `MarkRepeatBusinessUnknown` and `StopRepeatBusinessSafely`; two existing Supabase RPCs; the recipient expression in error workflow `M4uG1HAtN9Zggxww`. No message template, send node, credentials, connections, schedule, activation or existing unknown lock changes.

## Evidence

Execution 10128625 (23 October 2026 09:02 UTC) stopped after recording outreach 034e7b76-a7a3-4997-a8a2-0e224f61b77d as unknown. Both the n8n API and native database no longer contain the execution. The retained server log contains only the final generic stop error, so the original failed provider/check is unknown.

The active workflow version, created 21 October, sends only after authorize_repeat_business_send commits status=sending and the immutable draft ID. This outreach has no draft ID, subject/body, consent authorization, provider ID, internet message ID or sent_at. The finish RPC never removes these fields. Outlook searches found no corresponding project email or draft. A read-only check through the actual n8n runtime on 24 October passed the unchanged Shopify and Trello validations. No draft, send, claim or authorization was performed.

The defect is proven independently of the missing trigger error: five read-only pre-draft error routes call the same unknown finalizer as draft creation and sending. One such row globally holds the campaign. The old code also discards the originating check.

## Change

- Classify only errors from the five allowlisted pre-draft nodes as preflight_failed.
- Record the originating node, an allowlisted error code and execution ID; never persist raw provider errors.
- After five minutes, reclaim that same outreach with a fresh claim token and all existing fresh checks. At most two retries after the initial failure; persistent failures remain visible in preflight_failed for review.
- Respect existing business days/hours, send cadence, daily maximum, organization checks, exclusions and unknown locks. No automatic recovery of historical unknown, stale reserved, draft creation, authorization or send ambiguity.
- Route this workflow's error notifications to support@neontrip.de through the existing deduplication/throttle.

## Verification

Isolated PostgreSQL 17 tests fail on the old functions and pass on the candidate. They cover callback idempotency, claim binding, bounded retries/backoff, draft and unknown guards, business hours and cadence. Node tests fail on the old error expression and pass with the two-node patch. The actual installed n8n expression engine also evaluated the candidate successfully.

Strict MCP validation reports the same three existing false positives on unchanged jsCode object braces (BuildValidatedMikaMail, ValidateReservation, ValidateShopifyAndConsent) for baseline and candidate. The candidate has 35 valid connections, zero invalid connections and no new validation errors. The actual unchanged read-only code was executed successfully.

## Release and case completion

Production release requires exact commit approval. Apply the Supabase migration before the two n8n patches. Re-fetch and compare both expectedVersionId values and function baselines before applying; stop if drifted. Native workflow history exists for the Repeat Business baseline. Use the checked-in original expressions/function definitions for rollback; the database rollback preserves preflight evidence and conservatively changes preflight_failed to unknown.

The migration intentionally does NOT change outreach 034e7b76-a7a3-4997-a8a2-0e224f61b77d. Its separately reviewed recovery SQL is guarded against the exact unchanged snapshot. Immediately before recovery repeat read-only Shopify/Trello, mailbox and persisted-authorization checks. An exact release approval must explicitly include this case's safe resumption. Do not call a send endpoint manually.

The regular weekday workflow must perform every fresh check and establish sent-items proof (or a genuine current business exclusion). Keep the error email visible until the exact outreach is terminal with durable evidence and the new failure path is verified. Then move only execution 10128625's error email and read it back in the resolved archive folder. Saturday is outside the existing sending schedule; do not change that rule to finish faster.

This case's original triggering node remains unknown; do not describe the provider outage as established or the historical execution as successful.
