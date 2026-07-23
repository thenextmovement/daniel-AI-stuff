# Automation Safety Review

Review scope: DHL-arrival decision service, fail-closed Shopify/Trello/country gates, Postgres source of truth, EasyDPD browser purchase worker, six-digit A6 PDF processing, price-free EU A4 delivery notes, separate local CUPS workers, deterministic internal review mail, exact-message Outlook archive after confirmed label print, and the post-archive Quentin `Sign Arrived` projection. Production disposition on 2026-07-23: **CONDITIONAL GO for the separately gated arrival finalizer**. Its migration defaults the new Trello projection to disabled. Activation is permitted only after the exact deployed commit, PostgreSQL-17 apply/rollback/reapply proof, n8n backup/diff, endpoint smoke test and current activation boundary are green. If any gate fails, the Trello setting remains off; there is no partial GO.

Verification snapshot: 708 repository tests, TypeScript, production build, generated-workflow checks and n8n runtime validation are green. The migration additionally passed a real PostgreSQL 17 apply, behavior suite, rollback and re-apply.

| Dimension | Score (1–5) | Evidence and residual risk |
| --- | ---: | --- |
| Correctness | 5 | Full DHL number, six-digit overlay, exact Shopify/Trello matching, payment-status audit-only policy, manual-list/note/pickup/country blocks, approved EasyDPD products, EU A4-before-label gate and replay-preserved terminal state are enforced. The new closeout additionally requires confirmed print, `delivered_today`, complete exact-message archival, exact Quentin board/list/card and `pos=top`. |
| Reliability | 4 | Bounded pre-dispatch retries, timeouts, Berlin timezone, locks and fail-closed errors are present. Purchase, print, mail, archive and Trello projection persist state around each external side effect; every later uncertainty is manual review and never blindly retried. A real delivered-message canary remains the final external proof. |
| Idempotency | 5 | Application key and DB uniqueness use Shopify order ID plus full DHL number; one print job per artifact; Outlook uniqueness uses case plus hashed Graph message ID; the Trello outbox is unique per case. Outlook/Trello uncertainty after `dispatching` is never automatically repeated. |
| Observability | 5 | Postgres records run/case/browser/print/review/archive/Trello-projection state, immutable run snapshots, events, hashes, tracking, CUPS job IDs and external receipts. Trello remains a projection. |
| Security | 4 | Separate constant-time API tokens, bounded responses, exact message/card/list/board identifiers, sender-domain and full-tracking revalidation, path/identifier allowlists, worker identity checks, RLS/service-role-only grants, private storage and no public printer ingress. The physical host, Graph/Trello credential lifecycle and first external canary remain operational dependencies. |
| Tracking Impact | 5 | No analytics, fulfillment or customer tracking writes; existing DPD tracking blocks creation. Tracking impact remains zero in dry-run. |
| Cost Risk | 3 | Daniel approved purchases up to EUR 15.00. Database and worker cap every approved product at 1,500 cents, but EasyDPD exposes no machine-readable pre-click price; the system must not claim an observed price. This accepted residual risk is bounded by the human-approved product mapping and can be stopped instantly through the database switches. |

## Mandatory runtime gates before writes

- Deploy only the exact commit printed by `codex-predeploy ops` and verify `/api/health` reports it.
- Apply `20260722154500_prepare_arrival_label_live_configuration.sql`; verify it leaves both browser switches false. Its PostgreSQL 17 apply/rollback/reapply and SQL behavior suite must remain green.
- Store the dedicated print token only in GitHub Secrets/Coolify and macOS Keychain. Install both local workers only from clean exact `origin/main`; both no-page CUPS self-tests must pass.
- Complete `setup-session` and `self-test` in the dedicated EasyDPD profile. Login redirect, CAPTCHA, changed UI or missing frame is a hard stop.
- Import/validate the review-mail candidate and v0.7 arrival finalizer, keep every external side-effect processor single-attempt, then activate with recorded workflow IDs/versions and current database activation boundaries.
- Enable server writes, browser settings and local execute/live modes only after the preceding gates. First run is a single observed canary; verify EasyDPD PDF, unique DPD tracking, Shopify fulfillment/customer mail, annotated A6, correct CUPS queue and exact Outlook archive before unattended polling continues.
- Switzerland, non-EU, EU special territories, non-standard Shopify notes, pickup wording, manual Trello lists, ambiguous matches, refunded/voided/expired orders and any unknown mapping always remain manual review.

No gate may be bypassed by browser automation, direct printer exposure, manual database requeue or by setting an environment flag alone.

## Local schedule release and rollback

- The LaunchAgent defaults to `dry_run` every 300 seconds and is safe to enable after the API deployment, trigger-type migration and dedicated Keychain token are present.
- It copies an exact `origin/main` commit into a versioned runtime directory; installation from a dirty or stale checkout fails closed.
- Execute mode requires the local live gate plus an explicit acknowledgement, and the server independently rejects it until both database switches and the write gate are enabled.
- Every plist replacement creates a recoverable backup. `manage_arrival_label_scheduler.mjs rollback` loads the newest previous plist; `uninstall` stops the job and preserves both runtime and plist evidence.
- The separate Coolify scheduler token has an explicit secret-sync delete mode; the original n8n agent token is never rotated by scheduler installation.
- Emergency stop: unload the LaunchAgent and revoke the dedicated local/Coolify scheduler token. Do not alter uncertain carrier, CUPS, Shopify or Outlook rows to force a retry.

## Full rollback order

1. Set `live_purchase_enabled=false` and `worker_enabled=false`.
2. Reinstall the scheduler in `dry_run`, uninstall the EasyDPD worker and unload both print LaunchAgents.
3. Disable the internal review-mail workflow and arrival-finalizer workflow if their worker path is implicated; disable the Trello-arrival setting first.
4. Set `ARRIVAL_LABEL_WRITES_ENABLED=false` through the restricted Coolify workflow and revoke the print/browser/scheduler tokens as required.
5. Reconcile every `dispatching`, `submitted`, `purchased` or `manual_review` row against EasyDPD, CUPS, Shopify, Outlook and Trello before any manual state change. Never requeue an uncertain side effect.
6. Use `supabase/rollbacks/20260722154500_prepare_arrival_label_live_configuration_rollback.sql` to disable the staged mapping and remove only the new guard functions. It retains operational jobs and audit evidence.
7. For the delivery closeout itself, first deploy an application version without the new route, preserve audit evidence, then use `supabase/rollbacks/20260723103508_finalize_dhl_delivery_to_trello_sign_arrived_rollback.sql`. It cannot undo external Outlook/Trello changes.
