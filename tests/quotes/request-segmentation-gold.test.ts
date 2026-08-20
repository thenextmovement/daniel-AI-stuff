import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { GET as getSegmentGold, POST as postSegmentGold } from "@/app/api/ops/customer-records/segment-gold/route";
import {
  adjudicateRequestSegmentationGold,
  combineRequestSegmentationGoldActor,
  getRequestSegmentationBlindReviewContext,
  getRequestSegmentationGoldPilotNext,
  getRequestSegmentationReviewContext,
  REQUEST_SEGMENTATION_GOLD_PILOT_VERSION,
  redactRequestSegmentationModelUntilGold,
  toRequestSegmentationBlindReviewPayload,
  validateRequestSegmentationGoldResult,
  validateRequestSegmentationReviewContext,
} from "@/lib/ops/request-segmentation-gold";
import { CUSTOMER_SEGMENT_OPTIONS, CX8_TAXONOMY_VERSION } from "@/lib/ops/customer-segments";
import {
  isGoldUiSubmissionReady,
  safeModelEvidenceLinks,
} from "../../src/app/ops/customer-records/segment-gold-control";

const masterRequestId = "11111111-1111-4111-8111-111111111111";
const masterCustomerId = "55555555-5555-4555-8555-555555555555";
const publicRequestId = "request-public-gold-1";
const inputHash = "current-input-hash-v2";
const pilotMasterRequestIds = [
  masterRequestId,
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];
const pilotPublicRequestIds = [
  publicRequestId,
  "request-public-gold-2",
  "request-public-gold-3",
  "request-public-gold-4",
];

function blindRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: masterRequestId,
    request_id: publicRequestId,
    customer_id: masterCustomerId,
    title: "Leuchtschrift für einen Messestand",
    description: "Einsatz auf wechselnden B2B-Veranstaltungen; robuste Montage erforderlich.",
    size: "180 x 60 cm",
    color: ["Pink", "Warmweiß"],
    application: "Messestand",
    delivery_time: "Oktober 2026",
    customer_type: "gewerblich",
    country: "Deutschland",
    segment: "NT-10-LEAK-MUST-BE-IGNORED",
    segment_status: "accepted-leak-must-be-ignored",
    ...overrides,
  };
}

function blindCustomerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: masterCustomerId,
    email: "anna@messebau.example",
    first_name: "Anna",
    last_name: "Beispiel",
    company: "Beispiel Messebau GmbH",
    company_name: null,
    name: "Anna Beispiel",
    segment_history: "NT-1-LEAK-MUST-BE-IGNORED",
    ...overrides,
  };
}

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

