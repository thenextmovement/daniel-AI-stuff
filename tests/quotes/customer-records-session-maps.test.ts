import test from "node:test";
import assert from "node:assert/strict";

import { buildRequestIdSessionMaps } from "../../src/lib/ops/customer-records-session-maps";

test("buildRequestIdSessionMaps builds preferred tab and badge maps per request", () => {
  const maps = buildRequestIdSessionMaps(
    [
      { requestId: "req-1", tab: "contact", badge: "Kontaktdossier" },
      { requestId: "req-2", tab: "deal", badge: "Abschluss" },
    ],
    {
      preferredTabByRecord: (record) => record.tab,
      badgeLabelByRecord: (record) => record.badge,
    },
  );

  assert.deepEqual(maps.preferredTabsByRequestId, {
    "req-1": "contact",
    "req-2": "deal",
  });
  assert.deepEqual(maps.badgeLabelsByRequestId, {
    "req-1": "Kontaktdossier",
    "req-2": "Abschluss",
  });
});

test("buildRequestIdSessionMaps preserves null tabs and undefined badges", () => {
  const maps = buildRequestIdSessionMaps(
    [{ requestId: "req-3" }],
    {
      preferredTabByRecord: () => null,
      badgeLabelByRecord: () => undefined,
    },
  );

  assert.deepEqual(maps.preferredTabsByRequestId, {
    "req-3": null,
  });
  assert.deepEqual(maps.badgeLabelsByRequestId, {
    "req-3": undefined,
  });
});
