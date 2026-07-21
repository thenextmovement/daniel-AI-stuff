# NEONTRIP Loop/Agent Hardening Plan — 2026-07-21

## Objective

Convert the production automation landscape to database-backed, replay-safe deterministic loops with bounded AI proposals. Preserve current business behavior while removing direct AI-controlled side effects, Trello source-of-truth dependencies, oversized workflow monoliths, duplicate active variants, and unsafe recovery patterns.

## Approval state

The user explicitly approved planning and full execution in the current goal. This does not waive production gates: every mutation requires an exact backup, reviewed diff, inactive validation, replay evidence, rollback target, and a capability-specific cutover decision.

## Scope

- All 546 discovered n8n workflows, with implementation priority on all 152 active workflows.
- The 19 active workflows exceeding 30 nodes.
- Customer-visible AI paths: win-back, review requests, reply classification, follow-up, auto-reply, supplier/customer mail.
- Trello-driven fulfillment, shipping, quote, customs, and sales operations.
- Agent Control Tower and file-backed topic-agent lifecycle.
- Current production errors and credential exposure in stored execution diagnostics.

## Target execution contract

1. One trigger.
2. Schema validation before business logic.
3. Database job/state as source of truth.
4. Atomic claim/lease with a stable source-event idempotency key.
5. Bounded AI JSON proposal only where deterministic rules are insufficient.
6. Strict schema, evidence, policy, freshness, and confidence validation.
7. Human approval for customer-visible or materially ambiguous AI output.
8. Deterministic side-effect executor.
9. Durable receipt containing correlation ID, execution ID, source event ID, target record ID, and provider result.
10. Explicit retry class, attempt cap, dead-letter/manual-review state, and no blind retry.
11. Trello updates only as projections from database state.

## Ordered implementation

1. Freeze the evidence baseline and create the sanitized inventory.
2. Capture full versioned backups for every workflow before its first change.
3. Define one canonical workflow per capability; classify all other active variants as shadow, adapter, or legacy.
4. Fix current production errors before architecture refactors.
5. Harden customer-communication capabilities and switch auto-send paths to draft/review where policy evidence is insufficient.
6. Move Trello-derived authority into Postgres jobs and projection workers.
7. Split every active workflow over 30 nodes by responsibility.
8. Replace primary polling recovery with durable leases, provider webhooks where available, and reconciliation as a secondary safety net.
9. Align the Control Tower with a deterministic dispatcher and ephemeral file-backed topic agents.
10. Validate inactive candidates, shadow them, cut over capability by capability, and observe before retiring the replaced version.

## Dependencies

- n8n production API and workflow-version access.
- Supabase/Postgres migrations, RPCs, RLS, and a safe SQL runner.
- Outlook/Microsoft Graph, Shopify, PandaDoc, ActiveCampaign, Trello, DPD/17TRACK, Google Ads, Gemini/Anthropic/OpenAI credentials already managed in their platforms.
- Fresh Ops worktree created by `codex-new-worktree ops loop-agent-hardening`.
- `codex-predeploy ops` and `codex-safe-push-main` before any Ops deployment.
- Representative historical events without secret or customer-data leakage.
- Capability-specific human approval for any action that cannot be safely shadowed.

## Risks and countermeasures

- Big-bang regression: prohibited; use capability slices and rollback targets.
- Duplicate side effects during shadowing: shadow workflows may write only evaluation/audit records.
- Model drift: version prompts/policies and keep deterministic fallbacks.
- Stale customer context: freshness check immediately before approval/send.
- Provider timeout with unknown outcome: record `outcome_unknown`; reconcile before retry.
- Credential leakage in execution diagnostics: never persist resolved secret URLs; prefer credential-aware nodes and sanitized error envelopes; rotate exposed credentials only after dependent workflows are migrated and verified.
- Trello divergence: Postgres wins; projection repair must never overwrite canonical data from Trello.
- Cost fan-out: per-job model budget, attempt cap, concurrency cap, and cost receipt.

## Acceptance criteria

- Every active workflow is assigned to a capability and classified canonical, adapter, shadow, or scheduled for deactivation.
- No canonical active workflow exceeds 30 nodes.
- Every canonical active workflow has exactly one trigger.
- Every external write has a stable idempotency key and durable receipt.
- No customer-visible AI content is sent without strict deterministic validation and required approval.
- No business decision treats Trello as source of truth.
- Active workflow names and states do not contradict each other.
- Strict n8n validation reports zero errors on all cutover candidates.
- Golden-set AI evaluations meet the recorded precision/recall and unsafe-action thresholds.
- Duplicate, race, replay, timeout, provider-5xx, malformed-model-output, stale-context, and partial-failure tests pass.
- End-to-end tests prove one and only one intended side effect.
- Rollback is tested before cutover and remains available after cutover.
- Current known production errors are either fixed and regression-tested or explicitly blocked from cutover.

