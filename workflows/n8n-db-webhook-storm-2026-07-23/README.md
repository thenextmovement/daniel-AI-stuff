# n8n database / webhook storm — 2026-07-23

## Incident

At approximately 13:02 CEST, several active Trello-triggered workflows began
failing in parallel. Outlook received duplicate alert copies at sub-second
intervals. n8n `/healthz` remained intermittently alive while
`/healthz/readiness` flapped between `200` and `503`.

The production logs prove a shared infrastructure failure, not independent
downstream API failures:

- `ExecutionPersistence.create`, `ExecutionPersistence.applyDataUpdate`, and
  `ExecutionRepository.setRunning` timed out acquiring a PostgreSQL connection.
- The n8n database monitor repeatedly reported `Database connection timed out`.
- Multiple native Trello webhook paths were executing concurrently.
- PostgreSQL continuously wrote large checkpoints and hundreds of MB of WAL.

The production stack had no `N8N_CONCURRENCY_PRODUCTION_LIMIT`, used the
two-connection PostgreSQL pool default, saved successful execution data, and
retained up to 100,000 executions for 8,760 hours.

## Emergency containment

The following workflow event sources were deactivated without changing their
graphs:

| Workflow | ID |
| --- | --- |
| NEONTRIP Anfrage → Telegram Approval v1.1 — Credential Safe | `7AvW1d4JBNDFuNsv` |
| NEONTRIP EU Supplier DB Delivery v1 | `Hzf3fcJwmcCxExnx` |
| NEONTRIP Inflatables Production | `uRYt9I30bzzVTB2D` |
| NEONTRIP Preview Delivery Intake v1 — Trello Event to DB | `o3Lckpd5ZiH1hQ4H` |
| NEONTRIP Quote Ready SIMPLE v1.1 | `X5etVW0msgSzHMMG` |

The n8n application container was restarted independently of PostgreSQL. The
restart cleared the crashed process, but the container did not return to
readiness while the database remained under load.

## Infrastructure diff

`coolify-compose.before.yml` is the exact pre-change Coolify Compose definition.
`coolify-compose.hardened.yml` is the proposed reversible recovery definition.

The recovery definition:

- limits production execution concurrency to five;
- expands the n8n PostgreSQL pool from the documented default of two to ten;
- keeps failed executions but disables global success-payload persistence;
- restores n8n's documented 336-hour / 10,000-execution pruning defaults;
- removes the obsolete `N8N_RUNNERS_ENABLED` setting;
- uses database-aware readiness and explicit startup/grace periods.

## Required workflow architecture

Do not reactivate the five source workflows as separate native Trello
subscribers. Replace them with:

1. one Trello ingress;
2. normalization and strict board/action validation;
3. durable PostgreSQL enqueue keyed by Trello action ID;
4. small worker workflows with bounded concurrency;
5. side-effect idempotency keys and self-generated-event suppression;
6. one deduplicated incident alert per workflow/error fingerprint/time bucket.

Trello remains a projection. PostgreSQL remains the operational source of
truth.

## Rollback

1. Keep the Trello source workflows inactive.
2. Replace the Coolify Compose content with `coolify-compose.before.yml`.
3. Redeploy the service stack and verify PostgreSQL health first.
4. Verify `/healthz` and `/healthz/readiness` for at least ten consecutive
   samples.
5. Reactivate workflows only from their recorded published versions or exact
   inactive backups.

Never delete or replay failed executions automatically. Reconcile each intended
side effect against PostgreSQL and the external system before replay.
