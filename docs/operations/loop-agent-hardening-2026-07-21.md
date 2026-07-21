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

### Agent-to-draft replacements

- Replaced the design-reminder agent design with a 12-node deterministic loop: five-minute schedule, 10-minute minimum age, 48-hour maximum age, strict recipient validation, atomic database claim, Outlook draft creation, and explicit `draft_created` or `draft_unknown` receipt.
- The 48-hour freshness ceiling prevents the first database-backed run from creating a backlog of drafts for historical inbox items.
- Replaced the win-back agent design with a 19-node loop: deterministic deal/contact eligibility, active-project and segment exclusions, atomic claim, bounded JSON-only AI proposal, deterministic content allowlists and HTML escaping, and Outlook draft creation.
- Both workflows set `humanApprovalRequired=true` and `automaticSendAllowed=false`; neither contains an autonomous agent node or an automatic customer-send path.
- Added the shared `customer_communication_draft_jobs` state machine with service-role-only atomic claim/complete/unknown RPCs, append-only transition events, expired-lease fail-closed behavior, and no blind retry after an ambiguous provider outcome.

### Capability and agent decisions

- Every one of the 152 active workflows is assigned in the generated capability manifest; none is unclassified.
- 91 workflows are structurally acceptable to keep, while 61 require refactor or explicit review; all 19 workflows over 30 nodes have an explicit target decision.
- The five true agent workflows have individual decisions: replace win-back and design reminder with draft loops; retire the redundant PandaDoc event receiver after replay evidence; deactivate the unused Telegram GitHub controller and Fabienne assistant until owner allowlists and approval/tool wrappers exist.
- The manifest contains no target architecture that relies on an autonomous agent. AI remains only as a bounded proposal or enrichment step where deterministic logic is insufficient.

### Agent cutover evidence

- Production migration `customer_communication_draft_jobs` was applied after commit and predeploy gates.
- A transactional production smoke test proved first claim, duplicate suppression, completion, ambiguous-result quarantine, RLS, service-role-only execution, security-invoker functions, and complete rollback of synthetic rows.
- Published design workflow version `97fce4ef-81ae-41a2-b0f5-b6d963f51e15` exactly matches the 12-node candidate graph and passes strict validation with zero errors.
- Published win-back workflow version `be9da2da-adce-4b4c-83a9-a95c1a145a34` exactly matches the 19-node candidate graph and passes strict validation with zero errors.
- The unused Telegram GitHub controller and Fabienne tool agent were renamed with their explicit reactivation gates and are inactive.

### Immediate legacy hotfix candidates

- Added a strict-valid Gemini v1.2.1 hotfix that restores the missing credential binding on the terminal processing-label cleanup and disables retries on that cleanup write. This is a containment change; the 85-node workflow still requires the planned split.
- Added a strict-valid Supplier Shopify Tag Sync v0.2 candidate that removes three-attempt POST retry behavior, restores TLS certificate verification, and uses one bounded 60-second attempt.
- Captured versioned backups for the active-but-labelled-inactive payment-reminder webhook, the unused Gemini v1.1 duplicate, and the active Customs cleanup workflow before any state/name decision.

### ActiveCampaign auto-reply draft replacement

- Replaced the 32-node auto-send design with a strict-valid 22-node database draft loop and one webhook trigger.
- Removed five sticky nodes, a disabled fan-out, the volatile three-attempt guard, legacy cooldown authority, and the separate SMTP auto-send branch.
- Added stable `deal_id` identity, internal/test-recipient blocking, an atomic `activecampaign_autoreply` draft claim, and explicit draft-created or draft-unknown receipts.
- Replaced random prompt-style selection with a stable deal-derived variant and reduced model temperature.
- Model output is accepted only as an exact JSON object with one bounded `body` field. Malformed, URL-, address-, price-, discount-, guarantee-, percentage-, and deadline-shaped output falls back to deterministic copy.
- The only communication side effect is an Outlook draft with `automaticSendAllowed=false` and `humanApprovalRequired=true`; Outlook draft creation is never retried.

### Post-delivery and repeat-business draft replacements

- Replaced both direct customer-send paths with separate database-backed draft loops: 15 nodes for post-delivery and 16 for repeat-business, each with exactly one schedule trigger.
- Reduced both candidate RPCs to one item per run and replaced cross-node `.first()` lookups with item-linked references, preventing context from one customer being reused for another customer in the same batch.
- Added stable order/customer identities, internal/test-recipient rejection, atomic claims, human-review flags, explicit draft receipts, and fail-closed `draft_unknown` handling.
- Both models now receive an explicit untrusted-data boundary and may return only exact `{subject, body_text}` JSON. URLs, addresses, HTML, discounts, prices, guarantees, percentages, and delivery promises are rejected before HTML escaping and deterministic draft construction.
- Outlook creates drafts only, never retries draft creation, and routes provider errors to the canonical unknown-outcome state.
- Production cutover passed commit `b0197c1a6a6b08330eeda34b26e346d56117cdda`, `codex-safe-push-main`, and `codex-predeploy ops`. The production migration and a fully rolled-back transaction smoke passed before either graph changed.
- Published post-delivery version `5b515713-2bf9-4952-962a-21bc4f8fcfce` and repeat-business version `e73c2e50-f445-4c42-87c2-d3c7b20ae909` materially match their candidates exactly; n8n added only provider-managed webhook IDs to Outlook nodes.

