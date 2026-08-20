import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CLASSIFIER_VERSION,
  PROMPT_VERSION,
  TAXONOMY_VERSION
} from "../2026-08-19-request-segmentation-phase2-cx8/cx8-contract-source.mjs";
import {
  VALIDATOR_CODE_AFTER,
  VALIDATOR_CODE_BEFORE
} from "./validator-fix-source.mjs";
import {
  applyOperationsInMemory,
  createPatchBundle,
  loadPreparedPrestate,
  VALIDATOR_NODE_ID,
  WORKFLOW_ID
} from "./workflow-patch.mjs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

function sourceFixture() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION,
    job: {
      id: JOB_ID,
      request_id: REQUEST_ID,
      input_hash: "synthetic-input-hash-no-pii"
    },
    model: "gpt-5-mini",
    request: { customer_type: "" },
    domainFacts: {
      email_domain: null,
      is_freemail: false,
      is_shared_provider: false
    },
    researchCache: [],
    researchPolicy: { external_research_required: false },
    taxonomyContract: { definitions: [] }
  };
}

function needsReviewModel() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision: "needs_review",
    segment: null,
    confidence: 0.41,
    evidence_grade: "none",
    reasoning_short: "Synthetic ambiguity remains unresolved.",
    reason_codes: ["synthetic_ambiguous"],
    evidence: [],
    firmographic: {
      is_company: false,
      company_name: null,
      website: null,
      industry: null,
      email_domain: null,
      is_freemail: false
    },
    risk_flags: ["ambiguous_segment"],
    context_tags: [],
    organization_scale: null
  };
}

// Sanitized from the root shape observed in natural execution 5207538.
// No request, customer, company, domain, prompt, token, or source data is retained.
function sanitizedResponsesRoot(outputText) {
  return {
    id: "resp_sanitized_phase3",
    object: "response",
    status: "completed",
    model: "gpt-5-mini",
    output: [
      {
        id: "msg_sanitized_phase3",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text: outputText
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "neontrip_customer_segment",
        strict: true
      },
      verbosity: "medium"
    }
  };
}

function runValidator(code, ai, source = sourceFixture()) {
  const run = new Function("$input", "$", code);
  const result = run(
    { first: () => ({ json: ai }) },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return { first: () => ({ json: source }) };
    }
  );
  return result[0].json;
}

test("sanitized real Responses root reproduces the Phase-2 metadata-first failure", () => {
  const ai = sanitizedResponsesRoot(needsReviewModel());
  assert.throws(
    () => runValidator(VALIDATOR_CODE_BEFORE, ai),
    (error) => error.name === "classifier_output_contract_invalid"
      && error.message === "Classifier output keys do not match the strict CX8 schema."
  );
});

test("Responses output/content wins over root text configuration and records needs_review/null", () => {
  const ai = sanitizedResponsesRoot(needsReviewModel());
  const result = runValidator(VALIDATOR_CODE_AFTER, ai);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, null);
  assert.equal(result.rpcBody.p_classifier_json.decision, "needs_review");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.equal(result.rpcBody.p_job_id, JOB_ID);
  assert.equal(Object.keys(result.rpcBody).length, 18);
});

test("object-valued text is accepted only when it is the exact structured output", () => {
  const structured = runValidator(VALIDATOR_CODE_AFTER, { text: needsReviewModel() });
  assert.equal(structured.rpcBody.p_status, "needs_review");
  assert.equal(structured.rpcBody.p_segment, null);

  assert.throws(
    () => runValidator(VALIDATOR_CODE_AFTER, {
      text: {
        format: { type: "json_schema", name: "neontrip_customer_segment" },
        verbosity: "medium"
      }
    }),
    (error) => error.name === "Error"
      && error.message === "classifier_output_contract_invalid: Classifier output is not a structured object."
  );
});

test("malformed output reports a stable useful Error message instead of a custom Error name", () => {
  const ai = sanitizedResponsesRoot("{malformed");
  assert.throws(
    () => runValidator(VALIDATOR_CODE_AFTER, ai),
    (error) => error.name === "Error"
      && error.message === "classifier_output_malformed: Classifier returned malformed JSON."
  );
});

test("patch changes exactly one Validator field and exact reverse restores the full draft", () => {
  const { draft, active } = loadPreparedPrestate();
  const bundle = createPatchBundle();
  assert.equal(bundle.workflow_id, WORKFLOW_ID);
  assert.equal(bundle.forward.operations.length, 1);
  assert.equal(bundle.reverse.operations.length, 1);
  assert.equal(bundle.expected_diff.length, 1);
  assert.deepEqual(bundle.expected_diff.map((item) => [item.node_id, item.field_path]), [
    [VALIDATOR_NODE_ID, "parameters.jsCode"]
  ]);
  const expectedDiffArtifact = JSON.parse(fs.readFileSync(
    new URL("./expected-diff.json", import.meta.url),
    "utf8"
  ));
  assert.equal(expectedDiffArtifact.workflow_id, WORKFLOW_ID);
  assert.equal(expectedDiffArtifact.operation_count, 1);
  assert.equal(expectedDiffArtifact.changed_field_count, 1);
  assert.deepEqual(expectedDiffArtifact.fields, bundle.expected_diff);
  assert.deepEqual(
    { nodes: draft.nodes, connections: draft.connections, settings: draft.settings },
    { nodes: active.nodes, connections: active.connections, settings: active.settings }
  );

  const forward = applyOperationsInMemory(draft, bundle.forward.operations);
  const changedValidator = forward.nodes.find((node) => node.id === VALIDATOR_NODE_ID);
  assert.equal(changedValidator.parameters.jsCode, VALIDATOR_CODE_AFTER);
  assert.deepEqual(forward.connections, draft.connections);
  assert.deepEqual(forward.settings, draft.settings);
  assert.equal(forward.nodes.length, draft.nodes.length);

  const reverse = applyOperationsInMemory(forward, bundle.reverse.operations);
  assert.deepEqual(reverse, draft);
});
