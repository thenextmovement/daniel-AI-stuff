import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import Ajv from "ajv";

import {
  BUILD_PROMPT_CODE,
  CLAIM_BODY_AFTER,
  CLAIM_URL_AFTER,
  CLASSIFIER_SCHEMA,
  CLASSIFIER_VERSION,
  CONTEXT_TAGS,
  CX8_SEGMENTS,
  EVIDENCE_CODES,
  FAILURE_PAYLOAD_CODE,
  MODEL_RISK_FLAGS,
  ORGANIZATION_SCALES,
  POLICY_VERSION,
  PROMPT_VERSION,
  QUALITY_GATE_VERSION,
  SEGMENT_EVIDENCE_CODES,
  TAXONOMY_VERSION,
  VALIDATOR_CODE
} from "./cx8-contract-source.mjs";
import {
  applyOperationsInMemory,
  createPatchBundle,
  loadPreparedPrestate
} from "./workflow-patch.mjs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const INPUT_HASH = "synthetic-input-hash-no-pii";
const WEB_URL = "https://verified.example/company";
const SCALE_URL = "https://verified.example/organization-scale";

function definitionFor(segment) {
  return {
    ...segment,
    description: `Synthetic complete definition for ${segment.segment} with enough detail.`,
    inclusion_criteria: [`Positive criterion for ${segment.segment}.`],
    required_evidence: [`Required evidence for ${segment.segment}.`],
    required_evidence_code: SEGMENT_EVIDENCE_CODES[segment.segment],
    exclusion_criteria: [`Exclusion criterion for ${segment.segment}.`],
    tie_breaker: `Synthetic deterministic tie breaker for ${segment.segment} with enough detail.`
  };
}

function verifiedCache(url = WEB_URL, evidenceOverrides = {}, summaryOverrides = {}) {
  return {
    cache_key: "company_name:synthetic-company",
    lookup_type: "company_name",
    lookup_value: "Synthetic Company",
    provider: "classification",
    status: "ok",
    evidence_json: [
      {
        type: "research_cache",
        url,
        used_for: "segment_role",
        evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"],
        ...evidenceOverrides
      }
    ],
    summary_json: {
      firmographic: { company_name: "Synthetic Company" },
      effective_status: "accepted",
      verified_company_identity: true,
      evidence_website_domain_verified: true,
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      evidence_contract_valid: true,
      classifier_segment: "NT-1",
      required_evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"],
      validated_evidence_count: 1,
      validated_evidence_uses: ["segment_role"],
      ...summaryOverrides
    }
  };
}

function makePayload(overrides = {}) {
  const definitions = CX8_SEGMENTS.map(definitionFor);
  const customerType = overrides.customerType ?? "gewerblich";
  const freemail = overrides.freemail === true;
  const domain = freemail ? "gmail.com" : "synthetic.example";
  const companyName = overrides.companyName === undefined
    ? (freemail ? "" : "Synthetic Company")
    : overrides.companyName;
  return {
    contract: {
      taxonomy_version: TAXONOMY_VERSION,
      policy_version: POLICY_VERSION,
      policy_mode: "shadow",
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      quality_gate_version: QUALITY_GATE_VERSION,
      decision_unit: "requesting_or_contracting_entity",
      default_outcome: "needs_review",
      fallback_segment: null,
      shadow_only: true
    },
    job: {
      id: JOB_ID,
      request_id: REQUEST_ID,
      input_hash: INPUT_HASH,
      attempts: 1,
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION
    },
    request: {
      id: REQUEST_ID,
      request_id: "NT-SYNTHETIC-REQUEST",
      customer_id: CUSTOMER_ID,
      title: "Synthetic NEONTRIP request",
      description: "Synthetic request content used only for an offline test.",
      customer_type: customerType,
      application: "Synthetic application",
      country: "DE",
      form_id: "synthetic_first_party_form",
      landing_page_url: "https://neontrip.example/anfrage",
      utm_source: "offline-test",
      created_at: "2026-08-19T12:00:00.000Z",
      segment: "NT-18",
      s_kategorie: "S4",
      estimated_value: 999999,
      commercial_playbook: { hidden_marker: "LEGACY_COMMERCIAL_LEAK" }
    },
    customer: {
      id: CUSTOMER_ID,
      email: freemail ? "synthetic.qa@gmail.com" : `qa@${domain}`,
      first_name: "Synthetic",
      last_name: "Customer",
      name: "Synthetic Customer",
      company_name: companyName,
      company: companyName,
      phone: null,
      original_phone: null,
      city: "Teststadt",
      country: "DE"
    },
    domain_facts: {
      email_domain: domain,
      is_valid_dns_host: true,
      is_freemail: freemail,
      is_shared_provider: false,
      email_domain_cache_allowed: !freemail
    },
    research_cache: overrides.researchCache ?? [],
    related_history: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        request_id: "NT-SYNTHETIC-HISTORY",
        title: "Prior synthetic request",
        description: "Prior safe request description.",
        status: "new",
        created_at: "2026-08-18T12:00:00.000Z",
        segment: "LEGACY_HISTORY_SEGMENT_LEAK",
        s_kategorie: "LEGACY_HISTORY_S_LEAK",
        commercial_playbook: { marker: "LEGACY_HISTORY_COMMERCIAL_LEAK" }
      }
    ],
    taxonomy: {
      version: TAXONOMY_VERSION,
      lifecycle_status: "shadow",
      decision_unit: "requesting_or_contracting_entity",
      default_outcome: "needs_review",
      definitions,
      tie_break_order: CX8_SEGMENTS.map((item) => item.segment)
    },
    segment_definitions: definitions,
    context_definitions: CONTEXT_TAGS.map((contextTag) => ({
      context_tag: contextTag,
      label: `Label ${contextTag}`,
      description: `Synthetic context definition for ${contextTag}.`
    })),
    organization_scale_values: [...ORGANIZATION_SCALES],
    quality_gate: {
      version: QUALITY_GATE_VERSION,
      min_unique_gold_total: 300,
      min_gold_per_segment: 25,
      min_precision_per_predicted_class: 0.90,
      min_recall_per_actual_class: 0.85,
      min_accepted_coverage: 0.80,
      critical_segments: ["NT-8", "NT-10"],
      min_critical_precision: 0.95,
      required_mapping_integrity: 1,
      max_provenance_violations: 0,
      manual_activation_required: true
    },
    active_policy: {
      version: POLICY_VERSION,
      mode: "shadow",
      taxonomy_version: TAXONOMY_VERSION,
      classifier_version: CLASSIFIER_VERSION,
      prompt_version: PROMPT_VERSION,
      rules: CX8_SEGMENTS.map((item) => ({
        segment: item.segment,
        s_kategorie: item.default_s_kategorie,
        min_confidence: item.review_threshold,
        needs_human_review: false,
        automation_enabled: false
      }))
    }
  };
}

