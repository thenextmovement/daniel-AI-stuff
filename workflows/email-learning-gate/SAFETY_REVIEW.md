# Production Safety Review — AI Email Learning Gate v2

## Decision

Approved for deployment in draft-only mode after the database backup and predeploy gates pass. Automatic customer sending remains prohibited.

## Risk scorecard

| Area | Rating | Evidence |
| --- | --- | --- |
| Customer side effects | Low | No Outlook send node or customer-facing mutation is added. Runtime remains draft plus human review. |
| Data integrity | Low | Review writes are transactional, idempotent and audit-appended. Content-hash drift removes knowledge from retrieval. |
| AI autonomy | Low | AI cannot approve feedback or knowledge. Deterministic SQL gates execute human decisions. |
| Privacy | Low | Style output is aggregate-only; audit rows omit message bodies and reusable customer facts. Tables are private to `service_role`. |
| Rollback | Low | Dedicated rollback SQL and application commit rollback are documented and integration-tested. |
| Operational usability | Medium-Low | Reviewers must enter their identity and a reason. UI exposes general and e-mail-specific states separately. |

## Guardrails verified

- RLS is enabled for all new tables.
- `anon` and `authenticated` receive no table or function access.
- Audit tables are append-only for `service_role` at the grant layer.
- Legacy unaudited review functions lose `service_role` execution rights.
- Style approval blocks risky labels and high-risk cases.
- Support search requires general approval, e-mail approval, allowed mode, safe risk class, validity window and exact content hash.
- Existing starter knowledge is backfilled only when its reviewer equals the explicit 2026-07-14 user authorization marker; the preflight count is used as the deployment invariant.
- No Trello data becomes a source of truth.
- No secret or customer message content is added to source control or audit snapshots.

## Failure modes and response

- Migration fails: transaction aborts; do not deploy the application.
- Application deploy fails after migration: current runtime search fails closed for unapproved knowledge; roll application forward or apply documented rollback.
- Reviewer retries a request: the same UUID returns the stored result without a second mutation.
- Content changes after e-mail approval: hash mismatch makes retrieval return zero rows.
- Global knowledge is retired or sent back for changes: any active e-mail approval is retired automatically.
- Eligibility rejects a style sample: feedback remains non-learning and the API reports failure; no prompt is changed.

## Residual risk

The authenticated operator name is still entered by the employee, but the server prefixes it with the authenticated Ops actor. This provides session attribution without pretending the browser-supplied display name is an independent identity provider.
