import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  BUILD_CODE_AFTER,
  CLASSIFIER_BODY_EXPRESSION,
  CLASSIFIER_MODEL,
  CLASSIFIER_PARAMETERS_AFTER,
  CLASSIFIER_REASONING_EFFORT,
  CLASSIFIER_VERSION,
  POLICY_VERSION,
  PREPARE_CODE,
  PREPARE_NODE_ID,
  PROMPT_VERSION,
  QUALITY_GATE_VERSION,
  RESEARCH_BODY_EXPRESSION,
  RESEARCH_CONTRACT,
  RESEARCH_MODEL,
  RESEARCH_NODE,
  SOURCE,
  STRICT_OUTPUT_SCHEMA,
  TAXONOMY_VERSION,
  URL_RUNTIME_HELPER_SOURCE,
  VALIDATOR_CODE_AFTER,
  VALIDATOR_NODE_ID,
  VALIDATOR_VERSION,
  evaluateBodyExpression
} from "./url-runtime-repair-source.mjs";
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

const JOB_ID_A = "11111111-1111-4111-8111-111111111111";
const JOB_ID_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID_A = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID_B = "44444444-4444-4444-8444-444444444444";
const SOURCE_URL = "https://example.com/services";

function definitionFor(segment) {
  return {
    ...segment,
    description: "Complete synthetic definition for " + segment.segment + " with enough detail.",
    inclusion_criteria: ["Positive criterion for " + segment.segment + "."],
    required_evidence: ["Required evidence for " + segment.segment + "."],
    required_evidence_code: SEGMENT_EVIDENCE_CODES[segment.segment],
    exclusion_criteria: ["Exclusion criterion for " + segment.segment + "."],
    tie_breaker: "Deterministic synthetic tie breaker for " + segment.segment + " with enough detail."
  };
}

function job(id = JOB_ID_A, requestId = REQUEST_ID_A) {
  return {
    id,
    request_id: requestId,
    input_hash: "input-hash-" + id.slice(0, 8),
    source: SOURCE,
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION
  };
}

function payload(overrides = {}) {
  const domainFacts = {
    is_valid_dns_host: true,
    is_freemail: false,
    is_shared_provider: false,
    email_domain_cache_allowed: true,
    domain_lookup_allowed: true,
    ...(overrides.domain_facts || {})
  };
  const input = {
    title: "Synthetic request",
    description: "Synthetic minimized request context.",
    declared_customer_type: "unknown",
    declared_customer_type_first_party_verified: false,
    application: "Synthetic application",
    country: "DE",
    company: "Synthetic Media GmbH",
    company_lookup_allowed: true,
    email_domain: "example.com",
    domain_facts: domainFacts,
    ...(overrides.input || {})
  };
  input.domain_facts = domainFacts;
  return {
    contract: {
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      policy_version: POLICY_VERSION,
      quality_gate_version: QUALITY_GATE_VERSION,
      research_contract: RESEARCH_CONTRACT,
      source: SOURCE,
      evaluation_only: true,
      master_projection_authorized: false,
      validator_version: VALIDATOR_VERSION,
      research_model: RESEARCH_MODEL,
      classifier_model: CLASSIFIER_MODEL,
      classifier_reasoning_effort: CLASSIFIER_REASONING_EFFORT
    },
    input,
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
      label: "Label " + contextTag,
      description: "Synthetic context definition for " + contextTag + "."
    })),
    organization_scale_values: [...ORGANIZATION_SCALES]
  };
}

function runBuild(payloads, jobs) {
  const run = new Function("$input", "$", BUILD_CODE_AFTER);
  return run(
    { all: () => payloads.map((value) => ({ json: value })) },
    (nodeName) => {
      assert.equal(nodeName, "Normalize Claimed Jobs");
      return {
        itemMatching: (index) => ({ json: jobs[index] })
      };
    }
  );
}

function rawResearch(source, overrides = {}) {
  const query = overrides.query ?? source.researchPlan.query;
  const sourceUrl = overrides.sourceUrl ?? SOURCE_URL;
  const sources = Object.prototype.hasOwnProperty.call(overrides, "sources")
    ? overrides.sources
    : [
    { type: "url", url: sourceUrl, title: "Synthetic official source" }
  ];
  const extraCalls = overrides.extraCalls || [];
  const action = {
    type: "search",
    query
  };
  if (overrides.omitActionSources !== true) action.sources = sources;
  const searchCall = {
    id: overrides.searchCallId || "ws_phase6_research",
    type: "web_search_call",
    status: "completed",
    action
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "results")) {
    searchCall.results = overrides.results;
  }
  return {
    id: overrides.responseId || "resp_phase6_research",
    object: "response",
    status: overrides.status || "completed",
    incomplete_details: overrides.incompleteDetails ?? null,
    model: overrides.model || RESEARCH_MODEL,
    output: [
      searchCall,
      ...extraCalls,
      {
        id: "msg_phase6_research",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          annotations: overrides.annotations ?? [],
          text: "Synthetic bounded company research summary."
        }]
      }
    ]
  };
}

function runPrepare(incoming, buildSources) {
  const run = new Function("$input", "$", PREPARE_CODE);
  return run(
    { all: () => incoming.map((value) => ({ json: value })) },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return {
        itemMatching: (index) => ({ json: buildSources[index] })
      };
    }
  );
}

function acceptedModel() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision: "classified",
    segment: "NT-4",
    confidence: 0.94,
    evidence_grade: "strong",
    reasoning_short: "Bound official source verifies the intermediary role.",
    reason_codes: ["verified_intermediary_role"],
    evidence: [{
      type: "web_search",
      url: SOURCE_URL,
      used_for: "segment_role",
      evidence_code: "verified_client_project_intermediary"
    }],
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

function privateModel() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision: "classified",
    segment: "NT-8",
    confidence: 0.95,
    evidence_grade: "strong",
    reasoning_short: "The unverified declared type claims private use.",
    reason_codes: ["declared_private_use"],
    evidence: [{
      type: "customer_declared",
      url: null,
      used_for: "private_use",
      evidence_code: "explicit_private_use"
    }],
    firmographic: {
      is_company: false,
      company_name: null,
      website: null,
      industry: null,
      email_domain: "gmail.com",
      is_freemail: true
    },
    risk_flags: [],
    context_tags: [],
    organization_scale: null
  };
}

function directBusinessModel() {
  const model = acceptedModel();
  model.segment = "NT-9";
  model.reasoning_short = "Bound official evidence verifies a direct operating business after higher-priority roles were ruled out.";
  model.reason_codes = ["verified_direct_business", "higher_priority_roles_excluded"];
  model.evidence = [{
    type: "web_search",
    url: SOURCE_URL,
    used_for: "segment_role",
    evidence_code: "verified_direct_business"
  }];
  model.firmographic.company_name = "Synthetic Direct Business GmbH";
  return model;
}

