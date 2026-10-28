import assert from "node:assert/strict";
import test from "node:test";
import { resolveManagementRange } from "../../src/lib/ops/management-kpis";

test("management periods use Berlin midnight in winter and at month and quarter boundaries", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assert.equal(resolveManagementRange({ range: "today" }, now).from.toISOString(), "2026-10-27T23:00:00.000Z");
  assert.equal(resolveManagementRange({ range: "month" }, now).from.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(resolveManagementRange({ range: "quarter" }, now).from.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(resolveManagementRange({ range: "7d" }, now).from.toISOString(), "2026-10-21T22:00:00.000Z");
});

test("custom date-only periods include the complete Berlin day across daylight saving changes", () => {
  const winter = resolveManagementRange({ range: "custom", from: "2026-10-28", to: "2026-10-28" });
  assert.equal(winter.from.toISOString(), "2026-10-27T23:00:00.000Z");
  assert.equal(winter.to.toISOString(), "2026-10-28T22:59:59.999Z");
  const change = resolveManagementRange({ range: "custom", from: "2026-10-25", to: "2026-10-25" });
  assert.equal(change.to.getTime() - change.from.getTime() + 1, 25 * 3600_000);
});
