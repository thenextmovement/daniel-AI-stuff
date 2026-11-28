# #NEONT4692: finish the verified Shopify payment projection

Issue: https://github.com/thenextmovement/daniel-AI-stuff/issues/231

## Exact scope

The Qonto receipt and final easybill invoice are already paid. This repair must not
repeat them. It admits only existing Shopify job
`c4ebb761-c3d9-47d0-afbe-49c4533a007d` for order `8513317896459`,
payment `055b1062-e9fd-4d2a-9c97-147b3c5e1c54`, EUR 1,163.82.
The existing worker's `orderMarkAsPaid` mutation records a manual payment; the
fresh order must have no authorization or other transactions, so no card capture
is admitted. The invoice remains `3717331959`, receipt `3225854832`.

This is a **candidate awaiting exact-commit production approval**. No main push,
merge, Ops deployment, direct worker trigger, new ledger, transfer, easybill
payment, customer message or historical Manual-Paid recovery is included.

## Why this payment path is expected not to mail

The active order-creation workflow sets `send_receipt:false` and
`send_fulfillment_receipt:false`. This is current workflow evidence; the original
#4692 creation execution has expired and its original flag is not independently
recoverable.

A fresh 2026-10-26T21:53:23Z read verified that #4692 and completed comparison
#4795 belong to the same n8n app `290803777537`. #4795 has exactly one successful
manual SALE, `manualPaymentGateway:true`, and its complete five-event timeline
ends in n8n marking it paid without a customer-mail event. #4692 remains PENDING
with no transactions and the full outstanding balance.

Shopify staff's answer to the matching API-import/manual-payment question states
that `send_receipt` defaults to false for API order creation:
https://community.shopify.com/t/orders-created-through-api-not-sending-confirmation-emails/275234/2
The answer's original public topic record identifies Liam as Shopify staff.
The community's AI summary is not treated as staff evidence.

Current API contract:
https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/orderMarkAsPaid

These are concrete grounds for the existing API path, not an explicit native
notification-suppression flag. `orderMarkAsPaid` has no notify parameter and the
absence of all future provider-generated mail is not an API guarantee. Do not
describe the local `customerEmailSuppressed` marker as a Shopify mail control.
No Billbee login, integration change, global notification change or permission
expansion is needed or included.

## Apply only the approved SHA

1. Re-read the latest case memory and exact approval. Read the live workflow
   `K9poQw3a1DOO16Vd` through n8n MCP. The candidate expects version
   `a463dca5-5221-481b-8d0e-008ee0eb8071`, active, and the exact affected nodes
   and edges in the test fixture. Abort on drift rather than overwriting it.
2. Feed that in-memory workflow into `patch-workflow.mjs`. Validate its 11 MCP
   operations, apply that exact delta, and read active/published nodes and edges
   back. Preserve credentials, timer, activation, existing easybill/manual/
   collective branches and error workflow. Do not merge or deploy the repository.
3. Freshly GET the complete Shopify payment state/history and the easybill invoice
   plus complete receipts. Confirm the exact Qonto receipt, no cancellation,
   refund or gift card, correct n8n app, no transactions/authorization, full
   pending balance and unchanged mail/document state. Produce exactly the
   `required_proof` schema in the SQL; `checkedAt` is the oldest time of these
   direct reads, not a newly assigned time for stale data.
4. Load `ops/repairs/20261026-shopify-paid-4692.sql` and invoke its session-local
   admission function in the same transaction/session with that fresh proof.
   The atomically locked predicates allow only BLOCKED/attempt0 and expire five
   minutes after the provider reads. They preserve the original historical
   proforma-mail job and all documents. A repeated admission is a no-op; it does
   not reset or reopen any job.
5. Let the existing minute scheduler claim the job. Only attempt1 may POST.
   An ambiguous result cannot cause a second POST: later attempts may only reuse
   an independently read exact paid manual receipt. Before DONE the first
   attempt also reads Shopify again and verifies a unique successful SALE,
   exact order, amount, app, full PAID balance and receipt timestamp.
6. Read the durable DONE event, original ledger ShopifyDONE, independent
   provider receipt and complete order timeline. Recheck unchanged mail jobs,
   invoice sent_at/postbox and no new customer-mail event. Only then invoke the
   separate guarded finalizer for CompanyBrain incident
   `70d7f8ee-c565-4c69-ad52-09f355cdacd2` with fresh matching provider evidence.
   It records a canonical resolved transition, not a fictitious payment.
7. Re-read the original 09:10 internal warning and every exact duplicate before
   moving only the now-closed #4692 messages to Outlook's real Archive. Read the
   moved items there and compare bodies. Mixed digests and unproved Manual-Paid
   executions remain visible.

## Failure and rollback boundary

The existing internal error route is preserved and was read back as
`support@neontrip.de`; no test alert is sent. Expired or changed evidence aborts.
The local helper definitions do nothing until explicitly called.
Before admission, the exact n8n delta can be reverted through version history
after checking no concurrent edits. After any claim/mutation, do not remove the
guard, reset the job or restore the old hold blindly: preserve its receipt and
resolve the actual outcome first. SQL rollback cannot undo a provider payment.

## Verification

- Direct JavaScript and generated-node regression tests, including unmodified
  ordinary/collective branches, mismatched scope, price/currency, existing
  authorization, failed HTTP/GraphQL, expired proof, uncertain retry and duplicate
  receipt; n8n generated code compiles and is exercised with representative data.
- Isolated PostgreSQL tests use actual current claim/complete function definitions
  against synthetic fixtures, no network or production connection. Admission,
  idempotency, worker projection and unchanged customer-mail/document rows are
  checked; the separate incident finalizer has its own guarded tests.
- MCP validateOnly: all 11 delta operations valid, no mutation.
- Full workflow validator: no new error categories versus the live baseline
  (both have the same ten existing code-parser heuristic reports); 0 invalid
  connections. Independent execution/compilation tests cover the affected code.
- GitHub CI must pass for the final exact commit before asking approval.

The six-node fixture contains only affected paths and immediate consumers for
regression comparison; it is not a full workflow export or a production backup.
