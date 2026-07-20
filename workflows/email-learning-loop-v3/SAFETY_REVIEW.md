# Safety Review — Email Agent Learning Loop v3

## Scope and trust boundaries

Untrusted inputs include incoming email text, attachments, quoted history, WhatsApp/support relay content, offer documents, Shopify notes, and manually written replies. These inputs may contain prompt injection, incorrect claims, personal data, or instructions that conflict with company policy.

The AI proposes a draft. Deterministic code validates and stores it. A human sends or replaces the draft. Supabase is the audit source of truth; Outlook remains the customer-facing delivery surface. No workflow contains a send-mail action.

## Findings addressed

- The previous active profile endpoint returned version email-style-profile-v2-human-gated while the workflow accepted only v1, so learning could never activate.
- The previous renderer read the pre-profile prompt output, so accepted profile data was not deterministically enforced or logged.
- Feedback lacked bounded correction reasons, making style corrections indistinguishable from factual or process corrections.
- There was no deterministic final quality gate for deferral phrases, unsupported commitments, excessive length, missing customer action, paragraph structure, or closing.

## Input and output validation

- Review reasons are restricted to a fixed allowlist and limited to one through eight values.
- Approval requires a reviewer, a note, and an idempotency key.
- Content/process reason codes cannot be approved into style learning.
- Improvement candidates store reason metadata and counts, not customer content.
- Style profiles require the exact version, human-gated flag, safe-to-apply flag, eligibility, and at least five approved samples.
- Reusable profiles contain only aggregate style constraints.
- Draft output must match the expected JSON object and plain-text body contract.
- The quality gate fails closed on unsupported facts, internal deferral, unsupported commitments, imprecise customer action, too many questions, length/paragraph limits, invalid closing, or markup.
- Failure produces a non-retryable draft error; it never sends customer communication.

## Blocked reusable content

The learning profile may not contain customer identities, email addresses, domains, order numbers, offer numbers, prices, addresses, dates, attachment content, product details, discounts, factual assertions, or promises. Those remain per-message evidence and must be re-resolved from source systems.

## Authorization and data access

- New functions use security invoker behavior.
- Execution is revoked from public and authenticated roles and granted only to service_role.
- The review view uses security invoker behavior.
- The improvement table has RLS enabled with service-role-only policy.
- No secrets are added to source control or workflow JSON.

## Idempotency, observability, and recovery

- Review decisions use idempotency keys and audit rows.
- Improvement candidates deduplicate by feedback and candidate type.
- Quality metrics are aggregate and contain no customer content.
- Workflow evidence records applied profile metadata and quality-gate results.
- Inactive workflow backups and a tested database rollback are recorded in README.md.

## Pre-release evidence

- Main, retry, and matcher backups exist and validate with zero workflow errors.
- Local workflow tests pass.
- Repository suite passes: 593 tests, zero failures.
- Next.js production build succeeds.
- PostgreSQL 17 test proves: five approved safe style examples activate a profile; factual correction is rejected from style learning and creates a knowledge candidate; rollback removes v3 interfaces while retaining audit data.

## Residual risks and controls

- Matching can associate the wrong sent reply in an unusual conversation pattern. Control: seven-day draft window, conversation matching, structural-only extraction, and required human review.
- Five examples can still encode a poor stylistic preference. Control: explicit reason codes, reviewer note, category/channel fallback, bounded aggregate rules, and reversible profile use.
- Source-system facts can be incomplete. Control: resolve-first behavior and fail-closed quality gate; no fabricated answer and no automatic sending.
- Historical pending reviews are not trusted automatically. Control: zero mass approval.

## Safety scorecard

| Area | Score | Evidence |
| --- | ---: | --- |
| Human control | 5/5 | Draft-only, explicit review, no send action |
| Data minimization | 5/5 | Aggregate style only; candidates contain metadata only |
| Validation | 5/5 | Allowlist, schema checks, exact versioning, deterministic quality gate |
| Idempotency/audit | 5/5 | Review idempotency and audit records |
| Reversibility | 5/5 | Inactive workflow backups and tested non-destructive rollback |
| Observability | 4/5 | Aggregate metrics and workflow evidence; real-message outcomes still require ongoing monitoring |

Release condition: deploy only the exact commit approved by codex-predeploy ops, then verify the live RPCs and active workflow definitions before relying on the learning loop.
