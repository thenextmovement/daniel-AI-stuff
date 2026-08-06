# NEONTRIP Request Auto-Reply — Production Cutover

Status at creation: candidate validated; production database and n8n cutover pending.

## Scope

This cutover restores the six-minute acknowledgement described by the operator for:

- current landing-page requests (`form_id=landing-page-form`),
- legacy live NerdyForms requests (`form_id=2418`), and
- current unstructured Outlook requests (`form_id=outlook_email`).

There is deliberately no historical backfill. Manual Ops imports and requests with
`attribution_raw.auto_reply_suppressed=true` are not eligible.

The database is authoritative. Trello remains a projection and is not involved in
enqueue, claim, recipient resolution, delivery or completion.

## Current-state evidence

- Legacy auto-reply `nUrqyTSnGE8j9QT8` is inactive and contains an Outlook draft,
  not a send operation.
- It waits six minutes and contains the expected Fabienne/NEONTRIP copy and signature.
- Its trigger and customer context depend on ActiveCampaign.
- The current structured and Outlook intake workflows write `status=new` requests to
  `master_requests`.
- No PandaDoc or PandaDog reference exists in these five request/auto-reply workflow
  graphs. ActiveCampaign references exist in all four legacy intake graphs.
- The repository already contains the separate provider-retirement migration
  `20260729120000_retire_external_document_provider.sql`; this cutover does not revive
  any external document provider.

## Delivery contract

1. An `AFTER INSERT` trigger sees only new `master_requests` rows.
2. The trigger checks the runtime mode, source allowlist and suppression flag.
3. A unique job is due six minutes after insertion.
4. A one-minute n8n schedule atomically claims at most one due job.
5. A bounded model call proposes exactly one JSON `body`; customer text is explicitly untrusted.
6. Deterministic code rejects malformed or risky output and uses a fixed safe fallback.
7. Recipient, subject and full Fabienne/NEONTRIP signature are deterministic.
8. Outlook sends exactly once with retries disabled.
9. A confirmed node result becomes `sent`; any Outlook error becomes
   `delivery_unknown` and requires manual review.
10. A stale processing lease also becomes `delivery_unknown`; it is never reclaimed.

Runtime modes are mutually exclusive:

- `off`: no enqueue and no claim,
- `canary`: only a directly enqueued internal `@neontrip.de` canary may be claimed,
- `live`: only newly inserted allowlisted customer requests are enqueued and claimed.

## ActiveCampaign removal diff

The three executing intake graphs are changed only after the database and worker pass
the internal canary:

| Workflow | Nodes removed | Rewire | Data cleanup | Candidate validation |
| --- | --- | --- | --- | --- |
| `FQ7lf36yje4B1eE3` | AC contact, AC deal, AC deal-field update | `Has Email?` → `Supabase: Upsert Customer` | remove `ac_contact_id`; set `ac_deal_id=null`; remove AC Trello link | 32 nodes, 0 strict errors |
| `Xqt27WSNfJYVGROP` | AC contact, AC deal, AC deal-field update | `Keep First Item Only` → `Supabase: Upsert Customer` | remove `ac_contact_id`; set `ac_deal_id=null`; remove AC Trello link | 26 nodes, 0 strict errors |
| `fcPiGDWq41htB5mV` | AC contact, AC deal, prepare/update deal | `Translate Fields` → `Supabase: Upsert Customer` | remove `ac_contact_id`; set `ac_deal_id=null`; remove AC Trello link | 34 nodes, 0 strict errors |

The no-run Zendesk duplicate `AcYSau5MGsAxeAqL` is deactivated and clearly retired,
not rewritten. The old auto-reply remains inactive and is clearly retired after the new
worker passes the canary. Backup workflows retain the historical graphs but remain
inactive.

The two remaining intake graphs above 30 nodes are existing legacy graphs. This
cutover reduces them without adding behavior; decomposition remains a separate task.

## Required gate and sequence

1. Commit only the files in this directory plus the matching migration, rollback and
   SQL test.
2. Push with `codex-safe-push-main`.
3. Run `codex-predeploy ops` and use only its exact commit.
4. Apply the migration. Confirm mode is `off`.
5. Run the transaction-safe production catalog/behavior smoke.
6. Create the n8n worker inactive and validate its stored draft.
7. Set mode to `canary`, activate the worker and enqueue one internal canary.
8. Confirm one Outlook message plus one `sent` receipt and zero unknown/duplicate rows.
9. Keep mode `canary`; publish the three validated intake diffs and retire the two old
   workflows.
10. Set mode to `live` atomically.
11. Observe the first natural request through enqueue, six-minute due time, Outlook send
    and durable `sent` receipt.

## Rollback

Immediate kill switch:

```sql
select public.configure_request_autoreply(
  'off',
  'incident rollback',
  null,
  'operator'
);
```

Then deactivate the new n8n worker. If intake rollback is required, restore each source
workflow from the exact inactive backup IDs in
`production-backups-2026-08-06.json`, validate, publish, and verify its trigger. Do not
activate the old AC auto-reply as part of rollback; it is draft-only and its upstream
ActiveCampaign event source is no longer authoritative.

The SQL rollback removes the `master_requests` trigger and all service-role executor
permissions while retaining jobs/events for incident evidence.
