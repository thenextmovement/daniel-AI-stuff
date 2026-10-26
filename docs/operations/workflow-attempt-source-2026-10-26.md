# Workflow-attempt scanner source and evidence isolation

Scope: NEONTRIP operational monitoring, database migration only. No Ops deployment,
n8n edit, customer communication, payment mutation, or workflow retry.

## Evidence and correction

On 26 October 2026, PostgreSQL cron job 2 failed every five minutes because
`scan_company_brain_workflow_attempt_gaps()` writes `source_key=workflow_attempt`,
but that key is absent from `company_source_registry`. The incident foreign key
rolls back the entire scanner transaction, including its stale-attempt markers.
Runs 64941, 64944, 64946 and 64948 failed between 19:00 and 19:15 UTC.

The migration atomically adds this missing projection source and isolates the
scanner's evidence under `workflow_attempt_gap:<attempt UUID>` / incident type
`workflow_attempt_gap`. The immutable attempt and its actual action are retained;
a missing terminal event does not become a fabricated `create_and_send_offer`
failure. Existing business incidents, causes, holds and resolutions are untouched.
It does not invoke the scanner or change schedules, source settings, queue
triggers or business workflows. `ON CONFLICT DO NOTHING` preserves an existing
registry row. Freshness is unset for this event projection. Exact function-body
guards reject unreviewed drift before either apply or rollback.

The three tested function bodies match production `md5(prosrc)`:

- original scanner: `586275f42f145687dc0d7df33c0736ee`
- corrected scanner: `90257d3d984f5351c8bb80e6efae0d4a`
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

### Quantified impact (26 October, 19:27 UTC)

There are 661 old eligible attempts. The corrected natural scan creates one
separate internal gap per immutable attempt (661 gaps at this snapshot), instead
of changing a business-failure incident. These are missing terminal-event
projections, not proof that 661 business operations failed. No business case is
repaired or declared complete. No existing source uses this new fingerprint.

| Actual action | Attempts |
| --- | ---: |
| design_field_alignment_v1 | 404 |
| qc_auto_repair_v1 | 132 |
| email_bounce_detected | 73 |
| manual_auto_quote_prepare_v1 | 44 |
| manual_minimum_size_review_v1 | 5 |
| google_data_manager_live_ingest | 1 |
| google_data_manager_live_remove | 1 |
| design_field_manual_correction | 1 |

The rejected registry-only candidate would group these into 542 fingerprints:
537 new incidents (652 attempts), two existing open incidents (four attempts)
and three resolved incidents (five attempts). Forty-one fingerprints mix
different actions. It would overwrite these five specific business causes and
their source evidence, even where a delivery guard preserves `resolved`:

| Existing incident | Status | Existing cause |
| --- | --- | --- |
| 06b8b812-ab3e-465a-a182-2dae55afb9f3 | open | preview_delivery_failed |
| 77b7e4ec-ad99-4dbd-84ba-33805527a125 | open | size_ladder_technical_validation_failed |
| 4f830c99-a721-4a27-85f3-41a04aabe982 | resolved | size_ladder_technical_validation_failed |
| 72a03793-3a4b-4c9d-ba0a-f6782639200c | resolved | video_content_qc_failed |
| 76495e76-da61-468b-8502-40fffbb60586 | resolved | video_content_qc_failed |

Replacing only the hard-coded action was also rejected: it would touch 327 open
and 23 resolved incidents. Separate gap identity avoids both classes of overlap.
The existing Preview-Delivery trigger resolves business failures by request/card;
the separate gap type prevents unrelated delivery success from closing a missing
terminal-event gap. Gap closure requires explicit verification and the existing
manual incident transition API; this patch adds no automatic resolution or
business retry. Operational/financial holds outside these three monitoring
tables have no write path from the scanner.

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
fix. The registry-only candidate also failed the new business-hold preservation
test before the scanner change. Fifteen assertions cover stale eligibility,
immutable identity/action binding, terminal/fresh state preservation, all three
business decisions (open/resolved/ignored), incident dedupe and the actual
Preview-Delivery queue consumer's unrelated-success path.
Additional checks cover repeat application, pre-existing source settings and
rollback/reapply and atomic rejection of unknown function drift. The queue
consumer is the actual unchanged production function with an isolated input
table. A referenced source cannot be rolled back by discarding history.

After explicit approval of the exact commit, apply only
`supabase/migrations/20261026200000_register_workflow_attempt_source.sql` through
Supabase MCP. Do not merge/push main or trigger Ops deployment. Re-read the source
row, exact corrected function and unchanged cron definitions. Wait for a natural job-2 run and
verify its real terminal result plus durable scanner evidence. Do not trigger a
test scan or classify an empty cron-error list as success.

Rollback atomically restores the old scanner and removes only this migration's
marked, unused registration. Foreign-key rejection after evidence references it
also rolls back the function change. Retain evidence and investigate instead of
cascading deletion or rewriting source attribution.
