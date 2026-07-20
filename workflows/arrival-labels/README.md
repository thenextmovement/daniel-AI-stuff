# NEONTRIP DHL Arrival Labels (inactive dry-run workflow)

This workflow schedules the tested Ops arrival-label service. It deliberately contains no matching, EasyDPD, or PDF business logic.

## Build and check

```bash
node workflows/arrival-labels/build-workflow.mjs
node workflows/arrival-labels/test-workflow.mjs
```

The default schedule is `0 7 * * *` in `Europe/Berlin`. Set `ARRIVAL_LABEL_CRON` while building to generate another five-field cron expression.

Runtime secrets stay in n8n environment variables:

- `NEONTRIP_OPS_BASE_URL` (HTTPS)
- `ARRIVAL_LABEL_AGENT_API_TOKEN` (at least 24 characters)

The generated workflow is inactive and always sends `mode=dry_run` and `persist=false`. It must not be activated until the Ops API deployment, real read-only dry run, and review are complete. Deactivation is the immediate workflow rollback.