function pilotSelectionFetch(calls: string[], completedRequestIds: string[] = []) {
  return (async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input));
    calls.push(url);
    if (url.includes("/request_segmentation_jobs?")) {
      return Response.json(pilotMasterRequestIds.map((requestId, index) => ({
        request_id: requestId,
        created_at: `2026-08-20T07:3${index}:00.000Z`,
      })));
    }
    if (url.includes("/request_segmentation_gold_adjudications?")) {
      return Response.json(completedRequestIds.map((requestId) => ({ request_id: requestId })));
    }
    if (url.includes("/master_requests?")) {
      return Response.json(pilotMasterRequestIds.map((id, index) => ({
        id,
        request_id: pilotPublicRequestIds[index],
      })));
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
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

test("Gold review is server-blind before immutable adjudication and reveals comparison only afterwards", () => {
  const withoutGold = validateRequestSegmentationReviewContext(
    reviewResult(),
    { masterRequestId, publicRequestId },
  );
  assert.equal(withoutGold.latestClassification?.proposedSegment, "NT-3");
  assert.equal(redactRequestSegmentationModelUntilGold(withoutGold).latestClassification, null);

  const currentGold = {
    gold_adjudication_id: "33333333-3333-4333-8333-333333333333",
    input_hash: inputHash,
    labeled_segment: "NT-4",
    labeled_s_kategorie: "S2",
    context_tags: ["startup_tech"],
    organization_scale: "small",
    labeling_version: "gold_labeling_v2_20260819_cx8",
    created_at: "2026-08-20T08:00:00.000Z",
  };
  const withGold = validateRequestSegmentationReviewContext(
    reviewResult({ current_gold_adjudication: currentGold }),
    { masterRequestId, publicRequestId },
  );
  const comparison = redactRequestSegmentationModelUntilGold(withGold);
  assert.equal(comparison.currentGoldAdjudication?.labeledSegment, "NT-4");
  assert.equal(comparison.latestClassification?.proposedSegment, "NT-3");
  assert.deepEqual(comparison.latestClassification?.reasonCodes, ["official_company_site"]);
  assert.equal(comparison.latestClassification?.evidenceProvenanceValid, true);
  assert.equal(comparison.latestClassification?.mappingIntegrity, true);

  const withGoldButStaleModel = validateRequestSegmentationReviewContext(
    reviewResult({
      current_gold_adjudication: currentGold,
      latest_classification: latestClassification({
        input_hash: "stale-input-hash",
        input_hash_current: false,
      }),
    }),
    { masterRequestId, publicRequestId },
  );
  assert.equal(redactRequestSegmentationModelUntilGold(withGoldButStaleModel).latestClassification, null);
});

test("Phase-4 pilot selects immutable CX8-v3 job identities without reading model outcomes", async () => {
  const calls: string[] = [];
  await withSupabaseFetch(pilotSelectionFetch(calls, [pilotMasterRequestIds[0]]), async () => {
    assert.deepEqual(await getRequestSegmentationGoldPilotNext(), {
      requestId: pilotPublicRequestIds[1],
      position: 2,
      total: 4,
      complete: false,
    });
  });

  const jobCall = calls.find((url) => url.includes("/request_segmentation_jobs?")) || "";
  assert.match(jobCall, /select=request_id%2Ccreated_at|select=request_id,created_at/);
  assert.match(jobCall, /taxonomy_version=eq\.nt_taxonomy_v2_20260819_cx8/);
  assert.match(jobCall, /classifier_version=eq\.segment_classifier_v3_20260819_cx8/);
  assert.match(jobCall, /prompt_version=eq\.segment_prompt_v4_20260819_cx8/);
  assert.match(jobCall, /created_at=lte\.2026-08-20T08%3A15%3A00\.000Z|created_at=lte\.2026-08-20T08:15:00\.000Z/);
  const query = jobCall.split("?")[1] || "";
  assert.doesNotMatch(query, /(?:^|[=&])(status|segment|confidence|evidence|risk_flags|s_kategorie|source|input_hash)=/);
  assert.equal(calls.some((url) => url.includes("/request_segment_classifications?")), false);

  const goldCall = calls.find((url) => url.includes("/request_segmentation_gold_adjudications?")) || "";
  assert.match(goldCall, /select=request_id/);
  assert.match(goldCall, /labeling_version=eq\.gold_labeling_v2_20260819_cx8/);
  assert.doesNotMatch(goldCall.split("?")[1] || "", /labeled_segment|adjudication_reason|evidence_urls/);

  const masterCall = calls.find((url) => url.includes("/master_requests?")) || "";
  assert.match(masterCall, /select=id%2Crequest_id|select=id,request_id/);
  assert.doesNotMatch(masterCall.split("?")[1] || "", /segment|status|confidence|source|taxonomy|s_kategorie|history/);
});

test("Phase-4 pilot endpoint returns only one opaque request and neutral progress", async () => {
  const calls: string[] = [];
  await withSupabaseFetch(pilotSelectionFetch(calls), async () => {
    const response = await getSegmentGold(new NextRequest(
      "http://localhost/api/ops/customer-records/segment-gold?mode=pilot-next",
      { headers: { host: "localhost" } },
    ));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const payload = await response.json() as Record<string, unknown>;
    assert.deepEqual(payload, {
      ok: true,
      pilot: {
        requestId: pilotPublicRequestIds[0],
        position: 1,
        total: 4,
        complete: false,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(payload),
      /predicted|confidence|taxonomy|legacy|inputHash|reasonCodes|riskFlags|evidence|sKategorie/,
    );
  });

  const completeCalls: string[] = [];
  await withSupabaseFetch(pilotSelectionFetch(completeCalls, pilotMasterRequestIds), async () => {
    assert.deepEqual(await getRequestSegmentationGoldPilotNext(), {
      requestId: null,
      position: 4,
      total: 4,
      complete: true,
    });
  });
});

test("pilot review refuses a concurrently completed case without revealing Gold or model data", async () => {
  const calls: string[] = [];
  await withSupabaseFetch(pilotSelectionFetch(calls, [pilotMasterRequestIds[0]]), async () => {
    const response = await getSegmentGold(new NextRequest(
      `http://localhost/api/ops/customer-records/segment-gold?requestId=${publicRequestId}&mode=pilot-review`,
      { headers: { host: "localhost" } },
    ));
    assert.equal(response.status, 409);
    const payload = await response.text();
    assert.match(payload, /pilot_candidate_not_current/);
    assert.doesNotMatch(payload, /NT-4|NT-3|startup_tech|example\.org|0\.91/);
  });
  assert.equal(calls.some((url) => url.includes("neontrip_get_request_segmentation_review_context")), false);
});

test("pilot GET and POST reject every request outside the current frozen cohort position", async () => {
  const calls: string[] = [];
  await withSupabaseFetch(pilotSelectionFetch(calls), async () => {
    const outsideGet = await getSegmentGold(new NextRequest(
      "http://localhost/api/ops/customer-records/segment-gold?requestId=outside-pilot&mode=pilot-review",
      { headers: { host: "localhost" } },
    ));
    assert.equal(outsideGet.status, 409);
    assert.match(await outsideGet.text(), /pilot_candidate_not_current/);

    const outsidePost = await postSegmentGold(new NextRequest(
      "http://localhost/api/ops/customer-records/segment-gold",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost" },
        body: JSON.stringify({
          requestId: "outside-pilot",
          inputHash,
          segment: "NT-3",
          contextTags: [],
          organizationScale: null,
          operatorName: "Daniel",
          reason: "Dieser Write darf die Pilot-Allowlist niemals verlassen.",
          evidenceUrls: ["https://example.org/about"],
          pilotVersion: REQUEST_SEGMENTATION_GOLD_PILOT_VERSION,
        }),
      },
    ));
    assert.equal(outsidePost.status, 409);
    assert.match(await outsidePost.text(), /pilot_candidate_not_current/);
  });
  assert.equal(calls.some((url) => url.includes("neontrip_adjudicate_request_segmentation_gold")), false);
  assert.equal(calls.some((url) => url.includes("neontrip_get_request_segmentation_review_context")), false);
});

test("Gold GET route sends only curated blind facts and no segment metadata before Gold exists", async () => {
  const calls: string[] = [];
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    calls.push(decodeURIComponent(url));
    if (url.includes("/master_requests?") && decodeURIComponent(url).includes("customer_id")) {
      return Response.json([blindRequestRow()]);
    }
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/master_customers?")) return Response.json([blindCustomerRow()]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) {
      return Response.json(reviewResult({
        latest_classification: latestClassification({
          evidence_json: [{
            type: "web_search",
            url: "https://user:pre-gold-secret@localhost./private",
            used_for: "segment_role",
            evidence_code: "verified_event_or_media_operator",
            secret: "raw-pre-gold-evidence-must-not-leak",
          }],
        }),
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const response = await getSegmentGold(new NextRequest(
      `http://localhost/api/ops/customer-records/segment-gold?requestId=${publicRequestId}`,
      { headers: { host: "localhost" } },
    ));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const payload = await response.json() as {
      context?: {
        latestClassification?: unknown;
        blindReviewFacts?: { company?: string; emailDomain?: string; colors?: string[] };
      };
    };
    assert.equal(payload.context?.latestClassification, null);
    assert.equal(payload.context?.blindReviewFacts?.company, "Beispiel Messebau GmbH");
    assert.equal(payload.context?.blindReviewFacts?.emailDomain, "messebau.example");
    assert.deepEqual(payload.context?.blindReviewFacts?.colors, ["Pink", "Warmweiß"]);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /official_company_site|pre-gold-secret|raw-pre-gold-evidence|NT-10-LEAK|accepted-leak|NT-1-LEAK|taxonomyVersion|classifierVersion|promptVersion|qualityGateVersion|masterRequestId|publicRequestId/,
    );
  });
  assert.equal(calls.filter((url) => url.includes("neontrip_get_request_segmentation_review_context")).length, 2);
  const requestFactsCall = calls.find((url) => url.includes("/master_requests?") && url.includes("customer_id"));
  assert.match(requestFactsCall || "", /select=id,request_id,customer_id,title,description,size,color,application,delivery_time,customer_type,country/);
  assert.doesNotMatch(requestFactsCall || "", /segment|status|confidence|source|taxonomy|s_kategorie|history/);
});

test("blind fact contract failures are PII-free and non-cacheable", async () => {
  const secret = "pii-contract-sentinel@private.example";
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?") && decodeURIComponent(url).includes("customer_id")) {
      return Response.json([blindRequestRow()]);
    }
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/master_customers?")) return Response.json([blindCustomerRow({ email: { raw: secret } })]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(reviewResult());
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const response = await getSegmentGold(new NextRequest(
      `http://localhost/api/ops/customer-records/segment-gold?requestId=${publicRequestId}`,
      { headers: { host: "localhost" } },
    ));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const payloadText = await response.text();
    assert.equal(payloadText.includes(secret), false);
    assert.match(payloadText, /kuratierten Fakten/);
  });
});

