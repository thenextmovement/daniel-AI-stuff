# AI Email Learning Gate v2

This change makes style learning and support knowledge explicitly human-gated, auditable, idempotent and reversible.

## Runtime contract

- Customer communication remains an Outlook draft. This change adds no send action.
- Style learning uses aggregate statistics only. It never exposes or reuses customer text, names, prices, dates, commitments or case facts.
- A feedback row can be approved only when deterministic eligibility checks pass. High-risk cases and edits involving facts, intent, questions, attachments, amounts, dates or commitments are blocked.
- A style profile is eligible only after five approved, safe samples in the 90-day segment window.
- Knowledge must be approved twice: first as a general version, then explicitly for `email_drafting`.
- E-mail retrieval requires the approved content hash to equal the live version hash. Any later drift fails closed immediately.
- Reviewer identity, an explanation of at least eight characters and a UUID idempotency key are mandatory.
- Every review decision is appended to a private audit table. The audit tables contain metadata and eligibility snapshots, not message bodies.

## Files

- Migration: `supabase/migrations/20260717104000_harden_email_learning_knowledge_review_gate.sql`
- Rollback: `supabase/rollbacks/20260717104000_harden_email_learning_knowledge_review_gate_rollback.sql`
- SQL fixture and integration test: `tests/sql/email-learning-gate-base.sql`, `tests/sql/email-learning-gate.test.sql`
- Static contract test: `tests/quotes/email-learning-gate.test.ts`
- Ops UI: `/ops/email-agent` and `/ops/voice-copilot` → Wissen

## Deployment order

1. Save production schema/function definitions and counts for the affected tables.
2. Apply the database migration.
3. Verify all and only the explicitly user-authorized starter articles received the separate e-mail approval. Compare the post-migration count with the captured preflight count instead of hard-coding a number.
4. Verify the old unaudited review RPCs are no longer executable by `service_role`.
5. Deploy the exact application commit printed by `codex-predeploy ops`.
6. Smoke-test both review pages and the read-only e-mail knowledge search.
7. Keep all customer sending disabled; continue Outlook-draft plus human-review operation.

## Rollback

Roll back the application to the pre-change commit, then apply the rollback SQL. The rollback restores the previous review RPC grants and support search. The stricter aggregate style profile intentionally remains because it is fail-closed and contains no customer facts.

## Verification commands

```sh
npm run test:quotes
npx tsc --noEmit
npm run build
git diff --check
```

The SQL integration test is executed against an isolated local PostgreSQL database with `ON_ERROR_STOP=1`, followed by the rollback file.
