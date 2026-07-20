# Automation Safety Review

Review scope: inactive DHL-arrival dry-run service, additive Postgres schema, generated n8n scheduler, and PDF processor. Production disposition: **NO-GO for label writes; GO for code review and fixture/read-only validation**.

| Dimension | Score (1–5) | Evidence and residual risk |
| --- | ---: | --- |
| Correctness | 4 | Full-number DHL extraction, exact Trello order references, strict customer fallback, note/express conflict handling and reference protection are tested. Real DHL templates and a real EasyDPD PDF still require contract fixtures. |
| Reliability | 4 | Bounded retries/backoff, timeouts, Berlin timezone, inactive daily scheduler and fail-closed errors. Live API pagination/rate behavior needs a shadow period. |
| Idempotency | 5 | Application key and DB uniqueness use Shopify order ID plus full DHL number; Shopify/database existing-label checks; lease RPC with row lock; repeat-run tests. EasyDPD must later accept or emulate this idempotency contract. |
| Observability | 4 | Correlation ID, run/case state, immutable per-run snapshot, append-only events, structured Markdown/JSON report, PDF SHA/QA artifacts. Alert routing is not yet configured because workflow is inactive. |
| Security | 4 | Secrets only from server/n8n environment, token-protected internal API, constant-time token check, DHL sender-domain allowlist, RLS and service-role-only grants, private paths. The separate project RLS advisories are pre-existing and outside this migration. |
| Tracking Impact | 5 | No analytics, fulfillment or customer tracking writes; existing DPD tracking blocks creation. Tracking impact remains zero in dry-run. |
| Cost Risk | 5 | No label-buying adapter exists, write flag defaults false, n8n sends dry-run only. Future EasyDPD test labels require an explicit capped sandbox/cost plan. |

## Blocking findings before writes

- No documented EasyDPD endpoint/auth/idempotency/error contract is available.
- No confirmed mapping exists for standard, Express/Eil and the 09:00/12:00/DPD Express 12:00/18:00 choices.
- The reference EasyDPD PDF could not be downloaded through an approved API; PDF QA currently uses a synthetic A6 fixture.
- The migration is un-applied and the n8n workflow is unimported/inactive.
- A real service-driven read-only run after deployment has not yet been operator-approved.

No blocker may be bypassed by browser automation or by setting the environment flag alone.
