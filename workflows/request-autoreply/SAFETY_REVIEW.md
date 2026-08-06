# Request Auto-Reply Safety Review

## Decision

Approved for an internal canary only after commit, safe-push, predeploy and production
database smoke. Live mode is gated on a confirmed canary receipt and published intake
diffs. Default database mode is `off`.

## Scorecard

| Area | Score | Evidence |
| --- | ---: | --- |
| Correctness | 5/5 | Source allowlist, six-minute due time, deterministic recipient/subject/signature, bounded AI body |
| Reliability | 5/5 | Durable queue, token-bound claim, terminal stale lease, explicit completion assertion |
| Idempotency | 5/5 | Unique request/job identity, one attempt maximum, replay-safe completion/unknown receipts |
| Observability | 5/5 | Retained n8n executions, append-only enqueue/claim/sent/blocked/unknown events |
| Security/privacy | 5/5 | RLS, service-role-only RPCs, no secrets, no raw body in events, prompt-injection boundary |
| Customer safety | 5/5 | Strict JSON, deterministic validator/fallback, no prices/dates/discounts/URLs/promises, internal canary |
| Cost/control | 5/5 | One due job per execution, one bounded model call, no historical backfill |

## Verification evidence

- Workflow unit/policy tests pass, including malformed JSON and forbidden price,
  upload, prompt-injection, deadline and URL cases.
- Strict n8n candidate validation: 13 enabled nodes, one trigger, twelve valid
  connections, zero invalid connections and zero errors.
- PostgreSQL 17 clean apply and behavior suite pass.
- PostgreSQL 17 rollback and reapply pass while remaining fail closed.
- A real parallel two-session claim test returns exactly one `process` and one `stop`;
  the job remains `processing:1`.
- The three ActiveCampaign-removal candidates have zero remaining AC/PandaDoc strings,
  zero invalid connections and zero strict validation errors.

## Known residuals

- Two modified intake graphs remain over the 30-node decomposition target (32 and 34
  nodes). No new behavior is added to those graphs; this cutover removes three/four
  nodes and records decomposition as separate work.
- Outlook send success can occasionally provide no message ID. The receipt then records
  `outlook_node_success` with a deterministic execution-scoped accepted ID. Any node
  error is still quarantined as `delivery_unknown`.
- Customer communication is autonomous only for this narrow acknowledgement class.
  Any validation uncertainty falls back to fixed safe copy; provider uncertainty never
  retries.
