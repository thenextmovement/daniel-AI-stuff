# AI email feedback delta collector

This change separates Microsoft Graph ingestion from feedback matching.

## Production workflow structure

### Sent Delta Indexer

1. Schedule trigger every five minutes.
2. Claim a durable database lease and read the opaque Graph cursor.
3. Validate or construct the Microsoft Graph delta URL.
4. Perform at most one Sent Items Graph request.
5. Sanitize quoted text and the Fabienne signature.
6. Atomically store the page, cursor, run log, and backoff state.

HTTP 429 is treated as data, not as an immediate retry loop. The database stores
the `Retry-After` window, and later schedules skip work until it expires.

### Review Feedback Matcher

1. Schedule trigger every five minutes.
2. Fetch deterministic draft/sent candidate pairs from Postgres.
3. Expand the bounded candidate list.
4. Calculate semantic and style differences without AI.
5. Atomically record feedback and mark the sent-index row as matched.

The matcher has no Microsoft Graph access.

## Safety boundaries

- No workflow sends customer communication.
- No AI is used in the collector.
- Stored reply bodies are sanitized and capped at 6,000 characters.
- Tables and RPCs are service-role-only.
- The Graph cursor host and path are validated before use.
- Leases, unique keys, and RPCs make replay idempotent.
- Learning remains human-gated and cannot rewrite prompts automatically.

## Tests

```bash
node workflows/email-feedback-delta/build-workflows.mjs
node workflows/email-feedback-delta/test-workflows.mjs
```

The production cutover requires:

1. Apply `20260716130326_email_agent_sent_delta_index.sql`.
2. Create the Sent Delta Indexer inactive.
3. Run isolated Graph and database regressions.
4. Activate the indexer and observe successful cursor advancement.
5. Replace the existing collector body with the generated matcher workflow.
6. Verify no Graph calls remain in the matcher.

## Rollback

1. Deactivate the Sent Delta Indexer.
2. Deactivate the matcher.
3. Reactivate backup workflow `FdNldGSMnyfwZpbX`.
4. Only after workflow rollback, optionally apply
   `20260716130326_email_agent_sent_delta_index_rollback.sql`.

Keeping the new tables during workflow rollback is safe because they have no
customer-facing side effects.
