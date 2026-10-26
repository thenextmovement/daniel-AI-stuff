# Quote Ready QC: a card moved during inspection

Business: NEONTRIP. Workflow `bvRcF5Xaj3eGY0J4`.
The original execution10379086 correctly stopped when card
https://trello.com/c/0jKOTIfF left Quote Ready during its read.
The claim audit and Company Brain projection nevertheless remained processing/running.
This change records that abort, preserving the manual values and every write guard.
It never marks QC as passed and never invokes the extractor or a customer email path.

## Scope and evidence
- Trello action6adf16c74f23473f1119a32c,2026-10-26T09:00:55.192Z:
  list659ffc4e5f8bffd67fe38265→6a18389f5e45294188451924,
  card6adf159dd4f7aadbd2908cdb, board63d10c34105771f01ccf4296.
- Execution10379086:09:00:49.136–09:00:57.360Z, stops at Guard QC Correction Writes.
- Audit17df6902-c5e1-18d0-8e04-b568552b9730; Company Brain attempt571aa0d2-9be6-418b-aab1-3928a08b7ff7.
- Guard change distinguishes a list move of the same active card from identity/board/closed-card failures.
  The new branch PATCHes only its owned processing audit with execution/source/card predicates,
  verifies a single exact returned record, then still raises an internal error.
- Narrow UPDATE trigger projects only this QC abort to the matching running attempt.
  A missing, conflicting or already terminal attempt rolls the audit update back.
  Existing INSERT projections and all other statuses/workflows remain unchanged.
  Only the existing timestamp trigger consumes the resulting attempt update; no mail or job insertion.
- Error workflowM4uG1HAtN9Zggxww adds only the QC ID to its support@neontrip.de allowlist.
  Existing digest limits, schedules, credentials, other recipients and activation remain unchanged.

## Verification and release
Local: `node --test workflows/quote-ready-qc/test-*.mjs` and
`python3 scripts/test_qc_moved_audit_db.py`.
The latter uses disposable offline PostgreSQL17, the existing real attempt table/INSERT projection,
and tests atomic rollback, terminal protection, replay, exact historical binding, and rollback/reapply.
The workflow tests also run through the existing CI quote-test command.
Fixture contains the affected code/configuration and placeholder parameters for unrelated nodes,
not production secrets or a runnable workflow backup.

Before applying, obtain explicit approval of the final full commit SHA.
Re-read both active workflows and the exact historical audit/attempt.
Base versions: QC22037c4c-045e-4643-ac00-cb00572ac45b;
error90331088-65e5-443e-a79f-3d6da9cae498.
Build patches from fresh full reads; validateOnly has no production effect.
Run the repository's exact-SHA predeploy/safe-main helpers as required.
Apply migration20261026120000_qc_moved_audit_projection, then both narrow workflow patches.
Read back active versions and compare every unchanged node/connection/setting/credential.
Do not manually execute the business workflow or manufacture a moved-card alert.

Re-read the original execution and Trello action, then apply
`ops/repairs/20261026-qc-moved-audit.sql` once.
It updates only the exact old processing row; the trigger synchronizes the exact attempt atomically.
A repeated matching application is a no-op; any changed binding/state aborts.
Read back both terminal blocked records, retained before-fields, source and execution IDs.
Only then archive the uniquely bound internal error10379086 and any proven duplicate;
read each back from the actual Archive folder. No QC success or customer delivery claim.
If a live moved-card event later occurs, verify its returned audit, projected attempt and real internal
alert receipt without generating a test notification. Existing whole-batch fail-closed behavior remains.

Rollback: restore the two workflow patches from n8n version history before applying the scoped rollback SQL.
Do not undo truthful historical terminal evidence. No app deployment/restart required.
