# n8n database / webhook storm — 2026-07-23

## Status

Contained, hardened, and restored under bounded concurrency.

- Last n8n error mail in Outlook: `2026-07-23 13:41:32 CEST`.
- Normal business mail continued afterward.
- No new failed n8n execution was recorded after `13:47:22 CEST` during
  restoration.
- `/healthz` and `/healthz/readiness` returned `200` throughout every
  post-change sample, including after all affected workflows were restored.
- Current n8n logs contain no new PostgreSQL pool timeout. Separate handled
  `invalid_message_id` messages and calls to formerly inactive webhook paths
  are not database failures and did not affect readiness.

## Incident

At approximately 13:02 CEST, several native Trello-triggered workflows began
failing in parallel. Outlook received duplicate alert copies at sub-second
intervals. n8n `/healthz` remained intermittently alive while
`/healthz/readiness` flapped between `200` and `503`.

The production logs prove a shared self-hosted infrastructure overload, not a
general n8n cloud outage and not several independent downstream API failures:

- `ExecutionPersistence.create`, `ExecutionPersistence.applyDataUpdate`, and
  `ExecutionRepository.setRunning` timed out acquiring a PostgreSQL connection.
- The n8n database monitor repeatedly reported `Database connection timed out`.
- Many native Trello webhook paths executed concurrently for the same board
  events.
- Some workflows update Trello labels/comments, producing more board webhook
  events.
- PostgreSQL continuously wrote large checkpoints and hundreds of MB of WAL.

The production stack had no `N8N_CONCURRENCY_PRODUCTION_LIMIT` and used n8n's
two-connection PostgreSQL pool default. Its pruning variables were named
`N8N_EXECUTIONS_DATA_*`; n8n's supported variables are `EXECUTIONS_DATA_*`.
The intended pruning was therefore not reliably configured. Individual
high-volume workflows also explicitly persisted all successful executions.
Finally, the common Outlook error sender retried each send up to six times,
multiplying duplicate notifications during the database failure.

## Emergency containment and backups

Every modified production workflow was backed up before its graph or settings
were changed. Each backup was created inactive and its nodes, connections, and
settings were compared with the source.

| Production workflow | Production ID | Exact inactive backup |
| --- | --- | --- |
| NEONTRIP Anfrage → Telegram Approval v1.1 — Credential Safe | `7AvW1d4JBNDFuNsv` | `xocBJAwf4qHVhQZS` |
| EU Supplier Request v1.1 — DB Delivery Loop | `Hzf3fcJwmcCxExnx` | `A0bG6Q7nyfoo6w6y` |
| Inflatables EU-Anfrage \| PRODUKTION \| 20 Lieferanten | `uRYt9I30bzzVTB2D` | `geHePkhCl1bNO5aI` |
| NEONTRIP Preview Delivery Intake v1 — Trello Event to DB | `o3Lckpd5ZiH1hQ4H` | `KM0dTjMbGaleGsGZ` |
| NEONTRIP Quote Ready SIMPLE v1.1 | `X5etVW0msgSzHMMG` | `iVb7i0a79TIoHZXU` |
| Trello Update Auto-Email → Outlook mit PandaDoc Link | `8PlBdlnG8gwtYTc7` | `q4lUrgfeo21BCd7e` |
| Error Notification → info@NeonTrip.de | `M4uG1HAtN9Zggxww` | `7BUhJaslYnAV3KkT` |

The seven production workflows were first deactivated. The n8n application and
PostgreSQL containers were stopped as one stack without deleting persistent
volumes. No failed execution was automatically replayed.

## Infrastructure hardening

`coolify-compose.before.yml` is the exact pre-change Coolify Compose definition.
`coolify-compose.hardened.yml` is the deployed reversible recovery definition.

The recovery definition:

- limits production execution concurrency to five;
- expands the n8n PostgreSQL pool from two to ten connections;
- increases the pool acquisition timeout to 30 seconds;
- keeps failed executions but disables global success-payload persistence;
- uses the supported `EXECUTIONS_DATA_*` variables;
- restores the documented 336-hour / 10,000-execution pruning limits;
- removes the obsolete `N8N_RUNNERS_ENABLED` setting;
- checks `/healthz/readiness` instead of the editor root;
- adds startup and graceful-stop periods.

The change was deployed only after `codex-predeploy ops` passed. The exact
recovery commit was:

