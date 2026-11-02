import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/internal/shipping/installation-documents/route";

test("installation preparation requires internal authentication", async () => {
  const response = await POST(new NextRequest("https://ops.neontrip.de/api/internal/shipping/installation-documents", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("authorized preparation creates complete attachments without network side effects", async () => {
  const oldKey = process.env.OPS_INTERNAL_API_KEY;
  const oldFetch = globalThis.fetch;
  const testKey = "installation-local-test-only-key-0001";
  process.env.OPS_INTERNAL_API_KEY = testKey;
  globalThis.fetch = async () => { throw new Error("Unexpected external side effect"); };
  try {
    const items = [{ id: 1, title: "LED Neonschild Test", quantity: 1 }, { id: 2, title: "Wandmontage Set", quantity: 1 }];
    const response = await POST(new NextRequest("https://ops.neontrip.de/api/internal/shipping/installation-documents", {
      method: "POST", headers: { "x-neontrip-internal-key": testKey }, body: JSON.stringify({ fulfillmentId: "456", order: {
        id: 123, email: "test@example.test", line_items: items,
        fulfillments: [{ id: 456, order_id: 123, status: "success", line_items: items }],
      } }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, true);
    assert.equal(body.graphDraft.attachments.length, 3);
    assert(body.bodyHtml.includes("Mika Zangane"));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPS_INTERNAL_API_KEY; else process.env.OPS_INTERNAL_API_KEY = oldKey;
  }
});
