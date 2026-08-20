import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ACCEPTED_BY_AFTER,
  BUILD_CODE_AFTER,
  BUILD_CODE_BEFORE,
  CLAIM_NODE_ID,
  CLASSIFIER_NODE_ID,
  CLASSIFIER_NODE_BEFORE,
  CLASSIFIER_PARAMETERS_AFTER,
  CLASSIFIER_VERSION_AFTER,
  POLICY_VERSION_AFTER,
  PROMPT_VERSION,
  QUALITY_GATE_VERSION_AFTER,
  STRICT_OUTPUT_SCHEMA,
  TAXONOMY_VERSION,
  VALIDATOR_CODE_AFTER,
  VALIDATOR_VERSION,
  evaluateResponsesJsonBody,
  promptConstructionSource
} from "./forced-research-source.mjs";
import {
  applyOperationsInMemory,
  createPatchBundle,
  loadPreparedPrestate,
  WORKFLOW_ID
} from "./workflow-patch.mjs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_URL = "https://example.com/services";

function sourceFixture(researchRequired = true) {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION_AFTER,
    prompt_version: PROMPT_VERSION,
    job: {
      id: JOB_ID,
      request_id: REQUEST_ID,
      input_hash: "synthetic-input-hash-no-pii"
    },
    model: "gpt-4o-mini",
    request: { customer_type: "b2b" },
    domainFacts: {
      email_domain: "example.com",
      is_freemail: false,
      is_shared_provider: false
    },
    researchCache: [],
    researchPolicy: { external_research_required: researchRequired },
    taxonomyContract: {
      definitions: [
        {
          segment: "NT-4",
          required_evidence_code: "verified_client_project_intermediary"
        }
      ]
    },
    systemPrompt: "synthetic-system-prompt",
    userPrompt: "synthetic-user-prompt"
  };
}

function acceptedModel() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision: "classified",
    segment: "NT-4",
    confidence: 0.94,
    evidence_grade: "strong",
    reasoning_short: "Verified synthetic company evidence matches the intermediary role.",
    reason_codes: ["verified_intermediary_role"],
    evidence: [
      {
        type: "web_search",
        url: SOURCE_URL,
        used_for: "segment_role",
        evidence_code: "verified_client_project_intermediary"
      }
    ],
    firmographic: {
      is_company: true,
      company_name: "Synthetic Example Company",
      website: "https://example.com",
      industry: "Synthetic services",
      email_domain: "example.com",
      is_freemail: false
    },
    risk_flags: [],
    context_tags: [],
    organization_scale: null
  };
}

function rawResponsesRoot(model, includeWebSearchCall = true) {
  return {
    id: "resp_synthetic_phase5",
    object: "response",
    status: "completed",
    model: "gpt-4o-mini-2024-07-18",
    output: [
      ...(includeWebSearchCall
        ? [{
          id: "ws_synthetic_phase5",
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            queries: ["synthetic company role"],
            sources: [
              {
                type: "url",
                url: SOURCE_URL
              }
            ]
          }
        }]
        : []),
      {
        id: "msg_synthetic_phase5",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            text: JSON.stringify(model)
          }
        ]
      }
    ]
  };
}

function runValidator(ai, source = sourceFixture()) {
  const run = new Function("$input", "$", VALIDATOR_CODE_AFTER);
  const result = run(
    { first: () => ({ json: ai }) },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return { first: () => ({ json: source }) };
    }
  );
  return result[0].json;
}

function changedLeafPaths(before, after, prefix = "") {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
      return [prefix];
    }
    return before.flatMap((value, index) =>
      changedLeafPaths(value, after[index], prefix ? prefix + "." + index : String(index))
    );
  }
  if (before === null || after === null
      || typeof before !== "object" || typeof after !== "object") {
    return [prefix];
  }
  const paths = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const next = prefix ? prefix + "." + key : key;
    if (!(key in before) || !(key in after)) {
      paths.push(next);
    } else {
      paths.push(...changedLeafPaths(before[key], after[key], next));
    }
  }
  return paths;
}

test("research-required request body offers only web_search and forces a tool call", () => {
  const body = evaluateResponsesJsonBody(sourceFixture(true));
  assert.equal(body.model, "gpt-4o-mini");
  assert.deepEqual(body.input, [
    { role: "system", content: "synthetic-system-prompt" },
    { role: "user", content: "synthetic-user-prompt" }
  ]);
  assert.deepEqual(body.tools, [{
    type: "web_search",
    search_context_size: "medium",
    user_location: { type: "approximate", country: "DE" }
  }]);
  assert.equal(body.tool_choice, "required");
  assert.equal(body.temperature, 0.1);
  assert.equal(body.max_output_tokens, 1400);
  assert.deepEqual(body.include, ["web_search_call.action.sources"]);
  assert.equal(body.store, true);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "neontrip_segment_classification");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, STRICT_OUTPUT_SCHEMA);
});

test("research-not-required request body disables all tools deterministically", () => {
  const body = evaluateResponsesJsonBody(sourceFixture(false));
  assert.deepEqual(body.tools, []);
  assert.equal(body.tool_choice, "none");
});

test("raw Responses root with an actual web_search_call passes the existing provenance validator", () => {
  const result = runValidator(rawResponsesRoot(acceptedModel(), true));
  assert.equal(result.rpcBody.p_status, "accepted");
  assert.equal(result.rpcBody.p_segment, "NT-4");
  assert.equal(result.rpcBody.p_classifier_version, CLASSIFIER_VERSION_AFTER);
  assert.equal(result.rpcBody.p_prompt_version, PROMPT_VERSION);
  assert.equal(result.rpcBody.p_accepted_by, ACCEPTED_BY_AFTER);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.validator_version, VALIDATOR_VERSION);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, true);
  assert.deepEqual(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources, [{
    url: SOURCE_URL,
    source_type: "web_search_call",
    source_ref: "ws_synthetic_phase5",
    validated_positive_evidence_codes: ["verified_client_project_intermediary"]
  }]);
});

