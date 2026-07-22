# NEONTRIP DHL Arrival Labels (inactive guarded workflows)

These workflows invoke the tested Ops arrival-label service. One reacts to allowlisted DHL Outlook emails every minute, one performs the daily reconciliation, one drains the deduplicated internal review-mail outbox, and one drains the exact-message Outlook archive outbox after a confirmed shipping-label print. They deliberately contain no matching, EasyDPD, Shopify-mutation, PDF, or printing business logic.

For installations that do not use the paid n8n mail trigger, `deploy/local-arrival-label-scheduler` provides a macOS LaunchAgent. It calls the same authenticated endpoint every five minutes using `trigger_type=local_schedule`, reads secrets from Keychain and keeps the Mac outbound-only. The local schedule is an alternative trigger, not a second source of business logic.

## Build and check

```bash
node workflows/arrival-labels/build-workflow.mjs
node workflows/arrival-labels/test-workflow.mjs
```

The default schedule is `0 7 * * *` in `Europe/Berlin`. Set `ARRIVAL_LABEL_CRON` while building to generate another five-field cron expression.

Runtime secrets stay in n8n environment variables:

- `NEONTRIP_OPS_BASE_URL` (HTTPS)
- `ARRIVAL_LABEL_AGENT_API_TOKEN` (at least 24 characters)
- `ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID` (dedicated Cloudflare Access service-token ID; archive worker only)
- `ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET` (dedicated Cloudflare Access service-token secret; archive worker only)

All generated workflows are inactive. The two detector workflows send `mode=dry_run` and `persist=true`: persistence is limited to audited case decisions, events and review-mail outbox entries; it does not authorize carrier purchase or printing. The mail worker sends deterministic plain text only to `info@neontrip.de`, marks dispatch before Outlook, and never automatically resends an uncertain dispatch. The Outlook archive worker first performs a bounded, retryable read-only `GET /api/health`, then invokes one server-side outbox item per minute with a single-attempt POST. The server revalidates the exact message ID, allowlisted DHL sender and full tracking number before a single move to the Archive folder. It also requires Microsoft Graph application permission `Mail.ReadWrite` and the fail-closed database archive setting to be enabled with a current activation timestamp. Deactivation plus disabling the archive setting is the immediate archive rollback; production workflow version 593 is the pre-v0.6 graph rollback point.
