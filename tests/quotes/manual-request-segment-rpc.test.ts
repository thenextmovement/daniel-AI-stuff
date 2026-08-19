import test from "node:test";
import assert from "node:assert/strict";
import {
  setAuthoritativeManualRequestSegment,
  validateManualRequestSegmentRpcResult,
} from "@/lib/ops/manual-request-segment-rpc";
import { isManualRequestSegmentSource } from "@/lib/ops/customer-segments";

const expected = {
  requestId: "11111111-1111-4111-8111-111111111111",
  segment: "NT-3" as const,
  source: "manual_ops_import",
};

const validResult = {
  request_id: expected.requestId,
  public_request_id: "public-request-1",
  segment: expected.segment,
  s_kategorie: "S1",
  segment_status: "accepted",
  segment_confidence: null,
  segment_source: expected.source,
  segment_classified_at: "2026-08-19T12:00:00.000Z",
  segment_policy_version: "manual_override_v1_20260819",
  authoritative: true,
  audit_id: "22222222-2222-4222-8222-222222222222",
};

test("manual source detection follows the canonical manual_* namespace", () => {
  assert.equal(isManualRequestSegmentSource("manual_ops_portal"), true);
  assert.equal(isManualRequestSegmentSource("human_review"), false);
  assert.equal(isManualRequestSegmentSource("operator_confirmed"), false);
});

test("manual segment RPC validator accepts the complete authoritative contract", () => {
  assert.deepEqual(validateManualRequestSegmentRpcResult(validResult, expected), validResult);
});

test("manual segment RPC validator trusts the non-empty DB-derived S category", () => {
  const dbDerived = { ...validResult, s_kategorie: "S9" };
  assert.deepEqual(validateManualRequestSegmentRpcResult(dbDerived, expected), dbDerived);
  assert.throws(
    () => validateManualRequestSegmentRpcResult({ ...validResult, s_kategorie: "" }, expected),
    /keinen gueltigen autoritativen DB-Vertrag/,
  );
});

test("manual segment RPC validator rejects HTTP-success-shaped but non-authoritative results", () => {
  for (const invalid of [
    null,
    { ...validResult, authoritative: false },
    { ...validResult, segment_status: "needs_review" },
    { ...validResult, segment_confidence: 1 },
    { ...validResult, segment: "NT-4" },
    { ...validResult, segment_source: "request_segmenter" },
    { ...validResult, audit_id: null },
  ]) {
    assert.throws(
      () => validateManualRequestSegmentRpcResult(invalid, expected),
      /keinen gueltigen autoritativen DB-Vertrag/,
    );
  }
});

test("manual segment RPC wrapper validates the response before returning success", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: "unexpected" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    await assert.rejects(
      setAuthoritativeManualRequestSegment({
        ...expected,
        actor: { operatorName: "Test" },
        reason: "test",
      }),
      /keinen gueltigen autoritativen DB-Vertrag/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
