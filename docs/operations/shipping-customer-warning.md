# NEONTRIP customer delivery warnings

Status: prepared and checked on 2026-11-09; not published. Requires approval of the exact clean commit.

## Scope and evidence

- Ziel: future delivery-failed / returning / returned notices go to the shipment's customer from support@neontrip.de, with the existing Mika Zangane signature, photograph and NEONTRIP logo. No routine internal delivery-problem copy.
- Nachbar: pickup notices and reminders, installation documents, carrier ingestion, schedules, credentials and workflow topology remain unchanged.
- Wirkung: shipping_notifications remains authoritative for recipient, claim, attempts and sent state. The existing Outlook node sends the HTML; a real Sent Items/provider receipt remains necessary for live proof.
- Allowed paths: NEONTRIP shipping notification renderer, its n8n node builder, existing queue/claim/monitor SQL functions and focused tests. No new workflow, table, queue, kind or provider.
- Production workflow: QtG2XHw7DsvOEPtQ, active/draft version d8426ca3-d643-43fd-93e8-0db787bba6d8, active=true, 40 nodes (including sticky note). Backup: n8n/backups/2026-11-09-shipping-customer-warning/active-before.json.
- Concrete execution 11605409 (2026-11-09 12:07Z) sent notification f0459be3-3cee-4c05-b4a0-4767d2db933c for #NEONT4796 internally. Its existing sent key stays unchanged. The separately authorized manual customer email was confirmed in Outlook at 12:13:41Z. No new customer email was sent during this change.
- Read-only DB check found zero unsent delivery-problem rows and zero currently eligible incidents without an existing notification. No retrospective resend/backfill is introduced.

## Change

The legacy technical kind/key internal_delivery_problem / internal:delivery_problem is retained to preserve deduplication. New records store recipient_type=customer and the actual customer email. Before the first claim, the existing queue refreshes only never-attempted recipients against the current shipment and skips superseded/resolved incidents.

The modified kind allows one automatic attempt only. A stale sending/failed record cannot be reclaimed. Unknown sends stay for manual provider/Sent Items reconciliation. The existing technical monitor now recognizes a failed delivery warning after its first attempt, because automatic retries are intentionally disabled. Invalid/missing/internal customer addresses remain pending for that same monitor; no customer warning is redirected internally.

The deterministic renderer verifies one matching external recipient, supported/current status, first attempt and tracking number. It escapes customer/order text and limits tracking links to official DHL/DPD HTTPS hosts. Costs are described without claiming a specific customer debt, amount or return deadline. Returning/returned states have distinct truthful actions.

The workflow builder patches only Build Shipping Notification Emails. It derives the new rendering function and signature from the TypeScript source to keep the n8n/API text identical. Existing sender nodes, credential references, connections, schedule and activation state are unchanged. The existing internal branch remains available only for the unchanged pickup-validation fallback.

## Checks

- 33 shipping/renderer tests passed, including n8n/API parity, unchanged pickup HTML, recipient rejection, HTML escaping, link checks and complete workflow-diff equality.
- 5 shipping/installation route tests passed.
- Existing isolated PostgreSQL harness: 45 tests passed; targeted rollback checks also pass, including a new guard preventing the restored internal template from consuming customer-addressed rows.
- TypeScript and production Next build passed.
- n8n validation: zero errors; the same five pre-existing warnings as the live workflow.
- HTML preview visually checked: correct Mika photograph and NEONTRIP logo load; full text and signature render.
- No live migration, workflow write/publish, manual workflow execution or customer canary.

## Release after exact commit approval

1. Run codex-predeploy ops from the clean task worktree; HEAD must equal the approved SHA and contain current origin/main. Use codex-safe-push-main; verify the deployed application commit separately.
2. Re-read the complete n8n draft/active version, activation and the three SQL function definitions/privileges. Compare to captured baseline; stop and reconcile any drift.
3. Ensure there is no in-flight notification execution and enough time before the next hourly :07 schedule. Do not replay the prior execution.
4. Generate the candidate with scripts/build_shipping_customer_warning_workflow.mjs using the verified active graph. Update only node build-shipping-notification-emails.parameters.jsCode. Compare the entire resulting graph, then publish with activation preserved.
5. Immediately apply only 20261109121935_shipping_customer_delivery_warning.sql before the next scheduled run. The renderer is deployed first because it rejects legacy internal recipients; DB-first would temporarily allow the old template to send internally.
6. Verify all function definitions/permissions, the one-node workflow diff and active version by readback. Observe the next natural qualifying incident. Correlate execution, DB recipient/notification key, and Outlook Sent Items; a green execution alone is insufficient.
7. If a run overlaps the cutover or sending becomes uncertain, reconcile its exact notification and provider state manually. Never reset attempts or replay automatically.

## Rollback

Use the captured workflow baseline and supabase/rollbacks/20261109121935_shipping_customer_delivery_warning.sql only during a controlled no-execution window. The SQL restores prior functions with one intentional safety guard: the old internal template cannot claim customer-addressed delivery-warning rows created during this release. Such rows retain their status/attempts for manual reconciliation. Never delete history or reset sent/uncertain notifications. Revert application source through the normal exact-commit release gate. Already sent customer messages cannot be recalled by rollback.
