# QA and rollback — DHL/DPD arrival labels

## QA plan

1. Run TypeScript, full repository tests and production build.
2. Generate and statically validate the inactive n8n workflow; verify one schedule trigger, `Europe/Berlin`, retry/timeout, `dry_run`, `persist=false`, and no EasyDPD reference.
3. Run the saved fixture twice. Assert identical decisions and idempotency keys. Confirm `#NEONT4498` is `existing_label` with `01476817678011` and the Dimmer case is `special_case`.
4. Exercise synthetic A6 portrait labels. Extract text (`3486` only), assert A6 dimensions, render PNG at 3×, verify safe/protected rectangles are disjoint, and reject overlap/wrong-size/multiple-page files.
5. Review the SQL in a disposable Supabase branch/local database: apply migration, check RLS/grants/constraints, repeat upsert, concurrent lease claim and rollback. Never first-test the rollback on production.
6. Deploy the read-only Ops endpoint only after PR approval and `codex-predeploy ops`. Keep `ARRIVAL_LABEL_WRITES_ENABLED=false`.
7. Run the live service manually without `--persist`; compare Outlook, Trello, Shopify and existing shipment evidence to operator records. Resolve every manual-review item.
8. Import the n8n JSON inactive, execute manually in shadow, then activate only the dry-run schedule after approval. Monitor at least five business days.
9. After an official EasyDPD sandbox/API contract is available, add adapter contract tests for find-existing, create-once, duplicate response, timeout-after-create reconciliation, PDF download, void and rate limits. Re-run the safety review.
10. First future write: one approved non-reference order, serialized lease, operator witness, EasyDPD reconciliation, Shopify tracking confirmation, PDF scan test and cost check. Stop immediately on any mismatch.

## Rollback

Immediate operational rollback is non-destructive:

1. Deactivate `NEONTRIP DHL Arrival Labels Dry Run v0.1` in n8n.
2. Keep/set `ARRIVAL_LABEL_WRITES_ENABLED=false` and revoke `ARRIVAL_LABEL_AGENT_API_TOKEN`.
3. Roll the Ops application back to the previously approved commit.
4. Preserve reports, event history and label artifacts for incident review. Do not delete or void a carrier label automatically.

The additive database objects can remain safely unused. If they must be removed, first deploy an app version that no longer references them, export any required audit data, obtain explicit approval, then use `supabase/rollbacks/20260720094159_create_arrival_label_automation_rollback.sql`. This rollback deletes arrival-label audit data and is therefore a last resort.

For a future partially created carrier label: block the case, reconcile EasyDPD by idempotency key and tracking number, and require an operator to decide whether to void it. Never retry creation until reconciliation proves that no label exists.
