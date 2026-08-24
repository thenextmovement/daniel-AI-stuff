import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILD_CODE_AFTER,
  CLASSIFIER_MODEL,
  CLASSIFIER_REASONING_EFFORT,
  CLASSIFIER_VERSION,
  POLICY_VERSION,
  PROMPT_VERSION,
  QUALITY_GATE_VERSION,
  RESEARCH_CONTRACT,
  RESEARCH_MODEL,
  SOURCE,
  TAXONOMY_VERSION,
  TREATMENT_CONTRACT,
  VALIDATOR_VERSION
} from "../2026-08-21-request-segmentation-treatment-shadow-always-on/treatment-shadow-source.mjs";
import {
  DOMAIN_SCOPE_AFTER,
  DOMAIN_SCOPE_BEFORE,
  PREPARE_CODE_AFTER,
  PREPARE_CODE_BEFORE
} from "./offdomain-source.mjs";
import {
  applyOperationsInMemory,
  createArtifactFiles,
  createPatchBundle,
  loadPreparedPrestate
} from "./workflow-patch.mjs";
import {
  CONTEXT_TAGS,
  CX8_SEGMENTS,
  ORGANIZATION_SCALES,
  SEGMENT_EVIDENCE_CODES
} from "../2026-08-19-request-segmentation-phase2-cx8/cx8-contract-source.mjs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const IN_DOMAIN_URL = "https://example.com/leistungen";
const OFF_DOMAIN_URL = "https://www.google.com/maps/search/example?utm_source=openai";

function definitionFor(segment) {
  return {
    ...segment,
    description: `Synthetic definition for ${segment.segment}.`,
    inclusion_criteria: [`Positive criterion for ${segment.segment}.`],
    required_evidence: [`Required evidence for ${segment.segment}.`],
    required_evidence_code: SEGMENT_EVIDENCE_CODES[segment.segment],
    exclusion_criteria: [`Exclusion criterion for ${segment.segment}.`],
    tie_breaker: `Tie breaker for ${segment.segment}.`
  };
}

function job() {
  return {
    id: JOB_ID,
    request_id: REQUEST_ID,
    input_hash: "synthetic-current-input-hash",
    source: SOURCE,
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION
  };
}

function payload() {
  return {
    contract: {
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      policy_version: POLICY_VERSION,
      quality_gate_version: QUALITY_GATE_VERSION,
      research_contract: RESEARCH_CONTRACT,
      treatment_contract: TREATMENT_CONTRACT,
      source: SOURCE,
      evaluation_only: false,
      master_projection_authorized: true,
      validator_version: VALIDATOR_VERSION,
      research_model: RESEARCH_MODEL,
      classifier_model: CLASSIFIER_MODEL,
      classifier_reasoning_effort: CLASSIFIER_REASONING_EFFORT
    },
    input: {
      title: "Synthetic request",
      description: "Wir benötigen ein Schild für unser kleines Eventstudio.",
      declared_customer_type: "unknown",
      declared_customer_type_first_party_verified: false,
      application: "Innenbereich",
      country: "DE",
      company: null,
      company_lookup_allowed: false,
      email_domain: "example.com",
      domain_facts: {
        is_valid_dns_host: true,
        is_freemail: false,
        is_shared_provider: false,
        email_domain_cache_allowed: true,
        domain_lookup_allowed: true
      }
    },
    taxonomy: {
      version: TAXONOMY_VERSION,
      lifecycle_status: "shadow",
      decision_unit: "requesting_or_contracting_entity",
      default_outcome: "needs_review",
      definitions: CX8_SEGMENTS.map(definitionFor),
      tie_break_order: CX8_SEGMENTS.map((item) => item.segment)
    },
    context_definitions: CONTEXT_TAGS.map((contextTag) => ({
      context_tag: contextTag,
      label: `Label ${contextTag}`,
      description: `Synthetic context for ${contextTag}.`
    })),
    organization_scale_values: [...ORGANIZATION_SCALES]
  };
}

function runBuild() {
  const run = new Function("$input", "$", BUILD_CODE_AFTER);
  return run(
    { all: () => [{ json: payload() }] },
    (nodeName) => {
      assert.equal(nodeName, "Normalize Claimed Jobs");
      return { itemMatching: () => ({ json: job() }) };
    }
  )[0].json;
}

