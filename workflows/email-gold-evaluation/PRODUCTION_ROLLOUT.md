# Production rollout record

## Applied on 2026-07-17

- Supabase project: `klibiejfisijpagzkxls`
- Migration: `20260717111500_email_agent_gold_evaluation_and_rollout_gate.sql`
- Pre-change public schema backup:
  `/Users/danielklesse/backups/neontrip-ops-email-gold-evaluation-20260717-110700/public-schema-before.sql`
- Backup SHA-256:
  `0075a00dbafddd5f7bb7013d23dccf703c5d90c7fdbfb5f76b027793d1591050`
- Rollback:
  `supabase/rollbacks/20260717111500_email_agent_gold_evaluation_and_rollout_gate_rollback.sql`

## Decision-shadow v2

- Production workflow: `LvXVkIhWZH0w0Y1x`
- Inactive pre-change backup: `fWnzumazKbvKDDa7`
- Live validation: 6 enabled nodes, 7 valid connections, 0 errors, 0 warnings.
- Exact trusted relay sources: `whatsapp_relay`, `support_chat_offer_relay`,
  `customer_form_relay`.
- An `internal_sender` conflict on a trusted relay fails closed to
  `human_review`; an invented relay label cannot bypass the internal rule.

## Frozen gold baseline

- Evaluation version: `email-decision-shadow-v1:gold-baseline-v1`
- Evaluation run: `e88bff8e-c6ce-4915-9b10-68ae9876b0de`
- Cases: 50 (`draft`: 5, `human_review`: 24, `no_reply`: 21)
- Routing accuracy: 100%
- Actionable recall: 100%
- No-reply precision: 100%
- Unsafe no-reply cases: 0
- Exact label accuracy: 90%
- No customer subject, message body, draft body, or sent body is stored in the
  gold tables.
- Seed and evaluation replays were verified idempotent in production.

## Effective stage

- Requested stage: `review_only`
- Effective stage: `review_only`
- Current Facts-Package comparisons: 0/30 at rollout time
- Action-driving no-reply routing: disabled
- Automatic sending: permanently disabled by database constraint
- Human send approval: required

The decision gate has passed. The current-version draft-quality gate remains in
observation until 30 real sent comparisons meet all correction, rewrite, and edit
thresholds. No stage promotion was requested during this deployment.
