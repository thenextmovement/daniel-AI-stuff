# NEONTRIP Phase 5: deterministic external research patch

This directory contains a prepared, unapplied runtime-repair patch for active NEONTRIP workflow `ELpwCfdWOCRZ22gy`. It is pinned to the exact restored pre-v4 graph. It does not contain or concern RIESENOBJEKTE.

Preparing and validating this repaired artifact performed no live workflow write, publication, activation change, manual execution, retry, OpenAI request, customer communication, pricing action, Trello write, or other customer-facing action. The prior v4 publication that exposed the runtime failure was rolled back before this artifact was prepared.

## Decision

The current OpenAI node cannot reliably enforce research.

Its active configuration offers the built-in web-search tool, and the Build prompt tells the model twice to search when `researchPolicy.external_research_required=true`. The latest inspected n8n schema for that node family exposes the web-search settings but no `tool_choice` field.

The four completed Gold-pilot executions confirm the gap without retaining PII:

| Execution | Research required | API tool choice | Web-search calls | Validator result |
|---|---:|---|---:|---|
| 5220485 | yes | auto | 0 | needs_review |
| 5222757 | no | auto | 0 | needs_review |
| 5222798 | yes | auto | 0 | needs_review |
| 5222825 | yes | auto | 0 | needs_review |

All three research-required cases skipped the available tool. Prompt-only behavior is therefore not a reliable enforcement mechanism.

OpenAI documents that `tool_choice: "auto"` lets the model decide whether to search, while `tool_choice: "required"` forces a tool call. With web search as the only offered tool, the smallest supported repair is a direct Responses API request whose request body selects the tool deterministically:

- required: `tools=[{type:"web_search", ...}]`, `tool_choice="required"`
- not required: `tools=[]`, `tool_choice="none"`

The first natural v4 attempt then exposed a separate n8n runtime boundary: executions `5225368` and `5225393` reached the Build node, but the HTTP Request node rejected the previous multiline object-building `jsonBody` expression with `invalid syntax` before any OpenAI request. The workflow was restored to the exact pre-v4 graph.

The bounded runtime repair now builds the complete `responsesRequestBody` object in the existing Code node, where it is ordinary JavaScript. The HTTP node performs only this proven property handoff:

    ={{ JSON.stringify($json.responsesRequestBody) }}

Offline regression proves that this Build-owned body is exactly equivalent to the intended prior body for both research branches. The complex multiline HTTP expression is retained only as a test fixture and cannot return in the forward patch.

References:

- [OpenAI web-search tool guide](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI Responses API create reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)

## Exact contract

The patch keeps:

- taxonomy: `nt_taxonomy_v2_20260819_cx8`
- prompt: `segment_prompt_v4_20260819_cx8`
- model: `gpt-4o-mini`
- temperature: `0.1`
- maximum output tokens: `1400`
- include: `web_search_call.action.sources`
- store: `true`
- the exact strict output schema and schema metadata
- validator provenance version: `n8n_cx8_validator_v1`

The classifier-orchestration contract changes to:

- classifier: `segment_classifier_v4_20260820_cx8`
- quality gate: `nt_quality_gate_v3_20260820_cx8`
- shadow policy: `nt_policy_v3_20260820_cx8_shadow`
- accepted_by: `n8n-request-segmenter-v4`
- lock owner: `n8n-request-segmenter-v4-cx8-shadow`

The prompt-construction source is byte-identical before and after the version-pin lines. The prompt version therefore remains v4. The classifier version changes because the API orchestration and tool-selection contract changed.

## Exact workflow diff

Only six fields on four existing nodes change:

1. `claim-jobs.parameters.jsonBody`: v4 classifier and v4 lock owner.
2. `build-prompt.parameters.jsCode`: classifier v4, gate v3, policy v3, plus construction of the exact Responses request body in normal JavaScript.
3. `openai-classifier.type`: OpenAI node to `n8n-nodes-base.httpRequest`.
4. `openai-classifier.typeVersion`: `4.4`.
5. `openai-classifier.parameters`: POST `https://api.openai.com/v1/responses` with the deterministic tool branch.
6. `validate-output.parameters.jsCode`: classifier v4 and accepted_by v4.

The classifier node keeps the same id, name, position, connections, existing `openAiApi` credential reference, retry settings, wait time, and error routing. No trigger, topology, connection, credential, activation, setting, disabled node, RPC shape, taxonomy, or other node field changes.

The HTTP Request node serializes only `$json.responsesRequestBody` and returns the raw JSON body from `/v1/responses`. The existing Validator already traverses `output[].content[].text` and binds evidence URLs only to `output[]` items with `type="web_search_call"`.

## Version and data implications

The inactive Phase-5 base database contract must be present before this n8n patch can be applied. After the failed first attempt, the database was returned to v2 active / v4 inactive while all five v4 jobs were preserved unchanged. The recovery resume SQL must not run before the repaired n8n v4 graph is published and read back. During this safe recovery cutover, the candidate policy remains inactive, so the v4 Claim returns no work until the resume flip is deliberately released.

Because cache validation binds taxonomy + classifier + prompt:

- v3 cache entries must not be reused as v4 evidence;
- v4 accepted results can seed only the v4 cache contract;
- old v3 classifications remain historical audit records;
- existing human Gold labels remain valid because the taxonomy did not change;
- v3 and v4 model results must not be mixed in the v3 or v4 quality-gate calculation;
- a new evaluation-only job can be created for the same request/input under the new version triple.

