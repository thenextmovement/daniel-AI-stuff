# NEONTRIP DHL Arrival Labels (inactive dry-run workflow)

These workflows invoke the tested Ops arrival-label service. One reacts to allowlisted DHL Outlook emails every minute; the other performs the daily reconciliation. They deliberately contain no matching, EasyDPD, Shopify-mutation, PDF, or printing business logic.

## Build and check

```bash
node workflows/arrival-labels/build-workflow.mjs
node workflows/arrival-labels/test-workflow.mjs
```

The default schedule is `0 7 * * *` in `Europe/Berlin`. Set `ARRIVAL_LABEL_CRON` while building to generate another five-field cron expression.

Runtime secrets stay in n8n environment variables:

- `NEONTRIP_OPS_BASE_URL` (HTTPS)
- `ARRIVAL_LABEL_AGENT_API_TOKEN` (at least 24 characters)

Both generated workflows are inactive and always send `mode=dry_run` and `persist=false`. They must not be activated until the Ops API deployment, real read-only dry run, and review are complete. Deactivation is the immediate workflow rollback.