function abstainingModel() {
  const model = acceptedModel();
  model.decision = "needs_review";
  model.segment = null;
  model.confidence = 0.45;
  model.evidence_grade = "weak";
  model.reasoning_short = "The bounded research is not sufficient for a reliable segment decision.";
  model.reason_codes = ["insufficient_segment_evidence"];
  model.evidence = [];
  model.risk_flags = ["ambiguous_segment"];
  return model;
}

function rawClassifier(model, extraOutput = []) {
  return {
    id: "resp_phase6_classifier",
    object: "response",
    status: "completed",
    incomplete_details: null,
    model: CLASSIFIER_MODEL,
    output: [
      { id: "rs_phase6_classifier", type: "reasoning", summary: [] },
      ...extraOutput,
      {
        id: "msg_phase6_classifier",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          annotations: [],
          text: JSON.stringify(model)
        }]
      }
    ]
  };
}

function runValidator(responses, prepareSources) {
  const run = new Function("$input", "$", VALIDATOR_CODE_AFTER);
  return run(
    { all: () => responses.map((value) => ({ json: value })) },
    (nodeName) => {
      assert.equal(nodeName, "Prepare Strict Classification");
      return {
        itemMatching: (index) => ({ json: prepareSources[index] })
      };
    }
  );
}

function cloneAcrossRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

function runPrepareWithoutGlobalUrl(incoming, buildSources) {
  const sandbox = {
    URL: undefined,
    $input: { all: () => incoming.map((value) => ({ json: value })) },
    $: (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return {
        itemMatching: (index) => ({ json: buildSources[index] })
      };
    },
    result: null
  };
  vm.runInNewContext(
    "result = (function () {\n" + PREPARE_CODE + "\n})();",
    sandbox
  );
  return cloneAcrossRealm(sandbox.result);
}

function runValidatorWithoutGlobalUrl(responses, prepareSources) {
  const sandbox = {
    URL: undefined,
    $input: { all: () => responses.map((value) => ({ json: value })) },
    $: (nodeName) => {
      assert.equal(nodeName, "Prepare Strict Classification");
      return {
        itemMatching: (index) => ({ json: prepareSources[index] })
      };
    },
    result: null
  };
  vm.runInNewContext(
    "result = (function () {\n" + VALIDATOR_CODE_AFTER + "\n})();",
    sandbox
  );
  return cloneAcrossRealm(sandbox.result);
}

function parseHttpUrlWithoutGlobalUrl(value) {
  const sandbox = { URL: undefined, value, result: null };
  vm.runInNewContext(
    URL_RUNTIME_HELPER_SOURCE + "\nresult = parseHttpUrl(value);",
    sandbox
  );
  return sandbox.result === null ? null : cloneAcrossRealm(sandbox.result);
}

test("current restored v3 Counter-124 prestate is pinned and forward/reverse is exact", () => {
  const { draft, active, manifest } = loadPreparedPrestate();
  assert.equal(draft.versionId, "3d1fb779-adb1-46d3-b199-b342a8800513");
  assert.equal(draft.activeVersionId, draft.versionId);
  assert.equal(draft.versionCounter, 124);
  assert.equal(draft.nodes.length, 20);
  assert.equal(Object.keys(draft.connections).length, 17);
  assert.deepEqual(
    { nodes: draft.nodes, connections: draft.connections, settings: draft.settings },
    { nodes: active.nodes, connections: active.connections, settings: active.settings }
  );
  assert.equal(manifest.draft_active_graphs_equal, true);

  const bundle = createPatchBundle();
  const candidate = applyOperationsInMemory(draft, bundle.forward.operations);
  assert.equal(candidate.nodes.length, 23);
  assert.equal(Object.keys(candidate.connections).length, 20);
  assert.equal(candidate.active, draft.active);
  assert.deepEqual(candidate.settings, draft.settings);
  const reversed = applyOperationsInMemory(candidate, bundle.reverse.operations);
  assert.deepEqual(reversed, draft);
});

test("workflow uses only dedicated Phase-6 evaluation RPCs and keeps claim limit one", () => {
  const bundle = createPatchBundle();
  const claim = bundle.forward.operations.find((item) => item.nodeId === "claim-jobs");
  const payloadNode = bundle.forward.operations.find((item) => item.nodeId === "get-payload");
  assert.match(claim.updates["parameters.url"], /neontrip_claim_request_segmentation_phase6_evaluation$/);
  assert.match(claim.updates["parameters.jsonBody"], /p_limit: 1/);
  assert.match(claim.updates["parameters.jsonBody"], /n8n-request-segmenter-v5/);
  assert.equal(claim.updates.retryOnFail, false);
  assert.equal(claim.updates.maxTries, 1);
  assert.doesNotMatch(claim.updates["parameters.url"], /neontrip_claim_request_segmentation_jobs$/);
  assert.match(payloadNode.updates["parameters.url"], /neontrip_get_request_segmentation_phase6_evaluation_payload$/);
  assert.equal(bundle.safety.general_ingress_data_unchanged, true);
  assert.equal(bundle.safety.general_ingress_processing_paused, true);
  assert.equal("general_ingress_unchanged" in bundle.safety, false);
});

