# Safety review — email retry recovery v1

## Scope

Recover only database rows already marked failed_retryable or rows whose processing
lease expired. The worker cannot discover arbitrary inbox messages.

## Failure analysis

- Concurrent workers: atomic row locks, a single-worker gate, and a lease allow
  only one retry at a time.
- Crash after claim: the expired lease becomes eligible again.
- Crash after Outlook draft creation: the next attempt searches the conversation
  and suppresses duplicate creation.
- Existing employee draft: the worker leaves it untouched and marks the case for
  normal human review.
- Moved source: immutable internet-message-id lookup resolves the new Graph ID
  before processing.
- Deleted source: no new draft is created; only a source missing after both
  identity lookups becomes final and remains visible in retry health.
- Transient downstream outage: exponential retry scheduling is bounded at five
  total attempts.
- Database outage: the claim cannot be made, so no Outlook side effect occurs.
- Logging failure after draft creation: the failure function reconciles a known
  created draft instead of scheduling duplicate work.
- Prompt injection: the same production facts-package allowlist and validation
  nodes are reused.
- Customer communication: only Outlook drafts are created. There is no send node
  and human approval remains mandatory.

## Rollout

1. Back up the database schema and the generated workflow.
2. Apply and verify the migration with service-role-only grants.
3. Create the retry workflow inactive and validate its graph.
4. Run deterministic database and workflow tests.
5. Activate the worker.
6. Verify one known failed row is recovered or safely finalized, then inspect
   retry events, n8n executions, and the Outlook draft queue.
