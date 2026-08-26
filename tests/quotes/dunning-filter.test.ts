import assert from "node:assert/strict";
import test from "node:test";
import { matchesDunningOrderAge } from "../../src/lib/ops/dunning-filter";

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
