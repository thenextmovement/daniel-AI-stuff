import test from "node:test";
import assert from "node:assert/strict";
import {
  adjudicateRequestSegmentationGold,
  getRequestSegmentationReviewContext,
  validateRequestSegmentationGoldResult,
  validateRequestSegmentationReviewContext,
} from "@/lib/ops/request-segmentation-gold";
import { CX8_TAXONOMY_VERSION } from "@/lib/ops/customer-segments";
import {
  isGoldUiSubmissionReady,
  isCurrentGoldProposal,
  resolveGoldProposalPrefill,
} from "../../src/app/ops/customer-records/segment-gold-control";

const masterRequestId = "11111111-1111-4111-8111-111111111111";
const publicRequestId = "request-public-gold-1";
const inputHash = "current-input-hash-v2";

function latestClassification(overrides: Record<string, unknown> = {}) {
  return {
    classification_id: "22222222-2222-4222-8222-222222222222",
    input_hash: inputHash,
    input_hash_current: true,
    status: "accepted",
    proposed_segment: "NT-3",
    s_kategorie: "S1",
    confidence: 0.91,
    evidence_grade: "strong",
    reasoning_short: "Öffentliche Unternehmensseite belegt Event- und Medienproduktion.",
    reason_codes: ["official_company_site"],
    evidence_json: [{
      type: "web_search",
      url: "https://example.org/about",
      used_for: "segment_role",
      evidence_code: "verified_event_or_media_operator",
    }],
    risk_flags: [],
    context_tags: ["film_tv", "startup_tech"],
    organization_scale: "small",
    evidence_provenance_valid: true,
    mapping_integrity: true,
    classified_at: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

function reviewResult(overrides: Record<string, unknown> = {}) {
  return {
    request_id: masterRequestId,
    public_request_id: publicRequestId,
    current_input_hash: inputHash,
    taxonomy_version: CX8_TAXONOMY_VERSION,
    classifier_version: "segment_classifier_v3_20260819_cx8",
    prompt_version: "segment_prompt_v4_20260819_cx8",
    quality_gate_version: "nt_quality_gate_v2_20260819_cx8",
    gold_eligibility: {
      normalized_customer_type: "gewerblich",
      nt8_first_party_eligible: false,
      nt9_first_party_eligible: true,
      nt8_requires_null_organization_scale: true,
      nt5_requires_nonnull_organization_scale: true,
      nt6_required_organization_scale: "enterprise",
      non_nt8_requires_external_evidence_url: true,
    },
    latest_classification: latestClassification(),
    current_gold_adjudication: null,
    ...overrides,
  };
}

function adjudicationResult(overrides: Record<string, unknown> = {}) {
  return {
    gold_adjudication_id: "33333333-3333-4333-8333-333333333333",
    request_id: masterRequestId,
    input_hash: inputHash,
    taxonomy_version: CX8_TAXONOMY_VERSION,
    labeling_version: "gold_labeling_v2_20260819_cx8",
    labeled_segment: "NT-3",
    labeled_s_kategorie: "S1",
    context_tags: ["film_tv", "startup_tech"],
    organization_scale: "small",
    created: true,
    idempotent_retry: false,
    evaluation_job_id: "44444444-4444-4444-8444-444444444444",
    master_segment_mutated: false,
    ...overrides,
  };
}

async function withSupabaseFetch<T>(fetchImpl: typeof fetch, run: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

test("review context validator accepts only the exact current CX8 v3 contract", () => {
  const context = validateRequestSegmentationReviewContext(reviewResult(), { masterRequestId, publicRequestId });
  assert.equal(context.currentInputHash, inputHash);
  assert.equal(context.latestClassification?.proposedSegment, "NT-3");
  assert.equal(context.latestClassification?.inputHashCurrent, true);
  assert.deepEqual(context.latestClassification?.contextTags, ["film_tv", "startup_tech"]);
  assert.equal(context.goldEligibility.normalizedCustomerType, "gewerblich");
  assert.equal(context.goldEligibility.nt9FirstPartyEligible, true);
  assert.equal(context.currentGoldAdjudication, null);

  for (const invalid of [
    reviewResult({ taxonomy_version: "nt_taxonomy_v1" }),
    reviewResult({ latest_classification: { ...latestClassification(), unexpected: true } }),
    reviewResult({ latest_classification: latestClassification({ context_tags: ["unknown_context"] }) }),
    reviewResult({ latest_classification: latestClassification({ confidence: "0.91" }) }),
    reviewResult({ latest_classification: latestClassification({ evidence_json: [{
      type: "web_search",
      url: "javascript:alert(1)",
      used_for: "segment_role",
      evidence_code: "verified_event_or_media_operator",
    }] }) }),
    reviewResult({ latest_classification: latestClassification({ evidence_json: [{ url: "https://example.org" }] }) }),
    reviewResult({ gold_eligibility: {
      ...reviewResult().gold_eligibility,
      nt8_first_party_eligible: true,
    } }),
  ]) {
    assert.throws(
      () => validateRequestSegmentationReviewContext(invalid, { masterRequestId, publicRequestId }),
      /erwarteten CX8-Vertrag/,
    );
  }
});

test("Gold UI pre-fills only an input-current latest proposal", () => {
  const current = validateRequestSegmentationReviewContext(
    reviewResult(),
    { masterRequestId, publicRequestId },
  ).latestClassification;
  assert.equal(isCurrentGoldProposal(current), true);
  assert.deepEqual(resolveGoldProposalPrefill(current), {
    segment: "NT-3",
    contextTags: ["film_tv", "startup_tech"],
    organizationScale: "small",
    evidenceUrls: "https://example.org/about",
  });

  const stale = validateRequestSegmentationReviewContext(
    reviewResult({
      latest_classification: latestClassification({
        input_hash: "stale-input-hash",
        input_hash_current: false,
      }),
    }),
    { masterRequestId, publicRequestId },
  ).latestClassification;
  assert.equal(isCurrentGoldProposal(stale), false);
  assert.deepEqual(resolveGoldProposalPrefill(stale), {
    segment: "",
    contextTags: [],
    organizationScale: "",
    evidenceUrls: "",
  });
  assert.equal(isCurrentGoldProposal(null), false);
});

test("Gold UI permits fully manual adjudication for null or stale latest classification", () => {
  const noPrediction = validateRequestSegmentationReviewContext(
    reviewResult({ latest_classification: null }),
    { masterRequestId, publicRequestId },
  );
  const stale = validateRequestSegmentationReviewContext(
    reviewResult({
      latest_classification: latestClassification({
        input_hash: "stale-input-hash",
        input_hash_current: false,
      }),
    }),
    { masterRequestId, publicRequestId },
  );
  const manualReady = {
    currentGold: null,
    selectedOptionReady: true,
    evidenceReady: true,
    organizationScaleReady: true,
    firstPartyEligibilityReady: true,
    actorReady: true,
    reasonReady: true,
    confirmed: true,
    saving: false,
  };

  assert.equal(isGoldUiSubmissionReady({ ...manualReady, context: noPrediction }), true);
  assert.equal(isGoldUiSubmissionReady({ ...manualReady, context: stale }), true);
  assert.equal(isGoldUiSubmissionReady({
    ...manualReady,
    context: stale,
    selectedOptionReady: false,
    evidenceReady: false,
  }), false);
});

test("review context exposes immutable current gold only when it matches the exact input", () => {
  const currentGold = {
    gold_adjudication_id: "33333333-3333-4333-8333-333333333333",
    input_hash: inputHash,
    labeled_segment: "NT-3",
    labeled_s_kategorie: "S1",
    context_tags: ["film_tv"],
    organization_scale: null,
    labeling_version: "gold_labeling_v2_20260819_cx8",
    created_at: "2026-08-19T13:00:00.000Z",
  };
  const context = validateRequestSegmentationReviewContext(
    reviewResult({ current_gold_adjudication: currentGold }),
    { masterRequestId, publicRequestId },
  );
  assert.equal(context.currentGoldAdjudication?.labeledSegment, "NT-3");

  assert.throws(
    () => validateRequestSegmentationReviewContext(
      reviewResult({ current_gold_adjudication: { ...currentGold, input_hash: "stale-hash" } }),
      { masterRequestId, publicRequestId },
    ),
    /erwarteten CX8-Vertrag/,
  );
});

test("review loader resolves the master UUID and calls only the service-role review RPC", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  await withSupabaseFetch((async (input, init = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes("/master_requests?")) {
      return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    }
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) {
      return Response.json(reviewResult());
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const context = await getRequestSegmentationReviewContext(publicRequestId);
    assert.equal(context.masterRequestId, masterRequestId);
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.body, { p_request_id: masterRequestId });
});

test("gold adjudication posts the exact current hash, actor, evidence and active CX8 segment", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  await withSupabaseFetch((async (input, init = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(reviewResult());
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) return Response.json(adjudicationResult());
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const result = await adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "nt-3",
      contextTags: ["startup_tech", "film_tv", "film_tv"],
      organizationScale: "small",
      actor: "Daniel",
      reason: "Offizielle Unternehmensseite und Impressum wurden manuell geprüft.",
      evidenceUrls: ["https://example.org/impressum", "https://example.org/about"],
    });
    assert.equal(result.created, true);
    assert.equal(result.masterSegmentMutated, false);
  });
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.url.includes("neontrip_set_manual_request_segment")), false);
  assert.equal(calls.some((call) => call.url.includes("master_requests") && call.body !== null), false);
  assert.deepEqual(calls[2]?.body, {
    p_request_id: masterRequestId,
    p_input_hash: inputHash,
    p_taxonomy_version: CX8_TAXONOMY_VERSION,
    p_segment: "NT-3",
    p_context_tags: ["film_tv", "startup_tech"],
    p_organization_scale: "small",
    p_adjudicated_by: "Daniel",
    p_adjudication_reason: "Offizielle Unternehmensseite und Impressum wurden manuell geprüft.",
    p_evidence_urls: ["https://example.org/about", "https://example.org/impressum"],
  });
});

