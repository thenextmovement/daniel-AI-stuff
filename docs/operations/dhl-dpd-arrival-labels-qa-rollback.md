# QA and rollback — DHL/DPD arrival labels

## QA plan

1. Run TypeScript, full repository tests and production build.
2. Generate and statically validate all three inactive n8n workflows; verify exactly one trigger per workflow, `Europe/Berlin`, retry/timeout, `dry_run`, audit persistence, sender-domain validation for the Outlook trigger, fixed internal recipient, and no EasyDPD/Shopify mutation/print call.
3. Run the saved fixture twice. Assert identical decisions and idempotency keys. Confirm `#NEONT4498` is `existing_label` with `01476817678011` and the Dimmer case is `special_case`.
4. Exercise synthetic A6 portrait labels. Extract the last six digits (`113486`), including leading-zero cases, assert A6 dimensions, render PNG at 3×, verify safe/protected rectangles are disjoint, and reject overlap/wrong-size/multiple-page files.
5. Test the Shopify fail-closed gate with the exact live four-line offer note/custom-attribute schema, extra lines, unknown fields, malicious URLs, `Abholer`, `Selbstabholer`, `Ladenlokal`, `holt ab`, `vor Ort`, and an already-fulfilled order. Also test `Problem with Sign`, `Problem mit Schild`, `Manual Review`, `Manuelle Prüfung` and `Sonderfälle` as Trello-list-only blockers. Every deviation must have no selected DPD product and must create one replay-stable review-notification key.
6. Test destination handling for Germany, Austria, Switzerland, another non-EU country, missing address/country, and known EU VAT/customs special territories. Switzerland/non-EU/special territories must have no DPD product and one review notification; an EU plan must require complete address data, a separate approved EU product mapping and A4 printer/media.
7. Generate one-page and multi-page synthetic EU delivery notes. Reopen every output, assert A4 on every page, extract all text, reject price/tax fields, render every page to PNG, verify the Shopify address/order/DHL reference and visually inspect the rendered pages for clipping.
8. Test the review-mail outbox in a disposable database: fixed `info@neontrip.de` recipient, trusted `*.myshopify.com/admin/orders/<id>` link, duplicate enqueue, concurrent claim, pre-dispatch retry, post-dispatch uncertainty, sent-result replay and rollback.
9. Review the SQL in a disposable Supabase branch/local database: apply migration, check RLS/grants/constraints, repeat upsert, concurrent lease claim and rollback. Prove that an EU case cannot reach `label_created` before its QA-approved delivery-note job is confirmed `printed`. Never first-test the rollback on production.
10. Deploy the read-only Ops endpoint only after PR approval and `codex-predeploy ops`. Keep `ARRIVAL_LABEL_WRITES_ENABLED=false`.
11. Run the live service manually without `--persist`; compare Outlook, Trello, Shopify address/country and existing shipment evidence to operator records. Resolve every manual-review item.
12. Import the n8n JSON inactive, execute manually in shadow, then activate the audit workflows and review-mail worker only after approval. Monitor at least five business days.
13. On the office print hosts, install only CUPS client tooling, configure the exact A6 and A4 queues, inspect their media keywords and run `npm run arrival-labels:print-worker -- --self-test` for each environment; neither self-test may print a page.
14. Run both print-worker configurations against a mocked Ops API and CUPS runner. Verify checksum rejection, pre-dispatch retry, durable dispatch, submitted/printed evidence and mandatory manual review on uncertainty.
15. Print one synthetic A6 reference page and one price-free A4 EU delivery note under operator supervision. Measure 105 × 148 mm and A4 respectively, scan every label barcode/QR area, and confirm neither document is scaled.
16. After an official EasyDPD sandbox/API contract is available, add adapter contract tests for find-existing, create-once, duplicate response, timeout-after-create reconciliation, PDF download, void and rate limits. Determine whether the app writes Shopify fulfillment itself and test only one owner. Re-run the safety review.
17. Prove with separate fixtures that a current, unused label can be manually approved while an old fulfilled shipment label can only block a second purchase and can never authorize download or print by itself.
18. First future write: one approved non-reference domestic order and then one approved EU order, serialized lease, operator witness, delivery-note print evidence before EU purchase, EasyDPD reconciliation, Shopify tracking confirmation, PDF scan test, physical print confirmation and cost check. Stop immediately on any mismatch.

## Safety scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4/5 | Deterministic note, country, address, product and document gates; real EasyDPD contract still missing. |
| reliability | 4/5 | Durable queues and fail-closed uncertainty; physical attachment remains an operator responsibility. |
| idempotency | 5/5 | Full DHL/order identity plus unique artifact, mail and print keys. |
| observability | 4/5 | Decision snapshots, country/document state, events, reports and CUPS IDs; production dashboards are still pending. |
| security | 5/5 | Read-only inputs, fixed internal recipient, private artifacts, scoped workers and no embedded secrets. |
| tracking impact | 5/5 | No analytics or tracking mutation. |
| cost risk | 4/5 | Carrier purchase remains disabled and EU purchase is DB-gated behind confirmed A4 print; final carrier price validation is pending. |

Required before production: disposable-database migration/trigger proof, exact EU DPD product approval, exact A4 printer/media approval, official EasyDPD adapter contract, witnessed two-printer test, and a fresh EU territorial-policy review.

## Rollback

Immediate operational rollback is non-destructive:

1. Deactivate `NEONTRIP DHL Arrival Labels Dry Run v0.1` in n8n.
2. Deactivate `NEONTRIP DHL Arrival Email Dry Run v0.1` in n8n.
3. Deactivate `NEONTRIP Arrival Label Review Mail Outbox v0.1` in n8n.
4. Stop/disable both the A6 label and A4 delivery-note print-worker services and revoke their `ARRIVAL_LABEL_PRINT_API_TOKEN` values.
5. Keep/set `ARRIVAL_LABEL_WRITES_ENABLED=false` and revoke `ARRIVAL_LABEL_AGENT_API_TOKEN`.
6. Roll the Ops application back to the previously approved commit.
7. Preserve reports, event history, review notifications, print jobs and label artifacts for incident review. Do not delete, requeue, resend, reprint or void anything automatically.

The additive database objects can remain safely unused. If they must be removed, first deploy an app version that no longer references them, export any required audit data, obtain explicit approval, then use `supabase/rollbacks/20260720094159_create_arrival_label_automation_rollback.sql`. This rollback deletes arrival-label audit data and is therefore a last resort.

For a future partially created carrier label: block the case, reconcile EasyDPD by idempotency key and tracking number, and require an operator to decide whether to void it. Never retry creation until reconciliation proves that no label exists. For a `dispatching`, `submitted` or uncertain CUPS job, physically inspect the printer and CUPS history before any manual reprint.
