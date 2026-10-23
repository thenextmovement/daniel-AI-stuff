# NEONTRIP customer-requested invoices

Issue #218; PROJ-001; owner Rahim. Customer portal: `https://rechnung.neontrip.de/<private-token>`.
Ops repository: `thenextmovement/daniel-AI-stuff`; Coolify application `zs80848k80oskk0ow0kc0cos`, production branch `main`.

The customer opens the review dialog using the button directly below the invoice email field in Rechnungsversand. The dialog shows the saved invoice address, recipient email, project/VAT references, positions, gross total and current Pro-forma PDF. Opening or closing it has no billing side effect. The customer then explicitly confirms consent version `2026-10-23`. POST `/api/rechnung/[token]/invoice` queues the existing canonical `CREATE_INVOICE` job immediately. Existing minute workers create and send the invoice; payment method, due days and paid state are unchanged. No new workflow or schedule.

The service-role RPC locks the billing case, verifies the viewed revision/timestamp, current finalized Pro-forma, no pending edits/jobs, valid recipient and eligible status. Consent and confirmed invoice inputs are recorded in `billing_events`. Replays reuse the request. `invoice_requested_at` locks editing immediately; database triggers also prevent Ops/automation from rewriting the confirmed financial fields while a worker is using them. Payment recording, status transitions and document finalization remain available.

## Release after explicit approval

1. Re-fetch/review the exact branch and commit. Follow `codex-predeploy ops` / `codex-safe-push-main` and verify the configured Coolify UUID, repository, branch and full SHA.
2. **Apply migration `20261023120000_billing_portal_invoice_request.sql` before deploying the application**, because the portal query selects the new column. This is additive; it does not convert any existing case or enqueue a job.
3. Through n8n MCP, re-fetch workflow `M4uG1HAtN9Zggxww` and apply only `n8n/patches/2026-10-23-portal-invoice-alerts.json`. It changes `Send Prepared Alert Email.parameters.toRecipients`: document worker `u48KZyTcU2J9pw2P`, delivery worker `wqaTsVKuKqKnp2AG`, and their grouped outages go to `support@neontrip.de`. Other recipients, dedupe limits, nodes, credentials and activation stay unchanged. Provider-availability alerts already use support.
4. Verify the deployed health/SHA through Coolify MCP and the application health endpoint. Inspect the portal without clicking the invoice button on a real order. Observe the next explicitly authorized request through job, Easybill document and delivery receipt; do not infer email delivery from a queued job.

## Verification

All development tests use synthetic data; no production mutation or actual document/email was triggered.

- `node --import tsx --test tests/quotes/billing-*.test.ts`
- `npm run build`
- SQL fixture `tests/sql/billing-portal-invoice.test.sql`: disposable PostgreSQL with migrations `20260819170000`, `20260819180000`, `20260821153000`, `20260822130000`, then the new migration. Tests run inside a rollback transaction.
- `node tests/sql/billing-portal-invoice-concurrency.test.mjs`: requires the isolated Docker container `portal-invoice-test-20261023` (or `BILLING_TEST_CONTAINER`), with network mode `none`; tests request/request and both request/edit lock orders.
- Start the built app on loopback port 3218, then `node tests/browser/billing-portal-invoice.mjs`. Customer APIs are mocked and external browser requests blocked. Tests cover button placement, saved review data, no request on opening, unchecked/reset consent, focus containment/Escape, edit/pending guards, stale view, reload, lost response, blocked worker, desktop/mobile and overflow.
- Alert patch validated using n8n MCP `validateOnly`; recipient expression and active worker command/message preparation exercised with synthetic data. Actual email delivery remains a live verification step.

## Operational limits and rollback

If creation/dispatch fails, the request remains locked and existing worker retries/incident alerts apply. Support must reconcile the existing job/document; never create a second invoice or clear the timestamp to retry. An API/network failure is shown as unconfirmed; the client reloads persisted state before a new attempt.

A refund arriving in the brief interval before invoice finalization cannot rewrite confirmed amounts. Its transaction fails safely and must be retried after finalization, when the existing credit-note path applies. This change does not redesign refund/cancellation processing.

Roll back the application first. Keep the additive column, RPC and guards after any consent was recorded; old portal code may show edit controls but database guards still reject edits. The SQL rollback deliberately refuses to remove the lock if any request exists. Before the first request, `supabase/rollbacks/20261023120000_billing_portal_invoice_request_rollback.sql` safely removes the addition. For alert rollback restore only the saved recipient value `info@NeonTrip.de`, after re-fetching the workflow and checking for intervening changes. Never reverse already created invoices or sent mail as part of a code rollback.