function runBuild(payload) {
  const run = new Function("$input", "$", BUILD_PROMPT_CODE);
  const result = run({ first: () => ({ json: payload }) }, () => {
    throw new Error("Build node must not read another node.");
  });
  return result[0].json;
}

function runValidator(ai, source) {
  const run = new Function("$input", "$", VALIDATOR_CODE);
  const result = run(
    { first: () => ({ json: ai }) },
    (nodeName) => {
      assert.equal(nodeName, "Build Classifier Prompt");
      return { first: () => ({ json: source }) };
    }
  );
  return result[0].json;
}

function runFailurePayload(current, lineage = {}) {
  const run = new Function("$input", "$", FAILURE_PAYLOAD_CODE);
  return run(
    { first: () => ({ json: current }) },
    (nodeName) => ({
      all: () => (lineage[nodeName] || []).map((json) => ({ json }))
    })
  );
}

function baseModel(source, overrides = {}) {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    decision: "classified",
    segment: "NT-1",
    confidence: 0.93,
    evidence_grade: "strong",
    reasoning_short: "Synthetic evidence satisfies the requested role contract.",
    reason_codes: ["synthetic_verified_role"],
    evidence: [
      {
        type: "web_search",
        url: WEB_URL,
        used_for: "segment_role",
        evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"]
      }
    ],
    firmographic: {
      is_company: true,
      company_name: "Synthetic Company",
      website: WEB_URL,
      industry: "Synthetic industry",
      email_domain: source.domainFacts.email_domain,
      is_freemail: source.domainFacts.is_freemail
    },
    risk_flags: [],
    context_tags: [],
    organization_scale: null,
    ...overrides
  };
}

function rawResponse(model, sources = []) {
  const output = [];
  if (sources.length) {
    output.push({
      id: "ws_synthetic_1",
      type: "web_search_call",
      status: "completed",
      action: { sources: sources.map((url) => ({ url })) }
    });
  }
  output.push({
    id: "msg_synthetic_1",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: JSON.stringify(model) }]
  });
  return { id: "resp_synthetic_1", status: "completed", output };
}

function webEvidence(
  segment,
  usedFor = segment === "NT-10" ? "institution_status" : "segment_role",
  url = WEB_URL
) {
  return {
    type: "web_search",
    url,
    used_for: usedFor,
    evidence_code: SEGMENT_EVIDENCE_CODES[segment]
  };
}

function declaredEvidence(segment) {
  return {
    type: "customer_declared",
    url: null,
    used_for: segment === "NT-8" ? "private_use" : "segment_role",
    evidence_code: SEGMENT_EVIDENCE_CODES[segment]
  };
}

test("static schema is OpenAI-compatible, strict, CX8-only and excludes validator-owned flags", () => {
  const ajv = new Ajv({ allErrors: true, strictKeywords: false });
  assert.equal(ajv.validateSchema(CLASSIFIER_SCHEMA), true, ajv.errorsText());
  assert.deepEqual(CLASSIFIER_SCHEMA.properties.segment.enum, [
    "NT-10", "NT-1", "NT-4", "NT-3", "NT-5", "NT-6", "NT-8", "NT-9", null
  ]);
  assert.deepEqual(CLASSIFIER_SCHEMA.properties.context_tags.items.enum, CONTEXT_TAGS);
  assert.deepEqual(CLASSIFIER_SCHEMA.properties.organization_scale.enum, [...ORGANIZATION_SCALES, null]);
  assert.deepEqual(CLASSIFIER_SCHEMA.properties.evidence.items.properties.evidence_code.enum, EVIDENCE_CODES);
  assert.deepEqual(CLASSIFIER_SCHEMA.properties.risk_flags.items.enum, MODEL_RISK_FLAGS);
  assert.equal(MODEL_RISK_FLAGS.includes("taxonomy_contract_mismatch"), false);
  assert.equal(MODEL_RISK_FLAGS.includes("evidence_provenance_unverified"), false);
  assert.equal(JSON.stringify(CLASSIFIER_SCHEMA).includes("uniqueItems"), false);
  assert.equal(JSON.stringify(CLASSIFIER_SCHEMA).includes('"const"'), false);
});

