# Email Agent Passive Safe Learning v4

## Objective

The email agent learns useful brevity and structure without relying on an employee to review every comparison. After a human sends or replaces an Outlook draft, deterministic database rules may use only aggregate style signals. Customer facts and wording are never reusable learning data. Every customer response remains draft-only and requires human review before sending.

## Production dependencies

- Supabase project: `klibiejfisijpagzkxls`
- Main draft workflow: `aE1v0KxbgXbWjUm8`
- Retry workflow: `oyF3lAhAOLUgWbzg`
- Sent-mail delta indexer: `7TxHQRyeUxVbpOrl`
- Review feedback matcher: `bAXM54PasUD8IFNx`

## Passive learning contract

1. The existing matcher associates a sent response with its AI draft and stores the bounded structural comparison.
2. Pending comparisons from the last 90 days enter passive learning only when the case is valid, not high-risk, and changes at most 65 percent of the draft.
3. Question, amount, date, attachment, commitment, internal-detail, factual, and full-rewrite changes are rejected from style learning.
4. Drafts or sent responses containing vague internal deferral language are rejected. Sent responses containing unsupported commitment patterns are rejected.
5. A manual `rejected` or `ignored` decision always excludes the sample. A manual approval is still subject to the same v4 safety rules.
6. Three safe examples activate the most specific available category/channel/reply-class profile. If that scope is too small, the function falls back through channel and global aggregate scopes.
7. The profile exposes counts, median words, median paragraphs, a bounded closing choice, and style preference flags only. It contains no customer text, identity, facts, or source references.
8. Main and retry workflows accept only `email-style-profile-v5-passive-safe`, backed by `email-feedback-analyzer-v5` and at least ten semantically safe samples. The profile cannot rewrite the base prompt or authorize sending.
9. Manual review remains available only to correct an exceptional classification. It is not required for ordinary safe style learning.

## Initial production baseline

Captured on 2026-07-20 before v4 cutover:

- 55 feedback comparisons evaluated
- 3 comparisons pass the conservative passive v4 gate without manual action
- Minimum profile threshold: 3 safe comparisons
- All other comparisons remain excluded unless they independently satisfy the same safety contract

The low initial threshold is deliberately paired with narrow, deterministic eligibility and bounded output. It permits the existing real comparisons to activate a useful profile immediately without trusting risky historical edits.

## Backups and rollback

Validated inactive n8n backups created before production modification:

- Main: `pIWvI2bgITkSeHga`
- Retry: `Kwp1jIgUMp0TYTYb`

Database rollback:

- `supabase/rollbacks/20260720164453_email_agent_passive_safe_learning_rollback.sql`

The database rollback removes only the v4 view and functions. It preserves all feedback, audit rows, improvement candidates, and the previous v3 interfaces. Restore the inactive workflow backups only if workflow rollback is also required.

## Verification

- Generator and workflow behavior tests for both drafting paths
- Repository quote tests and Next.js production build
- PostgreSQL 17 clean apply and integration scenario
- Unsafe amount, deferral, and manual-exclusion cases proven ineligible
- Content-column inspection of the reusable eligibility view
- Non-destructive rollback proving v3 and data preservation
- Complete n8n validation before and after live update
- Live RPC, profile-count, draft-only, and no-send verification