`35413ff397f7e34f0e944935c1eac14fa6d71158`

## Workflow hardening

The affected high-volume workflows now use:

- `saveDataSuccessExecution: none`
- `saveDataErrorExecution: all`
- `saveExecutionProgress: false`

The common error workflow now:

- fingerprints errors by workflow, failed node, and normalized message;
- emits at most one alert per fingerprint per 15 minutes;
- emits at most 20 alert emails globally per UTC hour;
- reports the number suppressed in the next emitted alert;
- bounds and HTML-escapes untrusted error fields;
- only links to execution URLs below `https://fuajob.online/`;
- never retries the Outlook send (`maxTries: 1`);
- continues safely when the alert send itself fails.

`prepare-alert-data.js` is the exact Code-node source. Its offline test covers
deduplication, normalization, HTML escaping, URL allowlisting, and the global
hourly cap. No test email was sent.

The RH Trello workflow had two additional strict-validation errors. Before
reactivation:

- its Trello card ID was migrated to the required resource-locator shape;
- the deprecated `continueOnFail` property was removed from the audit node,
  retaining modern `onError: continueRegularOutput`.

Strict validation then passed with zero errors.

## Controlled restoration

Workflows were restored one at a time in this order:

1. deduplicated common error notifier;
2. Preview Delivery DB intake;
3. Telegram Approval;
4. EU Supplier DB Delivery Loop;
5. Inflatables supplier flow;
6. Quote Ready;
7. RH Trello customer-update flow after its validation repair.

Readiness remained `200` between every activation. The already-active Preview
Delivery Worker v2.1 (`S4gjf0YeZjP0pqFR`) remained active and uses its existing
token-bound database claim loop.

## Residual architecture work

The immediate failure mode is bounded, but the production instance still has
many independent native Trello subscriptions. A single board action therefore
starts several small filter executions. The concurrency cap prevents this
fan-out from exhausting PostgreSQL again, while success-payload suppression and
pruning sharply reduce write amplification.

The durable simplification remains:

1. one Trello ingress;
2. normalization and strict board/action validation;
3. durable PostgreSQL enqueue keyed by Trello action ID;
4. small worker workflows with bounded concurrency;
5. side-effect idempotency keys and self-generated-event suppression.

This migration must be staged capability by capability. Do not mass-disable the
remaining Trello workflows; several perform distinct live production work.
PostgreSQL remains the operational source of truth and Trello remains a
projection.

The Compose file still references the mutable n8n `latest` tag inherited from
the prior deployment. Pin the currently verified image digest in a separate
controlled maintenance change; do not redeploy production merely to discover a
tag during an incident.

## Safety scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| Correctness | 4/5 | Root cause is log-proven and the RH schema errors are fixed; the Trello ingress is not yet consolidated. |
| Reliability | 5/5 | Bounded concurrency, larger DB pool, correct pruning, readiness healthcheck, staged restoration. |
| Idempotency | 4/5 | DB-backed Telegram, supplier, and preview paths retain durable claims; every remaining legacy customer-send path still needs claim-before-send review during ingress consolidation. |
| Observability | 4/5 | Readiness, failed executions, bounded notifier, backups, and operation log exist; no dedicated DB-pool dashboard yet. |
| Security | 5/5 | No secrets added, untrusted alert content is escaped, links are allowlisted, and no test customer communication was sent. |
| Tracking impact | 5/5 | No analytics, attribution, or conversion-tracking change. |
| Cost risk | 5/5 | No new paid API action or automatic replay; concurrency limits bound downstream calls. |
| Rollback | 5/5 | Exact pre-change Compose plus seven graph-verified inactive workflow backups. |

## Rollback

Infrastructure rollback:

1. Deactivate the seven workflow sources/notifier listed above.
2. Replace the Coolify Compose content with `coolify-compose.before.yml`.
3. Redeploy the service stack without deleting persistent volumes.
4. Verify PostgreSQL health, then verify `/healthz` and
   `/healthz/readiness` for at least ten consecutive samples.

Workflow rollback:

1. Keep the corresponding production workflow inactive.
2. Compare it with the recorded inactive backup ID.
3. Restore the exact backup graph/settings or use the recorded version history.
4. Strict-validate before activating.
5. Activate one workflow at a time and observe readiness and error executions.

Never delete or replay failed executions automatically. Reconcile each intended
side effect against PostgreSQL and the external system before replay.