test("domain path emits exactly one bounded site query and Stage-1 body contains no context or ids", () => {
  const [item] = runBuild([payload()], [job()]);
  assert.equal(
    item.json.researchPlan.query,
    "site:example.com Unternehmen Leistungen Kundenprojekte Standorte Impressum"
  );
  assert.equal(item.json.researchPlan.lookup_type, "domain");
  assert.equal(item.json.researchPlan.execute, true);
  const body = evaluateBodyExpression(RESEARCH_BODY_EXPRESSION, item.json);
  assert.deepEqual(Object.keys(body).sort(), [
    "include", "input", "instructions", "max_output_tokens", "model", "store", "tool_choice", "tools"
  ]);
  assert.equal(body.model, RESEARCH_MODEL);
  assert.equal(body.input, item.json.researchPlan.query);
  assert.equal(typeof body.input, "string");
  assert.equal(body.input.length <= 240, true);
  assert.match(body.instructions, /concise source-grounded answer/);
  assert.match(body.instructions, /inline URL citations/);
  assert.equal(body.instructions.includes(body.input), false);
  assert.equal(body.tool_choice, "required");
  assert.deepEqual(body.tools, [{
    type: "web_search",
    search_context_size: "medium",
    user_location: { type: "approximate", country: "DE" }
  }]);
  assert.deepEqual(body.include, [
    "web_search_call.action.sources",
    "web_search_call.results"
  ]);
  assert.equal(body.store, false);
  assert.equal("max_tool_calls" in body, false);
  assert.equal("parallel_tool_calls" in body, false);
  assert.equal(RESEARCH_NODE.retryOnFail, undefined);
  assert.equal(RESEARCH_NODE.maxTries, undefined);
  const serialized = JSON.stringify(body);
  for (const forbidden of [JOB_ID_A, REQUEST_ID_A, "Synthetic minimized request context", "input-hash"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("company fallback requires the exact DB gate and rejects person or PII-like values", () => {
  const valid = payload({
    input: { email_domain: null, company: "Synthetic Media GmbH", company_lookup_allowed: true },
    domain_facts: {
      is_valid_dns_host: false,
      is_freemail: false,
      is_shared_provider: false,
      email_domain_cache_allowed: false,
      domain_lookup_allowed: false
    }
  });
  const [validItem] = runBuild([valid], [job()]);
  assert.equal(validItem.json.researchPlan.lookup_type, "company");
  assert.equal(
    validItem.json.researchPlan.query,
    "Synthetic Media GmbH offizielle Website Unternehmen Leistungen Kundenprojekte Standorte"
  );

  const longLegitimateCompany = "Musterveranstaltungstechnik GmbH";
  const [longLegitimate] = runBuild([
    payload({
      input: {
        email_domain: null,
        company: longLegitimateCompany,
        company_lookup_allowed: true
      },
      domain_facts: {
        is_valid_dns_host: false,
        is_freemail: false,
        is_shared_provider: false,
        email_domain_cache_allowed: false,
        domain_lookup_allowed: false
      }
    })
  ], [job()]);
  assert.equal(
    longLegitimate.json.researchPlan.query,
    longLegitimateCompany + " offizielle Website Unternehmen Leistungen Kundenprojekte Standorte"
  );

  const sanitizedRejectedValues = [
    "NEONTRIP",
    "Max Mustermann",
    "Muster Consulting",
    "AccountA1B2C3D4E5F6G7H8I GmbH",
    "AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne AlphaBetaOne GmbH"
  ];
  for (const company of sanitizedRejectedValues) {
    const candidate = payload({
      input: { email_domain: null, company, company_lookup_allowed: true },
      domain_facts: {
        is_valid_dns_host: false,
        is_freemail: false,
        is_shared_provider: false,
        email_domain_cache_allowed: false,
        domain_lookup_allowed: false
      }
    });
    const [result] = runBuild([candidate], [job()]);
    assert.equal(result.json.researchPlan.query, null, company);
    assert.equal(result.json.researchPlan.execute, false, company);
    assert.equal(result.json.researchPlan.blocked, true, company);
  }

  const piiRejectedValues = [
    "max@example.com",
    "https://example.com",
    "+49 170 12345678",
    "11111111-1111-4111-8111-111111111111",
    "utm_campaign=sensitive"
  ];
  for (const company of piiRejectedValues) {
    const candidate = payload({
      input: { email_domain: null, company, company_lookup_allowed: true },
      domain_facts: {
        is_valid_dns_host: false,
        is_freemail: false,
        is_shared_provider: false,
        email_domain_cache_allowed: false,
        domain_lookup_allowed: false
      }
    });
    const [result] = runBuild([candidate], [job()]);
    assert.ok(result.json.failureBody, company);
    assert.equal(result.json.researchRequestBody, undefined, company);
  }

  valid.input.company_lookup_allowed = false;
  const [denied] = runBuild([valid], [job()]);
  assert.equal(denied.json.researchPlan.query, null);
  assert.equal(denied.json.researchPlan.blocked, true);
});

test("freemail or shared domain cannot become a domain query", () => {
  for (const flags of [
    { is_freemail: true, is_shared_provider: false },
    { is_freemail: false, is_shared_provider: true }
  ]) {
    const candidate = payload({
      input: { company: null, company_lookup_allowed: false, email_domain: "gmail.com" },
      domain_facts: {
        is_valid_dns_host: true,
        email_domain_cache_allowed: false,
        domain_lookup_allowed: false,
        ...flags
      }
    });
    const [result] = runBuild([candidate], [job()]);
    assert.equal(result.json.researchPlan.query, null);
    assert.equal(result.json.researchPlan.lookup_type, null);
  }
});

test("item matching carries each internal job while both OpenAI bodies stay identifier-free", () => {
  const inputs = [payload(), payload({ input: { title: "Second synthetic request" } })];
  const jobs = [job(JOB_ID_A, REQUEST_ID_A), job(JOB_ID_B, REQUEST_ID_B)];
  const built = runBuild(inputs, jobs);
  assert.equal(built[0].json.job.id, JOB_ID_A);
  assert.equal(built[1].json.job.id, JOB_ID_B);
  assert.deepEqual(built.map((item) => item.pairedItem.item), [0, 1]);
  for (const item of built) {
    const stage1 = JSON.stringify(evaluateBodyExpression(RESEARCH_BODY_EXPRESSION, item.json));
    assert.equal(stage1.includes(item.json.job.id), false);
    assert.equal(stage1.includes(item.json.job.request_id), false);
    assert.equal(stage1.includes(item.json.job.input_hash), false);
  }

  const prepared = runPrepare(
    built.map((item) => rawResearch(item.json)),
    built.map((item) => item.json)
  );
  assert.deepEqual(prepared.map((item) => item.pairedItem.item), [0, 1]);
  for (const item of prepared) {
    const stage2 = JSON.stringify(evaluateBodyExpression(CLASSIFIER_BODY_EXPRESSION, item.json));
    assert.equal(stage2.includes(item.json.job.id), false);
    assert.equal(stage2.includes(item.json.job.request_id), false);
    assert.equal(stage2.includes(item.json.job.input_hash), false);
  }
});

test("Prepare binds one completed Stage-1 query and builds a tool-free strict GPT-5.5 request", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  assert.equal(prepared.json.researchEvidence.performed, true);
  assert.equal(prepared.json.researchEvidence.query, built.json.researchPlan.query);
  assert.deepEqual(prepared.json.researchEvidence.sources, [{
    url: SOURCE_URL,
    title: "Synthetic official source",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research"
  }]);
  const body = evaluateBodyExpression(CLASSIFIER_BODY_EXPRESSION, prepared.json);
  assert.equal(body.model, CLASSIFIER_MODEL);
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.deepEqual(body.tools, []);
  assert.equal(body.tool_choice, "none");
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 8000);
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, STRICT_OUTPUT_SCHEMA);
  assert.deepEqual(
    body.text.format.schema.properties.evidence.items.properties.type.enum,
    ["web_search", "customer_declared"]
  );
  assert.equal(CLASSIFIER_PARAMETERS_AFTER.options.timeout, 300000);
});

test("documented output_text url_citation is an attributable fallback when action.sources is absent", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json, {
    omitActionSources: true,
    annotations: [{
      type: "url_citation",
      url: SOURCE_URL,
      title: "Synthetic citation source",
      start_index: 0,
      end_index: 20
    }]
  })], [built.json]);
  assert.equal(prepared.json.researchEvidence.valid, true);
  assert.equal(prepared.json.researchEvidence.abstention_code, null);
  assert.deepEqual(prepared.json.researchEvidence.sources, [{
    url: SOURCE_URL,
    title: "Synthetic citation source",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research"
  }]);
  const [validated] = runValidator([rawClassifier(acceptedModel())], [prepared.json]);
  assert.equal(validated.json.rpcBody.p_status, "accepted");
  assert.equal(validated.json.rpcBody.p_segment, "NT-4");
});

