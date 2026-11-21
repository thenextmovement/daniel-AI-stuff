# Easybill gross rounding — Issue 249 / PROJ-001

Cause: jobs for #NEONT4831/#NEONT4832 expected 29700 net + 5642 VAT = 35342 gross cents. Four gross-price lines (27667,1130,3570,2975) at19% yield 29700 net when each line is rounded first, but 29699 net +5643 VAT when easybill sums precise converted net values. Original draft and final guards rejected this legitimate difference; retrying identical calculations four times cannot fix it. The immediately downstream delivery guard also compared all three totals exactly, and therefore required the same evidence-aware treatment. Screenshot execution11181812 is pruned; matching live jobs blocked at11:45:58/11:46:58Z are the current evidence, not a reconstructed execution trace.

## Changes
- Document worker u48KZyTcU2J9pw2P: only Verify Easybill Draft Amounts, Prepare Document Completion, Prepare Successful Completion. Identical gross and independently verified matching gross lines/rate/currency/document identity required; source net must equal sum of rounded line nets, provider net must equal exact aggregate gross-to-net calculation. No blanket cent tolerance. Credits/cancellations and exact legacy path unchanged. Fractional-cent prices retained; only machine floating-point representation noise tolerated.
- Persist source/provider totals and deterministic rounding proof in existing BILLING_JOB_DONE event.
- Customer Delivery Worker wqaTsVKuKqKnp2AG: one read-only Load Verified Document Amounts node between existing load/check, plus Check Existing Customer Delivery. For a mismatch, requires exactly one trusted creation event for same case/document, exact source and actual totals, finalized document, matching currency and recalculated aggregate VAT. Exact old matches need no rounding proof. Existing postbox duplicate protection, recipient/message/PDF/attachment checks remain intact.
- All other nodes/connections/settings/credentials/schedules/activation preserved by equality checks. n8n native history provides rollback. MCP partial save rejected server-managed settings; existing authenticated API used with exact version guards/readback. No app deployment.

## Verification
51 isolated tests pass; original guards reproduce the real failure. Both real source cases passed draft/final guards; both finalized documents and their actual stored proofs passed sender check. Document workflow validator:0 errors/69 heuristic warnings. Sender:5 pre-existing expression-parser errors in unchanged attachment nodes, identical on original29-node baseline and patched30-node workflow;0 new errors,0 invalid connections. Runtime completion/send evidence is required before claiming recovery.
Live document worker published b326437d-f772-4ec5-954e-8f484b891c3c; sender published5de51f1b-6194-43e3-b830-796a30283050.
No test customer email or synthetic financial action. Only existing blocked document jobs requeued with guarded status/amount checks, audit events, same idempotency keys and same provider draft IDs. Original unsent delivery jobs retained; scheduled retry brought forward after patch. Source and invoice tax rounding differ by1cent; both original and provider amounts remain auditable, gross/payment amounts unchanged.

Run: node --test n8n/patches/2026-11-04-easybill-rounding/*.test.mjs

Preserve these patches when publishing future workflow versions; do not deploy stale generated inactive workflows over current service history.

## Live recovery (04 November 2026, UTC)
|Order|Document retained|Creation|Customer delivery|Postbox|Final state|
|---|---|---|---|---|---|
|#NEONT4831|3727210508 / PF-NEONT4831|11209537,19:59:58,first recovery attempt DONE|11209881,20:05:50,DONE|1482121901|SENT,payment pending,35342 gross cents|
|#NEONT4832|3727212995 / PF-NEONT4832|20:00:58,first recovery attempt DONE|11209935,20:06:50,DONE|1482122120|SENT,payment pending,35342 gross cents|
Both cases have exactly one billing document and no open incidents. Shopify live pending/outstanding353.42 each; easybill paid_amount0 each. Sender natural20:07:50 run successful after completion. One stored delivery completion per document. No additional payment, invoice, credit or duplicate mail was created. Normal previously blocked proforma/confirmation delivery completed; attachment1 per document.

Immediate payment-projection consumer K9poQw3a1DOO16Vd inspected: no net/VAT comparison, unchanged. Prior Qonto rule/mail HTML and Manual-Paid once-alert versions unchanged and active.

Broader read-only check found old #NEONT4388 CREATE_INVOICE job blocked since14September. Existing easybill invoice3569473916 dated26May,117810 gross/99000 net cents is finalized,fully paid on7September and has postbox1433251622. Shopify is also fully paid/outstanding0. Old billing mirror/Shopify show zero tax while this existing invoice contains18810VAT cents. This is a separate historical tax-metadata discrepancy, not the current rounding fault. No new invoice/payment/mail or historical tax mutation; legacy block and two intentional historical safety blocks remain unchanged. No claim of a globally clean billing backlog.