## Validation evidence required per capability

- Full pre-change backup and version ID.
- Sanitized structural diff.
- Static and strict workflow validation.
- Unit/contract tests for parsers, policies, and idempotency.
- Historical replay comparison.
- Failure-injection results.
- Inactive or shadow execution evidence.
- Cutover checklist and exact rollback instruction.
- Post-cutover execution IDs and monitoring result.

## Rollback

Keep the previous workflow active version and full JSON backup until the replacement passes post-cutover observation. Roll back by disabling the new trigger, restoring the previous version, verifying canonical database state, replaying only unreceipted jobs, and documenting the incident. Never roll back by replaying external side effects blindly.

## Implemented hardening slices

### Resolve-first email intake and retry

- Added race-safe canonical identity resolution for `request_id` and `internet_message_id`.
- Added an atomic email-agent claim with a fail-closed ambiguity gate and mandatory human approval flags.
- Replaced opaque nested n8n failures with a bounded, sanitized error envelope.
- Kept both workflows draft-only; neither is authorized to send customer communication automatically.
- PostgreSQL 17 tests cover legacy collisions, duplicate replay, real concurrent calls, rollback, and reapply.

### Telegram quote approval

- Removed token-bearing Telegram API URLs from the published workflow and from the retained local backup.
- Migrated all six Telegram operations to the credential-backed native node.
- Verified the credential read-only against the Telegram API without sending a message.
- Added an idempotent database claim RPC so duplicate Trello events become successful no-ops.
- The credential-safe stage-one workflow is published; the database-claim cutover follows the matching migration.
- The previously exposed bot token still requires provider-side rotation after all dependants have been checked.

### Existing-offer resend

- Repaired invalid JavaScript string and regular-expression escapes.
- Removed timestamp-based idempotency fallbacks and require the stable Trello action ID.
- Corrected customer first-name parsing and bounded retries to read-only operations.
- A Trello projection failure can no longer reclassify a completed resend as a failed delivery.

### EU supplier quotation request

- Replaced Trello comments and n8n static data as the per-recipient send ledger with Postgres.
- Added atomic `processing` claims and terminal `sent` or `delivery_unknown` states.
- Disabled automatic Outlook send retries; ambiguous outcomes stop and require manual review.
- Added an append-only delivery transition audit and service-role-only RPC access.
- Converted card and label operations to credential-backed native Trello nodes so resolved query credentials cannot appear in error URLs.
- Added strict AI output shape, control-character, length, and numeric quantity validation before the deterministic email template.
- Candidate boundary: 30 nodes, one trigger, zero strict validation errors.
- PostgreSQL 17 tests cover first claim, replay, real parallel claims, successful completion, ambiguous send failure, expired leases, role isolation, rollback, and reapply.
- A temporary production n8n diagnostic verified native Trello card and attachment reads and was deleted after the test.

## Defects found so far

1. Open-inbox and email-agent claims could race on alternate message identities.
2. Email failures collapsed useful nested causes into `Unknown workflow error`.
3. The Telegram approval workflow stored a live bot credential in four request URLs.
4. The existing-offer resend workflow contained invalid JavaScript and broken regex escaping.
5. The resend idempotency key could fall back to wall-clock time and duplicate a customer send.
6. The EU supplier workflow retried an ambiguous Outlook `sendMail` operation up to five times.
7. The supplier workflow read an empty Outlook response as if it still contained the card and recipient, then called a malformed Trello URL.
8. Supplier recipient delivery state was split between Trello comments and volatile n8n static data instead of the database.
9. A resolved Trello API key and token were retained in an n8n error diagnostic URL.
10. The first supplier refactor candidate had a string-typed Switch output, one stale renamed-node connection, and an incomplete static error-node contract; strict validation caught all three before cutover.
11. A fresh worktree lacked installed test dependencies; `npm ci` restored the lockfile-defined environment.
12. The installed dependency tree currently reports two high and one low advisory; remediation is being reviewed separately to avoid an untested lockfile mutation.

## Validation ledger

- Repository quote/ops suite: 646 passed, 0 failed.
- Voice runtime TypeScript build: passed.
- Next.js production build: passed.
- Workflow candidate behavior suite: 4 workflows passed.
- Supplier candidate strict validation: 30 nodes, 1 trigger, 33 valid connections, 0 invalid connections, 0 errors.
- Secret-pattern scan: no Telegram bot URL, OpenAI key pattern, or JWT pattern remains in the scoped artifacts.
