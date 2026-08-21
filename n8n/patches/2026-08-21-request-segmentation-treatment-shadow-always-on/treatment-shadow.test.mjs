import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ACCEPTED_BY,
  BUILD_CODE_AFTER,
  CLASSIFIER_BODY_EXPRESSION,
  CLASSIFIER_MODEL,
  CLASSIFIER_REASONING_EFFORT,
  CLASSIFIER_VERSION,
  POLICY_VERSION,
  PREPARE_CODE,
  PROMPT_VERSION,
  QUALITY_GATE_VERSION,
  RESEARCH_BODY_EXPRESSION,
  RESEARCH_CONTRACT,
  RESEARCH_MODEL,
  SOURCE,
  STRICT_OUTPUT_SCHEMA,
  TAXONOMY_VERSION,
  TREATMENT_CONTRACT,
  VALIDATOR_CODE_AFTER,
  VALIDATOR_VERSION,
  evaluateBodyExpression
} from "./treatment-shadow-source.mjs";
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
const SOURCE_URL = "https://example.com/leistungen";

function definitionFor(segment) {
  return {
    ...segment,
    description: `Synthetic complete definition for ${segment.segment}.`,
    inclusion_criteria: [`Positive criterion for ${segment.segment}.`],
    required_evidence: [`Required evidence for ${segment.segment}.`],
    required_evidence_code: SEGMENT_EVIDENCE_CODES[segment.segment],
    exclusion_criteria: [`Exclusion criterion for ${segment.segment}.`],
    tie_breaker: `Deterministic tie breaker for ${segment.segment}.`
  };
}

function job(source = SOURCE) {
  return {
    id: JOB_ID,
    request_id: REQUEST_ID,
    input_hash: "synthetic-current-input-hash",
    source,
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION
  };
}

