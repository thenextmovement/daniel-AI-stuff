# AI email resolve-first and open-inbox backfill

## Plan

1. Replace vague future-work language with a resolve-first policy in the shared
   production drafting core.
2. Keep verified source boundaries: Outlook current message and thread,
   organization context, attachments, approved knowledge, Shopify, and signed
   offer evidence.
3. Permit useful high-risk drafts when they pass deterministic validation;
   mandatory human approval remains in place.
4. Deterministically reject internal-deferral language and render a concrete
   customer request only when required evidence is genuinely missing.
5. Scan a bounded 30-day inbox window for actionable messages that have no reply
   verb, later sent reply, or existing draft. Enqueue at most ten candidates per
   30-minute run into the existing durable retry worker.

## Node structure

### Production draft agent

The 30-node production graph remains structurally unchanged. Its shared prompt,
validator, fallback renderer, log snapshot, and retry-derived copy are patched.

- One Outlook trigger.
- One Outlook `createReply` action.
- No send, sendMail, replyAll, move, delete, or read-state action.
- Existing idempotency lock, attachment validation, commerce resolver, human
  review, observability, and durable retry behavior remain active.

### Open-inbox scanner

1. `Open Inbox Schedule` — every 30 minutes.
2. `Fetch Open Inbox Snapshot` — read-only Microsoft Graph batch for inbox,
   drafts, sent items, and `PidTagLastVerbExecuted`.
3. `Select Open Inbox Candidates` — deterministic automation/noise, reply,
   draft, acknowledgement, age, and actionable-request filters.
4. `Loop Open Inbox Candidates` — one queue write at a time.
5. `Enqueue Open Inbox Candidate` — service-role-only, idempotent database RPC.

The scanner never drafts or sends. The already deployed retry worker reloads the
source message, rechecks for an existing draft, and uses the same resolve-first
drafting core as new incoming mail.

## Resolve-first behavior

- Search all provided sources before drafting.
- Answer immediately when customer-safe verified facts are available.
- Never use vague phrases such as “ich kläre das intern”, “wir prüfen das noch
  einmal”, “wir melden uns anschließend”, or English equivalents.
- If the customer must provide something, ask for the exact reference, document,
  measurement, address, or decision and state why it is needed.
- If unavailable evidence is internal and cannot safely be supplied by the
  customer, omit the unsupported claim and expose the precise missing evidence
  to human review metadata. Do not promise a later answer.
- High-risk drafts remain proposals only and still pass every deterministic
  amount, reference, attachment, commitment, telemetry, schema, and injection
  check.

## Backfill selection

A message is eligible only when all of the following hold:

- it is still in the Outlook Inbox and no older than 30 days;
- it is external mail or a verified support/WhatsApp/form relay;
- it contains a direct question or a deterministic business-action signal;
- it is not a pure acknowledgement, automated response, or no-reply message;
- its latest Outlook verb is not reply/reply-all;
- no newer sent message or draft exists in the same conversation;
- its durable request ID has not already been seen.

The scan reads at most 1,000 inbox, draft, and sent records per source and queues
at most ten oldest open candidates per run. Repeated scans are safe.

## Tests

```bash
node workflows/email-resolve-first/build-workflows.mjs
node workflows/email-resolve-first/test-workflows.mjs
node workflows/email-retry-recovery/build-workflow.mjs
node workflows/email-retry-recovery/test-workflow.mjs
npm run test:quotes
```

Database tests apply the existing retry fixture and migrations, then
`20260720131125_enqueue_email_agent_open_inbox_backfill.sql` and
`workflows/email-resolve-first/database-tests.sql` in an isolated Postgres
database.

## Rollback

1. Deactivate `AI Email Agent — Open Inbox Backfill v1`.
2. Restore the production draft agent from inactive backup
   `eOLwPj5l85ihGfAn` or workflow version history.
3. Restore the retry worker from inactive backup `q3a4SVEwCCT10DLf` or workflow
   version history.
4. Apply
   `supabase/rollbacks/20260720131125_enqueue_email_agent_open_inbox_backfill_rollback.sql`.
   It removes only still-unprocessed attempt-zero backfill locks; completed or
   already processing cases remain auditable.
5. Confirm both restored workflows contain no send action and that existing
   Outlook drafts remain untouched.
