# Automation Safety Review

Review scope: DHL-arrival decision service, fail-closed Shopify/Trello/country gates, Postgres source of truth, EasyDPD browser purchase worker, six-digit A6 PDF processing, price-free EU A4 delivery notes, separate local CUPS workers, deterministic internal review mail and exact-message Outlook archive after confirmed label print. Production disposition on 2026-07-22: **CONDITIONAL GO for a guarded live rollout**. The committed migration stages approved products and the EUR 15 cap with both purchase switches still false. Execute mode may be enabled only after the exact deployed commit, production migration, Keychain-backed workers, dedicated Shopify/easyDPD profile self-test and one observed canary are green. If any gate fails, the switches remain off; there is no partial GO.

| Dimension | Score (1–5) | Evidence and residual risk |
| --- | ---: | --- |
| Correctness | 5 | 670 tests pass. Full DHL number, six-digit overlay, exact Shopify/Trello matching, payment-status audit-only policy, manual-list/note/pickup/country blocks, approved EasyDPD products, EU A4-before-label gate and replay-preserved terminal state are enforced. A real 2026-07-22 EasyDPD A6 PDF was annotated/rendered with no protected-area overlap; a generated EU A4 page was visually checked and contains no price fields. |
| Reliability | 4 | Bounded pre-dispatch retries, timeouts, Berlin timezone, locks and fail-closed errors are present. Purchase, print, mail and archive all persist `dispatching` before the external side effect; every later uncertainty is manual review and never blindly retried. Both real CUPS queues advertise the approved media and retain completed-job evidence. The remaining external dependency is the dedicated Shopify session and the first live canary. |
| Idempotency | 5 | Application key and DB uniqueness use Shopify order ID plus full DHL number; review-mail keys include the blocked input snapshot; one print job per annotated artifact; Outlook archive uniqueness uses case plus hashed exact Graph message ID; row leases; uncertainty after mail, print or Outlook-move `dispatching` is manual review, never automatic resend/reprint/removal. EasyDPD must later accept or emulate the carrier idempotency contract. |
| Observability | 5 | Postgres records run/case/browser/print/review/archive state, immutable run snapshots, events, hashes, tracking, CUPS job IDs, Outlook receipts and QA metadata. Local plists contain no secrets; logs are bounded. Shopify timeline evidence confirms the EasyDPD fulfillment and customer shipping-confirmation mail for the verified 2026-07-22 label. |
| Security | 4 | Separate constant-time API tokens, bounded JSON/PDF/Graph responses, exact Graph message ID, sender-domain and full-tracking revalidation, fixed review recipient, deterministic plain text, trusted Shopify admin URL construction, untrusted-link removal, path/identifier allowlists, worker identity checks, RLS/service-role-only grants, private storage, optional scoped Cloudflare Access service token, hardened unprivileged systemd worker and no public printer ingress. The macOS scheduler accepts only the exact allowlisted HTTPS run path, has a separate credential that is not accepted by review/archive endpoints, and reads it from Keychain; no inbound port is opened. The physical host, Graph `Mail.ReadWrite` consent and credential rotation still require local admin setup. |
| Tracking Impact | 5 | No analytics, fulfillment or customer tracking writes; existing DPD tracking blocks creation. Tracking impact remains zero in dry-run. |
| Cost Risk | 3 | Daniel approved purchases up to EUR 15.00. Database and worker cap every approved product at 1,500 cents, but EasyDPD exposes no machine-readable pre-click price; the system must not claim an observed price. This accepted residual risk is bounded by the human-approved product mapping and can be stopped instantly through the database switches. |

## Mandatory runtime gates before writes

- Deploy only the exact commit printed by `codex-predeploy ops` and verify `/api/health` reports it.
- Apply `20260722154500_prepare_arrival_label_live_configuration.sql`; verify it leaves both browser switches false. Its PostgreSQL 17 apply/rollback/reapply and SQL behavior suite must remain green.
- Store the dedicated print token only in GitHub Secrets/Coolify and macOS Keychain. Install both local workers only from clean exact `origin/main`; both no-page CUPS self-tests must pass.
- Complete `setup-session` and `self-test` in the dedicated EasyDPD profile. Login redirect, CAPTCHA, changed UI or missing frame is a hard stop.
- Import/validate the eight-node review-mail candidate, keep the Outlook send single-attempt, then activate it with a recorded workflow ID/version. Archive v0.6 must remain active and healthy.
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
3. Disable the internal review-mail workflow and archive workflow if their worker path is implicated.
4. Set `ARRIVAL_LABEL_WRITES_ENABLED=false` through the restricted Coolify workflow and revoke the print/browser/scheduler tokens as required.
5. Reconcile every `dispatching`, `submitted`, `purchased` or `manual_review` row against EasyDPD, CUPS, Shopify and Outlook before any manual state change. Never requeue an uncertain side effect.
6. Use `supabase/rollbacks/20260722154500_prepare_arrival_label_live_configuration_rollback.sql` to disable the staged mapping and remove only the new guard functions. It retains operational jobs and audit evidence.
