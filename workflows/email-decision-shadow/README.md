# AI email decision shadow

This phase compares three recommendations without changing customer-facing behavior:

- `draft`
- `no_reply`
- `human_review`

## Architecture

The production draft agent keeps its existing `Normalize Email -> Should Process
Email?` edge. A second parallel edge asynchronously dispatches the same normalized
record to a six-node subworkflow.

The subworkflow:

1. validates and normalizes the input;
2. applies deterministic rules for automated, internal, stale, acknowledgement-only,
   high-risk, and prompt-injection cases; trusted WhatsApp, offer-chat, and form
   relays are recognized as customer channels and can never be suppressed merely
   because Outlook shows `support@neontrip.de` as the technical sender;
3. calls AI only for the remaining ambiguous messages;
4. requires strict JSON and validates enums, confidence, reasons, and risk flags;
5. falls back to `human_review` for invalid, risky, low-confidence, or unsafe
   `no_reply` results;
6. records the result in a service-role-only Supabase table.

The shadow workflow cannot create, send, or modify an Outlook message.

## Tests

```bash
node workflows/email-decision-shadow/build-workflows.mjs
node workflows/email-decision-shadow/test-workflows.mjs
```

To create a patched production payload after the shadow workflow has a concrete ID:

```bash
node workflows/email-decision-shadow/build-workflows.mjs \
  /path/to/current-draft-agent.json SHADOW_WORKFLOW_ID
```

## Rollout

1. Apply `20260716134044_email_agent_decision_shadow.sql`.
2. Create the decision shadow workflow inactive.
3. Test deterministic, AI, invalid-JSON, risk, and database paths.
4. Add the parallel async dispatch to the draft agent.
5. Observe at least 50 decisions before any decision becomes action-driving.
6. Keep relayed customer channels fail-closed as `human_review` whenever upstream
   metadata still contains `internal_sender`.

## Rollback

1. Restore inactive decision-shadow backup `fWnzumazKbvKDDa7` to production
   workflow `LvXVkIhWZH0w0Y1x` if the Relay-v2 classifier must be reverted.
2. Restore inactive main-agent backup `YD9HBDt2WvW4TBDj` to the production draft
   workflow ID only if the whole shadow dispatch must be removed.
3. Deactivate the decision shadow workflow.
4. Optionally apply
   `20260716134044_email_agent_decision_shadow_rollback.sql`.