function researchResponse(built, sources, annotations = []) {
  return {
    id: "resp_synthetic_research",
    status: "completed",
    incomplete_details: null,
    model: RESEARCH_MODEL,
    output: [
      {
        id: "ws_synthetic_research",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: built.researchPlan.query,
          sources: sources.map((url) => ({ type: "url", url, title: "Synthetic source" }))
        }
      },
      {
        id: "msg_synthetic_research",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "Synthetic source-grounded summary.",
          annotations: annotations.map((url) => ({
            type: "url_citation",
            url,
            title: "Synthetic citation"
          }))
        }]
      }
    ]
  };
}

function runPrepare(incoming, built) {
  const run = new Function("$input", "$", PREPARE_CODE_AFTER);
  return run(
    { all: () => [{ json: incoming }] },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return { itemMatching: () => ({ json: built }) };
    }
  )[0].json;
}

test("pinned Counter-137 workflow is exact and the patch round-trips", () => {
  const { draft, active } = loadPreparedPrestate();
  assert.equal(draft.versionId, "f333c2b1-6114-4aaa-8f7d-b18d9e4999b7");
  assert.equal(draft.versionCounter, 137);
  assert.equal(draft.activeVersionId, draft.versionId);
  assert.equal(active.activeVersionId, draft.versionId);
  assert.equal(draft.nodes.length, 23);
  assert.deepEqual(
    { nodes: draft.nodes, connections: draft.connections, settings: draft.settings },
    { nodes: active.nodes, connections: active.connections, settings: active.settings }
  );
  const bundle = createPatchBundle();
  const candidate = applyOperationsInMemory(draft, bundle.forward.operations);
  assert.equal(bundle.forward.operations.length, 1);
  assert.equal(bundle.reverse.operations.length, 1);
  assert.deepEqual(applyOperationsInMemory(candidate, bundle.reverse.operations), draft);
});

test("only the exact domain survives provider-added off-domain sources", () => {
  const built = runBuild();
  const prepared = runPrepare(
    researchResponse(
      built,
      [OFF_DOMAIN_URL, IN_DOMAIN_URL],
      [OFF_DOMAIN_URL, IN_DOMAIN_URL]
    ),
    built
  );
  assert.equal(prepared.researchEvidence.valid, true);
  assert.equal(prepared.researchEvidence.performed, true);
  assert.deepEqual(
    prepared.researchEvidence.sources.map((source) => source.url),
    [IN_DOMAIN_URL]
  );
  assert.equal(JSON.stringify(prepared).includes("google.com"), false);
});

test("an all-off-domain provider result is ignored and remains provenance-missing", () => {
  const built = runBuild();
  const prepared = runPrepare(
    researchResponse(built, [OFF_DOMAIN_URL], [OFF_DOMAIN_URL]),
    built
  );
  assert.equal(prepared.researchEvidence.valid, false);
  assert.equal(prepared.researchEvidence.performed, true);
  assert.deepEqual(prepared.researchEvidence.sources, []);
  assert.equal(
    prepared.researchEvidence.abstention_code,
    "treatment_shadow_research_provenance_missing"
  );
});

test("malformed sources and an invalid authorized domain still fail closed", () => {
  const built = runBuild();
  assert.throws(
    () => runPrepare(researchResponse(built, ["not-a-url"]), built),
    (error) => error && error.name === "treatment_shadow_research_source_invalid"
  );

  const invalidDomainBuild = runBuild();
  invalidDomainBuild.researchPlan.lookup_value = "localhost";
  assert.throws(
    () => runPrepare(researchResponse(invalidDomainBuild, [IN_DOMAIN_URL]), invalidDomainBuild),
    (error) => error && error.name === "treatment_shadow_research_domain_scope_invalid"
  );
});

test("generated artifacts describe one field-only change and an exact reverse", () => {
  const files = createArtifactFiles();
  assert.deepEqual(Object.keys(files).sort(), [
    "expected-diff.json",
    "forward-patch.json",
    "full-diff.json",
    "reverse-patch.json"
  ]);
  assert.equal(files["forward-patch.json"].patch.operations.length, 1);
  assert.equal(files["full-diff.json"].changed_nodes.length, 1);
  assert.equal(files["full-diff.json"].connections_unchanged, true);
  assert.equal(files["full-diff.json"].settings_unchanged, true);
  assert.equal(files["full-diff.json"].activation_unchanged, true);
  assert.equal(PREPARE_CODE_BEFORE.split(DOMAIN_SCOPE_BEFORE).length - 1, 1);
  assert.equal(PREPARE_CODE_AFTER.split(DOMAIN_SCOPE_AFTER).length - 1, 1);
});