test("claimed web evidence without a web_search_call stays fail-closed", () => {
  const result = runValidator(rawResponsesRoot(acceptedModel(), false));
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, false);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources.length, 0);
  assert.ok(result.rpcBody.p_risk_flags.includes("invalid_external_evidence"));
  assert.ok(result.rpcBody.p_risk_flags.includes("evidence_provenance_unverified"));
  assert.ok(result.rpcBody.p_risk_flags.includes("missing_external_company_evidence"));
});

test("version pins change while taxonomy, prompt construction, schema, and validator logic stay fixed", () => {
  assert.ok(BUILD_CODE_AFTER.includes(
    'const POLICY_VERSION = "' + POLICY_VERSION_AFTER + '";'
  ));
  assert.ok(BUILD_CODE_AFTER.includes(
    'const CLASSIFIER_VERSION = "' + CLASSIFIER_VERSION_AFTER + '";'
  ));
  assert.ok(BUILD_CODE_AFTER.includes(
    'const PROMPT_VERSION = "' + PROMPT_VERSION + '";'
  ));
  assert.ok(BUILD_CODE_AFTER.includes(
    'const QUALITY_GATE_VERSION = "' + QUALITY_GATE_VERSION_AFTER + '";'
  ));
  assert.equal(promptConstructionSource(BUILD_CODE_AFTER), promptConstructionSource(BUILD_CODE_BEFORE));
  assert.deepEqual(
    JSON.parse(CLASSIFIER_NODE_BEFORE.parameters.options.textFormat.textOptions.schema),
    STRICT_OUTPUT_SCHEMA
  );
  assert.equal(CLASSIFIER_PARAMETERS_AFTER.url, "https://api.openai.com/v1/responses");
  assert.equal(CLASSIFIER_PARAMETERS_AFTER.authentication, "predefinedCredentialType");
  assert.equal(CLASSIFIER_PARAMETERS_AFTER.nodeCredentialType, "openAiApi");
});

test("patch changes exactly six approved fields and the reverse restores the full workflow", () => {
  const { draft, active } = loadPreparedPrestate();
  const bundle = createPatchBundle();
  assert.equal(bundle.workflow_id, WORKFLOW_ID);
  assert.equal(bundle.forward.operations.length, 4);
  assert.equal(bundle.reverse.operations.length, 4);
  assert.equal(bundle.expected_diff.length, 6);
  assert.deepEqual(
    bundle.expected_diff.map((item) => [item.node_id, item.field_path]),
    [
      ["claim-jobs", "parameters.jsonBody"],
      ["build-prompt", "parameters.jsCode"],
      ["openai-classifier", "type"],
      ["openai-classifier", "typeVersion"],
      ["openai-classifier", "parameters"],
      ["validate-output", "parameters.jsCode"]
    ]
  );

  const expectedDiffArtifact = JSON.parse(fs.readFileSync(
    new URL("./expected-diff.json", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(expectedDiffArtifact.fields, bundle.expected_diff);
  const fullDiffArtifact = JSON.parse(fs.readFileSync(
    new URL("./full-diff.json", import.meta.url),
    "utf8"
  ));
  assert.equal(fullDiffArtifact.changed_node_count, 4);
  assert.equal(fullDiffArtifact.changed_field_count, 6);
  for (const field of fullDiffArtifact.fields) {
    const forwardOperation = bundle.forward.operations.find(
      (operation) => operation.nodeId === field.node_id
    );
    const reverseOperation = bundle.reverse.operations.find(
      (operation) => operation.nodeId === field.node_id
    );
    assert.deepEqual(field.after, forwardOperation.updates[field.field_path]);
    assert.deepEqual(field.before, reverseOperation.updates[field.field_path]);
  }

  assert.deepEqual(
    { nodes: draft.nodes, connections: draft.connections, settings: draft.settings },
    { nodes: active.nodes, connections: active.connections, settings: active.settings }
  );

  const forward = applyOperationsInMemory(draft, bundle.forward.operations);
  const changedPaths = changedLeafPaths(draft, forward);
  assert.ok(changedPaths.includes("nodes.0.parameters.jsonBody"));
  assert.deepEqual(forward.connections, draft.connections);
  assert.deepEqual(forward.settings, draft.settings);
  assert.equal(forward.nodes.length, draft.nodes.length);

  const beforeClassifier = draft.nodes.find((node) => node.id === CLASSIFIER_NODE_ID);
  const afterClassifier = forward.nodes.find((node) => node.id === CLASSIFIER_NODE_ID);
  assert.equal(afterClassifier.id, beforeClassifier.id);
  assert.equal(afterClassifier.name, beforeClassifier.name);
  assert.deepEqual(afterClassifier.position, beforeClassifier.position);
  assert.deepEqual(afterClassifier.credentials, beforeClassifier.credentials);
  assert.equal(afterClassifier.type, "n8n-nodes-base.httpRequest");
  assert.equal(afterClassifier.typeVersion, 4.4);
  assert.deepEqual(afterClassifier.parameters, CLASSIFIER_PARAMETERS_AFTER);

  const beforeClaim = draft.nodes.find((node) => node.id === CLAIM_NODE_ID);
  const afterClaim = forward.nodes.find((node) => node.id === CLAIM_NODE_ID);
  assert.deepEqual(afterClaim.credentials, beforeClaim.credentials);

  const reverse = applyOperationsInMemory(forward, bundle.reverse.operations);
  assert.deepEqual(reverse, draft);
});
