# NEONTRIP Phase 3 CX8 Validator repair

This single-node repair was applied to workflow ELpwCfdWOCRZ22gy on 2026-08-20. The instance published the workflow write immediately. No activation change or manual workflow execution was performed.

## Confirmed cause

Natural execution 5207538 returned a raw OpenAI Responses root with both:

- root text configuration metadata shaped as text: { format, verbosity }
- the actual assistant JSON under output[].content[].text

The deployed Phase-2 Validator inspected root text before output/content and accepted every object-valued text field as a candidate. It therefore validated the response-format configuration object instead of the classifier result. Its custom Error.name also caused n8n to display Unknown error rather than the useful contract failure.

The regression fixture retains only this response topology and synthetic values. It contains no request, customer, company, domain, prompt, token, search source, or other execution data.

## Exact repair

Only validate-output.parameters.jsCode changes:

1. A direct structured object remains valid.
2. output[] and content[] are traversed before root output_text/text convenience fields.
3. An object-valued text field is accepted only when it has the exact CX8 structured-output keys.
4. contractError throws a normal Error whose message begins with the stable contract code. It no longer assigns a custom Error.name.

The Record RPC body, failure RPC node and shape, CX8 taxonomy/classifier/prompt versions, evidence gates, topology, connections, credentials, trigger, settings, node count, activation state, and every other node field remain unchanged.

## Prepared prestate

- Workflow: ELpwCfdWOCRZ22gy
- Active/non-archived: true/true
- Draft and active version: f2ae5824-6056-4d10-9e4a-0009c91261cf
- Version counter: 113
- Nodes / connection sources: 20 / 17
- Draft, active and locally reconstructed approved Phase-2 graph hash: 156675859a4ba9cc6a1c39624512217482e931b2bed18c1b7dd62db9d416abc0
- Validator before hash: 5564c60fff894c7adf29f1f38e22beed9b276b7ee13a140bc9d1d7ee9bfa1c88
- Validator after hash: 79bdc5e7bc231661ff5427a3f3e4a3509870320382dca8b666e099ba15539ea5

The complete full draft and published-active readbacks are under ../../backups/2026-08-20-request-segmentation-phase3-validator/.

## Verification

Run:

    node --test n8n/patches/2026-08-19-request-segmentation-phase2-cx8/cx8-contract.test.mjs n8n/patches/2026-08-20-request-segmentation-phase3-validator/validator-fix.test.mjs
    node n8n/patches/2026-08-20-request-segmentation-phase3-validator/workflow-patch.mjs

The combined offline suite passes 34/34 tests. The focused Phase-3 suite proves the old metadata-first failure, the repaired needs_review/null result, exact object-text filtering, stable malformed-output error text, one changed field, and a full exact reverse.

n8n validateOnly accepted the one-operation forward patch and the two-operation forward-plus-reverse roundtrip. A full readback afterward remained on version f2ae5824-6056-4d10-9e4a-0009c91261cf, counter 113, with the original graph unchanged.

## Live application and natural runtime proof

Immediately before the write, full draft and published-active readbacks still matched the prepared prestate exactly. The reviewed one-operation patch was then applied once. Full readback proved:

- draft version and active version: 80101742-c095-4a69-827f-aeaab6bc71ca
- version counter: 114
- active and non-archived
- 20 nodes and 17 connection sources
- draft graph equals published-active graph
- the complete graph equals the locally calculated target with only validate-output.parameters.jsCode changed
- runtime workflow validation: valid, zero errors; the eleven pre-existing warnings are unchanged
- reverse-only validateOnly remained valid after publication

The first historical pilot had already made one natural attempt on the old Validator and was then cancelled through the canonical database RPC to prevent a deterministic retry. It wrote no classification, master projection, cache entry, or customer action.

After publication, a new single historical job was staged and released through the canonical database RPCs. It was marked evaluation_only=true and master_projection_authorized=false. Natural scheduled execution 5210710 completed successfully in 3.491 seconds and recorded one needs_review classification with segment null. The job ended needs_review after one attempt with no error. The target master-segmentation hash remained exactly equal to its pre-run baseline, the CX8 cache stayed at zero, and follow-up plus pricing decisions stayed blocked. No manual n8n execution, retry, Trello write, message, pricing action, or other customer-facing action was used as proof.

## Rollback

Rollback is the exact reverse updateNode operation in workflow-patch.mjs. Before a rollback, re-fetch full draft and published-active state and require version 80101742-c095-4a69-827f-aeaab6bc71ca plus the repaired Validator source. Validate the reverse against that live state, apply only that one operation, then require a complete full-graph readback equal to the prepared prestate. Do not manually run or retry a customer execution as proof.