The workflow stays shadow-only. Follow-up, pricing, payment, collection, and any other customer automation remain blocked.

## Prepared prestate

- workflow: `ELpwCfdWOCRZ22gy`
- active / non-archived: yes / yes
- draft and active version: `9880b37e-4c81-4ae9-87b2-fc667d33cf8c`
- version counter: `116`
- nodes / connection sources: `20 / 17`
- draft and published-active graphs: identical
- graph SHA-256: `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`

Complete readbacks are under `../../backups/2026-08-20-request-segmentation-phase5-forced-research/`.

## Artifacts

- `audit-findings.json`: sanitized execution and node-schema evidence.
- `forced-research-source.mjs`: exact before/after sources and request-body expression.
- `workflow-patch.mjs`: pinned forward, reverse, and offline application harness.
- `forward-patch.json`: standalone prepared forward operations.
- `reverse-patch.json`: standalone exact reverse operations.
- `full-diff.json`: complete before/after values for all six changed fields.
- `expected-diff.json`: six-field allowlist with hashes.
- `forced-research.test.mjs`: request-branch, raw Responses, provenance, diff, and reverse tests.
- `validation-results.json`: offline and n8n `validateOnly` results.

## Verification performed

Focused tests:

    node --test n8n/patches/2026-08-20-request-segmentation-phase5-forced-research/forced-research.test.mjs

Result: 8 passed, 0 failed.

Phase-3 Validator plus Phase-5 tests:

    node --test       n8n/patches/2026-08-20-request-segmentation-phase3-validator/validator-fix.test.mjs       n8n/patches/2026-08-20-request-segmentation-phase5-forced-research/forced-research.test.mjs

Result: 13 passed, 0 failed.

Phase-2, Phase-3, and Phase-5 tests:

    node --test       n8n/patches/2026-08-19-request-segmentation-phase2-cx8/cx8-contract.test.mjs       n8n/patches/2026-08-20-request-segmentation-phase3-validator/validator-fix.test.mjs       n8n/patches/2026-08-20-request-segmentation-phase5-forced-research/forced-research.test.mjs

Result: 42 passed, 0 failed.

The tests prove:

- required research creates only a web-search tool plus `tool_choice=required`;
- no required research creates no tools plus `tool_choice=none`;
- the Build node owns the exact complete Responses body and the HTTP node uses only the simple property handoff;
- the two observed `invalid syntax` failures are pinned and the former complex expression cannot be reintroduced;
- a synthetic raw Responses root with an actual `web_search_call` reaches `accepted` through the unchanged provenance logic;
- claimed external evidence without a corresponding tool call stays `needs_review`;
- prompt construction and strict schema remain unchanged;
- only the six approved fields change;
- the exact reverse restores the full pinned workflow.

The HTTP Request node validates with 0 errors and 0 warnings. The complete candidate workflow validates with 0 errors and retains exactly the 11 pre-existing warnings, adding none.

n8n `validateOnly` accepted:

- forward: 4 operations, valid, not applied;
- reverse: 4 operations, valid, not applied;
- forward plus exact reverse: 8 operations, valid, not applied.

A complete live readback afterward is byte-for-object identical to the pre-validation readback and remains on version/counter `9880b37e... / 116`.

## Review and rollout gate

The canonical cutover order is strict:

1. Verify the already applied Phase-5 base database contract: v2 policy/gate active, v4/gate-v3 candidate inactive, exactly eight inert candidate rules, and the exact preserved five-job recovery state. Do not reapply the base migration.
2. Verify the already deployed Ops dual-contract reader at its approved production commit. Do not redeploy it as part of the database/n8n recovery.
3. Re-fetch the n8n full draft and published-active state. Require the exact prepared version, counter, graph hash, active state, and node hashes; re-run the offline tests and `validateOnly`.
4. Publish only the four prepared n8n `updateNode` operations atomically while the candidate policy is still inactive.
5. Re-fetch and compare the complete graph against the calculated v4 candidate, then validate the active workflow. The v4 Claim must still receive no work at this point.
6. Only after the repaired n8n v4 publish/readback succeeds, apply `supabase/rollouts/held/20260820111828_resume_request_segmentation_phase5_forced_research_shadow.sql`. It flips only the four active policy/gate flags and requires the exact preserved recovery state: four Gold evaluation jobs plus one naturally created ingress job. It must not create, reset, delete, unlock, or otherwise mutate a job row.
7. Let the scheduled workflow process those five existing jobs naturally. Require an actual `web_search_call` for every research-required branch and no tool call for every non-required branch. Stop at the first contract or runtime deviation.

The recovery resume SQL running before the repaired n8n v4 publish and full readback is a hard stop. Likewise, do not publish n8n v4 unless the exact five-job rollback state, inactive candidate contract, and Ops dual-contract reader are verified.

The current active workflow publishes writes immediately. A stale prestate or any unrelated live change is a hard stop.

## Exact rollback

`reverse-patch.json` restores the prior Claim body, Build source, OpenAI node type/version/parameters, and Validator source. It does not touch any other field.

Before rollback, re-fetch the full live state and require that it equals the reviewed Phase-5 target. Validate the reverse, apply only those four reverse operations, and require the complete readback to equal the backup. Do not use a real customer, manual retry, or customer-visible side effect as rollback proof.