test("three observed completed exact-query responses without source fields become semantic terminal review", () => {
  const [built] = runBuild([payload()], [job()]);
  for (const caseNumber of [1, 2, 3]) {
    const observedShape = rawResearch(built.json, {
      responseId: "resp_observed_missing_sources_" + caseNumber,
      searchCallId: "ws_observed_missing_sources_" + caseNumber,
      omitActionSources: true,
      annotations: []
    });
    assert.deepEqual(
      Object.keys(observedShape.output[0].action).sort(),
      ["query", "type"]
    );
    const [prepared] = runPrepare([observedShape], [built.json]);
    const research = prepared.json.researchEvidence;
    assert.equal(research.valid, false);
    assert.equal(research.performed, true);
    assert.equal(research.abstention_code, "phase6_research_provenance_missing");
    assert.equal(research.response_id, "resp_observed_missing_sources_" + caseNumber);
    assert.equal(research.search_call_id, "ws_observed_missing_sources_" + caseNumber);
    assert.equal(research.search_call_count, 1);
    assert.equal(research.search_call_status, "completed");
    assert.equal(research.query, built.json.researchPlan.query);
    assert.deepEqual(research.sources, []);

    const [validated] = runValidator([rawClassifier(acceptedModel())], [prepared.json]);
    const rpc = validated.json.rpcBody;
    assert.equal(validated.json.failureBody, undefined);
    assert.equal(rpc.p_status, "needs_review");
    assert.equal(rpc.p_segment, null);
    assert.deepEqual(rpc.p_reason_codes, ["phase6_research_provenance_missing"]);
    assert.deepEqual(rpc.p_evidence_json, []);
    assert.ok(rpc.p_risk_flags.includes("evidence_provenance_unverified"));
    assert.deepEqual(rpc.p_classifier_json.reason_codes, ["phase6_research_provenance_missing"]);
    assert.deepEqual(rpc.p_classifier_json.evidence, []);
    assert.equal(rpc.p_classifier_json.segment, null);
    assert.equal(rpc.p_classifier_json.evidence_provenance.valid, false);
    assert.equal(rpc.p_classifier_json.evidence_provenance.research_performed, true);
    assert.equal(
      rpc.p_classifier_json.evidence_provenance.research_response_id,
      "resp_observed_missing_sources_" + caseNumber
    );
    assert.equal(
      rpc.p_classifier_json.evidence_provenance.research_call_id,
      "ws_observed_missing_sources_" + caseNumber
    );
    assert.equal(
      rpc.p_classifier_json.evidence_provenance.research_query,
      built.json.researchPlan.query
    );
    assert.deepEqual(
      rpc.p_classifier_json.evidence_provenance.validated_positive_evidence_codes,
      []
    );
    assert.deepEqual(rpc.p_classifier_json.evidence_provenance.verified_sources, []);
  }
});

test("web_search_call.results is observability only and cannot become evidence", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json, {
    omitActionSources: true,
    annotations: [],
    results: [{
      type: "url",
      url: "https://unrelated.example.org/results-only",
      title: "Must not become evidence"
    }]
  })], [built.json]);
  assert.equal(prepared.json.researchEvidence.valid, false);
  assert.deepEqual(prepared.json.researchEvidence.sources, []);
  const [validated] = runValidator([rawClassifier(acceptedModel())], [prepared.json]);
  assert.equal(validated.json.rpcBody.p_status, "needs_review");
  assert.equal(validated.json.rpcBody.p_segment, null);
  assert.deepEqual(
    validated.json.rpcBody.p_classifier_json.evidence_provenance.verified_sources,
    []
  );
});

test("Prepare rejects rewritten query, a second search call, and out-of-domain sources", () => {
  const [built] = runBuild([payload()], [job()]);
  assert.throws(
    () => runPrepare([rawResearch(built.json, { query: "different query" })], [built.json]),
    /phase6_research_query_binding_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      extraCalls: [{
        id: "ws_second",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: built.json.researchPlan.query, sources: [] }
      }]
    })], [built.json]),
    /phase6_research_call_count_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      sourceUrl: "https://unrelated.example.org/services"
    })], [built.json]),
    /phase6_research_domain_scope_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      sources: [{
        type: "computer_initialize_state",
        url: SOURCE_URL,
        title: "Wrong source type"
      }]
    })], [built.json]),
    /phase6_research_source_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      omitActionSources: true,
      annotations: [{
        type: "url_citation",
        url: "https://unrelated.example.org/injected",
        title: "Cross-domain annotation",
        start_index: 0,
        end_index: 10
      }]
    })], [built.json]),
    /phase6_research_domain_scope_invalid/
  );
});

test("Prepare bounds Stage-1 URLs and references while deduplicating normalized sources", () => {
  const [built] = runBuild([payload()], [job()]);
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      sourceUrl: "https://example.com/" + "a".repeat(2030)
    })], [built.json]),
    /phase6_research_source_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      responseId: "r".repeat(321)
    })], [built.json]),
    /phase6_research_response_invalid/
  );
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      searchCallId: "w".repeat(321)
    })], [built.json]),
    /phase6_research_query_binding_invalid/
  );
  const twentyFourValidSources = Array.from({ length: 24 }, (_, index) => ({
    type: "url",
    url: SOURCE_URL + "?source=" + index,
    title: "Source " + index
  }));
  const [capped] = runPrepare([rawResearch(built.json, {
    sources: twentyFourValidSources
  })], [built.json]);
  assert.equal(capped.json.researchEvidence.sources.length, 20);
  assert.deepEqual(
    capped.json.researchEvidence.sources.map((item) => item.url),
    twentyFourValidSources.slice(0, 20).map((item) => item.url)
  );
  for (const unsafeTwentyFirst of [
    { type: "url", url: "not-a-valid-url", title: "Invalid item 21" },
    {
      type: "url",
      url: "https://unrelated.example.org/source-21",
      title: "Cross-domain item 21"
    }
  ]) {
    assert.throws(
      () => runPrepare([rawResearch(built.json, {
        sources: [
          ...twentyFourValidSources.slice(0, 20),
          unsafeTwentyFirst,
          ...twentyFourValidSources.slice(21)
        ]
      })], [built.json]),
      /phase6_research_(?:source_invalid|domain_scope_invalid)/
    );
  }
  assert.throws(
    () => runPrepare([rawResearch(built.json, {
      omitActionSources: true,
      annotations: { type: "url_citation", url: SOURCE_URL }
    })], [built.json]),
    /phase6_research_annotation_invalid/
  );
  const nullSources = rawResearch(built.json);
  nullSources.output[0].action.sources = null;
  assert.throws(
    () => runPrepare([nullSources], [built.json]),
    /phase6_research_source_invalid/
  );

  const [deduplicated] = runPrepare([rawResearch(built.json, {
    sources: [
      { type: "url", url: SOURCE_URL, title: "First" },
      { type: "url", url: SOURCE_URL + "/", title: "Duplicate" }
    ],
    annotations: [{
      type: "url_citation",
      url: SOURCE_URL,
      title: "Cross-channel duplicate",
      start_index: 0,
      end_index: 10
    }]
  })], [built.json]);
  assert.equal(deduplicated.json.researchEvidence.sources.length, 1);
  assert.equal(deduplicated.json.researchEvidence.sources[0].url, SOURCE_URL);
});

