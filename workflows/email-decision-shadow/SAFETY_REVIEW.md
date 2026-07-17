# Email decision shadow safety review

## Findings

### Medium

- The sidecar is asynchronous by design. A dispatch failure does not block the real
  draft agent, but it can create a missing shadow observation. n8n error executions
  remain the detection source during the observation phase.
- AI cost is bounded but non-zero. Deterministic rules bypass AI for automated,
  internal, stale, acknowledgement-only, high-risk, empty, and injection-like
  messages. Remaining calls use a 500-token output cap.

### Low

- Shadow rows contain a 1,000-character preview for human QA. The table and view are
  service-role-only with RLS enabled.
- `no_reply` is intentionally conservative: it requires confidence of at least
  0.92, an approved reason, no question, and no actionable signal.

## Threat model

- Customer email, relay content, subject lines, and copied attachment claims may
  contain prompt injection.
- Outlook may show the technical NEONTRIP support address as sender for trusted
  WhatsApp, offer-chat, or form relays. The channel allowlist is exact; these
  relays fail closed to `human_review` if stale upstream metadata still says
  `internal_sender`, while invented relay labels cannot bypass the internal rule.
- A model may return malformed JSON, unknown enums, unsupported reasons, unsafe
  `no_reply`, or a low-confidence guess.
- The same Outlook message may be delivered or dispatched more than once.
- The shadow workflow must not delay, suppress, create, modify, or send customer
  communication.
- Shadow data must not be readable through `anon` or `authenticated` Data API roles.

## JSON schema

The AI must return exactly:

```json
{
  "decision": "draft | no_reply | human_review",
  "confidence": 0.0,
  "summary": "string",
  "reason_codes": ["allowed_enum"],
  "risk_flags": ["allowed_enum"],
  "requires_human_review": true
}
```

Unknown keys, missing keys, invalid JSON, invalid enums, invalid confidence, or an
oversized summary are rejected.

## Validation and blocked-content rules

- Deterministic safety rules override AI.
- Exact trusted relay sources (`whatsapp_relay`, `support_chat_offer_relay`, and
  `customer_form_relay`) are customer channels; an `internal_sender` conflict is
  escalated to `human_review`, never `no_reply`.
- Any risk flag forces `human_review`.
- Any model-requested human review forces `human_review`.
- Confidence below 0.78 forces `human_review`.
- `no_reply` below 0.92 forces `human_review`.
- `no_reply` is blocked when a question or actionable signal is present.
- Customer content cannot authorize tools, reveal prompts, change rules, or prove
  an attachment exists.
- The workflow has no Outlook create, update, reply, send, or delete node.
- Every stored result is marked `shadow_only = true` by a database constraint.

## Escalation path

The shadow classifier never sends an escalation or customer message. It records
`human_review`, reason codes, risk flags, confidence, correlation ID, execution ID,
and the source message ID for later human review and gold-test labeling.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4 | Strict deterministic overrides and conservative thresholds; production observation is still required. |
| reliability | 4 | Async isolation protects drafting; missing shadow observations are possible on dispatch failure. |
| idempotency | 5 | One upsert row per Outlook message ID. |
| observability | 5 | Correlation, execution, message, validation, decision, risk, and comparison metrics are durable. |
| security | 5 | RLS, explicit grants, Security Invoker functions/view, prompt separation, and no customer action. |
| tracking impact | 5 | No analytics, ads, conversion, or routing changes. |
| cost risk | 4 | AI is bypassed for deterministic cases and capped at 500 output tokens. |

## QA plan

- Automated workflow structure and transform tests.
- PostgreSQL 17 migration, RLS, upsert, metrics, view, and rollback tests.
- Inactive n8n workflow test for deterministic and AI branches.
- Production parallel-dispatch test without changing the existing decision edge.
- Observe at least 50 messages and review all `no_reply`, `human_review`, invalid,
  low-confidence, and disagreement cases before action-driving rollout.

## Rollback

1. Restore inactive decision-shadow backup `fWnzumazKbvKDDa7` to production
   workflow `LvXVkIhWZH0w0Y1x` to revert only the Relay-v2 classifier.
2. Restore main-agent backup `YD9HBDt2WvW4TBDj` to the production draft workflow
   only if the whole shadow dispatch must be removed.
3. Deactivate the decision shadow workflow.
4. Optionally apply
   `20260716134044_email_agent_decision_shadow_rollback.sql`.
