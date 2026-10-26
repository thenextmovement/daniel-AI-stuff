# NEONTRIP initial quoting card-context guard

Workflow: EtEpzMp10EmaqXIS, NEONTRIP Quoting Agent v1 — Event Driven.
Observed baseline: version 7d94dbea-9ae9-43c8-ab00-0752ea6798b9, active, 107 nodes.

Execution 10401215 (26 October 2026, 14:20:38–14:22:00 UTC) waited 70 seconds after card creation. Card 6adf61b57c4288abebd49c63 (https://trello.com/c/OO9V1RPV) left the initial request list and then board during that wait. The processing and failure labels still exist on the source board; applying them on the destination board returned 404. The processing-label node also emitted a regular empty output because alwaysOutputData was enabled. No successful quote analysis was recorded. The current supplier handoff must not be restarted or reversed.

## Limited candidate

- Read the live card immediately before the first label mutation and before the failure-label path. Verify immutable card ID, source board, original input list and not archived.
- Missing, mismatched or failed reads remain explicit unconfirmed failures; a proven move/closure is an explicit blocked error. No label writes follow either guard failure. Original processing-error text is retained on the failure branch.
- Disable alwaysOutputData only on Add Description Processing Label so its error output cannot also feed the normal analysis branch.
- Use existing error workflow ArT3LN25Mb1PAuBE. Its existing Outlook recipient includes support@neontrip.de; throttle, digest and disabled WhatsApp branch remain unchanged.

No changes to schedules, activation, credentials, business rules, recovery branches or customer-message paths. No database mutation, historical recovery, card move or customer email. Existing later write guards remain unchanged. Trello reads and writes are not atomic: a move after a successful read can still produce a technical error, which must remain visible.

## Verification and eventual application

Run `node --test workflows/quoting-board-guard/board-guard.test.mjs`; the test wrapper also includes this in the existing quotes CI suite. Build the candidate using `patchWorkflow` on a fresh MCP workflow read, compare every unchanged node, connection, setting and credential reference, and validate the diff via n8n MCP validateOnly before applying.

Production requires explicit approval of the exact reviewed commit. Do not merge or push main: main triggers an unrelated Ops deployment. Apply only the reviewed workflow delta via MCP, preserving name, settings and active state. First recheck the current workflow baseline and alert route; any drift needs review. Read back the complete published workflow, not only the draft. No synthetic business run or test alarm.

Observe the next genuine event and its terminal record/internal mail. Historical execution 10401215 must not be replayed and this patch does not convert it into a successful analysis. Archive associated internal mails only after an evidenced case closure, and reread the actual archive.

Rollback uses n8n version history for the affected workflow; no separate full workflow backup is required.