test("validator binds Stage-2 evidence only to separate Stage-1 response and call", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  const [validated] = runValidator([rawClassifier(acceptedModel())], [prepared.json]);
  assert.equal(validated.json.rpcBody.p_status, "accepted");
  assert.equal(validated.json.rpcBody.p_segment, "NT-4");
  assert.equal(validated.json.rpcBody.p_research_contract, RESEARCH_CONTRACT);
  assert.equal(validated.json.rpcBody.p_accepted_by, "n8n-request-segmenter-v5");
  assert.deepEqual(Object.keys(validated.json.rpcBody).sort(), [
    "p_accepted_by",
    "p_classifier_json",
    "p_classifier_version",
    "p_confidence",
    "p_evidence_grade",
    "p_evidence_json",
    "p_firmographic_json",
    "p_input_hash",
    "p_job_id",
    "p_model",
    "p_model_version",
    "p_prompt_version",
    "p_reason_codes",
    "p_reasoning_short",
    "p_request_id",
    "p_research_contract",
    "p_risk_flags",
    "p_segment",
    "p_status"
  ].sort());
  assert.equal(validated.json.rpcBody.p_model, CLASSIFIER_MODEL);
  assert.equal(validated.json.rpcBody.p_model_version, CLASSIFIER_MODEL);
  assert.equal(validated.json.rpcBody.p_prompt_version, PROMPT_VERSION);
  assert.equal(validated.json.rpcBody.p_classifier_version, CLASSIFIER_VERSION);
  const classifier = validated.json.rpcBody.p_classifier_json;
  assert.equal(classifier.research_contract, RESEARCH_CONTRACT);
  assert.equal(classifier.validator_version, VALIDATOR_VERSION);
  assert.equal(classifier.research_model, RESEARCH_MODEL);
  assert.equal(classifier.classifier_model, CLASSIFIER_MODEL);
  assert.equal(classifier.classifier_reasoning_effort, "medium");
  assert.deepEqual(
    Object.keys(classifier.evidence_provenance).sort(),
    [
      "classifier_model",
      "classifier_reasoning_effort",
      "classifier_tool_call_count",
      "research_call_count",
      "research_call_id",
      "research_call_status",
      "research_contract",
      "research_model",
      "research_performed",
      "research_query",
      "research_response_id",
      "valid",
      "validated_positive_evidence_codes",
      "validator_version",
      "verified_sources"
    ].sort()
  );
  assert.equal(classifier.evidence_provenance.valid, true);
  assert.equal(classifier.evidence_provenance.research_performed, true);
  assert.equal(classifier.evidence_provenance.research_call_count, 1);
  assert.equal(classifier.evidence_provenance.research_call_status, "completed");
  assert.equal(classifier.evidence_provenance.research_query, built.json.researchPlan.query);
  assert.equal(classifier.evidence_provenance.classifier_tool_call_count, 0);
  assert.deepEqual(classifier.evidence_provenance.verified_sources, [{
    url: SOURCE_URL,
    source_type: "web_search_call",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research",
    validated_positive_evidence_codes: ["verified_client_project_intermediary"]
  }]);
});

test("NT-9 accepts bound verified_direct_business evidence without inventing a first-party B2B flag", () => {
  const [built] = runBuild([payload()], [job()]);
  assert.equal(built.json.request.customer_type, "unknown");
  assert.equal(built.json.request.customer_type_first_party_verified, false);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  const [validated] = runValidator([rawClassifier(directBusinessModel())], [prepared.json]);
  const rpc = validated.json.rpcBody;
  assert.equal(rpc.p_status, "accepted");
  assert.equal(rpc.p_segment, "NT-9");
  assert.equal(rpc.p_classifier_json.segment, "NT-9");
  assert.equal(rpc.p_classifier_json.evidence_provenance.valid, true);
  assert.deepEqual(
    rpc.p_classifier_json.evidence_provenance.validated_positive_evidence_codes,
    ["verified_direct_business"]
  );
  assert.deepEqual(rpc.p_classifier_json.evidence_provenance.verified_sources, [{
    url: SOURCE_URL,
    source_type: "web_search_call",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research",
    validated_positive_evidence_codes: ["verified_direct_business"]
  }]);
  assert.equal(
    rpc.p_classifier_json.evidence.some((item) => item.type === "customer_declared"),
    false
  );
});

test("NT-9 fails closed on bound positive higher-role evidence but ignores context-only use", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);

  const conflicting = directBusinessModel();
  conflicting.evidence.push({
    type: "web_search",
    url: SOURCE_URL,
    used_for: "segment_role",
    evidence_code: "verified_event_or_media_operator"
  });
  const [blocked] = runValidator([rawClassifier(conflicting)], [prepared.json]);
  assert.equal(blocked.json.rpcBody.p_status, "needs_review");
  assert.equal(blocked.json.rpcBody.p_classifier_json.segment, null);
  assert.equal(blocked.json.rpcBody.p_classifier_json.evidence_provenance.valid, false);
  assert.ok(blocked.json.rpcBody.p_risk_flags.includes("conflicting_evidence"));

  for (const usedFor of ["context_tag", "conflict"]) {
    const nonPositive = directBusinessModel();
    nonPositive.evidence.push({
      type: "web_search",
      url: SOURCE_URL,
      used_for: usedFor,
      evidence_code: "verified_event_or_media_operator"
    });
    const [allowed] = runValidator([rawClassifier(nonPositive)], [prepared.json]);
    assert.equal(allowed.json.rpcBody.p_status, "accepted", usedFor);
    assert.equal(allowed.json.rpcBody.p_segment, "NT-9", usedFor);
  }
});