test("Build pins the complete CX8 contract and removes legacy segmentation/commercial history leaks", () => {
  const source = runBuild(makePayload());
  assert.equal(source.taxonomy_version, TAXONOMY_VERSION);
  assert.equal(source.classifier_version, CLASSIFIER_VERSION);
  assert.equal(source.prompt_version, PROMPT_VERSION);
  assert.deepEqual(source.taxonomyContract.definitions.map((item) => item.segment),
    CX8_SEGMENTS.map((item) => item.segment));
  assert.deepEqual(source.taxonomyContract.definitions.map((item) => item.required_evidence_code),
    CX8_SEGMENTS.map((item) => SEGMENT_EVIDENCE_CODES[item.segment]));
  assert.match(source.systemPrompt, /No segment is a fallback/);
  assert.match(source.systemPrompt, /request\.declared_customer_type to normalize exactly to privat/);
  assert.match(source.systemPrompt, /gewerblich or b2b/);
  assert.doesNotMatch(source.systemPrompt, /source request\.customer_type/);
  assert.doesNotMatch(source.userPrompt, /LEGACY_COMMERCIAL_LEAK/);
  assert.doesNotMatch(source.userPrompt, /LEGACY_HISTORY_SEGMENT_LEAK/);
  assert.doesNotMatch(source.userPrompt, /LEGACY_HISTORY_S_LEAK/);
  assert.doesNotMatch(source.userPrompt, /LEGACY_HISTORY_COMMERCIAL_LEAK/);
  assert.doesNotMatch(source.userPrompt, /estimated_value/);
});

test("Build routes a taxonomy mismatch into the existing technical failure body", () => {
  const payload = makePayload();
  payload.contract.taxonomy_version = "wrong-taxonomy";
  const result = runBuild(payload);
  assert.equal(result.error.name, "segmentation_taxonomy_contract_invalid");
  assert.equal(result.failureBody.p_job_id, JOB_ID);
  assert.equal(result.failureBody.p_retry_delay_minutes, 15);
});

test("Build rejects a DB definition whose required_evidence_code does not match CX8", () => {
  const payload = makePayload();
  payload.taxonomy.definitions[0].required_evidence_code = SEGMENT_EVIDENCE_CODES["NT-1"];
  const result = runBuild(payload);
  assert.equal(result.error.name, "segmentation_taxonomy_contract_invalid");
  assert.equal(result.failureBody.p_job_id, JOB_ID);
});

test("Build keeps only verified, taxonomy-matched DB cache rows", () => {
  const good = verifiedCache();
  const wrongTaxonomy = verifiedCache("https://wrong-taxonomy.example/company");
  wrongTaxonomy.cache_key = "company_name:wrong-taxonomy";
  wrongTaxonomy.summary_json.taxonomy_version = "legacy";
  const notAccepted = verifiedCache("https://not-accepted.example/company");
  notAccepted.cache_key = "company_name:not-accepted";
  notAccepted.summary_json.effective_status = "needs_review";
  const source = runBuild(makePayload({ researchCache: [good, wrongTaxonomy, notAccepted] }));
  assert.deepEqual(source.researchCache.map((item) => item.cache_key), [good.cache_key]);
  assert.deepEqual(source.researchCache[0].summary_json, {
    firmographic: { company_name: "Synthetic Company" },
    effective_status: "accepted",
    verified_company_identity: true,
    evidence_website_domain_verified: true,
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION,
    evidence_contract_valid: true,
    classifier_segment: "NT-1",
    required_evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"],
    validated_evidence_count: 1,
    validated_evidence_uses: ["segment_role"]
  });
});

test("Build treats stale or invalid CX8 cache contracts as ordinary cache misses", () => {
  const fixtures = [
    verifiedCache(WEB_URL, {}, { classifier_version: "segment_classifier_wrong" }),
    verifiedCache(WEB_URL, {}, { prompt_version: "segment_prompt_wrong" }),
    verifiedCache(WEB_URL, {}, { evidence_contract_valid: false }),
    verifiedCache(WEB_URL, {}, { required_evidence_code: SEGMENT_EVIDENCE_CODES["NT-4"] })
  ];
  for (const fixture of fixtures) {
    const source = runBuild(makePayload({ researchCache: [fixture] }));
    assert.deepEqual(source.researchCache, []);
    assert.equal(source.error, undefined);
  }
});