### Follow-up emergency containment

- Captured the full 101-node, three-trigger published graph and exact active version before containment.
- The legacy Outlook send retries an ambiguous customer-send result up to three times. The reply classifier explicitly defaults API failures and unparseable/unclear output to `send`.
- The safe interim decision is to deactivate and clearly rename the monolith before replacement work. Existing database queue rows remain canonical and are not deleted or replayed.
- Target replacement: one scheduled intake, atomic claim/recovery, deterministic offer/reply preflight, fixed copy, a one-attempt delivery executor, durable receipt, human review for every uncertainty, and deterministic post-send scheduling.

### Deterministic follow-up replacement

- Replaced the 101-node agent-like state machine with a 19-node, one-trigger candidate containing no AI or agent node.
- Postgres now claims exactly one due non-payment follow-up under a row lock, owns the lease, records every transition, and converts stale in-flight attempts to `delivery_unknown` plus human review.
- Modern NEONTRIP and PandaDoc offers pass independent, allowlisted status/link preflights. Closed, ambiguous, unavailable, or malformed offer state is blocked for review.
- Outlook inbound-reply lookup is read-only and bounded. Any customer reply or lookup uncertainty blocks delivery; no model decides whether to override a reply.
- Customer copy is selected from fixed versioned templates, HTML-escaped, and contains only the preflight-approved offer link. There is no model call or model fallback.
- Outlook send has exactly one attempt. Success is receipted atomically and may enqueue the next follow-up once after 72 hours; any provider error becomes `delivery_unknown` and is never retried automatically.
- The non-destructive rollback revokes all service-role executor permissions while retaining delivery and event evidence.

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
13. The win-back agent accepted model-authored HTML and sent it directly to customers without schema validation, recipient idempotency, or human approval; a downstream tag write could also fail after an ambiguous send.
14. The design-reminder workflow used AI for a decision that could be deterministic, stored retry authority in volatile workflow static data, scanned every minute, automatically sent mail, and archived source messages on the no-send path.
15. The Telegram GitHub controller had no owner/chat allowlist while exposing branch, issue, pull-request, deploy, and confirmation write routes to an AI parser; the current published version had no execution evidence.
16. The Fabienne Telegram assistant had no owner/chat allowlist while exposing Outlook send, calendar create, Shopify, ActiveCampaign, mail, and calendar tools; the current published version had no execution evidence.
17. The first generated win-back validator contained incorrectly escaped regular-expression sequences inside a template literal; the code-node compilation test caught the defect before publication.
18. The first design-draft cutover plan would have considered the full historical source folder because the new database ledger starts empty; a 48-hour freshness ceiling now blocks that backfill.
19. The workflow named `Supplier Payment Reminder ... (INACTIVE DRAFT)` was actually active and exposed an unauthenticated webhook that accepted caller-controlled recipients and links, then retried Outlook sending up to three times. It had no execution history and is scheduled for immediate deactivation.
20. Gemini Mockup v1.2 completed a long series of real card/image operations but failed on its terminal processing-label cleanup because that node alone had no credential binding.
21. Supplier Shopify Tag Sync disabled TLS certificate verification and repeated an ambiguous POST up to three times; one incident lasted about 100 seconds after repeated 30-second timeouts. The first hardened run then proved why verification had been disabled: the internal `coolify-proxy` certificate is not trusted by n8n. It failed before data exchange; the candidate now routes through the publicly certified Ops endpoint without a forged `Host` header.
22. `Customs CI Cleanup (LÖSCHEN)` is not an obsolete workflow: it has current successful executions and performs database deletions plus invoice generation from a Trello event. It must be refactored, not blindly deactivated.
23. Both recent PandaDoc Event Receiver executions were duplicate no-ops: the same idempotency keys had already been claimed by specialized PandaDoc loops. Keeping the 58-node receiver active therefore adds an autonomous AI branch, a second error trigger, and a direct viewed-email sender without observed unique capability.
24. The dependency audit initially contained two high and one low advisory. Non-breaking transitive updates plus `tsx` 4.23.1/`esbuild` 0.28.1 remove all three; `npm audit` now reports zero vulnerabilities.
25. The ActiveCampaign auto-reply retried Outlook customer sends up to five times, maintained overlapping cooldown/static retry concepts, selected prompt style randomly, and sent a separate RIESENOBJEKTE SMTP path automatically.
26. Its legacy parser accepted malformed non-JSON model text as customer copy after a permissive regex/raw-text fallback. The replacement rejects malformed output and uses deterministic copy in a human-reviewed draft.
27. The public TLS route for Supplier Shopify Tag Sync is protected by Cloudflare Access and returned an HTML redirect. Because the POST outcome could not be proven from n8n, the workflow is now inactive; the two failed hardened runs were never automatically retried.
28. Post-delivery and repeat-business both generated probabilistic customer copy and sent it directly, with retries on model generation and no human approval or durable draft receipt.
29. Both outreach workflows used cross-node `.first()` references while requesting batches of ten candidates. A multi-item execution could therefore combine the first customer's identity/history with another item's model or send path; the replacements use one candidate plus item-linked references.
30. The repeat-business model node contained an empty `responses` configuration rather than an explicit bounded prompt, while its parser accepted permissively extracted JSON or raw fallback content.
31. The shared candidate harness accidentally applied the 30-node target-architecture gate to the explicitly temporary 85-node Gemini containment hotfix, so it aborted before testing later candidates. The hotfix is now covered only by its dedicated regression test and remains listed for decomposition.
32. The same harness detected triggers by the substring `trigger`, which incorrectly classified webhook-triggered workflows as having zero triggers. Trigger detection now handles webhook nodes explicitly and all native `*Trigger` node types uniformly.
33. The 101-node follow-up processor retries Outlook customer sends up to three times even though a timeout can leave the provider outcome unknown, allowing duplicate follow-ups.
34. Its AI reply classifier uses `send` as the documented default on API errors, malformed output, `UNCLEAR`, and every unknown category. A classifier outage can therefore trigger the exact customer side effect the classifier is meant to suppress.
35. Follow-up text parsing extracts the first brace-shaped substring from free-form model output and later rewrites forbidden phrases instead of requiring an exact output schema and human approval.
36. The follow-up workflow combines schedule, unauthenticated manual webhook, error trigger, stale/error recovery, offer checks, Outlook reply search, two AI classifiers, AI copy generation, customer send, queue mutation, ActiveCampaign projection, and audit logging in one 101-node cyclic graph.
37. The legacy business-hours node contains hardcoded address-based bypasses, including a personal mailbox, so selected records could run outside the published schedule instead of following a policy-controlled test mode.
38. The legacy claim is a retried REST `PATCH` with `continueRegularOutput`; an error-shaped response can continue into normalization rather than producing an explicit durable claim failure.

