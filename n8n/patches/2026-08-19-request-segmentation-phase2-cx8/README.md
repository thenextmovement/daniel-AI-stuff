# NEONTRIP Phase 2 CX8 n8n patch (prepared only)

This directory contains the complete local, non-applied partial-update and rollback source for workflow `ELpwCfdWOCRZ22gy`. It was prepared against the read-only live snapshot in `../../backups/2026-08-19-request-segmentation-phase2-cx8/`.

Nothing in this preparation updated, published, activated, deactivated, or manually executed the live workflow.

## Artifacts

- `cx8-contract-source.mjs`: pinned Claim, CX8 schema, Build prompt and deterministic Validator source.
- `workflow-patch.mjs`: emits the atomic five-operation forward patch, exact reverse patch, forward validateOnly request and forward-plus-reverse validateOnly request. It refuses to build when the pinned snapshot metadata, graph hash or expected Phase-1 node fields differ.
- `cx8-contract.test.mjs`: synthetic, non-sending offline contract suite.
- `expected-diff.json`: complete seven-field change allowlist with before/after hashes.
- `validation-results.json`: offline and n8n validateOnly proof.

Run locally from the Ops worktree:

```sh
node --test n8n/patches/2026-08-19-request-segmentation-phase2-cx8/cx8-contract.test.mjs
node n8n/patches/2026-08-19-request-segmentation-phase2-cx8/workflow-patch.mjs
```

The second command prints the forward, reverse and validateOnly payloads. It does not call n8n.

## Exact delta

The patch changes five nodes and seven fields:

1. `claim-jobs.parameters.url`: source-specific Claim RPC to the generic Claim RPC, so both normal intake and `gold_re_evaluation` jobs can be claimed.
2. `claim-jobs.parameters.jsonBody`: removes `p_source`; pins taxonomy `nt_taxonomy_v2_20260819_cx8`, classifier `segment_classifier_v3_20260819_cx8` and prompt `segment_prompt_v4_20260819_cx8`.
3. `build-prompt.parameters.jsCode`: validates the complete CX8 DB contract, including exact `required_evidence_code`, strips legacy/history segment and commercial-policy anchors, and builds the pinned prompt without a fallback.
4. `openai-classifier.parameters.simplify`: sets `false` so raw Responses API items are observable.
5. `openai-classifier.parameters.options.textFormat.textOptions.schema`: static strict CX8-only schema, context tags, nullable scale and exact evidence-code enum.
6. `validate-output.parameters.jsCode`: validates the model contract, evidence semantics and provenance, then prepares the unchanged Record RPC body.
7. `build-failure-payload.parameters.jsCode`: accepts only a real UUID and resolves job lineage from Validator, Build, Get, Normalize or Claim output; OpenAI response IDs such as `resp_*` can never become `p_job_id`.

Topology, trigger, credentials, settings, node count, Record node and activation/publication state are outside the patch and must remain byte-for-byte unchanged apart from any n8n-owned version metadata created by a later approved write.

## Evidence and failure contract

Actual web-search evidence is read only from raw `output[]` items with `type === "web_search_call"`; the allowlist is `item.action.sources[].url`, and `item.id` becomes `source_ref`. The existing OpenAI node already has `builtInTools.webSearch` and `options.include = ["web_search_call.action.sources"]`. Its exposed configuration has no force-search/tool-choice setting, so the prompt requests search when needed and the Validator safely downgrades if the model declines it. The positive `web_search_call` test is an explicitly synthetic raw-shape fixture; no live search or workflow execution was performed.

