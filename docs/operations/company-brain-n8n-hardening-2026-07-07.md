# Company Brain n8n hardening - 2026-07-07

This note records the production n8n state for `NEONTRIP Quote Ready SIMPLE v1.1`.

## Workflow

- n8n workflow ID: `X5etVW0msgSzHMMG`
- Runtime status: active
- Validation after latest check: valid
- Current validation summary: 70 nodes, 2 trigger nodes, 0 errors, 18 warnings
- Latest version after audit write hardening: `507`
- Latest version after quote email evidence hardening: `509`
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
7. `Build Audit: Workflow Error`, `Audit: Workflow Error`, and `Restore Workflow Error Context` were added behind the `On Error` trigger. Hard n8n failures now write a structured `workflow_hard_error` audit row by execution ID before the existing internal Outlook error alert is sent.
8. `Log Quote Email` was updated to upsert into `quote_email_log` with `on_conflict=unique_id` and `Prefer: resolution=merge-duplicates,return=minimal`. The payload now includes `request_id`, `offer_id`, `source_event_id`, and `idempotency_key` when the send path reaches that node.

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

The production n8n workflow currently writes three audit-only paths directly into `workflow_audit_log` with deterministic `id` values and `metadata.audit_event_key`:

- send guard blocked/unavailable: `send_guard_unavailable`
- AI customer copy hard-blocked after retry: `ai_customer_copy_blocked`
- hard n8n workflow/API/Outlook failures from the error trigger: `workflow_hard_error`

## Live Outlook / Graph setup

Company Brain already has a read-only Microsoft Graph search path. It stays disabled until all runtime variables are present:

```txt
MICROSOFT_GRAPH_TENANT_ID=
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_GRAPH_MAILBOX=support@neontrip.de
```

Supported aliases are `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `OUTLOOK_SHARED_MAILBOX`, and `OUTLOOK_MAILBOX`. The Azure app needs Microsoft Graph application permission `Mail.Read` for the mailbox. Prefer an Exchange application access policy so the app can read only the operational mailbox. Company Brain only performs read-only message search and maps results into `outlook_graph_live` evidence; it does not send mail through this path.

## Live n8n / Coolify setup

Company Brain reads n8n and Coolify only for diagnostics. It does not change workflows, trigger deploys, or send customer communication through these readiness paths.

```txt
N8N_API_URL=
# or N8N_BASE_URL=
N8N_API_KEY=

COOLIFY_API_URL=
# or COOLIFY_URL=
COOLIFY_API_TOKEN=
COOLIFY_APPLICATION_UUID=
```

`N8N_API_URL` / `COOLIFY_API_URL` may include `/api/v1`; otherwise Company Brain appends it automatically. `COOLIFY_APPLICATION_UUID` is optional and only lets the read-only check confirm the concrete app resource. The UI shows missing variable names but never secret values.

## Supabase security note

Company Brain depends on Supabase/PostgREST source-of-truth tables such as `workflow_audit_log`, `quote_email_log`, customer records, and offer bridge data. Supabase's 2026 platform direction makes explicit Data API grants more important for new `public` tables, while RLS remains a separate row-level protection layer.

Do not blindly enable RLS on legacy tables from an advisor warning. For each table, first classify the access model, add explicit grants if it must be reachable via PostgREST, add matching RLS policies, verify with service-role and non-service-role checks, and keep rollback SQL. Enabling RLS without policies can break production reads/writes.

## Important MCP limitation found

The incremental update MCP can set `onError`, but one earlier tested `updateNode` path left the existing top-level `continueOnFail` property in place. Using both fields made workflow validation fail. The workflow was repaired by removing `onError` again on the affected nodes and leaving `continueOnFail: false`.

For the two newly added audit nodes, the safe deletion path was verified: set `continueOnFail: null` and `onError: "continueRegularOutput"` in the same `updateNode` operation, validate first, then apply. Do not bulk-convert remaining `continueOnFail` warnings unless each node's branch semantics are reviewed and validation proves no mixed `continueOnFail`/`onError` state.

## Remaining risks

- The workflow violates the NEONTRIP production shape rule: one trigger and max 30 nodes.
- It still has 18 warnings, mostly deprecated `continueOnFail: true`.
- Customer-visible paths still need a broader split into smaller sub-workflows.
- Structured audit logging now covers guard-blocked, AI-copy hard-blocked, and hard workflow-error paths, but not every soft failed-send path.
- The `quote_email_log` hardening is saved and validated, but it still needs runtime proof from the next real send-path execution that reaches `Log Quote Email`.
- Trello must remain projection only; it must not become the retry source of truth.

## Safe next steps

1. Export or retrieve a full workflow JSON backup before structural work.
2. Split the workflow into smaller workflows:
   - Trello intake/projection
   - source-of-truth lookup and guard
   - offer email send
   - WhatsApp follow-up
   - error/audit logging
3. Add durable workflow-audit writes for remaining soft failed-send paths, especially delivery-status/bounce outcomes that happen after Graph accepted the send.
4. Replace remaining `continueOnFail` only when each branch has an explicit error contract and validation proves no mixed `continueOnFail`/`onError` state.

## Rollback

If the latest n8n change causes unexpected behavior, restore from n8n version history to version `504` for the pre-workflow-error-audit state, version `502` for the pre-audit-write state, or version `500` for the earlier pre-cleanup state. Reapply the full JSON backup captured before any follow-up structural split. The MCP rollback path previously returned `n8n API not configured`, so do not rely on MCP rollback as the only recovery path.