test("patch artifact changes exactly seven node fields and exact reverse restores the entire snapshot", () => {
  const { workflow } = loadPreparedPrestate();
  const bundle = createPatchBundle();
  assert.equal(bundle.forward.operations.length, 5);
  assert.equal(bundle.expected_diff.length, 7);
  const expectedDiffArtifact = JSON.parse(fs.readFileSync(
    new URL("./expected-diff.json", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(expectedDiffArtifact.fields, bundle.expected_diff);
  assert.equal(expectedDiffArtifact.operation_count, bundle.forward.operations.length);
  assert.equal(expectedDiffArtifact.changed_field_count, bundle.expected_diff.length);
  assert.equal(bundle.safety.prepared_only, true);
  assert.equal(bundle.forward.operations[0].updates["parameters.url"], CLAIM_URL_AFTER);
  assert.equal(bundle.forward.operations[0].updates["parameters.jsonBody"], CLAIM_BODY_AFTER);

  const forward = applyOperationsInMemory(workflow, bundle.forward.operations);
  const expected = structuredClone(workflow);
  expected.nodes.find((node) => node.id === "claim-jobs").parameters.url = CLAIM_URL_AFTER;
  expected.nodes.find((node) => node.id === "claim-jobs").parameters.jsonBody = CLAIM_BODY_AFTER;
  expected.nodes.find((node) => node.id === "build-prompt").parameters.jsCode = BUILD_PROMPT_CODE;
  const expectedOpenAi = expected.nodes.find((node) => node.id === "openai-classifier");
  expectedOpenAi.parameters.simplify = false;
  expectedOpenAi.parameters.options.textFormat.textOptions.schema = JSON.stringify(CLASSIFIER_SCHEMA);
  expected.nodes.find((node) => node.id === "validate-output").parameters.jsCode = VALIDATOR_CODE;
  expected.nodes.find((node) => node.id === "build-failure-payload").parameters.jsCode = FAILURE_PAYLOAD_CODE;
  assert.deepEqual(forward, expected);

  const reverse = applyOperationsInMemory(forward, bundle.reverse.operations);
  assert.deepEqual(reverse, workflow);
  assert.deepEqual(forward.connections, workflow.connections);
  assert.deepEqual(forward.settings, workflow.settings);
  assert.equal(forward.active, workflow.active);
  assert.equal(forward.nodes.length, workflow.nodes.length);
  assert.deepEqual(
    forward.nodes.find((node) => node.id === "record-classification"),
    workflow.nodes.find((node) => node.id === "record-classification")
  );
  const openai = forward.nodes.find((node) => node.id === "openai-classifier");
  assert.deepEqual(openai.parameters.builtInTools.webSearch, { searchContextSize: "medium", country: "DE" });
  assert.deepEqual(openai.parameters.options.include, ["web_search_call.action.sources"]);
});

test("generic exact-contract claim admits ingress and gold sources but no legacy or mismatched contract", () => {
  assert.match(CLAIM_URL_AFTER, /neontrip_claim_request_segmentation_jobs$/);
  assert.doesNotMatch(CLAIM_URL_AFTER, /_by_source$/);
  assert.doesNotMatch(CLAIM_BODY_AFTER, /p_source/);
  assert.match(CLAIM_BODY_AFTER, new RegExp(TAXONOMY_VERSION));
  assert.match(CLAIM_BODY_AFTER, new RegExp(CLASSIFIER_VERSION));
  assert.match(CLAIM_BODY_AFTER, new RegExp(PROMPT_VERSION));

  function eligible(job, policy) {
    return job.taxonomy_version === TAXONOMY_VERSION
      && job.classifier_version === CLASSIFIER_VERSION
      && job.prompt_version === PROMPT_VERSION
      && policy.taxonomy_version === TAXONOMY_VERSION
      && policy.classifier_version === CLASSIFIER_VERSION
      && policy.prompt_version === PROMPT_VERSION;
  }
  const cx8Policy = {
    taxonomy_version: TAXONOMY_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    prompt_version: PROMPT_VERSION
  };
  const cx8Job = { ...cx8Policy };
  assert.equal(eligible({ ...cx8Job, source: "master_requests_insert" }, cx8Policy), true);
  assert.equal(eligible({ ...cx8Job, source: "gold_re_evaluation" }, cx8Policy), true);
  assert.equal(eligible({ taxonomy_version: null, classifier_version: null, prompt_version: null, source: "master_requests_insert" }, cx8Policy), false);
  assert.equal(eligible({ ...cx8Job, classifier_version: "other", source: "gold_re_evaluation" }, cx8Policy), false);
});

test("synthetic raw-shape web_search_call fixture accepts NT-1 and binds normalized URL/code provenance", () => {
  const source = runBuild(makePayload());
  const model = baseModel(source, {
    evidence: [webEvidence("NT-1", "segment_role", `${WEB_URL}/#fragment`)]
  });
  const result = runValidator(rawResponse(model, [`${WEB_URL}/`]), source);
  assert.equal(result.rpcBody.p_status, "accepted");
  assert.equal(result.rpcBody.p_segment, "NT-1");
  assert.equal(result.rpcBody.p_accepted_by, "n8n-request-segmenter-v3");
  assert.equal(result.rpcBody.p_evidence_json[0].url, WEB_URL);
  const provenance = result.rpcBody.p_classifier_json.evidence_provenance;
  assert.equal(provenance.valid, true);
  assert.deepEqual(provenance.validated_positive_evidence_codes,
    [SEGMENT_EVIDENCE_CODES["NT-1"]]);
  assert.deepEqual(provenance.verified_sources, [{
    url: WEB_URL,
    source_type: "web_search_call",
    source_ref: "ws_synthetic_1",
    validated_positive_evidence_codes: [SEGMENT_EVIDENCE_CODES["NT-1"]]
  }]);
});

test("a model-invented external URL is semantic needs_review, not accepted provenance", () => {
  const source = runBuild(makePayload());
  const result = runValidator(rawResponse(baseModel(source), []), source);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, "NT-1");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.deepEqual(result.rpcBody.p_evidence_json, []);
  assert.equal(result.rpcBody.p_classifier_json.model_proposed_segment, "NT-1");
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, false);
  assert.deepEqual(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
  assert.ok(result.rpcBody.p_risk_flags.includes("invalid_external_evidence"));
  assert.ok(result.rpcBody.p_risk_flags.includes("evidence_provenance_unverified"));
});

test("verified DB cache URL is accepted and unverified cache is never allowlisted", () => {
  const goodSource = runBuild(makePayload({ researchCache: [verifiedCache(`${WEB_URL}/`)] }));
  const cacheModel = baseModel(goodSource, {
    evidence: [{
      type: "research_cache",
      url: `${WEB_URL}#synthetic-fragment`,
      used_for: "segment_role",
      evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"]
    }]
  });
  const accepted = runValidator(rawResponse(cacheModel), goodSource);
  assert.equal(accepted.rpcBody.p_status, "accepted");
  assert.equal(accepted.rpcBody.p_evidence_json[0].url, WEB_URL);
  assert.equal(
    accepted.rpcBody.p_classifier_json.evidence_provenance.verified_sources[0].source_type,
    "verified_db_cache"
  );
  assert.equal(
    accepted.rpcBody.p_classifier_json.evidence_provenance.verified_sources[0].source_ref,
    "company_name:synthetic-company"
  );

  const badCache = verifiedCache();
  badCache.status = "error";
  const badSource = runBuild(makePayload({ researchCache: [badCache] }));
  assert.deepEqual(badSource.researchCache, []);
  const rejected = runValidator(rawResponse(cacheModel), badSource);
  assert.equal(rejected.rpcBody.p_status, "needs_review");
  assert.deepEqual(rejected.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
});

test("verified DB cache cannot be relabeled by the model across evidence code or used_for", () => {
  const companyIdentityCache = verifiedCache(WEB_URL, { used_for: "company_identity" });
  const companyIdentitySource = runBuild(makePayload({ researchCache: [companyIdentityCache] }));
  const relabeledUseModel = baseModel(companyIdentitySource, {
    evidence: [{
      type: "research_cache",
      url: WEB_URL,
      used_for: "segment_role",
      evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"]
    }]
  });
  const relabeledUse = runValidator(rawResponse(relabeledUseModel), companyIdentitySource);
  assert.equal(relabeledUse.rpcBody.p_status, "needs_review");
  assert.deepEqual(relabeledUse.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
  assert.ok(relabeledUse.rpcBody.p_risk_flags.includes("invalid_external_evidence"));

  const otherCodeCache = verifiedCache(WEB_URL, {
    evidence_code: SEGMENT_EVIDENCE_CODES["NT-4"]
  });
  const otherCodeSource = runBuild(makePayload({ researchCache: [otherCodeCache] }));
  const relabeledCodeModel = baseModel(otherCodeSource, {
    evidence: [{
      type: "research_cache",
      url: WEB_URL,
      used_for: "segment_role",
      evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"]
    }]
  });
  const relabeledCode = runValidator(rawResponse(relabeledCodeModel), otherCodeSource);
  assert.equal(relabeledCode.rpcBody.p_status, "needs_review");
  assert.deepEqual(relabeledCode.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
  assert.ok(relabeledCode.rpcBody.p_risk_flags.includes("invalid_external_evidence"));
});

test("Validator independently rejects cache summary version and contract drift without throwing", () => {
  const mutations = [
    (summary) => { summary.classifier_version = "segment_classifier_wrong"; },
    (summary) => { summary.prompt_version = "segment_prompt_wrong"; },
    (summary) => { summary.evidence_contract_valid = false; },
    (summary) => { summary.required_evidence_code = SEGMENT_EVIDENCE_CODES["NT-4"]; }
  ];
  for (const mutate of mutations) {
    const source = runBuild(makePayload({ researchCache: [verifiedCache()] }));
    mutate(source.researchCache[0].summary_json);
    const model = baseModel(source, {
      evidence: [{
        type: "research_cache",
        url: WEB_URL,
        used_for: "segment_role",
        evidence_code: SEGMENT_EVIDENCE_CODES["NT-1"]
      }]
    });
    const result = runValidator(rawResponse(model), source);
    assert.equal(result.rpcBody.p_status, "needs_review");
    assert.deepEqual(result.rpcBody.p_classifier_json.evidence_provenance.verified_sources, []);
    assert.ok(result.rpcBody.p_risk_flags.includes("invalid_external_evidence"));
  }
});

test("NT-8 accepts only exact privat source choice plus explicit customer_declared evidence code", () => {
  const source = runBuild(makePayload({
    customerType: "  Privat  ",
    freemail: true,
    companyName: ""
  }));
  const model = baseModel(source, {
    segment: "NT-8",
    confidence: 0.94,
    evidence: [declaredEvidence("NT-8")],
    firmographic: {
      is_company: false,
      company_name: null,
      website: null,
      industry: null,
      email_domain: "gmail.com",
      is_freemail: true
    }
  });
  const result = runValidator(rawResponse(model), source);
  assert.equal(result.rpcBody.p_status, "accepted");
  assert.equal(result.rpcBody.p_segment, "NT-8");
  const provenance = result.rpcBody.p_classifier_json.evidence_provenance;
  assert.equal(provenance.request_evidence_used, true);
  assert.equal(provenance.explicit_private_choice_verified, true);
  assert.equal(provenance.explicit_business_choice_verified, false);
  assert.deepEqual(provenance.validated_positive_evidence_codes, ["explicit_private_use"]);
  assert.deepEqual(provenance.verified_sources, []);
});

test("fake model private evidence cannot override non-private or unknown source customer_type", () => {
  for (const customerType of ["gewerblich", "b2b", "anfrage_autoreply", "", "unternehmen oder privat"] ) {
    const source = runBuild(makePayload({ customerType, freemail: true, companyName: "" }));
    const model = baseModel(source, {
      segment: "NT-8",
      evidence: [declaredEvidence("NT-8")],
      firmographic: {
        is_company: false,
        company_name: null,
        website: null,
        industry: null,
        email_domain: "gmail.com",
        is_freemail: true
      }
    });
    const result = runValidator(rawResponse(model), source);
    assert.equal(result.rpcBody.p_status, "needs_review", customerType);
    assert.equal(result.rpcBody.p_segment, "NT-8", customerType);
    assert.equal(result.rpcBody.p_classifier_json.segment, null, customerType);
    assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, false, customerType);
    assert.ok(result.rpcBody.p_risk_flags.includes("evidence_provenance_unverified"), customerType);
  }
});

test("NT-9 needs exact gewerblich|b2b first-party choice, declaration code and verified direct-business URL", () => {
  for (const customerType of ["gewerblich", "B2B"] ) {
    const source = runBuild(makePayload({ customerType }));
    const model = baseModel(source, {
      segment: "NT-9",
      evidence: [webEvidence("NT-9"), declaredEvidence("NT-9")]
    });
    const result = runValidator(rawResponse(model, [WEB_URL]), source);
    assert.equal(result.rpcBody.p_status, "accepted", customerType);
    assert.equal(result.rpcBody.p_segment, "NT-9", customerType);
    assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.explicit_business_choice_verified, true);
  }

  for (const customerType of ["messe", "business", "unternehmen oder privat", ""] ) {
    const source = runBuild(makePayload({ customerType }));
    const model = baseModel(source, {
      segment: "NT-9",
      evidence: [webEvidence("NT-9"), declaredEvidence("NT-9")]
    });
    const result = runValidator(rawResponse(model, [WEB_URL]), source);
    assert.equal(result.rpcBody.p_status, "needs_review", customerType);
    assert.equal(result.rpcBody.p_segment, "NT-9", customerType);
    assert.equal(result.rpcBody.p_classifier_json.segment, null, customerType);
  }
});

test("NT-5/NT-6 fail closed without allowlisted scale evidence and NT-6 requires enterprise", () => {
  const source = runBuild(makePayload());
  const nt5NoScale = baseModel(source, {
    segment: "NT-5",
    evidence: [webEvidence("NT-5")],
    organization_scale: null
  });
  const rejectedNt5 = runValidator(rawResponse(nt5NoScale, [WEB_URL]), source);
  assert.equal(rejectedNt5.rpcBody.p_status, "needs_review");
  assert.ok(rejectedNt5.rpcBody.p_risk_flags.includes("organization_scale_unverified"));

  const nt5ScaleOnly = baseModel(source, {
    segment: "NT-5",
    evidence: [webEvidence("NT-5", "organization_scale")],
    organization_scale: "medium"
  });
  const rejectedNt5ScaleOnly = runValidator(rawResponse(nt5ScaleOnly, [WEB_URL]), source);
  assert.equal(rejectedNt5ScaleOnly.rpcBody.p_status, "needs_review");
  assert.ok(rejectedNt5ScaleOnly.rpcBody.p_risk_flags.includes("insufficient_segment_evidence"));

  const nt5 = baseModel(source, {
    segment: "NT-5",
    evidence: [webEvidence("NT-5"), webEvidence("NT-5", "organization_scale")],
    organization_scale: "medium"
  });
  assert.equal(runValidator(rawResponse(nt5, [WEB_URL]), source).rpcBody.p_status, "accepted");

  const nt6Large = baseModel(source, {
    segment: "NT-6",
    evidence: [webEvidence("NT-6"), webEvidence("NT-6", "organization_scale")],
    organization_scale: "large"
  });
  assert.equal(runValidator(rawResponse(nt6Large, [WEB_URL]), source).rpcBody.p_status, "needs_review");

  const nt6Enterprise = { ...nt6Large, organization_scale: "enterprise" };
  assert.equal(runValidator(rawResponse(nt6Enterprise, [WEB_URL]), source).rpcBody.p_status, "accepted");
});

test("NT-5/NT-6 split-URL scale evidence binds the required code to its own verified source", () => {
  for (const segment of ["NT-5", "NT-6"]) {
    const source = runBuild(makePayload());
    const model = baseModel(source, {
      segment,
      evidence: [
        webEvidence(segment, "segment_role", WEB_URL),
        webEvidence(segment, "organization_scale", SCALE_URL)
      ],
      organization_scale: segment === "NT-6" ? "enterprise" : "medium"
    });
    const result = runValidator(rawResponse(model, [WEB_URL, SCALE_URL]), source);
    assert.equal(result.rpcBody.p_status, "accepted", segment);
    const scaleSource = result.rpcBody.p_classifier_json.evidence_provenance.verified_sources
      .find((item) => item.url === SCALE_URL);
    assert.deepEqual(
      scaleSource?.validated_positive_evidence_codes,
      [SEGMENT_EVIDENCE_CODES[segment]],
      segment
    );
  }
});

test("NT-5/NT-6 split-URL scale evidence with another segment code stays needs_review", () => {
  for (const segment of ["NT-5", "NT-6"]) {
    const source = runBuild(makePayload());
    const wrongCode = segment === "NT-5"
      ? SEGMENT_EVIDENCE_CODES["NT-6"]
      : SEGMENT_EVIDENCE_CODES["NT-5"];
    const model = baseModel(source, {
      segment,
      evidence: [
        webEvidence(segment, "segment_role", WEB_URL),
        {
          ...webEvidence(segment, "organization_scale", SCALE_URL),
          evidence_code: wrongCode
        }
      ],
      organization_scale: segment === "NT-6" ? "enterprise" : "medium"
    });
    const result = runValidator(rawResponse(model, [WEB_URL, SCALE_URL]), source);
    assert.equal(result.rpcBody.p_status, "needs_review", segment);
    assert.equal(result.rpcBody.p_segment, segment, segment);
    assert.ok(result.rpcBody.p_risk_flags.includes("organization_scale_unverified"), segment);
    const scaleSource = result.rpcBody.p_classifier_json.evidence_provenance.verified_sources
      .find((item) => item.url === SCALE_URL);
    assert.deepEqual(scaleSource?.validated_positive_evidence_codes, [], segment);
  }
});

test("primary positive evidence used_for is identical to the DB segment contract", () => {
  const wrongUses = [
    ["NT-10", "segment_role"],
    ["NT-1", "company_identity"],
    ["NT-3", "company_identity"],
    ["NT-4", "company_identity"],
    ["NT-5", "organization_scale"],
    ["NT-6", "organization_scale"],
    ["NT-9", "company_identity"]
  ];
  for (const [segment, usedFor] of wrongUses) {
    const source = runBuild(makePayload());
    const evidence = [webEvidence(segment, usedFor)];
    if (segment === "NT-9") evidence.push(declaredEvidence("NT-9"));
    const model = baseModel(source, {
      segment,
      evidence,
      organization_scale: segment === "NT-6" ? "enterprise" : segment === "NT-5" ? "medium" : null,
      firmographic: segment === "NT-10"
        ? { ...baseModel(source).firmographic, is_company: false }
        : baseModel(source).firmographic
    });
    const result = runValidator(rawResponse(model, [WEB_URL]), source);
    assert.equal(result.rpcBody.p_status, "needs_review", `${segment}:${usedFor}`);
    assert.ok(result.rpcBody.p_risk_flags.includes("insufficient_segment_evidence"), `${segment}:${usedFor}`);
  }
});

test("NT-10 institutional evidence is not blocked by firmographic is_company=false", () => {
  const source = runBuild(makePayload());
  const model = baseModel(source, {
    segment: "NT-10",
    evidence: [webEvidence("NT-10")],
    firmographic: { ...baseModel(source).firmographic, is_company: false },
    risk_flags: ["missing_company_identity"]
  });
  const result = runValidator(rawResponse(model, [WEB_URL]), source);
  assert.equal(result.rpcBody.p_status, "accepted");
  assert.equal(result.rpcBody.p_segment, "NT-10");
  assert.equal(result.rpcBody.p_risk_flags.includes("missing_company_identity"), false);
});

test("an allowlisted URL with the wrong segment evidence_code remains needs_review", () => {
  const source = runBuild(makePayload());
  const model = baseModel(source, {
    segment: "NT-1",
    evidence: [webEvidence("NT-4")]
  });
  const result = runValidator(rawResponse(model, [WEB_URL]), source);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, "NT-1");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.ok(result.rpcBody.p_risk_flags.includes("insufficient_segment_evidence"));
  assert.deepEqual(
    result.rpcBody.p_classifier_json.evidence_provenance.verified_sources[0].validated_positive_evidence_codes,
    []
  );
});

test("positive segment evidence codes on context_tag or conflict never satisfy the segment gate", () => {
  const cases = [
    ["NT-10", "institution_status"],
    ["NT-1", "segment_role"],
    ["NT-4", "segment_role"],
    ["NT-3", "segment_role"],
    ["NT-5", "organization_scale"],
    ["NT-6", "organization_scale"],
    ["NT-9", "segment_role"]
  ];
  for (const usedFor of ["context_tag", "conflict"]) {
    for (const [segment] of cases) {
      const source = runBuild(makePayload());
      const evidence = [webEvidence(segment, usedFor)];
      if (segment === "NT-9") evidence.push(declaredEvidence("NT-9"));
      const model = baseModel(source, {
        segment,
        evidence,
        organization_scale: segment === "NT-6" ? "enterprise" : segment === "NT-5" ? "medium" : null
      });
      const result = runValidator(rawResponse(model, [WEB_URL]), source);
      assert.equal(result.rpcBody.p_status, "needs_review", `${segment}:${usedFor}`);
      assert.equal(result.rpcBody.p_segment, segment, `${segment}:${usedFor}`);
      assert.equal(result.rpcBody.p_classifier_json.segment, null, `${segment}:${usedFor}`);
      assert.ok(result.rpcBody.p_risk_flags.includes("insufficient_segment_evidence"), `${segment}:${usedFor}`);
      assert.deepEqual(
        result.rpcBody.p_classifier_json.evidence_provenance.verified_sources[0]
          .validated_positive_evidence_codes,
        [],
        `${segment}:${usedFor}`
      );
    }
  }
});

test("low-confidence NT-4 records the proposal while the validated segment stays null", () => {
  const source = runBuild(makePayload());
  const model = baseModel(source, {
    segment: "NT-4",
    confidence: 0.40,
    evidence: [webEvidence("NT-4")]
  });
  const result = runValidator(rawResponse(model, [WEB_URL]), source);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, "NT-4");
  assert.equal(result.rpcBody.p_classifier_json.model_proposed_segment, "NT-4");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.ok(result.rpcBody.p_risk_flags.includes("low_confidence"));
});

test("first-party privat blocks an externally evidenced non-private proposal", () => {
  const source = runBuild(makePayload({ customerType: "privat" }));
  const model = baseModel(source, {
    segment: "NT-4",
    evidence: [webEvidence("NT-4")]
  });
  const result = runValidator(rawResponse(model, [WEB_URL]), source);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, "NT-4");
  assert.equal(result.rpcBody.p_classifier_json.segment, null);
  assert.equal(result.rpcBody.p_classifier_json.model_proposed_segment, "NT-4");
  assert.ok(result.rpcBody.p_risk_flags.includes("conflicting_evidence"));
});