test("post-Gold model evidence exposes only safe deduplicated HTTP(S) links", () => {
  assert.deepEqual(safeModelEvidenceLinks([
    {
      type: "web_search",
      url: "https://example.org/about",
      used_for: "segment_role",
      evidence_code: "verified_event_or_media_operator",
    },
    {
      type: "web_search",
      url: "https://example.org/about",
      used_for: "segment_role",
      evidence_code: "verified_event_or_media_operator",
    },
    { type: "web_search", url: "javascript:alert(1)", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "https://user:secret@example.org/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://localhost/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://localhost./private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://127.0.0.1/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://10.1.2.3/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://172.16.0.1/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://192.168.1.1/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://169.254.169.254/private", used_for: "segment_role", evidence_code: "unsafe" },
    { type: "web_search", url: "http://[::1]/private", used_for: "segment_role", evidence_code: "unsafe" },
  ]), [{
    url: "https://example.org/about",
    host: "example.org",
    type: "web_search",
    usedFor: "segment_role",
    evidenceCode: "verified_event_or_media_operator",
  }]);
});

test("post-Gold GET exposes only the sanitized evidence-link schema", async () => {
  const currentGold = {
    gold_adjudication_id: "33333333-3333-4333-8333-333333333333",
    input_hash: inputHash,
    labeled_segment: "NT-4",
    labeled_s_kategorie: "S2",
    context_tags: ["startup_tech"],
    organization_scale: "small",
    labeling_version: "gold_labeling_v2_20260819_cx8",
    created_at: "2026-08-20T08:00:00.000Z",
  };
  const postGoldContext = reviewResult({
    current_gold_adjudication: currentGold,
    latest_classification: latestClassification({
      evidence_json: [
        {
          type: "web_search",
          url: "https://example.org/about",
          used_for: "segment_role",
          evidence_code: "verified_event_or_media_operator",
          secret: "raw-post-gold-evidence-must-not-leak",
        },
        {
          type: "web_search",
          url: "https://user:post-gold-secret@example.org/private",
          used_for: "segment_role",
          evidence_code: "verified_event_or_media_operator",
        },
        {
          type: "web_search",
          url: "http://127.0.0.1/private",
          used_for: "segment_role",
          evidence_code: "verified_event_or_media_operator",
        },
      ],
    }),
  });
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?") && decodeURIComponent(url).includes("customer_id")) {
      return Response.json([blindRequestRow()]);
    }
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/master_customers?")) return Response.json([blindCustomerRow()]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(postGoldContext);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const response = await getSegmentGold(new NextRequest(
      `http://localhost/api/ops/customer-records/segment-gold?requestId=${publicRequestId}`,
      { headers: { host: "localhost" } },
    ));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const payload = await response.json() as {
      context?: {
        latestClassification?: {
          evidenceJson?: unknown;
          evidenceLinks?: unknown;
        } | null;
      };
    };
    assert.equal(payload.context?.latestClassification?.evidenceJson, undefined);
    assert.deepEqual(payload.context?.latestClassification?.evidenceLinks, [{
      url: "https://example.org/about",
      host: "example.org",
      type: "web_search",
      usedFor: "segment_role",
      evidenceCode: "verified_event_or_media_operator",
    }]);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /raw-post-gold-evidence|post-gold-secret|127\.0\.0\.1|evidenceJson/,
    );
  });
});

