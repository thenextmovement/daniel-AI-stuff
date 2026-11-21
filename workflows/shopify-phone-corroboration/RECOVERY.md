# Accepted customer phone corroboration (NEONTRIP)

Candidate only. Exact commit approval is required before application.

## Bound case and limitation

The internal notice at 2026-10-26T14:53:54Z concerns offer A/N15964,
Offer `cmvp0rcfj0201p83h09hqno6s`, accepted snapshot
`cmvpdn2y9004vqd3a77k59s91`, and Shopify order `8629022720267` (#NEONT4804).
The old customer number lacks its national trunk zero; both accepted German
address snapshots contain the identical complete number. Shopify already has
the correct phone on billing and shipping addresses, but customer.phone and
order.phone were absent at the last provider read. A delivery contact is not
automatically a customer account contact; order.phone also has SMS semantics.

This patch prevents this particular source mismatch for future accepted offers.
It does not repair the historical customer, edit the signed offer, populate
order.phone, resend a webhook, recreate an order, or establish historical closure.
Keep the existing notice visible until separately verified case closure.

## Exact scope

Workflow `SEKwtYAVRR7zeKnl`, baseline version
`8827e6c8-32b8-43de-9595-59096296da8d`, 45 nodes, active.

- `Validate + Build Shopify Order Context`: retain normal valid-phone behavior.
  An otherwise invalid own customer number is normalized only when its digits
  match the same canonical number in every supplied accepted address contact,
  all those contacts explicitly have German country context, the customer's
  current country context is German, and the signed acceptance timestamp exists.
  Missing customer numbers, foreign/unknown countries, differing contacts,
  extensions, malformed plus numbers and absent acceptance fail closed.
- `Build Contact-Fallback Success Alert` and `Kontakt-Fallback-Mail senden`:
  use the confirmed internal recipient `support@neontrip.de` in both the alert
  metadata and actual Outlook send envelope. Existing alert conditions,
  credentials and retry behavior remain unchanged. No test alert is authorized.

No other node, edge, activation state, credential, schedule, receipt/payment
policy or idempotency key changes. No Ops deployment or main push/merge.

## Validation and release

1. Read the live workflow with n8n MCP. Abort on a different baseline; do not
   silently rebase an approved candidate. The two baseline JS fixtures contain
   code only, no credentials or customer payload.
2. Build the three operations using `buildOperations(liveWorkflow)` from
   `patch-workflow.mjs`; compare the entire proposed workflow against live and
   confirm only the three listed parameter edits.
3. Run `node --test workflows/shopify-phone-corroboration/phone-corroboration.test.mjs`.
   The same 19 tests are included in the standard quote test suite and CI.
   n8n MCP validateOnly must pass without a production execution.
4. After exact SHA approval only, apply the exact operations through n8n MCP.
   If its partial endpoint rejects before mutation, reread version/state and
   use the full MCP endpoint only with the exact same verified candidate.
5. Read back top-level and published workflow; verify all unrelated properties
   and activation are unchanged. Do not invoke the business workflow to test.
   Observe a future natural event for actual provider effect; code tests are
   not a claim that Shopify persisted any historical correction.

Rollback uses n8n version history or restores only these three parameter
values from the verified pre-change version after drift checking. It does not
delete an order or alter contacts already persisted by natural executions.
