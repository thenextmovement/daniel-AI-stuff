# Automation Safety Review

Review scope: inactive DHL-arrival dry-run service, fail-closed Shopify special-case gate, additive Postgres schema, deterministic internal review-mail outbox, generated Outlook/daily/mail-worker n8n orchestrators, PDF processor, authenticated print spool and local CUPS worker. Production disposition: **NO-GO for label creation or physical printing; GO for code review, fixtures and read-only validation**.

| Dimension | Score (1–5) | Evidence and residual risk |
| --- | ---: | --- |
| Correctness | 4 | Full-number DHL extraction, six-digit overlay, exact Trello order references, strict customer fallback, exact offer-note/custom-attribute gate, pickup wording and reference protection are tested. Real DHL templates and a real EasyDPD PDF still require contract fixtures. |
| Reliability | 4 | Bounded retries/backoff, timeouts, Berlin timezone, separate event/reconciliation triggers and fail-closed errors. Expired pre-dispatch claims can be recovered; exhausted attempts and every post-dispatch uncertainty require review. Real CUPS completion retention still needs a physical shadow test. |
| Idempotency | 5 | Application key and DB uniqueness use Shopify order ID plus full DHL number; review-mail keys include the blocked input snapshot; one print job per annotated artifact; row leases; uncertainty after mail or print `dispatching` is manual review, never automatic resend/reprint. EasyDPD must later accept or emulate the carrier idempotency contract. |
| Observability | 4 | Correlation ID, run/case/print/review-mail state, immutable per-run snapshot, append-only events, n8n mail-dispatch receipt, CUPS job ID, structured report, PDF SHA/QA artifacts. Printer telemetry and a witnessed Outlook shadow run still await setup. |
| Security | 4 | Separate constant-time API tokens, bounded JSON/PDF streams, fixed review recipient, deterministic plain text, trusted Shopify admin URL construction, untrusted-link removal, path/identifier allowlists, worker identity checks, RLS/service-role-only grants, private storage, optional scoped Cloudflare Access service token, hardened unprivileged systemd worker and no public printer ingress. The physical host and credential rotation still require local admin setup. |
| Tracking Impact | 5 | No analytics, fulfillment or customer tracking writes; existing DPD tracking blocks creation. Tracking impact remains zero in dry-run. |
| Cost Risk | 5 | No label-buying adapter exists, write flag defaults false, and n8n cannot call the carrier or printer. The only designed external side effect is an internal fixed-recipient review mail. Future EasyDPD test labels require an explicit capped sandbox/cost plan. |

## Blocking findings before writes

- No documented EasyDPD endpoint/auth/idempotency/error contract is available.
- No confirmed mapping exists for standard, Express/Eil and the 09:00/12:00/DPD Express 12:00/18:00 choices.
- The reference EasyDPD PDF could not be downloaded through an approved API; PDF QA currently uses a synthetic A6 fixture.
- The migration is un-applied and the n8n workflow is unimported/inactive.
- No CUPS tools or printer are configured on the current host; printer queue, media keyword and physical scan test are unverified.
- It is not yet confirmed whether EasyDPD itself owns Shopify fulfillment/tracking writes; a second writer is prohibited.
- A real service-driven read-only run after deployment has not yet been operator-approved.
- The new review-mail outbox has not been applied to a disposable database or shadow-tested with Outlook; its workflow remains inactive.

No blocker may be bypassed by browser automation, direct printer exposure, manual database requeue or by setting the environment flag alone.