test("Stage-1 provenance survives a clean Stage-2 abstention with empty positive codes", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  const [validated] = runValidator([rawClassifier(abstainingModel())], [prepared.json]);
  const rpc = validated.json.rpcBody;
  const provenance = rpc.p_classifier_json.evidence_provenance;
  assert.equal(rpc.p_status, "needs_review");
  assert.equal(rpc.p_segment, null);
  assert.equal(provenance.valid, false);
  assert.equal(provenance.research_performed, true);
  assert.equal(provenance.research_response_id, "resp_phase6_research");
  assert.equal(provenance.research_call_id, "ws_phase6_research");
  assert.equal(provenance.research_call_count, 1);
  assert.equal(provenance.research_call_status, "completed");
  assert.deepEqual(provenance.validated_positive_evidence_codes, []);
  assert.deepEqual(provenance.verified_sources, [{
    url: SOURCE_URL,
    source_type: "web_search_call",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research",
    validated_positive_evidence_codes: []
  }]);
});

test("validator rejects Stage-2 tools and forged URLs fail closed", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  assert.throws(
    () => runValidator(
      [rawClassifier(acceptedModel(), [{ id: "ws_forbidden", type: "web_search_call" }])],
      [prepared.json]
    ),
    /classifier_tool_call_forbidden/
  );

  const forged = acceptedModel();
  forged.evidence[0].url = "https://forged.example.org/services";
  const [result] = runValidator([rawClassifier(forged)], [prepared.json]);
  assert.equal(result.json.rpcBody.p_status, "needs_review");
  assert.equal(result.json.rpcBody.p_classifier_json.segment, null);
  assert.equal(result.json.rpcBody.p_classifier_json.evidence_provenance.valid, false);
  assert.ok(result.json.rpcBody.p_risk_flags.includes("invalid_external_evidence"));
});

test("validator rejects incomplete, refused, or model-mismatched Stage-2 responses before RPC", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);

  const incomplete = rawClassifier(acceptedModel());
  incomplete.status = "incomplete";
  incomplete.incomplete_details = { reason: "max_output_tokens" };
  assert.throws(
    () => runValidator([incomplete], [prepared.json]),
    /classifier_response_envelope_invalid/
  );

  const refused = rawClassifier(acceptedModel());
  refused.output.at(-1).content = [{ type: "refusal", refusal: "Cannot comply." }];
  assert.throws(
    () => runValidator([refused], [prepared.json]),
    /classifier_refusal/
  );

  const wrongModel = rawClassifier(acceptedModel());
  wrongModel.model = "gpt-5.5";
  assert.throws(
    () => runValidator([wrongModel], [prepared.json]),
    /classifier_response_envelope_invalid/
  );
});

test("validator hard-rejects missing or nonempty Phase-6 research cache", () => {
  const [built] = runBuild([payload()], [job()]);
  const [prepared] = runPrepare([rawResearch(built.json)], [built.json]);
  const missing = structuredClone(prepared.json);
  delete missing.researchCache;
  assert.throws(
    () => runValidator([rawClassifier(acceptedModel())], [missing]),
    /research_cache_forbidden/
  );
  const nonempty = structuredClone(prepared.json);
  nonempty.researchCache = [{ cache_key: "forbidden" }];
  assert.throws(
    () => runValidator([rawClassifier(acceptedModel())], [nonempty]),
    /research_cache_forbidden/
  );
});

test("Pilot payload pins declared customer type to unknown and first-party verification to false", () => {
  for (const declared of [
    { declared_customer_type: "b2b", declared_customer_type_first_party_verified: false },
    { declared_customer_type: "unknown", declared_customer_type_first_party_verified: true },
    { declared_customer_type: "privat", declared_customer_type_first_party_verified: true }
  ]) {
    const [result] = runBuild([payload({ input: declared })], [job()]);
    assert.equal(
      result.json.failureBody.p_error_code,
      "phase6_minimized_input_shape_invalid",
      JSON.stringify(declared)
    );
    assert.equal(result.json.researchRequestBody, undefined);
    assert.equal(result.json.systemPrompt, undefined);
  }
});

test("unverified unknown customer type cannot authorize NT-8 in the conflicting Gold-like case", () => {
  const candidate = payload({
    input: {
      declared_customer_type: "unknown",
      declared_customer_type_first_party_verified: false,
      company: null,
      company_lookup_allowed: false,
      email_domain: null
    },
    domain_facts: {
      is_valid_dns_host: false,
      is_freemail: false,
      is_shared_provider: false,
      email_domain_cache_allowed: false,
      domain_lookup_allowed: false
    }
  });
  const [built] = runBuild([candidate], [job()]);
  assert.equal(built.json.researchPlan.execute, false);
  const [prepared] = runPrepare([built.json], [built.json]);
  const [result] = runValidator([rawClassifier(privateModel())], [prepared.json]);
  assert.equal(result.json.rpcBody.p_status, "needs_review");
  assert.equal(result.json.rpcBody.p_classifier_json.segment, null);
  const provenance = result.json.rpcBody.p_classifier_json.evidence_provenance;
  assert.equal(provenance.valid, false);
  assert.equal(provenance.research_performed, false);
  assert.equal(provenance.research_response_id, null);
  assert.equal(provenance.research_call_id, null);
  assert.equal(provenance.research_call_count, 0);
  assert.equal(provenance.research_call_status, null);
  assert.equal(provenance.research_query, null);
  assert.equal(provenance.classifier_tool_call_count, 0);
  assert.deepEqual(provenance.verified_sources, []);
});

test("taxonomy review-threshold drift is rejected before either OpenAI request", () => {
  const candidate = payload();
  candidate.taxonomy.definitions.find((item) => item.segment === "NT-4").review_threshold = 0.81;
  const [result] = runBuild([candidate], [job()]);
  assert.equal(result.json.failureBody.p_error_code, "phase6_taxonomy_contract_invalid");
  assert.equal(result.json.researchRequestBody, undefined);
  assert.equal(result.json.systemPrompt, undefined);
});

test("exact payload allowlist blocks extra customer and tracking keys", () => {
  for (const forbiddenKey of ["email", "phone", "utm_campaign", "gold_segment"]) {
    const candidate = payload();
    candidate.input[forbiddenKey] = "forbidden";
    const [result] = runBuild([candidate], [job()]);
    assert.ok(result.json.failureBody);
    assert.equal(result.json.researchRequestBody, undefined);
  }
});

test("free-text PII sentinels fail closed before either OpenAI body is built", () => {
  const unsafeValues = [
    "Kontakt max@example.com",
    "Ruf mich an unter +49 170 12345678",
    "Mehr auf https://customer.example/path",
    "ID 11111111-1111-4111-8111-111111111111",
    "utm_campaign=private",
    "Opaque ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
  ];
  for (const description of unsafeValues) {
    const candidate = payload({ input: { description } });
    const [result] = runBuild([candidate], [job()]);
    assert.ok(result.json.failureBody, description);
    assert.equal(result.json.researchRequestBody, undefined, description);
    assert.equal(result.json.systemPrompt, undefined, description);
  }
});