test("Gold control is reachable only through the isolated authenticated blind-review page", () => {
  const customerCaseUi = readFileSync("src/app/ops/customer-records/page-client.tsx", "utf8");
  const goldReviewPage = readFileSync("src/app/ops/customer-records/gold-review/page.tsx", "utf8");
  const goldReviewPageClient = readFileSync("src/app/ops/customer-records/gold-review/page-client.tsx", "utf8");
  const goldUi = readFileSync("src/app/ops/customer-records/segment-gold-control.tsx", "utf8");
  const opsLayout = readFileSync("src/app/ops/layout.tsx", "utf8");
  const opsGlobalOverlays = readFileSync("src/app/ops/ops-global-overlays.tsx", "utf8");
  assert.doesNotMatch(customerCaseUi, /\/ops\/customer-records\/gold-review/);
  assert.doesNotMatch(customerCaseUi, /SegmentGoldAdjudicationControl/);
  assert.match(goldReviewPage, /hasOpsSession/);
  assert.match(goldReviewPage, /pilotParam/);
  assert.match(goldReviewPage, /REQUEST_SEGMENTATION_GOLD_PILOT_VERSION/);
  assert.match(goldReviewPageClient, /Exakte Anfrage-ID/);
  assert.match(goldReviewPageClient, /window\.location\.assign\(`\/ops\/customer-records\/gold-review\?requestId=/);
  assert.match(goldReviewPageClient, /segment-gold\?mode=pilot-next/);
  assert.match(goldReviewPageClient, /Vier-Fall-Prozesspilot/);
  assert.match(goldReviewPageClient, /pilot=1&requestId=/);
  assert.match(goldReviewPageClient, /<SegmentGoldAdjudicationControl[\s\S]{0,220}startExpanded[\s\S]{0,80}lockedOpen/);
  assert.doesNotMatch(goldReviewPageClient, /fetch\([`'"]\/api\/ops\/customer-records\?/);
  assert.doesNotMatch(goldUi, /customer-segments/);
  assert.match(goldUi, /context\.goldLabelOptions\.map/);
  assert.match(opsLayout, /<OpsGlobalOverlays \/>/);
  assert.doesNotMatch(opsLayout, /OpsTaskNotifier|OpsCopilotChat/);
  assert.match(opsGlobalOverlays, /\/ops\/customer-records\/gold-review/);
  assert.match(opsGlobalOverlays, /if \([\s\S]{0,180}BLIND_GOLD_REVIEW_PATH[\s\S]{0,180}return null/);
  assert.match(goldUi, /const \[expanded, setExpanded\] = useState\(startExpanded\)/);
  assert.match(goldUi, /context\?\.latestClassification\?\.inputHashCurrent === true/);
  assert.match(goldUi, /Abweichung zum gespeicherten DB-Kundentyp/);
  assert.match(goldUi, /Das ist für eine menschliche Gold-Bewertung zulässig/);
  assert.doesNotMatch(goldUi, /NT-8 ist gesperrt|NT-9 ist gesperrt/);
  assert.match(goldUi, /referrerPolicy="no-referrer"/);
  assert.match(goldUi, /pilotMode \? "&mode=pilot-review" : ""/);
  assert.match(goldUi, /pilotMode \? \{ pilotVersion \} : \{\}/);
  assert.match(goldUi, /if \(pilotMode\) \{[\s\S]{0,120}onPilotAdvance\?\.\(\);[\s\S]{0,40}return;[\s\S]{0,80}await loadReview\(\)/);
  assert.match(goldUi, /\{expanded \? \(/);
});

test("Phase-3 pilot documentation records the cancelled old attempt and one successful eval-only abstention", () => {
  const documentation = readFileSync("docs/projects/customer-records-ops/request-segmentation.md", "utf8");
  assert.match(documentation, /genau einmal natuerlich geclaimt/);
  assert.match(documentation, /kanonischen Cancel-RPC/);
  assert.match(documentation, /`status=cancelled`, `attempts=1`, `classifications=0`/);
  assert.match(documentation, /CX8-Research-Cache `0`/);
  assert.match(documentation, /verbleibende pending Historienjobs `0`/);
  assert.match(documentation, /80101742-c095-4a69-827f-aeaab6bc71ca/);
  assert.match(documentation, /Execution `5210710` in `3\.491s`/);
  assert.match(documentation, /Job `needs_review`, `attempts=1`, `error=null`, unlocked/);
  assert.match(documentation, /Klassifikation `needs_review` mit `segment=null`/);
  assert.match(documentation, /Follow-up und Pricing bleiben `false`/);
  assert.doesNotMatch(documentation, /endete am 20\.08\.2026 reproduzierbar/);
});

test("Phase-4 runbook keeps the four-case pilot blind, serial and non-activating", () => {
  const documentation = readFileSync("docs/projects/customer-records-ops/request-segmentation.md", "utf8");
  const migration = readFileSync("supabase/migrations/20260819183219_harden_request_segmentation_phase2_cx8.sql", "utf8");
  const evaluationEnqueue = migration.match(
    /create function public\.neontrip_enqueue_request_segmentation_evaluation[\s\S]*?comment on function public\.neontrip_enqueue_request_segmentation_evaluation/,
  )?.[0] || "";
  assert.match(documentation, /Phase 4: blinder Vier-Fall-Prozesspilot/);
  assert.match(documentation, /2026-08-20T08:15:00\.000Z/);
  assert.match(documentation, /Jobtabelle ausschliesslich\s+`request_id` und `created_at`/);
  assert.match(documentation, /gold_pilot_v1_20260820_cx8_four_case/);
  assert.match(documentation, /Genau ein benannter Reviewer arbeitet die Kohorte seriell ab/);
  assert.match(documentation, /wird nicht geraten/);
  assert.match(documentation, /laedt den abgeschlossenen Fall\s+nicht erneut/);
  assert.match(documentation, /Erst nach `complete=true`/);
  assert.match(documentation, /keinen weiteren historischen Backfill/);
  assert.match(documentation, /Follow-up, Pricing, WhatsApp, E-Mail, Mahnung/);
  assert.match(documentation, /Vier-Fall-Pilot ist kein Ersatz/);
  assert.match(documentation, /Intake-Workflow dennoch pauschal `B2B` schrieb/);
  assert.match(documentation, /darf er `NT-8` waehlen und die Abweichung begruenden/);
  assert.match(documentation, /aendert weder `customer_type` noch das operative Segment/);
  assert.match(evaluationEnqueue, /updated_at = now\(\)/);
  assert.doesNotMatch(evaluationEnqueue, /created_at\s*=/);
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

test("blind review loader brackets curated facts with the exact current hash and emits a fixed browser shape", async () => {
  const calls: string[] = [];
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    calls.push(decodeURIComponent(url));
    if (url.includes("/master_requests?") && decodeURIComponent(url).includes("customer_id")) {
      return Response.json([blindRequestRow()]);
    }
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/master_customers?")) return Response.json([blindCustomerRow()]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(reviewResult());
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    const context = await getRequestSegmentationBlindReviewContext(publicRequestId);
    const payload = toRequestSegmentationBlindReviewPayload(context);
    assert.deepEqual(Object.keys(payload).sort(), [
      "blindReviewFacts",
      "currentGoldAdjudication",
      "currentInputHash",
      "goldEligibility",
      "goldLabelOptions",
      "latestClassification",
    ]);
    assert.deepEqual(Object.keys(payload.blindReviewFacts).sort(), [
      "application",
      "colors",
      "company",
      "contactName",
      "country",
      "customerType",
      "deliveryTime",
      "description",
      "email",
      "emailDomain",
      "requestId",
      "requestedSize",
      "title",
    ]);
    assert.deepEqual(payload.goldLabelOptions, CUSTOMER_SEGMENT_OPTIONS.map(({ segment, label }) => ({
      code: segment,
      label,
    })));
    assert.equal(payload.latestClassification, null);
  });
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((url) => url.includes("neontrip_get_request_segmentation_review_context")).length, 2);

  let reviewCalls = 0;
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?") && decodeURIComponent(url).includes("customer_id")) {
      return Response.json([blindRequestRow()]);
    }
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/master_customers?")) return Response.json([blindCustomerRow()]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) {
      reviewCalls += 1;
      return Response.json(reviewCalls === 1 ? reviewResult() : reviewResult({
        current_input_hash: "changed-during-read",
        latest_classification: latestClassification({
          input_hash: "changed-during-read",
          input_hash_current: true,
        }),
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch, async () => {
    await assert.rejects(
      getRequestSegmentationBlindReviewContext(publicRequestId),
      /waehrend des blinden Reviews geaendert/,
    );
  });
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

test("Gold API binds the authenticated Ops actor to the typed operator name", async () => {
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
    const response = await postSegmentGold(new NextRequest("http://localhost/api/ops/customer-records/segment-gold", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost" },
      body: JSON.stringify({
        requestId: publicRequestId,
        inputHash,
        segment: "NT-3",
        contextTags: ["film_tv", "startup_tech"],
        organizationScale: "small",
        operatorName: "  Daniel  ",
        reason: "Offizielle Unternehmensseite und Impressum wurden manuell geprüft.",
        evidenceUrls: ["https://example.org/about", "https://example.org/impressum"],
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.body?.p_adjudicated_by, "local-ops:Daniel");

  const longAuthenticatedActor = `auth-${"a".repeat(149)}`;
  const longOperator = `operator-${"b".repeat(147)}`;
  const combinedActor = combineRequestSegmentationGoldActor(longAuthenticatedActor, longOperator);
  assert.equal(combinedActor, `${longAuthenticatedActor}:${longOperator}`);
  assert.ok(combinedActor.startsWith(longAuthenticatedActor));
  assert.ok(combinedActor.endsWith(longOperator));
  assert.throws(
    () => combineRequestSegmentationGoldActor("a".repeat(160), "b".repeat(160)),
    /zusammen maximal 320/,
  );

  let supabaseCalls = 0;
  await withSupabaseFetch((async () => {
    supabaseCalls += 1;
    return Response.json({});
  }) as typeof fetch, async () => {
    const response = await postSegmentGold(new NextRequest("http://localhost/api/ops/customer-records/segment-gold", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost" },
      body: JSON.stringify({
        requestId: publicRequestId,
        inputHash,
        segment: "NT-3",
        operatorName: "AI",
        reason: "Diese Begründung wäre ansonsten lang genug für Gold.",
        evidenceUrls: ["https://example.org/about"],
      }),
    }));
    assert.equal(response.status, 422);
  });
  assert.equal(supabaseCalls, 0);
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

test("Human Gold may disagree with stored customer type while deterministic scale rules stay enforced", async () => {
  let adjudicationCalls = 0;
  await withSupabaseFetch((async (input) => {
    const url = String(input);
    if (url.includes("/master_requests?")) return Response.json([{ id: masterRequestId, request_id: publicRequestId }]);
    if (url.includes("/rpc/neontrip_get_request_segmentation_review_context")) return Response.json(reviewResult());
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) {
      adjudicationCalls += 1;
      return Response.json(adjudicationResult({
        labeled_segment: "NT-8",
        labeled_s_kategorie: "S3",
        context_tags: [],
        organization_scale: null,
      }));
    }
    return Response.json({});
  }) as typeof fetch, async () => {
    const result = await adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-8",
      actor: "Daniel",
      reason: "Diese private Einordnung wurde fachlich vollständig geprüft.",
    });
    assert.equal(result.created, true);
  });
  assert.equal(adjudicationCalls, 1);

  let nt9Calls = 0;
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
    if (url.includes("/rpc/neontrip_adjudicate_request_segmentation_gold")) {
      nt9Calls += 1;
      return Response.json(adjudicationResult({
        labeled_segment: "NT-9",
        labeled_s_kategorie: "S3",
        context_tags: [],
        organization_scale: null,
      }));
    }
    return Response.json({});
  }) as typeof fetch, async () => {
    const result = await adjudicateRequestSegmentationGold({
      publicRequestId,
      inputHash,
      segment: "NT-9",
      actor: "Daniel",
      reason: "Diese direkte Business-Einordnung wurde vollständig geprüft.",
      evidenceUrls: ["https://example.org/about"],
    });
    assert.equal(result.created, true);
  });
  assert.equal(nt9Calls, 1);

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
    await expect422({
      ...base,
      evidenceUrls: ["https://user:secret@example.org/private"],
    }, /externe HTTP- oder HTTPS-Links ohne Zugangsdaten/);
    await expect422({
      ...base,
      evidenceUrls: ["http://127.0.0.1/private"],
    }, /externe HTTP- oder HTTPS-Links ohne Zugangsdaten/);
    await expect422({
      ...base,
      evidenceUrls: ["http://foo.local./private"],
    }, /externe HTTP- oder HTTPS-Links ohne Zugangsdaten/);
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
