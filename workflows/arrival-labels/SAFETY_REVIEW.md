# Automation Safety Review

Review scope: inactive DHL-arrival dry-run service, fail-closed Shopify and Trello-manual-list gates, additive Postgres schema, deterministic internal review-mail outbox, exact-message Outlook archive outbox, generated Outlook/daily/mail/archive-worker n8n orchestrators, outbound-only macOS LaunchAgent scheduler, PDF processor, authenticated print spool and local CUPS worker. Production disposition: **GO for the local scheduler in `dry_run`; NO-GO for automated label creation, automated physical printing or automatic Outlook moves; GO for code review, fixtures and read-only validation**. The witnessed one-off manual print of the verified existing `#NEONT4498` label is preserved in the batch audit and does not change this disposition.

| Dimension | Score (1–5) | Evidence and residual risk |
| --- | ---: | --- |
| Correctness | 4 | Full-number DHL extraction, six-digit overlay, exact Trello order references, strict customer fallback, explicit manual-list blocking, exact offer-note/custom-attribute gate, pickup wording and reference protection are tested. Real DHL templates, current-versus-stale existing-label evidence and a real EasyDPD PDF still require contract fixtures. |
| Reliability | 4 | Bounded retries/backoff, timeouts, Berlin timezone, separate event/reconciliation triggers and fail-closed errors. The local scheduler has an overlap lock, a 55-second bound and no in-process retry after an ambiguous API result. Expired pre-dispatch claims can be recovered; exhausted attempts and every post-dispatch uncertainty require review. Outlook validation failures cannot reprint a label. Real CUPS completion retention and Outlook move behavior still need witnessed tests. |
| Idempotency | 5 | Application key and DB uniqueness use Shopify order ID plus full DHL number; review-mail keys include the blocked input snapshot; one print job per annotated artifact; Outlook archive uniqueness uses case plus hashed exact Graph message ID; row leases; uncertainty after mail, print or Outlook-move `dispatching` is manual review, never automatic resend/reprint/removal. EasyDPD must later accept or emulate the carrier idempotency contract. |
| Observability | 4 | Correlation ID, audited `local_schedule` trigger, run/case/print/review-mail/archive-job state, immutable per-run snapshot, append-only events, n8n mail-dispatch receipt, CUPS job ID, Outlook moved-message receipt, structured report and PDF SHA/QA artifacts. Local logs contain only IDs/counts and errors, never case PII or tokens. Printer telemetry and a witnessed Outlook shadow run still await setup. |
| Security | 4 | Separate constant-time API tokens, bounded JSON/PDF/Graph responses, exact Graph message ID, sender-domain and full-tracking revalidation, fixed review recipient, deterministic plain text, trusted Shopify admin URL construction, untrusted-link removal, path/identifier allowlists, worker identity checks, RLS/service-role-only grants, private storage, optional scoped Cloudflare Access service token, hardened unprivileged systemd worker and no public printer ingress. The macOS scheduler accepts only the exact allowlisted HTTPS API path and reads secrets from Keychain; no inbound port is opened. The physical host, Graph `Mail.ReadWrite` consent and credential rotation still require local admin setup. |
| Tracking Impact | 5 | No analytics, fulfillment or customer tracking writes; existing DPD tracking blocks creation. Tracking impact remains zero in dry-run. |
| Cost Risk | 5 | No label-buying adapter exists, write flag defaults false, and n8n cannot call the carrier or printer. The only designed external side effect is an internal fixed-recipient review mail. Future EasyDPD test labels require an explicit capped sandbox/cost plan. |

## Blocking findings before writes

- No documented EasyDPD endpoint/auth/idempotency/error contract is available.
- No confirmed mapping exists for standard, Express/Eil and the 09:00/12:00/DPD Express 12:00/18:00 choices.
- The reference EasyDPD PDF could not be downloaded through an approved API; PDF QA currently uses a synthetic A6 fixture.
- The migration is un-applied and the n8n workflow is unimported/inactive.
- No CUPS tools or printer are configured on the current host; printer queue, media keyword and physical scan test are unverified.
- It is not yet confirmed whether EasyDPD itself owns Shopify fulfillment/tracking writes; a second writer is prohibited.
- Existing Shopify or DPD tracking blocks a second purchase but does not prove that its PDF is current, unused or printable. The future adapter needs explicit freshness/usability evidence; stale original-shipment labels stay manual.
- A real service-driven read-only run after deployment has not yet been operator-approved.
- The new review-mail outbox has not been applied to a disposable database or shadow-tested with Outlook; its workflow remains inactive.
- The Outlook archive migration and rollback passed on disposable PostgreSQL 17, including a two-message enqueue and uncertain-move transition, but are unapplied in production; the fail-closed setting defaults to disabled and the generated archive worker remains inactive.
- Microsoft Graph application permission `Mail.ReadWrite`, mailbox scope and admin consent have not been witnessed. `Mail.Read` alone cannot activate the move path.
- A controlled Outlook shadow test must prove that the exact DHL message moves from Inbox to Archive and returns a new Graph message ID before activation.

No blocker may be bypassed by browser automation, direct printer exposure, manual database requeue or by setting the environment flag alone.

## Local schedule release and rollback

- The LaunchAgent defaults to `dry_run` every 300 seconds and is safe to enable after the API deployment, trigger-type migration and dedicated Keychain token are present.
- It copies an exact `origin/main` commit into a versioned runtime directory; installation from a dirty or stale checkout fails closed.
- Execute mode requires the local live gate plus an explicit acknowledgement, and the server independently rejects it until the carrier adapter is released.
- Every plist replacement creates a recoverable backup. `manage_arrival_label_scheduler.mjs rollback` loads the newest previous plist; `uninstall` stops the job and preserves both runtime and plist evidence.
- Emergency stop: unload the LaunchAgent and revoke the dedicated API token. Do not alter uncertain carrier, CUPS, Shopify or Outlook rows to force a retry.