test("stale review hashes and invalid Gold input fail before the adjudication RPC", async () => {
  let adjudicationCalls = 0;
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) {
      return Response.json(reviewResult({
        current_input_hash: "new-current-hash",
        latest_classification: latestClassification({ input_hash: "new-current-hash" }),
      }));
    }
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) adjudicationCalls += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-3",
      actor: "Daniel",
      reason: "Diese Begründung ist lang genug für eine echte Prüfung.",
      evidenceUrls: ["https://example.org/about"],
    }), /seit dem Laden des Reviews geaendert/);
  });
  assert.equal(adjudicationCalls, 0);

  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) {
      return Response.json(reviewResult({
        gold_eligibility: {
          ...reviewResult().gold_eligibility,
          normalized_customer_type: "privat",
          nt8_first_party_eligible: true,
          nt9_first_party_eligible: false,
        },
      }));
    }
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) adjudicationCalls += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-9",
      actor: "Daniel",
      reason: "Diese direkte Business-Einordnung wurde vollständig geprüft.",
      evidenceUrls: ["https://example.org/about"],
    }), /gewerblichem oder B2B-Kundentyp/);
  });
  assert.equal(adjudicationCalls, 0);

  let reads = 0;
  await withSupabaseFetch((async () => {
    reads += 1;
    return Response.json([]);
  }) as typeof fetch, async () => {
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-2",
      actor: "Daniel",
      reason: "Diese Begründung ist lang genug für eine echte Prüfung.",
    }), /Nur aktive CX8-Segmente/);
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-3",
      actor: "Daniel",
      reason: "zu kurz",
    }), /mindestens 20 Zeichen/);
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-3",
      actor: "Daniel",
      reason: "Diese Begründung ist lang genug für eine echte Prüfung.",
    }), /mindestens eine gueltige Evidence-URL/);
  });
  assert.equal(reads, 0);
});

