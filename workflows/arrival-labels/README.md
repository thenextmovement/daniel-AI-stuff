# NEONTRIP DHL Arrival Labels (inactive guarded workflows)

These workflows invoke the tested Ops arrival-label service. One reacts to allowlisted DHL Outlook emails every minute, one performs the daily reconciliation, and one drains the deduplicated internal review-mail outbox. They deliberately contain no matching, EasyDPD, Shopify-mutation, PDF, or printing business logic.

## Build and check

```bash
node workflows/arrival-labels/build-workflow.mjs
node workflows/arrival-labels/test-workflow.mjs
```

The default schedule is `0 7 * * *` in `Europe/Berlin`. Set `ARRIVAL_LABEL_CRON` while building to generate another five-field cron expression.

Runtime secrets stay in n8n environment variables:

- `NEONTRIP_OPS_BASE_URL` (HTTPS)
- `ARRIVAL_LABEL_AGENT_API_TOKEN` (at least 24 characters)

All generated workflows are inactive. The two detector workflows send `mode=dry_run` and `persist=true`: persistence is limited to audited case decisions, events and review-mail outbox entries; it does not authorize carrier purchase or printing. The mail worker sends deterministic plain text only to `info@neontrip.de`, marks dispatch before Outlook, and never automatically resends an uncertain dispatch. They must not be activated until the Ops API deployment, database migration, shadow run and operator review are complete. Deactivation is the immediate workflow rollback.
