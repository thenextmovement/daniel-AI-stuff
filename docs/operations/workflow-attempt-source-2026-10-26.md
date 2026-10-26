# Workflow-attempt scanner source registration

Scope: NEONTRIP operational monitoring, database migration only. No Ops deployment,
n8n edit, customer communication, payment mutation, or workflow retry.

## Evidence and correction

On 26 October 2026, PostgreSQL cron job 2 failed every five minutes because
`scan_company_brain_workflow_attempt_gaps()` writes `source_key=workflow_attempt`,
but that key is absent from `company_source_registry`. The incident foreign key
rolls back the entire scanner transaction, including its stale-attempt markers.
Runs 64941, 64944, 64946 and 64948 failed between 19:00 and 19:15 UTC.

The migration adds exactly this missing projection source. It does not invoke
the scanner, modify its definition, change schedules, or change existing source
settings. `ON CONFLICT DO NOTHING` makes repeat application harmless. Freshness is
unset: this is an event projection, not a continuously refreshed external feed.

The three tested function bodies match production `md5(prosrc)`:

- scanner: `586275f42f145687dc0d7df33c0736ee`
- incident upsert: `350f7f30e25c121b1b0d275613c5c4f8`
- specific-cause guard: `2263b4aa578125ef4e5ffd52550bb592`

## Consumers and limits

The scanner writes only `company_brain_workflow_attempts`,
`company_brain_operational_incidents` and `company_brain_incident_events` through
the existing upsert. Live triggers only maintain timestamps, preserve specific
incident causes and protect append-only event history. The Ops incident APIs
read or explicitly transition this control plane; they do not enqueue customer
delivery merely because an incident exists. Customer-facing Fix Center actions
remain explicit, guarded actions. No mail or payment queue is touched here.

There were 661 old eligible attempts at inspection. The next natural scan may
mark those attempts stale and create/update internal incidents. This is evidence
of missing terminal events, not proof that 661 business operations failed. The
existing scanner's `create_and_send_offer` grouping and classification remain
unchanged; no historical case is repaired or declared complete by this change.

The inspected n8n health/monitor/digest workflows do not consume this incident
table. The shadow Internal Alert Router writes incidents; it is not an incident
sender. The existing technical digest reads n8n execution failures and retains
its dedupe limits. This patch therefore does not produce a customer mail or
incident-mail burst. **It does not add or prove a support-email route for this
PostgreSQL scanner.** That monitoring transport gap remains separately open.

This bug is not a demonstrated cause of the 09:15 Manual-Paid claim timeouts.
Historical errors 10085629/10129008 and errors 10381176/10381178/10381179 remain
separate; this migration supplies neither their job binding nor an archival
completion proof.

## Verification and application

Run `python3 scripts/test_workflow_attempt_source_db.py` on the development server.
It uses disposable PostgreSQL 17 with no network and the existing table/function
definitions. `BASELINE=1` reproduces the exact missing-source FK error before the
fix. Eleven scanner assertions cover stale eligibility, immutable binding,
terminal/fresh state preservation, incident dedupe and ignored-incident behavior.
Additional checks cover repeat application, pre-existing source settings and
rollback/reapply. A referenced source cannot be rolled back by discarding history.

After explicit approval of the exact commit, apply only
`supabase/migrations/20261026200000_register_workflow_attempt_source.sql` through
Supabase MCP. Do not merge/push main or trigger Ops deployment. Re-read the source
row and unchanged function/cron definitions. Wait for a natural job-2 run and
verify its real terminal result plus durable scanner evidence. Do not trigger a
test scan or classify an empty cron-error list as success.

Rollback removes only this migration's marked, unused registration. Foreign-key
rejection after any evidence references it is deliberate; retain that evidence
and investigate instead of cascading deletion or rewriting source attribution.
