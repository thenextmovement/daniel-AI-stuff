# Email Agent Learning Loop v3

## Objective

The email agent learns only from human-reviewed structural corrections. It never copies customer-specific facts, prices, promises, addresses, or attachment contents into a reusable style profile. Customer communication remains draft-only and requires human review in Outlook.

## Production dependencies

- Supabase project: klibiejfisijpagzkxls
- Main draft workflow: aE1v0KxbgXbWjUm8
- Retry workflow: oyF3lAhAOLUgWbzg
- Sent-mail delta indexer: 7TxHQRyeUxVbpOrl
- Review feedback matcher: bAXM54PasUD8IFNx

## Learning contract

1. The draft workflow stores a draft fingerprint and structural metadata.
2. The sent-mail indexer reads sent replies without sending or modifying mail.
3. The matcher associates a sent reply with the most recent eligible AI draft in the same conversation and stores structural deltas.
4. An operator reviews the feedback in the Ops UI and selects bounded reason codes.
5. Style-only feedback may be approved. Factual, research, attachment, price, question, commitment, or process corrections are blocked from style learning and routed to a metadata-only improvement candidate.
6. A style profile becomes eligible only after at least five approved examples in the relevant category/channel scope. Category falls back to channel and then global scope.
7. The draft workflow accepts only email-style-profile-v3-human-gated and applies only aggregate constraints: maximum words, maximum paragraphs, preferred closing, directness, and repetition avoidance.
8. A deterministic post-generation gate rejects unsupported facts, deferral language, commitments, excessive questions, length violations, invalid closing, malformed schema, or non-plain-text output.

## Initial production baseline

Captured on 2026-07-20 before cutover:

- 52 valid feedback rows
- 50 pending reviews
- 2 rejected reviews
- 0 approved reviews
- 42 reviewable edited replies
- 31 matched and 1,447 unmatched sent-mail index rows
- Active style profile: none; approved count 0; minimum 5

No existing feedback is mass-approved. An operator must review each useful example so that historical factual corrections cannot silently become style guidance.

## Backups and rollback

Inactive n8n backups created before modification:

- Main: xknml4yIrTifsw6l
- Retry: xCsvUbQ2LaS23aiI
- Matcher: 0nceu5sK4QuxwLh9

Database rollback:

- supabase/rollbacks/20260720160951_email_agent_learning_loop_v3_rollback.sql

The rollback is deliberately non-destructive: it removes the v3 RPC/view surface, restores the v2 review RPC permission, and retains audit and improvement-candidate data. Roll back the database interface before restoring the previous app/workflow revisions, then verify draft-only behavior and one createReply node with no send action.

## Verification

- Workflow generators and structural tests
- 593 repository tests
- Next.js production build
- PostgreSQL 17 clean apply, integration scenario, rollback, and post-rollback preservation checks
- Complete n8n validation before live update
- Live checks for active workflow markers, no send action, RPC version, grants, and aggregate quality metrics
