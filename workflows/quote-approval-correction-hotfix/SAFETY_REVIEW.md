# Safety review

## Findings

- High (fixed by this patch): the correction read referenced a column that does
  not exist and stopped the workflow before any correction record was written.
- Medium (pre-existing): the active workflow has 30 nodes, the allowed maximum,
  and the correction learning branch has no dedicated external-call error path.
- Medium (pre-existing): the error execution has no workflow correlation ID in
  its database row; observability relies on execution ID, card ID, Trello action
  ID, and the `quote_analysis` ID inside `change_log`.
- Low: replay must remain deliberate because the trigger is a historical Trello
  move event. The correction entry itself has a deterministic ID and checks for
  duplicates before writing.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | The selected columns match the live schema. |
| reliability | 4 | Atomic one-field patch; broader error-path limitation is unchanged. |
| idempotency | 5 | No side-effect logic changes; stable correction entry ID remains. |
| observability | 3 | No dedicated row-level correlation column; existing IDs are sufficient for this incident but should be normalized later. |
| security | 5 | No credential, role, RLS, or secret change. |
| tracking impact | 5 | No analytics or attribution surface changes. |
| cost risk | 5 | The REST response becomes smaller; no new calls are introduced. |

## Required fixes

- Apply the one-field patch only after repository test, n8n dry-run, safe main
  push, and the mandatory Ops predeploy gate.
- Validate the active workflow after the patch.

## QA plan

See `README.md`.

## Rollback

Use the exact reverse patch in `hotfix.json`; workflow version `635` is the
broader fallback if a node-level rollback is insufficient.
