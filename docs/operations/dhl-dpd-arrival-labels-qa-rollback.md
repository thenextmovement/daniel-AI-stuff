# QA and rollback — DHL/DPD arrival labels

## QA plan

1. Run TypeScript, full repository tests and production build.
2. Generate and statically validate both inactive n8n workflows; verify exactly one trigger per workflow, `Europe/Berlin`, retry/timeout, `dry_run`, `persist=false`, sender-domain validation for the Outlook trigger, and no EasyDPD/Shopify mutation/print call.
3. Run the saved fixture twice. Assert identical decisions and idempotency keys. Confirm `#NEONT4498` is `existing_label` with `01476817678011` and the Dimmer case is `special_case`.
4. Exercise synthetic A6 portrait labels. Extract text (`3486` only), assert A6 dimensions, render PNG at 3×, verify safe/protected rectangles are disjoint, and reject overlap/wrong-size/multiple-page files.
5. Review the SQL in a disposable Supabase branch/local database: apply migration, check RLS/grants/constraints, repeat upsert, concurrent lease claim and rollback. Never first-test the rollback on production.
6. Deploy the read-only Ops endpoint only after PR approval and `codex-predeploy ops`. Keep `ARRIVAL_LABEL_WRITES_ENABLED=false`.
7. Run the live service manually without `--persist`; compare Outlook, Trello, Shopify and existing shipment evidence to operator records. Resolve every manual-review item.
8. Import the n8n JSON inactive, execute manually in shadow, then activate only the dry-run schedule after approval. Monitor at least five business days.
9. On the office print host, install only CUPS client tooling, configure the exact queue, inspect its media keywords and run `npm run arrival-labels:print-worker -- --self-test`; this must print no page.
10. Run the print worker against a mocked Ops API and CUPS runner. Verify checksum rejection, pre-dispatch retry, durable dispatch, submitted/printed evidence and mandatory manual review on uncertainty.
11. Print one synthetic A6 reference page under operator supervision. Measure 105 × 148 mm and scan every barcode/QR area. Confirm the last-four text is visible and nothing is scaled.
12. After an official EasyDPD sandbox/API contract is available, add adapter contract tests for find-existing, create-once, duplicate response, timeout-after-create reconciliation, PDF download, void and rate limits. Determine whether the app writes Shopify fulfillment itself and test only one owner. Re-run the safety review.
13. First future write: one approved non-reference order, serialized lease, operator witness, EasyDPD reconciliation, Shopify tracking confirmation, PDF scan test, physical print confirmation and cost check. Stop immediately on any mismatch.

## Rollback

Immediate operational rollback is non-destructive:

1. Deactivate `NEONTRIP DHL Arrival Labels Dry Run v0.1` in n8n.
2. Deactivate `NEONTRIP DHL Arrival Email Dry Run v0.1` in n8n.
3. Stop/disable the local print-worker service and revoke `ARRIVAL_LABEL_PRINT_API_TOKEN`.
4. Keep/set `ARRIVAL_LABEL_WRITES_ENABLED=false` and revoke `ARRIVAL_LABEL_AGENT_API_TOKEN`.
5. Roll the Ops application back to the previously approved commit.
6. Preserve reports, event history, print jobs and label artifacts for incident review. Do not delete, requeue, reprint or void anything automatically.

The additive database objects can remain safely unused. If they must be removed, first deploy an app version that no longer references them, export any required audit data, obtain explicit approval, then use `supabase/rollbacks/20260720094159_create_arrival_label_automation_rollback.sql`. This rollback deletes arrival-label audit data and is therefore a last resort.

For a future partially created carrier label: block the case, reconcile EasyDPD by idempotency key and tracking number, and require an operator to decide whether to void it. Never retry creation until reconciliation proves that no label exists. For a `dispatching`, `submitted` or uncertain CUPS job, physically inspect the printer and CUPS history before any manual reprint.
