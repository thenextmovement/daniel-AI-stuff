# Company Brain n8n hardening - 2026-07-07

This note records the production n8n state for `NEONTRIP Quote Ready SIMPLE v1.1`.

## Workflow

- n8n workflow ID: `X5etVW0msgSzHMMG`
- Runtime status: active
- Validation after latest check: valid
- Current validation summary: 67 nodes, 2 trigger nodes, 0 errors, 18 warnings
- Latest version after audit write hardening: `504`
- Last known good pre-audit version: `502`

## Changes made

1. `Evaluate Guard` was changed to fail closed when the send guard is unavailable or returns an invalid response.
2. `Skip: Guard Blocked` now emits structured diagnostic fields such as status, action, retry safety, request/card identifiers, idempotency key, and customer-communication flag.
3. Three low-risk technical nodes were tightened away from deprecated `continueOnFail: true`:
   - `Wait 2 Minutes`
   - `WhatsApp Skip (kein Telefon)`
   - `WhatsApp Fertig`
4. `Audit: Guard Blocked` was added after `Skip: Guard Blocked`. It writes an audit-only, idempotent row to `workflow_audit_log` through the existing Supabase credential. It does not send customer communication.
5. `Build Audit: AI Copy Blocked` and `Audit: AI Copy Blocked` were added on the `Final Block? = true` path. If both AI mail-generation attempts still contain blocked words, the workflow writes a structured `ai_customer_copy_blocked` audit row before leaving the manual/Trello hard-block path.
6. The two new audit HTTP nodes use `onError: "continueRegularOutput"` with `continueOnFail` removed, so they do not add deprecated-warning debt.

No offer retry, customer email, Trello resend, or workflow execution was manually triggered during these changes.

## Workflow audit contract

The internal endpoint `/api/internal/workflow-audit` accepts direct n8n guard-blocked payloads in snake_case as well as the app's camelCase shape. This lets n8n post the output from `Skip: Guard Blocked` without brittle field mapping.

Minimum blocked-send payload:

```json
{
  "workflow_name": "NEONTRIP Quote Ready SIMPLE v1.1",
  "action": "offer_send",
  "status": "blocked",
  "reason": "send_guard_unavailable: invalid_guard_response",
  "retry_safety": "blocked",
  "request_id": "REQ-...",
  "card_id": "trello-card-id",
  "card_url": "https://trello.com/c/...",
  "document_id": "REQ-...",
  "failed_node": "Evaluate Guard",
  "idempotency_key": "quote-ready-guard-block:...",
  "correlation_id": "trello:...:quote-ready",
  "action_id": "trello-action-id",
  "customer_communication_sent": false
}
```

The endpoint derives `automation_issue_key`, `automation_issue_root_cause`, retry safety, duplicate `audit_event_key`, and stores the event in `workflow_audit_log`. It returns `customerCommunicationSent: false`.

The production n8n workflow currently writes two audit-only paths directly into `workflow_audit_log` with deterministic `id` values and `metadata.audit_event_key`:

- send guard blocked/unavailable: `send_guard_unavailable`
- AI customer copy hard-blocked after retry: `ai_customer_copy_blocked`

## Important MCP limitation found

The incremental update MCP can set `onError`, but one earlier tested `updateNode` path left the existing top-level `continueOnFail` property in place. Using both fields made workflow validation fail. The workflow was repaired by removing `onError` again on the affected nodes and leaving `continueOnFail: false`.

For the two newly added audit nodes, the safe deletion path was verified: set `continueOnFail: null` and `onError: "continueRegularOutput"` in the same `updateNode` operation, validate first, then apply. Do not bulk-convert remaining `continueOnFail` warnings unless each node's branch semantics are reviewed and validation proves no mixed `continueOnFail`/`onError` state.

## Remaining risks

- The workflow violates the NEONTRIP production shape rule: one trigger and max 30 nodes.
- It still has 18 warnings, mostly deprecated `continueOnFail: true`.
- Customer-visible paths still need a broader split into smaller sub-workflows.
- Structured audit logging now covers guard-blocked and AI-copy hard-blocked paths, but not every possible failed send path.
- Trello must remain projection only; it must not become the retry source of truth.

## Safe next steps

1. Export or retrieve a full workflow JSON backup before structural work.
2. Split the workflow into smaller workflows:
   - Trello intake/projection
   - source-of-truth lookup and guard
   - offer email send
   - WhatsApp follow-up
   - error/audit logging
3. Add durable workflow-audit writes for remaining send-failed paths, especially Outlook/Graph delivery failures and hard API errors.
4. Replace remaining `continueOnFail` only when each branch has an explicit error contract and validation proves no mixed `continueOnFail`/`onError` state.

## Rollback

If the latest n8n change causes unexpected behavior, restore from n8n version history to version `502` in the n8n UI for the pre-audit-write state, or version `500` for the earlier pre-cleanup state. Reapply the full JSON backup captured before any follow-up structural split. The MCP rollback path previously returned `n8n API not configured`, so do not rely on MCP rollback as the only recovery path.