## Validation ledger

- Repository quote/ops suite: 654 passed, 0 failed.
- Voice runtime TypeScript build: passed.
- Next.js production build: passed.
- Workflow candidate behavior suite: 6 workflows passed, including both agent-to-draft replacements.
- Supplier candidate strict validation: 30 nodes, 1 trigger, 33 valid connections, 0 invalid connections, 0 errors.
- Design draft-loop strict validation: 12 nodes, 1 trigger, 12 valid connections, 0 errors.
- Win-back draft-loop strict validation: 19 nodes, 1 trigger, 22 valid connections, 0 errors.
- Customer draft database tests: first claim, replay, completion, ambiguous outcome, expired lease, role isolation, real parallel claim, rollback, and reapply passed on PostgreSQL 17.
- Outlook draft create/delete diagnostic completed without a node error and the temporary workflow was deleted.
- Gemini cleanup hotfix candidate: 85 nodes, 1 trigger, 101 valid connections, 0 errors; retained only as immediate containment pending split.
- Supplier tag-sync hotfix candidate: 4 enabled nodes, 1 trigger, 3 valid connections, 0 errors.
- ActiveCampaign auto-reply draft candidate: 22 nodes, 1 trigger, 22 valid connections, 0 errors; malformed-model, unsafe-content, recipient, compilation, and deterministic-fallback tests passed.
- Extended draft-kind database tests and non-destructive rollback/reapply passed on PostgreSQL 17.
- Post-delivery draft candidate: 15 nodes, 1 trigger, 14 valid connections, 0 invalid connections, 0 strict errors.
- Repeat-business draft candidate: 16 nodes, 1 trigger, 15 valid connections, 0 invalid connections, 0 strict errors.
- Outreach behavior tests cover invalid/internal recipients, missing identities, exact-schema acceptance, malformed and injected output, unsafe claims/URLs, HTML escaping, deterministic fallback, draft-only routing, and outcome receipt branches.
- New outreach database tests passed first claim, real parallel duplicate suppression (`draft`/`stop`, one row and one claim event), completion, ambiguous-outcome quarantine, service-role boundaries, rollback rejection, and reapply on PostgreSQL 17.
- Consolidated candidate suite: 10 target workflows passed; the two production containment hotfixes and both agent-to-draft candidates also passed their dedicated suites.
- Deterministic follow-up candidate: 19 nodes, 1 trigger, 22 valid connections, 0 invalid connections, 0 strict errors, 0 AI/agent nodes.
- Follow-up behavior tests cover recipient/link validation, modern-offer closed/ambiguous state, PandaDoc terminal state, reply evidence, lookup failure, HTML/name injection, deterministic copy, one-attempt send routing, and durable completion/unknown branches.
- Follow-up PostgreSQL 17 tests cover real parallel claim (`process`/`stop` with one attempt/event), payment-reminder exclusion, completion replay, next-step idempotency, preflight block, ambiguous send, stale lease, service-role-only RPCs, rollback revoke, and reapply.
- Dependency audit: 0 vulnerabilities after the locked transitive update.
- Secret-pattern scan: no Telegram bot URL, OpenAI key pattern, or JWT pattern remains in the scoped artifacts.
