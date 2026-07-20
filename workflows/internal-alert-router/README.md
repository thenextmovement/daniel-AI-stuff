# Internal alert consolidation

This bundle introduces a deterministic shadow router for internal n8n failures without changing the current email delivery path.

## Scope

- Router workflow ID: `SH5HK6TqLCyaitXu`
- Adapter 1: `M4uG1HAtN9Zggxww`
- Adapter 2: `ArT3LN25Mb1PAuBE`
- Existing Outlook nodes remain enabled during shadow operation.
- The disconnected, disabled `Send Error Email (Fallback)` node is removed from adapter 1; it had no execution path.
- The router sends no email and invokes no AI model.
- n8n requires referenced sub-workflows to be published. The live router is therefore published but passive; Execute Sub-workflow is its only trigger.
- Repeated failures are upserted into the existing Company Brain incident store by a stable fingerprint.
- Error text is redacted before it is stored. The fingerprint normalizes execution IDs, URLs, email addresses, phone numbers, UUIDs, long numbers, and token-like values.

## Rollout

1. Preserve the published handler graphs and the inactive reviewer draft in `source/`.
2. Replace the inactive reviewer draft with the deterministic router, validate it, and publish the passive sub-workflow.
3. Add one failure-isolated shadow branch to each live error handler. Do not remove or disable Outlook delivery.
4. Backtest the deterministic fingerprint and cooldown policy against 30 days of Outlook history.
5. Run one live smoke test with a real source failure and confirm the Company Brain incident.
6. Before disabling the legacy nodes, add a deterministic notification path that sends the first occurrence immediately, keeps critical business alerts unchanged, and suppresses only repeated fingerprints inside the approved cooldown.

## Generate and test

```bash
node workflows/internal-alert-router/build-workflows.mjs
node workflows/internal-alert-router/test-workflows.mjs
```

## Rollback

The live handlers have no n8n MCP version history. Rollback therefore uses the full JSON snapshots in `source/`:

- `error-notification-info-active-before-20260720.json`
- `neontrip-error-alerting-active-before-20260720.json`
- `neontrip-error-alerting-active-before-workflow-id-hotfix-20260720.json`
- `ai-alert-reviewer-draft-before-20260720.json`

Apply the original `name`, `nodes`, `connections`, and `settings` with a full workflow update. Do not change any of the 56 source workflows during this phase.
