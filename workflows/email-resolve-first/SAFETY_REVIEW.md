# Safety review — resolve-first and open-inbox backfill

## Findings

### High

None after required controls.

### Medium

- `PidTagLastVerbExecuted` is advisory Outlook state, so the scanner also checks
  sent items and drafts and the retry worker performs a final draft
  reconciliation before `createReply`.
- The Microsoft Graph snapshot is bounded to 1,000 rows per source. This favors
  recent open work and prevents unbounded mailbox reads; execution logs expose
  Graph failures, and repeated scans safely continue the backlog.
- High-risk AI output is now allowed to remain useful instead of being replaced
  solely because of its risk class. Deterministic blocked-content, factual
  allowlist, exact fact IDs, and mandatory human approval remain unchanged.

### Low

- Backfill may queue a message that a human answered outside the same Outlook
  conversation. The final existing-draft check and human-review-only output
  limit impact; the scanner never sends.

## Threat model

- Customer email, attachment text, relay content, and historical messages are
  untrusted and may contain prompt injection.
- Organization-domain matches are candidates, never proof of identity or project.
- Model output may invent facts, amounts, identifiers, commitments, or future
  internal work.
- Mailbox snapshots may be stale or race with a human reply.
- Replays may otherwise create duplicate queue entries or drafts.

## JSON schema

The model must return exactly:

```json
{
  "category": "shipping|returns|invoice|product|complaint|general",
  "confidence": 0,
  "language": "de|en",
  "risk_level": "low|medium|high",
  "needs_human_approval": true,
  "greeting": "plain text",
  "paragraphs": ["plain text"],
  "closing": "Viele Grüße|Beste Grüße|Best regards",
  "facts_used": [{ "fact_id": "allowlisted-id" }],
  "blocked_reasons": ["string"],
  "missing_information": ["specific string"]
}
```

No additional key is accepted.

## Validation rules

- Exact JSON schema, language, closing, paragraph, and length validation.
- Exact fact IDs from customer-safe evidence only.
- Verified attachment presence overrides claims in customer text.
- Amounts, order/offer references, dates, and URLs must be allowlisted.
- Prompt injection always forces a safe fallback.
- Vague internal-deferral language deterministically forces a concrete fallback.
- Risk class alone does not destroy an otherwise valid, grounded draft.
- All drafts require human approval; automatic send is hard-coded false.

## Blocked content

- delivery, refund, discount, credit, cancellation, legal, production, or free
  service promises;
- unverified amounts, dates, URLs, order numbers, and offer numbers;
- internal viewed/read/opened telemetry;
- “intern prüfen/klären”, “melden uns später”, and equivalent future-work filler;
- HTML, Markdown, emoji, or non-approved closing text from the model;
- instructions embedded in email bodies or attachments.

## Escalation path

- Missing customer-supplied evidence: ask one precise question in the draft.
- Missing internal-only evidence: omit the claim and expose precise
  `missing_information` to human review without a customer-facing promise.
- Prompt injection, invalid schema, external-system failure, or evidence
  conflict: deterministic fallback or durable retry; never send.
- After five transient attempts: final observable failure for manual handling.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4 | Multi-signal reply detection and resolve-first validation; bounded mailbox snapshot remains conservative. |
| reliability | 5 | Existing database-backed retry worker, leases, attempt cap, and Graph retries. |
| idempotency | 5 | Stable request ID, `on conflict do nothing`, and final existing-draft reconciliation. |
| observability | 5 | n8n error executions, queue state, retry events, policy version, and source coverage. |
| security | 5 | Service-role-only invoker RPC, RLS boundaries, untrusted-input handling, no auto-send. |
| tracking impact | 5 | No analytics, attribution, or routing changes. |
| cost risk | 4 | Bounded Graph snapshot and ten candidates per run; no unbounded AI fan-out. |

## Required fixes

All required pre-production fixes are represented in the generated workflow and
migration. Production activation still requires validation, isolated database
tests, exact backups, diff review, `codex-predeploy ops`, and live draft-only QA.

## QA plan

- Valid high-risk direct answer remains a non-fallback draft.
- Internal-deferral draft is rejected and replaced with a concrete request.
- Verified missing attachment behavior remains unchanged.
- Pure acknowledgements, automated mail, replied messages, sent conversations,
  and existing drafts are excluded from backfill.
- WhatsApp/support relays remain eligible.
- Duplicate scans create one queue event and one eventual draft at most.
- Anonymous/authenticated roles cannot enqueue; service role can.
- Generated main, retry, and scanner each have one trigger and at most 30 nodes.
- No workflow contains a send action.

## Rollback

Use the exact inactive workflow backups and SQL rollback documented in README.md.
