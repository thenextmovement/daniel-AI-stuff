# Safety review — internal alert router shadow phase

## Trigger and validation

- Exactly one Execute Sub-workflow Trigger.
- Source workflow ID and name are required.
- Input length is bounded before processing.
- The live router is published because n8n requires a published sub-workflow, but Execute Sub-workflow is its only trigger. It has no schedule, webhook, form, chat, or email trigger.

## Determinism and idempotency

- No AI model makes routing or suppression decisions.
- The side effect is an idempotent Postgres upsert keyed by a stable failure fingerprint.
- Retries are safe because the same fingerprint updates the existing incident.
- A Supabase error is isolated to the shadow branch and cannot block the legacy email branch.

## Privacy and secrets

- Credential values are not present in workflow JSON; only n8n credential references are used.
- Error content is redacted for tokens, email addresses, URLs, phone numbers, UUIDs, long hexadecimal values, and long numeric identifiers.
- Only a bounded redacted preview and internal execution reference are stored.
- Customer communication is neither read nor sent.

## Failure behavior

| Failure | Behavior | Customer impact |
|---|---|---|
| Invalid alert identity | Router execution fails; legacy email remains unchanged | None |
| Supabase timeout or 5xx | Three idempotent attempts, then explicit failed shadow output | None |
| Ambiguous POST outcome | Retry is safe because fingerprint upsert is idempotent | None |
| Router recursion | Router has no error handler or outbound email; the info handler also excludes the router ID | None |
| Outlook timeout | Existing behavior remains unchanged in shadow phase | None |

## Rollback

Restore all three workflows from the dated full JSON files under `source/`. No database migration is introduced by this phase.

## Scorecard

| Control | Status |
|---|---|
| Production backup before mutation | Pass |
| Deterministic decision logic | Pass |
| Idempotency before side effect | Pass |
| Explicit external-call error path | Pass |
| Secrets outside workflow JSON | Pass |
| Postgres remains source of truth | Pass |
| Existing customer communication unchanged | Pass |
| Existing internal alert delivery unchanged | Pass in shadow phase |
| Automated archive/delete | Not in scope |

## Unrelated security advisory

The Supabase security advisor reports 13 independent ERROR findings: RLS is disabled on 11 public tables, and the views `v_easybill_invoice` and `v_orders_dash` are SECURITY DEFINER views. This rollout does not change them because an isolated access-policy and caller review is required:

- `crm_customer_change_log`
- `social_post_schedule`
- `ops_customer_email_message_link_backfill_20260604`
- `ops_customer_contact_cleanup_20260604`
- `crm_inventory_glossary`
- `crm_inventory_categories`
- `crm_inventory_items`
- `crm_inventory_movements`
- `crm_inventory_lock`
- `_qtx_stage`
- `quote_approvals`
