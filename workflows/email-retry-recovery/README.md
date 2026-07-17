# AI email retry recovery

This workflow closes the durable-recovery gap in the production Outlook draft
agent. It never sends customer communication.

## Runtime

The database claim function atomically claims one due retry or expired processing
lease. The worker runs once per minute, processes at most one case at a time, and
uses the same Outlook, organization, attachment, approved-knowledge, Shopify,
signed-offer, facts-package, validation, and Outlook-draft nodes as the active
production agent.

Before processing, one Microsoft Graph batch request:

1. reloads the source by its Graph ID;
2. falls back to the immutable internet message ID when Outlook changed the Graph
   ID after a move;
3. searches recent Outlook drafts for an existing reply in the same conversation.

If a draft already exists, the worker records the case as recovered without
creating another draft. Sources missing after both identity lookups become final
failures. Transient Graph, Supabase, Shopify, offer, attachment, or model
errors receive bounded database-backed retries with a 15-minute lease and a maximum
of five total attempts.

## Safety

- Outlook action: createReply only.
- No send, sendMail, or replyAll action exists.
- Every created or reconciled draft remains pending_review.
- Automatic sending is hard-coded to false in database responses and retry audit
  metadata.
- Atomic claims use for update skip locked.
- Existing-draft reconciliation prevents duplicate drafts after an ambiguous
  cross-system failure.
- Retry attempts and outcomes are recorded without storing message bodies in the
  retry event table.

## Source drift

The generated worker is derived from the exact published production workflow
version captured in source/main-workflow-active-20260717.json. The generated
source-core-manifest.json records SHA-256 hashes for every unchanged shared core
node. Any later production-agent change must regenerate and retest the retry worker.

## Commands

    node workflows/email-retry-recovery/build-workflow.mjs
    node workflows/email-retry-recovery/test-workflow.mjs

The isolated PostgreSQL test applies `database-fixture.sql`, the base and identity
migrations, `database-incident-fixture.sql`, both incident-repair migrations, and
finally `database-tests.sql`.

## Rollback

1. Deactivate AI Email Agent — Retry Recovery v1.
2. Apply the matching rollback SQL in supabase/rollbacks.
3. The production Outlook-triggered draft workflow remains independently active.