test("Gold eligibility blocks incompatible customer type and organization scale before adjudication", async () => {
  let adjudicationCalls = 0;
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(reviewResult());
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) adjudicationCalls += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-8",
      actor: "Daniel",
      reason: "Diese private Einordnung wurde fachlich vollständig geprüft.",
    }), /DB-bestaetigtem Kundentyp Privat/);
  });
  assert.equal(adjudicationCalls, 0);

  let reads = 0;
  await withSupabaseFetch((async () => {
    reads += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-5",
      actor: "Daniel",
      reason: "Diese Franchise-Einordnung wurde vollständig geprüft.",
      evidenceUrls: ["https://example.org/about"],
    }), /gepruefte Organisationsgroesse/);
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-6",
      organizationScale: "large",
      actor: "Daniel",
      reason: "Diese Enterprise-Einordnung wurde vollständig geprüft.",
      evidenceUrls: ["https://example.org/about"],
    }), /exakt die Organisationsgroesse Enterprise/);
    await assert.rejects(adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-8",
      organizationScale: "solo",
      actor: "Daniel",
      reason: "Diese private Einordnung wurde fachlich vollständig geprüft.",
    }), /leere Organisationsgroesse/);
  });
  assert.equal(reads, 0);
});

test("Gold input bounds return 422 before any RPC", async () => {
  let reads = 0;
  const expect422 = async (input: Parameters<typeof adjudicateRequestSegmentationGold>[0], pattern: RegExp) => {
    await assert.rejects(
      adjudicateRequestSegmentationGold(input),
      (error: unknown) => Boolean(
        error
        && typeof error === "object"
        && "status" in error
        && error.status === 422
        && "message" in error
        && pattern.test(String(error.message)),
      ),
    );
  };
  await withSupabaseFetch((async () => {
    reads += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    const base = {
      publicRequestId,
      inputHash,
      segment: "NT-3",
      actor: "Daniel",
      reason: "Diese Einordnung wurde fachlich vollständig geprüft.",
      evidenceUrls: ["https://example.org/about"],
    };
    await expect422({ ...base, actor: "A".repeat(321) }, /maximal 320/);
    await expect422({ ...base, reason: "R".repeat(4001) }, /maximal 4000/);
    await expect422({ ...base, contextTags: ["T".repeat(81)] }, /maximal 80/);
    await expect422({
      ...base,
      evidenceUrls: Array.from({ length: 13 }, (_, index) => `https://example.org/evidence-${index}`),
    }, /Maximal 12/);
    await expect422({
      ...base,
      evidenceUrls: [`https://example.org/${"a".repeat(2049)}`],
    }, /maximal 2048/);
  });
  assert.equal(reads, 0);
});

test("gold response validator accepts created or idempotent only and forbids master mutation", () => {
  const expected = {
    masterRequestId,
    inputHash,
    segment: "NT-3" as const,
    contextTags: ["film_tv", "startup_tech"] as const,
    organizationScale: "small" as const,
  };
  assert.equal(validateRequestSegmentationGoldResult(adjudicationResult(), {
    ...expected,
    contextTags: [...expected.contextTags],
  }).created, true);
  assert.equal(validateRequestSegmentationGoldResult(adjudicationResult({
    created: false,
    idempotent_retry: true,
  }), {
    ...expected,
    contextTags: [...expected.contextTags],
  }).idempotentRetry, true);

  for (const invalid of [
    adjudicationResult({ master_segment_mutated: true }),
    adjudicationResult({ created: true, idempotent_retry: true }),
    adjudicationResult({ taxonomy_version: "nt_taxonomy_v1" }),
    adjudicationResult({ unexpected: true }),
  ]) {
    assert.throws(
      () => validateRequestSegmentationGoldResult(invalid, { ...expected, contextTags: [...expected.contextTags] }),
      /keinen gueltigen unveraenderlichen DB-Vertrag/,
    );
  }
});
