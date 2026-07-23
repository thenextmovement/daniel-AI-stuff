# NEONTRIP DHL Arrival Labels (guarded workflows)

These workflows invoke the tested Ops arrival-label service. One reacts to allowlisted DHL Outlook emails every minute, one performs the daily reconciliation, one drains the deduplicated internal review-mail outbox, and one finalizes a printed delivery by first draining the exact-message Outlook archive outbox and then the gated Quentin `Sign Arrived` projection outbox. They deliberately contain no matching, EasyDPD, Shopify-mutation, PDF, or printing business logic.

For installations that do not use the paid n8n mail trigger, `deploy/local-arrival-label-scheduler` provides a macOS LaunchAgent. It calls the same authenticated endpoint every five minutes using `trigger_type=local_schedule`, reads secrets from Keychain and keeps the Mac outbound-only. The local schedule is an alternative trigger, not a second source of business logic.

## Build and check

```bash
node workflows/arrival-labels/build-workflow.mjs
node workflows/arrival-labels/test-workflow.mjs
```

The default schedule is `0 7 * * *` in `Europe/Berlin`. Set `ARRIVAL_LABEL_CRON` while building to generate another five-field cron expression.

The arrival-finalizer and internal-review workers use the encrypted n8n custom-auth credential `NEONTRIP Ops Archive Worker`, which carries both Cloudflare Access headers and the Ops bearer. Their Code nodes never receive secrets. The older inactive detector drafts still reference these environment variables:

- `NEONTRIP_OPS_BASE_URL` (HTTPS)
- `ARRIVAL_LABEL_AGENT_API_TOKEN` (at least 24 characters)
- `ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID`
- `ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET`

Generated files remain inactive release candidates until backed up, validated and activated in n8n. The two detector drafts send `mode=dry_run` and `persist=true`: persistence is limited to audited case decisions, events and review-mail outbox entries; it does not authorize carrier purchase or printing. The mail worker sends deterministic plain text only to `info@neontrip.de`, marks dispatch before Outlook, and never automatically resends an uncertain dispatch.

The v0.7 arrival finalizer first performs a bounded, retryable read-only `GET /api/health`, then invokes one exact Outlook archive item and one Trello arrival projection item per minute. Both processor POSTs are single-attempt. The server revalidates the exact Outlook message ID, allowlisted DHL sender and full tracking number before one Archive move. Only after all exact messages of a printed, delivered case are archived can the Trello worker revalidate the exact Quentin card, board, `Sign SHIPPED (NEON TRIP)` source, `Sign Arrived` target and full DHL number, then move the card once with `pos=top`. It requires Microsoft Graph application permission `Mail.ReadWrite`, Trello credentials, and separate fail-closed database settings with current activation timestamps. Immediate rollback is deactivation plus disabling the Trello-arrival setting; disable the Outlook archive setting too only if email archival itself must stop.