function payload({ freemail = false, description, source = SOURCE, extraInput = {}, extraContract = {} } = {}) {
  const domain = freemail ? "gmail.com" : "example.com";
  const domainLookupAllowed = !freemail;
  return {
    contract: {
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      policy_version: POLICY_VERSION,
      quality_gate_version: QUALITY_GATE_VERSION,
      research_contract: RESEARCH_CONTRACT,
      treatment_contract: TREATMENT_CONTRACT,
      source,
      evaluation_only: false,
      master_projection_authorized: true,
      validator_version: VALIDATOR_VERSION,
      research_model: RESEARCH_MODEL,
      classifier_model: CLASSIFIER_MODEL,
      classifier_reasoning_effort: CLASSIFIER_REASONING_EFFORT,
      ...extraContract
    },
    input: {
      title: "Synthetic request",
      description: description || "Wir benötigen ein Schild für unser kleines Eventstudio.",
      declared_customer_type: "unknown",
      declared_customer_type_first_party_verified: false,
      application: "Innenbereich",
      country: "DE",
      company: null,
      company_lookup_allowed: false,
      email_domain: domain,
      domain_facts: {
        is_valid_dns_host: true,
        is_freemail: freemail,
        is_shared_provider: false,
        email_domain_cache_allowed: domainLookupAllowed,
        domain_lookup_allowed: domainLookupAllowed
      },
      ...extraInput
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

function runBuild(inputPayload, source = SOURCE) {
  const run = new Function("$input", "$", BUILD_CODE_AFTER);
  return run(
    { all: () => [{ json: inputPayload }] },
    (nodeName) => {
      assert.equal(nodeName, "Normalize Claimed Jobs");
      return { itemMatching: () => ({ json: job(source) }) };
    }
  )[0].json;
}

function researchResponse(source, { withSources = true } = {}) {
  const action = { type: "search", query: source.researchPlan.query };
  if (withSources) action.sources = [{ type: "url", url: SOURCE_URL, title: "Official source" }];
  return {
    id: "resp_treatment_research",
    status: "completed",
    incomplete_details: null,
    model: RESEARCH_MODEL,
    output: [
      {
        id: "ws_treatment_research",
        type: "web_search_call",
        status: "completed",
        action
      },
      {
        id: "msg_treatment_research",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", annotations: [], text: "Synthetic research." }]
      }
    ]
  };
}

function runPrepare(incoming, built) {
  const run = new Function("$input", "$", PREPARE_CODE);
  return run(
    { all: () => [{ json: incoming }] },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return { itemMatching: () => ({ json: built }) };
    }
  )[0].json;
}

function model({
  segment = "NT-3",
  evidenceType = "request",
  evidenceUrl = null,
  evidenceCode = "verified_event_or_media_operator",
  evidenceUse = "segment_role",
  organizationScale = null,
  isCompany = true,
  decision = "classified"
} = {}) {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision,
    segment: decision === "classified" ? segment : null,
    confidence: decision === "classified" ? 0.94 : 0.4,
    evidence_grade: decision === "classified" ? "strong" : "weak",
    reasoning_short: "Synthetic deterministic treatment classification.",
    reason_codes: decision === "classified" ? [evidenceCode] : ["ambiguous_segment"],
    evidence: decision === "classified" ? [{
      type: evidenceType,
      url: evidenceUrl,
      used_for: evidenceUse,
      evidence_code: evidenceCode
    }] : [],
    firmographic: {
      is_company: isCompany,
      company_name: isCompany ? "Synthetic Company" : null,
      website: null,
      industry: null,
      email_domain: null,
      is_freemail: false
    },
    risk_flags: decision === "classified" ? [] : ["ambiguous_segment"],
    context_tags: [],
    organization_scale: organizationScale
  };
}

function classifierResponse(output) {
  return {
    id: "resp_treatment_classifier",
    status: "completed",
    incomplete_details: null,
    model: CLASSIFIER_MODEL,
    output: [
      { id: "rs_treatment_classifier", type: "reasoning", summary: [] },
      {
        id: "msg_treatment_classifier",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", annotations: [], text: JSON.stringify(output) }]
      }
    ]
  };
}

function runValidator(response, prepared) {
  const run = new Function("$input", "$", VALIDATOR_CODE_AFTER);
  return run(
    { all: () => [{ json: response }] },
    (nodeName) => {
      assert.equal(nodeName, "Prepare Treatment Classification");
      return { itemMatching: () => ({ json: prepared }) };
    }
  )[0].json;
}

function prepareFreemail() {
  const built = runBuild(payload({ freemail: true }));
  assert.equal(built.researchPlan.execute, false);
  return { built, prepared: runPrepare(built, built) };
}

function prepareBusiness({ withSources = true } = {}) {
  const built = runBuild(payload());
  assert.equal(built.researchPlan.execute, true);
  return { built, prepared: runPrepare(researchResponse(built, { withSources }), built) };
}

test("pinned current v3 graph round-trips and only the shadow lane is patched", () => {
  const { draft, active } = loadPreparedPrestate();
  assert.equal(draft.versionId, "d42befa7-f6fc-4201-8516-c71c01cf5e17");
  assert.equal(draft.versionCounter, 136);
  assert.equal(draft.nodes.length, 20);
  assert.deepEqual(
    { nodes: draft.nodes, connections: draft.connections, settings: draft.settings },
    { nodes: active.nodes, connections: active.connections, settings: active.settings }
  );
  const bundle = createPatchBundle();
  assert.equal(bundle.forward.operations.length, 9);
  assert.equal(bundle.reverse.operations.length, 9);
  const candidate = applyOperationsInMemory(draft, bundle.forward.operations);
  assert.equal(candidate.nodes.length, 23);
  assert.equal(Object.keys(candidate.connections).length, 20);
  assert.deepEqual(applyOperationsInMemory(candidate, bundle.reverse.operations), draft);
});

test("business-domain research is exact-domain-only and contains no request text or ids", () => {
  const built = runBuild(payload());
  assert.equal(
    built.researchPlan.query,
    "site:example.com Unternehmen Leistungen Kundenprojekte Standorte Impressum"
  );
  assert.equal(built.researchPlan.lookup_type, "domain");
  const body = evaluateBodyExpression(RESEARCH_BODY_EXPRESSION, built);
  assert.equal(body.input, built.researchPlan.query);
  assert.equal(body.tool_choice, "required");
  assert.equal(body.store, false);
  assert.equal(Object.hasOwn(body.tools[0], "filters"), false);
  assert.equal(body.tools[0].type, "web_search");
  assert.equal(body.tools[0].search_context_size, "medium");
  const serialized = JSON.stringify(body);
  for (const forbidden of [JOB_ID, REQUEST_ID, "kleines Eventstudio", "synthetic-current-input-hash"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("canonical enqueue sources are dynamic but must stay bound across job and payload", () => {
  const source = "master_requests_update";
  const built = runBuild(payload({ source }), source);
  assert.equal(built.failureBody, undefined);
  assert.equal(built.researchPlan.execute, true);

  const mismatched = runBuild(payload({ source: "manual" }), source);
  assert.ok(mismatched.failureBody);
  assert.equal(mismatched.researchRequestBody, undefined);
});

test("provider results outside the exact domain still fail closed without API filters", () => {
  const built = runBuild(payload());
  const response = researchResponse(built);
  response.output[0].action.sources[0].url = "https://outside.example.net/about";
  assert.throws(
    () => runPrepare(response, built),
    (error) => error && error.name === "treatment_shadow_research_domain_scope_invalid"
  );
});

test("freemail and disabled-domain cases never search and have no company fallback", () => {
  for (const candidate of [
    payload({ freemail: true }),
    payload({
      extraInput: {
        company: "Synthetic Media GmbH",
        company_lookup_allowed: false,
        email_domain: null,
        domain_facts: {
          is_valid_dns_host: false,
          is_freemail: false,
          is_shared_provider: false,
          email_domain_cache_allowed: false,
          domain_lookup_allowed: false
        }
      }
    })
  ]) {
    const built = runBuild(candidate);
    assert.equal(built.researchPlan.execute, false);
    assert.equal(built.researchPlan.lookup_type, null);
    assert.equal(built.researchPlan.query, null);
    assert.equal(built.researchRequestBody, null);
  }
});

test("freemail private-use wording accepts NT-8 as standard request evidence", () => {
  const { prepared } = prepareFreemail();
  const privateModel = model({
    segment: "NT-8",
    evidenceCode: "explicit_private_use",
    evidenceUse: "private_use",
    isCompany: false
  });
  privateModel.firmographic.email_domain = "gmail.com";
  privateModel.firmographic.is_freemail = true;
  const result = runValidator(classifierResponse(privateModel), prepared);
  assert.equal(result.rpcBody.p_status, "shadow");
  assert.equal(result.rpcBody.p_segment, "NT-8");
  assert.equal(result.rpcBody.p_classifier_json.treatment_tier, "standard");
  assert.equal(result.rpcBody.p_classifier_json.special_handling_required, false);
  assert.equal(result.rpcBody.p_classifier_json.standard_request_evidence_valid, true);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.research_performed, false);
  assert.deepEqual(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
});

test("freemail business wording accepts the matching small-business segment as standard", () => {
  const { prepared } = prepareFreemail();
  const businessModel = model();
  businessModel.firmographic.email_domain = "gmail.com";
  businessModel.firmographic.is_freemail = true;
  const result = runValidator(classifierResponse(businessModel), prepared);
  assert.equal(result.rpcBody.p_status, "shadow");
  assert.equal(result.rpcBody.p_segment, "NT-3");
  assert.equal(result.rpcBody.p_classifier_json.treatment_tier, "standard");
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, true);
  assert.deepEqual(
    result.rpcBody.p_classifier_json.evidence_provenance.validated_positive_evidence_codes,
    ["verified_event_or_media_operator"]
  );
});

test("freemail without a business-use signal defaults to private standard shadow", () => {
  const { prepared } = prepareFreemail();
  const noBusinessSignal = model({ decision: "needs_review", isCompany: false });
  noBusinessSignal.firmographic.email_domain = "gmail.com";
  noBusinessSignal.firmographic.is_freemail = true;
  const result = runValidator(classifierResponse(noBusinessSignal), prepared);
  assert.equal(result.rpcBody.p_status, "shadow");
  assert.equal(result.rpcBody.p_segment, "NT-8");
  assert.equal(result.rpcBody.p_classifier_json.treatment_tier, "standard");
  assert.equal(result.rpcBody.p_classifier_json.operational_default_applied, true);
  assert.ok(result.rpcBody.p_reason_codes.includes("freemail_no_business_use_signal"));
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, false);
});

test("missing provider citations do not block a clearly standard request", () => {
  const { prepared } = prepareBusiness({ withSources: false });
  assert.equal(prepared.researchEvidence.performed, true);
  assert.equal(prepared.researchEvidence.valid, false);
  assert.equal(prepared.researchEvidence.abstention_code, "treatment_shadow_research_provenance_missing");
  const standard = model();
  standard.firmographic.email_domain = "example.com";
  const result = runValidator(classifierResponse(standard), prepared);
  assert.equal(result.rpcBody.p_status, "shadow");
  assert.equal(result.rpcBody.p_segment, "NT-3");
  assert.equal(result.rpcBody.p_classifier_json.treatment_tier, "standard");
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.research_performed, true);
  assert.deepEqual(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
});

test("special public, multisite, enterprise, or large results require bound web evidence", () => {
  const { prepared } = prepareBusiness();
  const publicModel = model({
    segment: "NT-10",
    evidenceType: "web_search",
    evidenceUrl: SOURCE_URL,
    evidenceCode: "verified_public_or_institutional_entity",
    evidenceUse: "institution_status"
  });
  publicModel.firmographic.email_domain = "example.com";
  const accepted = runValidator(classifierResponse(publicModel), prepared);
  assert.equal(accepted.rpcBody.p_status, "shadow");
  assert.equal(accepted.rpcBody.p_classifier_json.treatment_tier, "special");
  assert.equal(accepted.rpcBody.p_classifier_json.special_handling_required, true);
  assert.equal(accepted.rpcBody.p_classifier_json.external_evidence_required, true);

  const noSource = prepareBusiness({ withSources: false }).prepared;
  const claimedSpecialFromRequest = model({
    segment: "NT-10",
    evidenceCode: "verified_public_or_institutional_entity",
    evidenceUse: "institution_status"
  });
  claimedSpecialFromRequest.firmographic.email_domain = "example.com";
  const blocked = runValidator(classifierResponse(claimedSpecialFromRequest), noSource);
  assert.equal(blocked.rpcBody.p_status, "needs_review");
  assert.equal(blocked.rpcBody.p_segment, null);
  assert.equal(blocked.rpcBody.p_classifier_json.segment, null);
});

test("large standard-role case needs both bound role and scale evidence", () => {
  const { prepared } = prepareBusiness();
  const large = model({
    evidenceType: "web_search",
    evidenceUrl: SOURCE_URL,
    organizationScale: "large"
  });
  large.firmographic.email_domain = "example.com";
  large.evidence.push({
    type: "web_search",
    url: SOURCE_URL,
    used_for: "organization_scale",
    evidence_code: "verified_event_or_media_operator"
  });
  const accepted = runValidator(classifierResponse(large), prepared);
  assert.equal(accepted.rpcBody.p_status, "shadow");
  assert.equal(accepted.rpcBody.p_classifier_json.treatment_tier, "special");

  large.evidence.pop();
  const blocked = runValidator(classifierResponse(large), prepared);
  assert.equal(blocked.rpcBody.p_status, "needs_review");
  assert.ok(blocked.rpcBody.p_risk_flags.includes("organization_scale_unverified"));
});

test("NT-9 request evidence fails closed when a higher-priority request role is also present", () => {
  const { prepared } = prepareFreemail();
  const direct = model({
    segment: "NT-9",
    evidenceCode: "verified_direct_business",
    evidenceUse: "segment_role"
  });
  direct.firmographic.email_domain = "gmail.com";
  direct.firmographic.is_freemail = true;
  direct.evidence.push({
    type: "request",
    url: null,
    used_for: "segment_role",
    evidence_code: "verified_event_or_media_operator"
  });
  const result = runValidator(classifierResponse(direct), prepared);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.ok(result.rpcBody.p_risk_flags.includes("conflicting_evidence"));
});

test("Stage-2 stays tool-free and the canonical record RPC has exactly 18 named arguments", () => {
  const { prepared } = prepareBusiness();
  const body = evaluateBodyExpression(CLASSIFIER_BODY_EXPRESSION, prepared);
  assert.equal(body.model, CLASSIFIER_MODEL);
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.deepEqual(body.tools, []);
  assert.equal(body.tool_choice, "none");
  assert.equal(body.store, false);
  assert.deepEqual(body.text.format.schema, STRICT_OUTPUT_SCHEMA);

  const standard = model({ evidenceType: "web_search", evidenceUrl: SOURCE_URL });
  standard.firmographic.email_domain = "example.com";
  const result = runValidator(classifierResponse(standard), prepared);
  assert.equal(Object.keys(result.rpcBody).length, 18);
  assert.equal(result.rpcBody.p_accepted_by, ACCEPTED_BY);
  assert.equal(Object.hasOwn(result.rpcBody, "p_research_contract"), false);
  assert.equal(Object.hasOwn(result.rpcBody, "p_treatment_contract"), false);
});

test("contract drift and customer/tracking payload fields fail before OpenAI", () => {
  const wrongTreatment = runBuild(payload({ extraContract: { treatment_contract: "wrong" } }));
  assert.ok(wrongTreatment.failureBody);
  assert.equal(wrongTreatment.researchRequestBody, undefined);

  for (const forbiddenKey of ["email", "phone", "utm_campaign", "gold_segment"]) {
    const candidate = payload();
    candidate.input[forbiddenKey] = "forbidden";
    const result = runBuild(candidate);
    assert.ok(result.failureBody, forbiddenKey);
    assert.equal(result.researchRequestBody, undefined, forbiddenKey);
  }
});

test("standalone patch artifacts equal the generator contract", () => {
  for (const [filename, expected] of Object.entries(createArtifactFiles())) {
    const artifact = new URL(`./${filename}`, import.meta.url);
    assert.deepEqual(JSON.parse(fs.readFileSync(artifact, "utf8")), expected, filename);
  }
});
