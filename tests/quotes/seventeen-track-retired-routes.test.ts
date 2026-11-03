import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as inboundRegister } from "../../src/app/api/internal/inbound-shipping/17track-register/route";
import { POST as inboundSync } from "../../src/app/api/internal/inbound-shipping/17track-sync/route";
import { POST as webhook } from "../../src/app/api/internal/inbound-shipping/17track-webhook/route";
import { POST as outboundRegister } from "../../src/app/api/internal/shipping/17track-register/route";
import { POST as outboundSync } from "../../src/app/api/internal/shipping/17track-sync/route";

test("retired 17TRACK entry points keep authentication and never call a provider or write data", async () => {
  const oldInternal = process.env.OPS_INTERNAL_API_KEY;
  const oldWebhook = process.env.SEVENTEEN_TRACK_WEBHOOK_TOKEN;
  const oldFetch = globalThis.fetch;
  const syntheticKey = "retired-provider-local-test-only-12345";
  process.env.OPS_INTERNAL_API_KEY = syntheticKey;
  process.env.SEVENTEEN_TRACK_WEBHOOK_TOKEN = syntheticKey;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network effect"); };
  try {
    for (const handler of [inboundRegister, inboundSync, outboundRegister, outboundSync, webhook]) {
      const unauthorized = await handler(new NextRequest("https://ops.neontrip.de/api/internal/test", { method: "POST" }));
      assert.equal(unauthorized.status, 401);
      const response = await handler(new NextRequest("https://ops.neontrip.de/api/internal/test", {
        method: "POST",
        headers: handler === webhook ? { "x-neontrip-webhook-token": syntheticKey } : { "x-neontrip-internal-key": syntheticKey },
        body: JSON.stringify({ data: { number: "synthetic", carrier: 100001 }, limit: 50 }),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, disabled: true, reason: "provider_retired", claimed: 0, recorded: false });
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldInternal === undefined) delete process.env.OPS_INTERNAL_API_KEY; else process.env.OPS_INTERNAL_API_KEY = oldInternal;
    if (oldWebhook === undefined) delete process.env.SEVENTEEN_TRACK_WEBHOOK_TOKEN; else process.env.SEVENTEEN_TRACK_WEBHOOK_TOKEN = oldWebhook;
  }
});
