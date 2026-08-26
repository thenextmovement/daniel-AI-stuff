import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCreatedDunningCourtApplication,
  matchesDunningOrderAge,
  matchesDunningOrderYear,
  matchesDunningStage,
} from "../../src/lib/ops/dunning-filter";

const NOW = new Date("2026-03-31T12:00:00.000Z");

test("inactive dunning order-age filter keeps every case", () => {
  assert.equal(matchesDunningOrderAge(null, "all", NOW), true);
  assert.equal(matchesDunningOrderAge("not-a-date", "all", NOW), true);
  assert.equal(
    matchesDunningOrderAge("2026-03-31T12:00:00.000Z", "all", NOW),
    true,
  );
});

test("dunning order-age filters use strict calendar-month boundaries", () => {
  const boundaries = [
    ["1", "2026-02-28T12:00:00.000Z"],
    ["2", "2026-01-31T12:00:00.000Z"],
    ["3", "2025-12-31T12:00:00.000Z"],
  ] as const;

  for (const [filter, boundary] of boundaries) {
    assert.equal(matchesDunningOrderAge(boundary, filter, NOW), false);
    assert.equal(
      matchesDunningOrderAge(
        new Date(Date.parse(boundary) - 1).toISOString(),
        filter,
        NOW,
      ),
      true,
    );
  }
});

test("active dunning order-age filters exclude missing or invalid order dates", () => {
  assert.equal(matchesDunningOrderAge(null, "1", NOW), false);
  assert.equal(matchesDunningOrderAge("not-a-date", "2", NOW), false);
  assert.equal(
    matchesDunningOrderAge("2026-01-01T00:00:00.000Z", "3", new Date("invalid")),
    false,
  );
});

test("dunning order-year filter supports the configured years", () => {
  assert.equal(
    matchesDunningOrderYear("2024-12-31T23:59:59.000Z", "2024"),
    true,
  );
  assert.equal(
    matchesDunningOrderYear("2025-01-01T00:00:00.000Z", "2024"),
    false,
  );
  assert.equal(matchesDunningOrderYear(null, "2026"), false);
  assert.equal(matchesDunningOrderYear("not-a-date", "2034"), false);
  assert.equal(matchesDunningOrderYear(null, "all"), true);
});

test("dunning stage filter distinguishes exact and minimum stages", () => {
  assert.equal(matchesDunningStage(6, "exact:6"), true);
  assert.equal(matchesDunningStage(7, "exact:6"), false);
  assert.equal(matchesDunningStage(5, "minimum:6"), false);
  assert.equal(matchesDunningStage(6, "minimum:6"), true);
  assert.equal(matchesDunningStage(7, "minimum:6"), true);
  assert.equal(matchesDunningStage(3, "all"), true);
});

test("created or progressed court applications can be hidden", () => {
  assert.equal(hasCreatedDunningCourtApplication([]), false);
  assert.equal(
    hasCreatedDunningCourtApplication([
      { eventType: "application_draft_created" },
    ]),
    true,
  );
  assert.equal(
    hasCreatedDunningCourtApplication([{ eventType: "court_order_served" }]),
    true,
  );
});
