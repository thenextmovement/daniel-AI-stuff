# n8n database / webhook storm — 2026-07-23

## Status

Contained, hardened, and restored under bounded concurrency.

- The PostgreSQL-timeout mail storm ended at `2026-07-23 13:41:32 CEST`.
- A separate design-reminder regression produced expected-stop/error alerts
  through `14:25:25 CEST`; its safe stop is now a successful no-op.
- Normal business mail continued after the database storm.
- No global n8n error execution or Outlook n8n error mail appeared after
  `14:25:25 CEST` during final controlled restoration.
- The only matching design-reminder customer mail is the already quarantined
  send at `14:10:26 CEST`; no later automatic customer send appeared.
- `/healthz` and `/healthz/readiness` returned `200` in 20 consecutive final
  samples, including after the bounded canonical mockup workflow was restored.
- The latest 100 stored production executions after restoration were all
  successful.
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
| Gemini Mockup Generator v1.1 legacy duplicate | `Rmv4Ht895SiIgUOC` | `haIxxQLtc7NWN49D` |
| Gemini Mockup Generator v1.2.1 canonical before bounding | `T4mdDxLquLMJ6FMl` | `GMf4Njo0bqStYwFW` |
| Design reminder before draft-only restoration | `btJd34v7PJFVej6G` | `5JAEFgo7kxq78rT4` |
| Design reminder before expected-stop no-op | `btJd34v7PJFVej6G` | `HFyaNKV3rRMddVrP` |
| Legacy bulk-Trello mockup error handler | `2gTu1lSGwsONtPSH` | `SgEfN0SuVyJUPmES` |
| Legacy v1.1 mockup cleanup | `fiDudR4FqkND92G0` | `okQts8yB3IdsNx6x` |

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

## Second recurrence: exact Trello / mockup trigger

The initial infrastructure repair bounded the blast radius but did not remove
the workflow-level trigger. Two overlapping Gemini mockup pollers had been
active against different Trello lists:

- legacy v1.1 `Rmv4Ht895SiIgUOC`;
- canonical v1.2.1 `T4mdDxLquLMJ6FMl`.

Both ran every ten seconds. In about 35 minutes they created 129 executions:
38 remained queued/new and 83 crashed. The canonical graph also contained 24
retry-enabled Trello write nodes. Those writes changed labels, comments,
attachments, and titles, causing additional board webhook executions while the
PostgreSQL execution pool was already saturated.

The canonical graph pointed to custom error workflow `2gTu1lSGwsONtPSH`.
Every workflow error made that handler list all processing-labelled cards,
comment on each card, and remove labels with retries. Legacy cleanup
`fiDudR4FqkND92G0` separately polled the retired v1.1 list and also removed
labels with retries. These were feedback amplifiers, not recovery controls.

The production correction is:

- legacy v1.1 is inactive and explicitly named `DO NOT ACTIVATE`;
- the bulk-Trello error handler is inactive and no production workflow points
  to it;
- the legacy v1.1 cleanup is inactive and explicitly named `DO NOT ACTIVATE`;
- canonical v1.2.2 polls once per minute, processes at most one active card,
  uses at most three generation attempts, and never retries Trello writes;
- canonical errors route to the capped central notifier, not to Trello;
- canonical success payloads are not persisted and execution timeout is ten
  minutes.

The 96-node canonical workflow remains an interim bounded implementation. It
must be decomposed before adding functionality; the incident fix does not
reclassify the oversized graph as target architecture.

## Separate design-reminder regression

The design reminder had drifted from draft-only to automatic send. Execution
`3555869` sent one customer message, then failed while recording the provider
receipt because the Outlook response did not supply the expected draft ID.
The exact database job
`bdd5680b-7f3e-4d02-a8d0-4a354eefb819` was moved to `draft_unknown` with
automatic send and automatic retry disabled.

Production `btJd34v7PJFVej6G` is now:

- Outlook `saveAsDraft: true`;
- `automaticSendAllowed: false`;
- `humanApprovalRequired: true`;
- no Outlook retry;
- strict-valid with 12 nodes and one trigger;
- expected `active_lease`, `manual_review_required`, and `draft_unknown`
  outcomes return a successful `stopped_safely` result instead of throwing an
  n8n error.

The candidate builder and regression test assert this successful fail-closed
behavior so a future rebuild cannot reintroduce alert-producing expected
stops.

Final restoration activated design draft-only first and then canonical mockup
v1.2.2. Successful runs are intentionally not persisted, so verification used
the absence of new error executions, the bounded Outlook view, PostgreSQL job
state, active published graphs, 20 consecutive health/readiness samples, and
the latest 100 stored executions. The retired v1.1, bulk error handler, and
legacy cleanup recorded no post-deactivation starts.

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
