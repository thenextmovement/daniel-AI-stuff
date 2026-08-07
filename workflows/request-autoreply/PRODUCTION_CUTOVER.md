# NEONTRIP Request Auto-Reply — Production Cutover

Status: live since 2026-08-06 18:30:06 CEST. The first natural post-cutover
request is still pending; two internal canaries completed exactly once.

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

### Missing-design form reply

For NEONTRIP form sources only (`landing-page-form` and `2418`), the relationship
lookup also returns a bounded attachment state from the persisted
`master_requests.file_urls` array:

- a non-empty array keeps the normal acknowledgement,
- an explicit empty array selects the fixed “Logo oder Design fehlt noch” reply,
- a null/missing request context fails safe to the normal acknowledgement, and
- `outlook_email` is always treated as not applicable.

The fixed reply is suppressed when the request text explicitly says that no design
exists, asks NEONTRIP to design/create it, or supplies the intended wording. These
signals are deterministic regex classifications; customer text never supplies email
copy, subject, recipient or signature. The special reply keeps the previously verified
NEONTRIP relationship sentence and the standard Fabienne signature.

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

## Production evidence

- Safe-pushed and predeploy-approved commit:
  `c8b4036c1c2db6e67f79c833d8546523a421ad87`.
- The production migration applied successfully. A transaction-safe production smoke
  covered mode-off behavior, no backfill, trigger presence, role permissions, canary
  claim/completion, delivery-unknown handling and rollback; it returned
  `request_autoreply_production_smoke_passed` and left mode `off` with zero rows.
- Active worker: `L6SqGZLnu3ia07x1`, published version
  `df5beb5b-0e9f-42a4-944a-b47956f63d4c`; strict validation reports 13 nodes,
  12 valid connections, zero invalid connections and zero errors.
- AI canary execution `4430366` used `gpt-4o-mini`, produced `body_source=ai`, sent one
  message to `support@neontrip.de`, completed as `sent`, and verified its durable
  receipt. Its job has `attempt_count=1`, `recipient_mode=canary`,
  `provider_receipt_source=outlook_node_success` and no error code.
- An earlier canary execution `4430221` safely used the deterministic fallback when the
  former Anthropic credential reported insufficient credit. It also completed exactly
  once; the production worker was then backed up and switched to the already-working
  OpenAI credential before live mode.
- Published ActiveCampaign-free intake versions:
  `FQ7lf36yje4B1eE3` → `85481908-995b-47c8-8349-ca1ffcc6d43d`,
  `Xqt27WSNfJYVGROP` → `35f1e6c6-c0b4-4d23-b7c0-3845dbeaec66`, and
  `fcPiGDWq41htB5mV` → `e1b30e57-98cb-4b64-98f0-a795dd6c181c`.
- Each published intake graph is active, has zero strict validation errors and contains
  zero ActiveCampaign, activehosted, PandaDog or PandaDoc references.
- Legacy Zendesk/ActiveCampaign workflow `AcYSau5MGsAxeAqL` and old draft-only
  auto-reply `nUrqyTSnGE8j9QT8` are deactivated and named `RETIRED`.
- Runtime settings are `mode=live`, `delay_minutes=6`,
  `policy_version=request-autoreply-v1`, updated by `codex-cutover-c8b4036`.
- Natural post-cutover observation: no real request arrived during the initial
  ten-minute window from 18:30 through 18:40 CEST. Every one-minute Outlook intake and
  delivery scheduler execution succeeded with no candidate. The database still held
  only the two canary jobs (`sent=2`, `max_attempt_count=1`, `blocked=0`,
  `delivery_unknown=0`, `live_recipient_mode=0`), confirming that historical requests
  were not enqueued. The first natural customer receipt therefore remains an external
  follow-up observation, not a failed gate.

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

For the missing-design extension specifically, the exact pre-change worker backup is
`NKJLPL7YePjZRvS5` and the exact pre-retirement design-reminder backup is
`yoNIIip1Deb7neQl`; both are inactive. Restore the worker graph from its backup and
re-run `20260807103000_add_request_autoreply_relationship_context.sql` to replace the
attachment-aware lookup with the prior relationship-only function. Reactivate
`btJd34v7PJFVej6G` only if the former human-review draft reminder is intentionally
wanted again. Validate and publish the restored worker before returning runtime mode
to `live`.