test("eval-only record cannot reach Trello because the preserved prepare node returns no items", () => {
  const { draft } = loadPreparedPrestate();
  const trello = draft.nodes.find((node) => node.id === "trello-description-sync-prepare");
  assert.ok(trello.parameters.jsCode.includes("disabled by ops request"));
  const run = new Function("$input", "console", trello.parameters.jsCode);
  const result = run(
    { first: () => ({ json: { projection: { applied: false } } }) },
    { log: () => {} }
  );
  assert.deepEqual(result, []);
});

test("Prepare and Validator embed one byte-identical URL-less runtime helper", () => {
  assert.equal(PREPARE_CODE.split(URL_RUNTIME_HELPER_SOURCE).length - 1, 1);
  assert.equal(VALIDATOR_CODE_AFTER.split(URL_RUNTIME_HELPER_SOURCE).length - 1, 1);
  for (const [label, code] of [
    ["Prepare", PREPARE_CODE],
    ["Validator", VALIDATOR_CODE_AFTER]
  ]) {
    assert.doesNotMatch(code, /\bnew\s+URL\s*\(/, label);
    assert.doesNotMatch(code, /\brequire\s*\(/, label);
    assert.doesNotMatch(code, /^\s*import\s/m, label);
  }
  const sandbox = { URL: undefined, result: null };
  vm.runInNewContext(
    URL_RUNTIME_HELPER_SOURCE
      + "\nresult = { urlType: typeof URL, parsed: parseHttpUrl('https://example.com/path') };",
    sandbox
  );
  assert.equal(sandbox.result.urlType, "undefined");
  assert.deepEqual(cloneAcrossRealm(sandbox.result.parsed), {
    url: "https://example.com/path",
    hostname: "example.com",
    dbHostname: "example.com"
  });
});

test("pure-JS URL parser canonicalizes the allowed DNS and port matrix without global URL", () => {
  const accepted = [
    [
      "http://Sub.Example.com/path?q=%2F#frag",
      {
        url: "http://sub.example.com/path?q=%2F",
        hostname: "sub.example.com",
        dbHostname: "sub.example.com"
      }
    ],
    [
      "HTTPS://EXAMPLE.COM:00443/Root/?x=1/#fragment",
      {
        url: "https://example.com/Root?x=1/",
        hostname: "example.com",
        dbHostname: "example.com"
      }
    ],
    [
      "http://example.com:00080/",
      { url: "http://example.com", hostname: "example.com", dbHostname: "example.com" }
    ],
    [
      "http://example.com:00081/path/",
      {
        url: "http://example.com:81/path",
        hostname: "example.com",
        dbHostname: "example.com"
      }
    ],
    [
      "https://example.com:1/a%2Fb?x=%3A",
      {
        url: "https://example.com:1/a%2Fb?x=%3A",
        hostname: "example.com",
        dbHostname: "example.com"
      }
    ],
    [
      "https://example.com:65535/path/?query=/",
      {
        url: "https://example.com:65535/path?query=/",
        hostname: "example.com",
        dbHostname: "example.com"
      }
    ],
    [
      "https://xn--bcher-kva.example/a",
      {
        url: "https://xn--bcher-kva.example/a",
        hostname: "xn--bcher-kva.example",
        dbHostname: "xn--bcher-kva.example"
      }
    ]
  ];
  for (const [value, expected] of accepted) {
    assert.deepEqual(parseHttpUrlWithoutGlobalUrl(value), expected, value);
  }
});

test("pure-JS DNS validation mirrors the DB helper's single leading-www strip", () => {
  assert.deepEqual(parseHttpUrlWithoutGlobalUrl("https://WWW.Example.com/path"), {
    url: "https://www.example.com/path",
    hostname: "www.example.com",
    dbHostname: "example.com"
  });
  assert.deepEqual(parseHttpUrlWithoutGlobalUrl("https://www.www.de/path"), {
    url: "https://www.www.de/path",
    hostname: "www.www.de",
    dbHostname: "www.de"
  });
  assert.deepEqual(parseHttpUrlWithoutGlobalUrl("https://www.www.www.de/path"), {
    url: "https://www.www.www.de/path",
    hostname: "www.www.www.de",
    dbHostname: "www.www.de"
  });
  assert.equal(parseHttpUrlWithoutGlobalUrl("https://www.google/path"), null);
  assert.equal(parseHttpUrlWithoutGlobalUrl("https://www.de/path"), null);
});

test("Prepare scopes one-strip source hosts against already-normalized expected domains", () => {
  const cases = [
    ["example.com", "https://www.example.com/path"],
    ["www.de", "https://www.www.de/path"],
    ["www.www.de", "https://www.www.www.de/path"],
    ["www.example.com", "https://www.www.example.com/path"],
    ["www.example.com", "https://sub.www.example.com/path"]
  ];
  for (const [expectedDomain, sourceUrl] of cases) {
    const [built] = runBuild([
      payload({ input: { email_domain: expectedDomain } })
    ], [job()]);
    assert.equal(built.json.researchPlan.lookup_value, expectedDomain);
    const [prepared] = runPrepareWithoutGlobalUrl([
      rawResearch(built.json, { sourceUrl })
    ], [built.json]);
    assert.equal(prepared.json.researchEvidence.valid, true, expectedDomain);
    assert.equal(prepared.json.researchEvidence.sources[0].url, sourceUrl, expectedDomain);
  }

  const [mismatchBuilt] = runBuild([
    payload({ input: { email_domain: "www.example.com" } })
  ], [job()]);
  assert.throws(
    () => runPrepareWithoutGlobalUrl([
      rawResearch(mismatchBuilt.json, { sourceUrl: "https://www.example.com/path" })
    ], [mismatchBuilt.json]),
    /phase6_research_domain_scope_invalid/
  );
});

test("pure-JS URL parser fails closed on unsafe syntax, authority, ports, DNS, IPs, and Unicode", () => {
  const longLabel = "a".repeat(64);
  const tooLongHost = Array.from({ length: 6 }, () => "a".repeat(43)).join(".") + ".com";
  const tooLongUrl = "https://example.com/" + "a".repeat(2030);
  const rejected = [
    "", " https://example.com", "https://example.com ",
    "https://example.com\npath", "https://example.com\tpath",
    "ftp://example.com/a", "javascript://example.com/a", "data://example.com/a",
    "http:/example.com", "https:////example.com", "https%3A%2F%2Fexample.com",
    "https://example.com\\path", "https://example.com/<x>",
    "https://example.com/\"x\"", "https://example.com/'x'",
    "https://example.com/`x`", "https://example.com/é",
    "https://user:pass@example.com/a", "https://user%40x@example.com/a",
    "https://example%40.com/a", "https://example%2f.com/a",
    "https://example%5c.com/a", "https://example%3a.com/a",
    "https://example.com:80:90/a",
    "https://example.com/%", "https://example.com/%0", "https://example.com/%GG",
    "https://example.com:/a", "https://example.com:+80/a",
    "https://example.com:-1/a", "https://example.com:0/a",
    "https://example.com:65536/a", "https://example.com:000080/a",
    "https://example.com:0x50/a",
    "https://example.com./a", "https://bücher.example/a",
    "https://example.xn--p1ai/a", "https://under_score.example/a",
    "https://empty..example/a", "https://-leading.example/a",
    "https://trailing-.example/a", "https://" + longLabel + ".example/a",
    "https://" + tooLongHost + "/a", "https://example.1/a",
    "https://example.c/a", "https://localhost/a",
    "https://x.localhost/a", "https://example.local/a", "https://singlelabel/a",
    "https://8.8.8.8/a", "https://127.0.0.1/a", "https://10.0.0.1/a",
    "https://172.16.0.1/a", "https://172.31.255.255/a",
    "https://192.168.1.1/a", "https://169.254.1.1/a",
    "https://100.64.0.1/a", "https://100.127.255.255/a",
    "https://127.example.com/a", "https://10.example.com/a",
    "https://172.16.example.com/a", "https://192.168.example.com/a",
    "https://169.254.example.com/a", "https://100.64.example.com/a",
    "https://2130706433/a", "https://0177.0.0.1/a",
    "https://0x7f000001/a", "https://127.1/a",
    "https://[2001:db8::1]/a", "https://[::1]/a",
    "https://[fe80::1%25eth0]/a",
    tooLongUrl
  ];
  for (const value of rejected) {
    assert.equal(parseHttpUrlWithoutGlobalUrl(value), null, value);
  }
});

test("observed source plus duplicate citations succeeds in the URL-less n8n runtime and remains bound", () => {
  const [built] = runBuild([payload()], [job()]);
  const observedUrl = "http://Sub.Example.com/path/?q=%2F#fragment";
  const research = rawResearch(built.json, {
    sourceUrl: observedUrl,
    annotations: Array.from({ length: 5 }, () => ({
      type: "url_citation",
      url: observedUrl,
      title: "Observed duplicate citation"
    }))
  });
  const [prepared] = runPrepareWithoutGlobalUrl([research], [built.json]);
  assert.equal(prepared.json.researchEvidence.valid, true);
  assert.deepEqual(prepared.json.researchEvidence.sources, [{
    url: "http://sub.example.com/path?q=%2F",
    title: "Synthetic official source",
    source_ref: "ws_phase6_research",
    research_response_ref: "resp_phase6_research"
  }]);

  const model = acceptedModel();
  model.evidence[0].url = "http://sub.example.com/path?q=%2F";
  const [validated] = runValidatorWithoutGlobalUrl(
    [rawClassifier(model)],
    [prepared.json]
  );
  assert.equal(validated.json.rpcBody.p_status, "accepted");
  assert.equal(
    validated.json.rpcBody.p_classifier_json.evidence_provenance.valid,
    true
  );
  assert.equal(
    validated.json.rpcBody.p_classifier_json.evidence_provenance.verified_sources.length,
    1
  );
});

test("URL-less runtime preserves semantic no-source abstention and strict domain boundaries", () => {
  const [built] = runBuild([payload()], [job()]);
  const missing = rawResearch(built.json, {
    omitActionSources: true,
    annotations: []
  });
  const [preparedMissing] = runPrepareWithoutGlobalUrl([missing], [built.json]);
  assert.equal(preparedMissing.json.researchEvidence.valid, false);
  assert.equal(
    preparedMissing.json.researchEvidence.abstention_code,
    "phase6_research_provenance_missing"
  );
  const [validatedMissing] = runValidatorWithoutGlobalUrl(
    [rawClassifier(acceptedModel())],
    [preparedMissing.json]
  );
  assert.equal(validatedMissing.json.rpcBody.p_status, "needs_review");
  assert.equal(validatedMissing.json.rpcBody.p_segment, null);

  for (const sourceUrl of [
    "https://notexample.com/path",
    "https://example.com.evil/path"
  ]) {
    assert.throws(
      () => runPrepareWithoutGlobalUrl(
        [rawResearch(built.json, { sourceUrl })],
        [built.json]
      ),
      /phase6_research_domain_scope_invalid/,
      sourceUrl
    );
  }
});

test("runtime repair changes only Prepare and Validator code versus committed provenance recovery", () => {
  const previousPath = new URL(
    "../2026-08-20-request-segmentation-phase6-provenance-recovery/forward-patch.json",
    import.meta.url
  );
  const previous = JSON.parse(fs.readFileSync(previousPath, "utf8")).patch;
  const current = createPatchBundle().forward;
  assert.equal(previous.operations.length, 9);
  assert.equal(current.operations.length, 9);

  for (let index = 0; index < current.operations.length; index += 1) {
    const before = structuredClone(previous.operations[index]);
    const after = structuredClone(current.operations[index]);
    const nodeId = after.nodeId || (after.node && after.node.id);
    if (nodeId === PREPARE_NODE_ID) {
      assert.equal(before.type, "addNode");
      assert.equal(after.type, "addNode");
      delete before.node.parameters.jsCode;
      delete after.node.parameters.jsCode;
      assert.deepEqual(after, before);
      continue;
    }
    if (nodeId === VALIDATOR_NODE_ID) {
      assert.equal(before.type, "updateNode");
      assert.equal(after.type, "updateNode");
      delete before.updates.parameters.jsCode;
      delete after.updates.parameters.jsCode;
      assert.deepEqual(after, before);
      continue;
    }
    assert.deepEqual(after, before, nodeId || after.type);
  }

  const previousPrepare = previous.operations.find(
    (operation) => operation.node && operation.node.id === PREPARE_NODE_ID
  ).node.parameters.jsCode;
  const previousValidator = previous.operations.find(
    (operation) => operation.nodeId === VALIDATOR_NODE_ID
  ).updates.parameters.jsCode;
  assert.equal((previousPrepare.match(/\bnew\s+URL\s*\(/g) || []).length, 2);
  assert.equal((previousValidator.match(/\bnew\s+URL\s*\(/g) || []).length, 1);
  assert.equal((PREPARE_CODE.match(/\bnew\s+URL\s*\(/g) || []).length, 0);
  assert.equal((VALIDATOR_CODE_AFTER.match(/\bnew\s+URL\s*\(/g) || []).length, 0);
});

test("standalone artifacts equal the generator contract", () => {
  const generated = createArtifactFiles();
  for (const [filename, expected] of Object.entries(generated)) {
    const path = new URL("./" + filename, import.meta.url);
    assert.deepEqual(JSON.parse(fs.readFileSync(path, "utf8")), expected);
  }
});