Verified DB-cache evidence forms the second allowlist. Build and Validator require the exact cache triple `nt_taxonomy_v2_20260819_cx8` / `segment_classifier_v3_20260819_cx8` / `segment_prompt_v4_20260819_cx8`, `evidence_contract_valid=true`, a definition-matched `required_evidence_code`, and consistent `validated_evidence_count`/`validated_evidence_uses`. A cache item is then accepted only when normalized URL, original cache `evidence_code`, original cache `used_for`, and derived `source_ref=cache_key` match together. The model cannot relabel cached company identity, stale classifier/prompt output, or another segment's code into positive role evidence. Missing or mismatched cache rows are ordinary cache misses; they do not create a technical job failure. Model-invented URLs, non-HTTP URLs, unsupported/private hosts, or URLs absent from both allowlists are removed and produce `needs_review`. Normalized URLs are written identically to `p_evidence_json` and `evidence_provenance.verified_sources`.

Technical contract failures throw and follow the existing workflow error path: malformed response, extra/missing schema keys, wrong taxonomy version, retired segment, or invalid enum. Semantic uncertainty is non-throwing: it records `p_status=needs_review`, preserves a classified model proposal in `p_segment`/`model_proposed_segment`, and keeps the validated/effective `classifier_json.segment` null.

The Validator owns `taxonomy_contract_mismatch` and `evidence_provenance_unverified`; the model cannot emit them. Primary positive evidence is DB-identical: NT-10 requires `institution_status`; NT-1/3/4/5/6/9 require `segment_role`. `company_identity`, `organization_scale`, `context_tag`, and `conflict` cannot replace the primary role item. NT-8 requires exact normalized first-party `customer_type=privat`; NT-9 requires exact `gewerblich|b2b`; a first-party private choice blocks every non-NT8 proposal. NT-5 and NT-6 require a separate verified `organization_scale` item in addition to primary role evidence, and NT-6 requires exact `enterprise`. NT-10 institutional evidence is not blocked merely because the model's `firmographic.is_company` is false. The prompt consistently exposes the untrusted form hint as `request.declared_customer_type`.

Validator-, OpenAI-, and Record-node errors use the existing failure RPC only after `Build Failure Payload` resolves a real job UUID from deterministic workflow lineage. If no UUID exists, it returns no item instead of sending a malformed failure call.

## Staged rollout

The DB base migration keeps v2 inactive. With the n8n patch later applied but before the separate approved policy flip, the exact v3 Claim returns an empty set. After the explicit activation artifact flips to the matching CX8 policy, the generic Claim admits only jobs matching all three pinned contract versions, independent of source. No workflow deactivation is required.

Before any later live write, re-fetch full draft and active workflow state and reject drift from version `9728db44-1dde-4b92-bcc7-defd60b063d3`, counter `112`, graph hash `ba4716a95ba911248400229eedf538f62621c798f717db93eaed2219813c3ba9`, and the complete expected diff. Re-run forward validateOnly.

Publishing is a mandatory separate gate and is not part of this artifact:

1. Apply the forward operations to the draft only under separate approval.
2. Re-fetch the complete draft and reject any change outside the seven-field allowlist, including topology, credentials, settings, trigger, Record node, node count or activation state.
3. Only after that comparison is clean, obtain the separate publish approval and publish the reviewed draft without changing workflow activation.
4. Re-fetch `mode=active`; require the published active version to match the reviewed draft graph and require `active=true` before the DB CX8 policy flip is permitted.

Rollback is equally gated. If the forward draft was never published, apply the reverse operations to the draft and verify that the active graph stayed on the old version. If CX8 was published, do not reverse-publish in isolation: coordinate the DB policy rollback and n8n reverse so the exact-contract Claim remains fail-closed during the transition. The mandatory canonical order when v2 is active is: drain all processing v2 jobs, atomically flip the DB policy from v2 back to v1, verify that the still-published v3 Claim returns an empty set, and only then apply/review/publish the exact n8n reverse to v1 and perform the same active readback. Do not publish the n8n reverse while v2 is still active. Every live apply, policy flip and publish requires its own approval; this preparation performs none of them.

## Read-only runtime evidence used during the audit

PII-free execution IDs inspected: Phase-2/Phase-1-natural `5181503`, `5182518`; historical accepted paths `5177927`, `5175342`, `5173109`, `5172847`. They showed no observable actual `web_search_call`; some historic outputs contained model-supplied URLs. No execution was started for this preparation.
