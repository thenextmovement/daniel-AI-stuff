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
import {
  CUSTOMER_SEGMENT_OPTIONS,
  CUSTOMER_SEGMENT_REGISTRY,
  CX8_TAXONOMY_VERSION,
  formatCustomerSegmentLabel,
  getCustomerSegmentOption,
  getKnownCustomerSegmentOption,
} from "@/lib/ops/customer-segments";

function segmentRequest(overrides: Partial<CustomerRequestSummary> = {}) {
  return {
    segment: "NT-3",
    segmentStatus: "accepted",
    segmentConfidence: null,
    segmentSource: "manual_ops_portal",
    segmentTaxonomyVersion: CX8_TAXONOMY_VERSION,
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
  assert.equal(getSegmentAuthorityStatusLabel(unknownSource), "Prüfen – unbekannte Quelle");
  assert.equal(getSegmentDecisionTone(unknownSource), "amber");

  const missingSource = segmentRequest({ segmentSource: null });
  assert.equal(shouldConfirmAiSegment(missingSource), true);
  assert.equal(getSegmentAuthorityStatusLabel(missingSource), "Prüfen – unbekannte Quelle");
  assert.equal(getSegmentDecisionTone(missingSource), "amber");
});

test("only the eight CX8 codes are writable while all legacy codes remain displayable", () => {
  assert.deepEqual(
    CUSTOMER_SEGMENT_OPTIONS.map((option) => option.segment),
    ["NT-1", "NT-3", "NT-4", "NT-5", "NT-6", "NT-8", "NT-9", "NT-10"],
  );
  assert.equal(CUSTOMER_SEGMENT_REGISTRY.length, 18);
  assert.equal(getCustomerSegmentOption("NT-2"), null);
  assert.equal(getKnownCustomerSegmentOption("NT-2")?.legacyLabel, "Gastronomie");
  assert.equal(formatCustomerSegmentLabel("NT-3", null), "Event/Messe");
  assert.equal(formatCustomerSegmentLabel("NT-3", CX8_TAXONOMY_VERSION), "Event-/Medienproduktion");
});

test("unversioned reused codes and inactive codes are always legacy and need reassignment", () => {
  for (const request of [
    segmentRequest({ segmentTaxonomyVersion: null }),
    segmentRequest({ segment: "NT-15", segmentTaxonomyVersion: CX8_TAXONOMY_VERSION }),
  ]) {
    assert.equal(shouldConfirmAiSegment(request), true);
    assert.equal(getSegmentAuthorityStatusLabel(request), "Legacy – neu zuordnen");
    assert.equal(getSegmentDecisionTone(request), "amber");
  }
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
