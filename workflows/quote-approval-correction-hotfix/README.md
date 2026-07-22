# Quote approval correction hotfix (2026-07-22)

## Symptom

n8n execution `3421843` failed in workflow `7AvW1d4JBNDFuNsv` at node
`Correction: Pending Approval`. PostgREST returned `42703` because the node
selected `quote_approvals.correlation_id`.

## Evidence and root cause

The production `public.quote_approvals` table has 15 columns. It contains
`card_id`, `change_log`, and `status`, but no `correlation_id`. The affected
pending row has a `quote_analysis` entry with the stable ID
`quote_analysis_v1:6a60a87c27f3ef05347e1113`, so the downstream code does not
need a row-level `correlation_id` for this execution.

The active correction branch was published after the last stored full-workflow
backup and introduced a REST `select` list that did not match the production
schema.

## Minimal production diff

Only `parameters.url` on node `corrApproval` changes:

```diff
- &select=card_id,change_log,status,correlation_id
+ &select=card_id,change_log,status
```

The exact observed pre-change value and the forward/reverse patches are stored
in `hotfix.json`. No database schema, credentials, connections, triggers, or
customer-visible actions change.

## QA plan

1. Run `node workflows/quote-approval-correction-hotfix/test-hotfix.mjs`.
2. Run the n8n partial update with `validateOnly: true`.
3. Confirm the node URL still filters by `card_id` and `status=pending` and now
   selects only columns present in the production schema.
4. Apply the atomic patch and validate the workflow with the runtime profile.
5. Run a read-only equivalent SQL query for the incident card and confirm one
   pending row with a `quote_analysis` entry is returned.
6. Confirm no new execution fails with Postgres error `42703` on this node.

Replaying execution `3421843` is not part of the hotfix because its trigger was
a Trello move event and the correction write is designed to be idempotent via
the stable `quote_correction_v1:<card>:<analysis>` entry ID.

## Rollback

Patch the same node field atomically in reverse using the values in
`hotfix.json`. n8n workflow backup version `664` contains the exact active
pre-change workflow and is the full-workflow rollback target if a node-level
rollback is insufficient.
