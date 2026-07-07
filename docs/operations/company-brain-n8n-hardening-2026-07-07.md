# Company Brain n8n hardening - 2026-07-07

This note records the production n8n state for `NEONTRIP Quote Ready SIMPLE v1.1`.

## Workflow

- n8n workflow ID: `X5etVW0msgSzHMMG`
- Runtime status: active
- Validation after latest check: valid
- Current validation summary: 64 nodes, 2 trigger nodes, 0 errors, 18 warnings
- Latest version after repair: `502`
- Last known good pre-cleanup version: `500`

## Changes made

1. `Evaluate Guard` was changed to fail closed when the send guard is unavailable or returns an invalid response.
2. `Skip: Guard Blocked` now emits structured diagnostic fields such as status, action, retry safety, request/card identifiers, idempotency key, and customer-communication flag.
3. Three low-risk technical nodes were tightened away from deprecated `continueOnFail: true`:
   - `Wait 2 Minutes`
   - `WhatsApp Skip (kein Telefon)`
   - `WhatsApp Fertig`

No offer retry, customer email, Trello resend, or workflow execution was manually triggered during these changes.

## Important MCP limitation found

The incremental update MCP can set `onError`, but the tested `updateNode` path did not delete the existing top-level `continueOnFail` property. Using both fields made workflow validation fail. The workflow was repaired by removing `onError` again on the affected nodes and leaving `continueOnFail: false`.

Do not bulk-convert remaining `continueOnFail` warnings through this MCP path unless the field deletion behavior is proven first with a non-production workflow or a full JSON backup/restore plan.

## Remaining risks

- The workflow violates the NEONTRIP production shape rule: one trigger and max 30 nodes.
- It still has 18 warnings, mostly deprecated `continueOnFail: true`.
- Customer-visible paths still need a broader split into smaller sub-workflows.
- Structured audit logging should be written for every blocked or failed send path into `workflow_audit_log`.
- Trello must remain projection only; it must not become the retry source of truth.

## Safe next steps

1. Export or retrieve a full workflow JSON backup before structural work.
2. Split the workflow into smaller workflows:
   - Trello intake/projection
   - source-of-truth lookup and guard
   - offer email send
   - WhatsApp follow-up
   - error/audit logging
3. Add durable workflow-audit writes for guard-blocked and send-failed paths before any Trello status projection.
4. Replace remaining `continueOnFail` only when each branch has an explicit error contract and validation proves no mixed `continueOnFail`/`onError` state.

## Rollback

If the latest n8n change causes unexpected behavior, restore from n8n version history to version `500` in the n8n UI, or reapply the full JSON backup captured before any follow-up structural split. The MCP rollback path returned `n8n API not configured` during this check, so do not rely on MCP rollback as the only recovery path.
