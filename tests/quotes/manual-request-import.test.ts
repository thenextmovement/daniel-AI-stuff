import test from "node:test";
import assert from "node:assert/strict";
import { manualSegmentStatus, resolveManualCustomerRequestId } from "@/lib/ops/manual-request-import";

test("manualSegmentStatus maps selected manual segments to the database-allowed accepted state", () => {
  assert.equal(manualSegmentStatus("Konzern"), "accepted");
  assert.equal(manualSegmentStatus("NT-3"), "accepted");
});

test("manualSegmentStatus keeps missing segments in review state", () => {
  assert.equal(manualSegmentStatus(""), "needs_review");
  assert.equal(manualSegmentStatus(null), "needs_review");
});

test("resolveManualCustomerRequestId replaces orphaned request ids on retry", () => {
  assert.equal(resolveManualCustomerRequestId("old-orphan-request", "new-request", false), "new-request");
  assert.equal(resolveManualCustomerRequestId("existing-request", "new-request", true), "existing-request");
  assert.equal(resolveManualCustomerRequestId(null, "new-request", false), "new-request");
});
