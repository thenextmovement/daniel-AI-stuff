# n8n incident fixes — 2026-07-23

This package records the minimal production diffs for three independent n8n
incidents. `workflow-patches.json` is the deployable source of truth and
`test-workflow-patches.mjs` guards the intended safety properties.

## Root causes and fixes

1. `hucy9EMXPblxJsCm` exceeded the Trello API-token interval limit while
   polling every minute and resolving the same board list on every run.
   The patch polls every five minutes, reads the stable list directly, and
   retries only that idempotent GET three times with a 20-second delay.
2. `7AvW1d4JBNDFuNsv` used Telegram `sendPhoto` for all image MIME types.
   Telegram rejected a valid PNG with unsupported photo dimensions. Both image
   branches now use `sendDocument`, preserving the binary, filename, caption,
   credentials, and approval flow without adding nodes to the 30-node workflow.
3. `j3GCBHSxfOW3SP1c` intentionally converted an expired Outlook-draft lease to
   `draft_unknown`, then threw on every later safe stop. Outlook Drafts was
   reviewed for the incident window and contained no draft for the intended
   recipient. The database row remains fail-closed. Repeated `active_lease` and
   `manual_review_required` states now end successfully with structured
   `automaticSendAllowed=false` and `automaticRetryAllowed=false`. A newly
   detected stale/ambiguous draft still throws once and remains observable in
   the Supabase job/event ledger.

## Verified pre-change backups

| Live workflow | Active version before fix | Inactive exact backup |
| --- | --- | --- |
| `hucy9EMXPblxJsCm` | `3b1858a2-c941-4944-9fbe-706812dba635` | `Kmb7tVRnvJkvok8h` |
| `7AvW1d4JBNDFuNsv` | `c80c6190-1124-4939-a95b-07124ce179f7` | `qWLH5BYoKii9nyzl` |
| `j3GCBHSxfOW3SP1c` | `5b515713-2bf9-4952-962a-21bc4f8fcfce` | `yXbmpeI1OEf1VUG8` |

Each backup graph was compared with its published live graph before any
production change; nodes and connections matched exactly.

## Rollout and rollback

Validate every operation atomically with n8n `validateOnly=true`, run strict
workflow validation, then apply the same operation list atomically. Do not
replay the Telegram workflow merely to test the fix because that would create
an external approval message.

If verification fails, roll the affected workflow back to the version created
automatically immediately before its partial update. The inactive backup IDs
above are the second recovery source. No Supabase schema or customer-data
mutation belongs to this rollout.