test("retired codes, malformed JSON, extra fields and validator-owned model flags are technical failures", () => {
  const source = runBuild(makePayload());
  const retired = baseModel(source, { segment: "NT-18" });
  assert.throws(
    () => runValidator(rawResponse(retired, [WEB_URL]), source),
    (error) => error.name === "classifier_segment_not_active"
  );

  assert.throws(
    () => runValidator({ output: [{ type: "message", content: [{ type: "output_text", text: "{bad" }] }] }, source),
    (error) => error.name === "classifier_output_malformed"
  );

  const extra = { ...baseModel(source), unexpected: true };
  assert.throws(
    () => runValidator(rawResponse(extra, [WEB_URL]), source),
    (error) => error.name === "classifier_output_contract_invalid"
  );

  const forbiddenFlag = baseModel(source, { risk_flags: ["evidence_provenance_unverified"] });
  assert.throws(
    () => runValidator(rawResponse(forbiddenFlag, [WEB_URL]), source),
    (error) => error.name === "classifier_output_contract_invalid"
  );
});

test("failure payload recovers a real job UUID for Validator, OpenAI, and Record errors", () => {
  const cases = [
    {
      label: "validator",
      current: { id: "resp_validator_synthetic", error: { name: "classifier_output_contract_invalid", message: "Synthetic validator failure" } },
      lineage: { "Build Classifier Prompt": [{ job: { id: JOB_ID } }] }
    },
    {
      label: "openai",
      current: { id: "resp_openai_synthetic", error: { name: "NodeApiError", message: "Synthetic OpenAI failure" } },
      lineage: { "Get Segmentation Payload": [{ job: { id: JOB_ID } }] }
    },
    {
      label: "record",
      current: { id: "resp_record_synthetic", error: { name: "NodeApiError", message: "Synthetic Record failure" } },
      lineage: { "Validate Classifier Output": [{ rpcBody: { p_job_id: JOB_ID } }] }
    }
  ];
  for (const fixture of cases) {
    const result = runFailurePayload(fixture.current, fixture.lineage);
    assert.equal(result.length, 1, fixture.label);
    assert.equal(result[0].json.failureBody.p_job_id, JOB_ID, fixture.label);
    assert.doesNotMatch(result[0].json.failureBody.p_job_id, /^resp_/, fixture.label);
    assert.equal(result[0].json.failureBody.p_retry_delay_minutes, 15, fixture.label);
  }
});

