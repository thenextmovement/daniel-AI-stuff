import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryCountdownLabel,
  deliveryDaysRemaining,
  orderAgeDays,
  orderAgeLabel,
} from "../../src/lib/ops/supplier-sales-display";

const now = "2026-07-29T12:00:00.000Z";

test("order age uses Berlin calendar days", () => {
  assert.equal(orderAgeDays("2026-07-16T05:07:00.000Z", now), 13);
  assert.equal(orderAgeLabel("2026-07-16T05:07:00.000Z", now), "vor 13 Tagen");
  assert.equal(orderAgeLabel("2026-07-29T00:30:00.000Z", now), "heute bestellt");
  assert.equal(orderAgeLabel(null, now), null);
});

test("delivery countdown distinguishes remaining, today and overdue days", () => {
  assert.equal(deliveryDaysRemaining("2026-08-13", now), 15);
  assert.equal(deliveryCountdownLabel("2026-08-13", now), "noch 15 Tage");
  assert.equal(deliveryCountdownLabel("2026-07-29", now), "heute");
  assert.equal(deliveryCountdownLabel("2026-07-28", now), "1 Tag überfällig");
  assert.equal(deliveryCountdownLabel("2026-07-20", now), "9 Tage überfällig");
  assert.equal(deliveryCountdownLabel("ungueltig", now), null);
});
