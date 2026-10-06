import assert from "node:assert/strict";
import test from "node:test";
import { feedbackRetryDate, validFeedbackDate } from "../../src/lib/ops/sales-call-feedback-contract";
test("retry defaults respect weekends and Berlin DST", () => {
  assert.equal(feedbackRetryDate(0, new Date("2026-10-23T12:00:00Z")), "2026-10-26");
  assert.equal(feedbackRetryDate(1, new Date("2026-10-23T12:00:00Z")), "2026-10-27");
});
test("feedback rejects impossible and past dates", () => {
  const now = new Date("2026-02-01T12:00:00Z");
  assert.equal(validFeedbackDate("2026-02-30", now), false);
  assert.equal(validFeedbackDate("2026-01-31", now), false);
  assert.equal(validFeedbackDate("2026-02-02", now), true);
});