test("failure payload uses Normalize/Claim lineage and never accepts resp_* as a job id", () => {
  const fromNormalize = runFailurePayload(
    { id: "resp_synthetic", error: { message: "Synthetic failure" } },
    { "Normalize Claimed Jobs": [{ id: JOB_ID, request_id: REQUEST_ID, input_hash: INPUT_HASH }] }
  );
  assert.equal(fromNormalize[0].json.failureBody.p_job_id, JOB_ID);

  const fromClaim = runFailurePayload(
    { id: "resp_synthetic", error: { message: "Synthetic failure" } },
    { "Claim Segmentation Jobs": [[{ id: JOB_ID, request_id: REQUEST_ID, input_hash: INPUT_HASH }]] }
  );
  assert.equal(fromClaim[0].json.failureBody.p_job_id, JOB_ID);

  const missing = runFailurePayload({
    id: "resp_synthetic",
    p_job_id: "resp_not_a_uuid",
    error: { message: "Synthetic failure" }
  });
  assert.deepEqual(missing, []);
});

test("model-declared needs_review remains a non-throwing semantic record with null segment", () => {
  const source = runBuild(makePayload({ customerType: "" }));
  const model = baseModel(source, {
    decision: "needs_review",
    segment: null,
    confidence: 0.42,
    evidence_grade: "none",
    reasoning_short: "Synthetic ambiguity remains unresolved.",
    reason_codes: ["synthetic_ambiguous"],
    evidence: [],
    firmographic: {
      is_company: false,
      company_name: null,
      website: null,
      industry: null,
      email_domain: source.domainFacts.email_domain,
      is_freemail: source.domainFacts.is_freemail
    },
    risk_flags: ["ambiguous_segment"]
  });
  const result = runValidator(rawResponse(model), source);
  assert.equal(result.rpcBody.p_status, "needs_review");
  assert.equal(result.rpcBody.p_segment, null);
  assert.equal(result.rpcBody.p_classifier_json.evidence_provenance.valid, false);
  assert.equal(Object.keys(result.rpcBody).length, 18);
  assert.deepEqual(Object.keys(result.rpcBody).sort(), [
    "p_accepted_by", "p_classifier_json", "p_classifier_version", "p_confidence",
    "p_evidence_grade", "p_evidence_json", "p_firmographic_json", "p_input_hash",
    "p_job_id", "p_model", "p_model_version", "p_prompt_version", "p_reason_codes",
    "p_reasoning_short", "p_request_id", "p_risk_flags", "p_segment", "p_status"
  ]);
});
