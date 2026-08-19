import test from "node:test";
import assert from "node:assert/strict";
import {
  getSegmentAuthorityStatusLabel,
  getSegmentDecisionTone,
  getSegmentStatusLabel,
  nextManualImportIdempotencyKey,
  shouldConfirmAiSegment,
} from "@/app/ops/customer-records/page-client";
import type { CustomerRequestSummary } from "@/lib/ops/customer-records";

function segmentRequest(overrides: Partial<CustomerRequestSummary> = {}) {
  return {
    segment: "NT-3",
    segmentStatus: "accepted",
    segmentConfidence: null,
    segmentSource: "manual_ops_portal",
    ...overrides,
  } as CustomerRequestSummary;
}

test("manual accepted authority stays confirmed without model confidence", () => {
  const request = segmentRequest();
  assert.equal(shouldConfirmAiSegment(request), false);
  assert.equal(getSegmentAuthorityStatusLabel(request), "Manuell bestätigt");
  assert.equal(getSegmentDecisionTone(request), "good");
});

test("accepted canonical AI does not use a UI confidence threshold, while unknown sources stay fail-closed", () => {
  const acceptedAi = segmentRequest({
    segmentSource: "request_segmenter",
    segmentConfidence: 0.42,
  });
  assert.equal(shouldConfirmAiSegment(acceptedAi), false);
  assert.equal(getSegmentAuthorityStatusLabel(acceptedAi), "KI bestätigt");
  assert.equal(getSegmentDecisionTone(acceptedAi), "good");

  const unknownSource = segmentRequest({
    segmentSource: "operator_confirmed",
    segmentConfidence: 0.99,
  });
  assert.equal(shouldConfirmAiSegment(unknownSource), true);
  assert.equal(getSegmentAuthorityStatusLabel(unknownSource), "Segment bestätigt");
  assert.equal(getSegmentDecisionTone(unknownSource), "amber");
});

test("error status is rendered and toned as a blocking failure", () => {
  const request = segmentRequest({
    segmentStatus: "error",
    segmentSource: "request_segmenter",
    segmentConfidence: 0.99,
  });
  assert.equal(getSegmentStatusLabel(request.segmentStatus), "Fehler");
  assert.equal(shouldConfirmAiSegment(request), true);
  assert.equal(getSegmentDecisionTone(request), "rose");
});

test("manual import idempotency key survives only unchanged error retries", () => {
  let creations = 0;
  const createKey = () => `key-${++creations}`;
  const first = nextManualImportIdempotencyKey(null, "submit", createKey);
  const retry = nextManualImportIdempotencyKey(first, "submit", createKey);
  assert.equal(first, "key-1");
  assert.equal(retry, first);
  assert.equal(creations, 1);
  assert.equal(nextManualImportIdempotencyKey(retry, "draft_changed"), null);
  assert.equal(nextManualImportIdempotencyKey(retry, "cleared"), null);
  assert.equal(nextManualImportIdempotencyKey(retry, "succeeded"), null);
});
