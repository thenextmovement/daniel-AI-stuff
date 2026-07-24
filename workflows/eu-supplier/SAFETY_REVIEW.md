# Safety review

## Findings

- High: The existing workflow uses Trello/static state as delivery truth. The database ledger must be active before replacement.
- High: Graph acceptance is not final inbox delivery. Store the provider ID and ingest bounces as failures.
- High: A crash after a Graph send can make delivery ambiguous. The draft identity is persisted before the one send; lease recovery blocks automatic resend and raises the one terminal alert.
- Medium: Only explicit organization domains and aliases match; free-mail domains require review.
- Medium: Attachments and bodies are untrusted. AI output is JSON-only and cannot perform actions.
- Medium: Graph notifications require the configured client-state secret, messages are re-fetched by immutable ID, and request correlation comes only from a stored outbound conversation ID.
- Medium: The immutable internet-message ID is reserved before OpenAI, so webhook replay cannot repeat extraction cost.
- Medium: Public B2B reviews are sparse. Verified NEONTRIP performance must become the primary score.

## Scorecard

| Dimension | Score | Notes |
|---|---:|---|
| correctness | 4 | Exact domain matching and evidence-bound fields |
| reliability | 4 | Exactly one supplier-mail retry; alert attempted once; live Graph canary pending |
| idempotency | 5 | Unique request/recipient, message and alert keys |
| observability | 4 | Correlation, execution, provider and error fields |
| security | 4 | HMAC, replay window, RLS and schema validation |
| tracking impact | 5 | No tracking changes |
| cost risk | 4 | Bounded content and one extraction per unique message |

## Required rollout checks

- Apply migrations in preview and verify RLS.
- Configure secrets without printing them.
- Use internal-recipient canaries only.
- Prove duplicate Trello/Graph events do not resend.
- Prove the first failure schedules exactly one retry and the second failure creates exactly one alert.
- Prove a failed alert is recorded terminally and is not automatically retried.
- Prove another employee at a configured domain matches the organization.
- Prove Gmail/lookalike domains require review.
- Roll back by deactivating new workflows and restoring the previous version.
