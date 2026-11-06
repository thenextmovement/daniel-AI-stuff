# Manual-paid: one email per concurrent incident

PROJ-001 / issue247 / Rahim / Codex. Service patch; no Ops application change.

The 4 November 2026 failures11207383,11207390 and11207394 received HTTP502 from the internal claim endpoint within the same second. Each supplied a different candidate order. The shared mail gate included candidate IDs in its key; upstream static workflow data also cannot atomically serialize simultaneous runs. The three received messages were distinct executions; sent-folder copies were not additional deliveries.

The request errors overlapped Coolify deployment azsmhq58tydiyhtkqndgj2sa (19:17:59–19:19:54Z). This supports a deployment handover as the likely trigger, not a proven origin-process diagnosis. Original claim receipts are absent. Candidate orders are not proof of actual selection, and no historical claim success is asserted or fabricated.

## Change

Only Prepare Alert Data and its immediate mail branch in M4uG1HAtN9Zggxww change. Exactly matching Manual-Paid unknown-claim errors use a dedicated service-role RPC. An atomic unique-key upsert admits one email for the operation/HTTP-status incident, records candidate IDs and suppresses simultaneous or repeated requests, including the same execution. A continuously observed incident never periodically reminds; a new incident is admitted only after 24h without this error. Different HTTP errors remain separate.

The original already-emailed502 incident was seeded from observed email/execution evidence to avoid a fourth notification. This is notification state only; no Manual-Paid claim receipt or financial state was backfilled.

Unrelated alerts retain the original static cooldown, global gate and recipient routing. The shadow incident recorder still receives the errors. New RPC failures stop without approving a send. This is at-most-once approval: a lost RPC/send response may require manual delivery investigation; automatic replay cannot guarantee both no duplicates and delivery. Send retries remain disabled. The main payment workflow, claim guard and all financial side effects are unchanged.

## Verified live

Active error-handler version: b678fdb4-d5af-46fe-8e72-829b6c7e96d7.
Supabase migration version:20261104194553, matching the filename.
Connections9/9, validator0errors. Existing unrelated warnings preserved.

Six JavaScript tests pass, including the original concurrent-error shape, unrelated cooldown and explicit boolean approval. PostgreSQL17 in a disposable offline container:12 concurrent requests → exactly one approval; replays denied; candidate IDs retained; continuous incidents suppressed; new incident after silence; malformed inputs and unauthorized roles denied. Three parallel live no-send checks of the already-emailed incident each returned HTTP200/approved=false/allowedEmails=0. Temporary helper deleted and NOT_FOUND verified. First helper attempt had an incorrectly wrapped webhook input; fixed in the disposable helper before successful verification, with no send node or financial action.

Direct Shopify and easybill read at19:41Z:
- #NEONT4796:1479.00EUR, paid in both, outstanding0.
- #NEONT4800:1091.23EUR, paid in both, outstanding0.
- #NEONT4812:765.17EUR, paid in both, outstanding0.
- #NEONT4826:1787.38EUR, paid in both, outstanding0; easybill paid_at2026-11-04.

All four payment projections DONE; final RECONCILE jobs DONE and no open billing incidents. Natural execution11208797 succeeded with an actual durable receipt(selection=none); this proves current claim-endpoint recovery, not historical claim completion. The service-outage incident was resolved with this evidence and the historical uncertainty explicitly retained in the resolution note. Original emails preserved; no customer message, extra payment, claim replay or app deploy.

## Reproduce / revert

```sh
node --test n8n/patches/2026-11-04-manual-alert-once/alert.test.mjs
python3 n8n/patches/2026-11-04-manual-alert-once/test_db.py
```

The guarded patch targets the original active version. Re-fetch current workflow before any future application; do not overwrite another change. n8n MCP validateOnly succeeded; actual save rejected a server-managed settings field, so the existing n8n API applied the exact scoped nodes/connections with version guards and readback. Settings, static data, activation and all unrelated nodes were compared and preserved.

To revert, restore only this branch and Prepare Alert Data against a fresh workflow version, then revoke RPC execution using the supplied rollback. Preserve the notification table/evidence. The pre-change workflow snapshot is private and untracked in the task worktree; n8n version history also remains available. No application deployment is required for these service changes.
