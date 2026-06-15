import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/ops/customer-records/inbound-shipping/route";

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://127.0.0.1:3100${path}`, {
    headers: { host: "127.0.0.1:3100" },
    ...init,
  });
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(response.headers.get("vary") || "", /Cookie/);
  assert.match(response.headers.get("vary") || "", /Cf-Access-Jwt-Assertion/);
}

test("inbound shipping route rejects unsupported scope filters", async () => {
  const response = await GET(request("/api/ops/customer-records/inbound-shipping?scope=stale-ish"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Ungueltiger Wareneingang-Filter/);
  assert.deepEqual(payload.issues, ["scope=stale-ish ist nicht unterstuetzt."]);
});

test("inbound shipping route rejects unsupported carrier filters", async () => {
  const response = await GET(request("/api/ops/customer-records/inbound-shipping?carrier=ups"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Ungueltiger Carrier-Filter/);
  assert.deepEqual(payload.issues, ["carrier=ups ist nicht unterstuetzt."]);
});

test("inbound shipping route rejects unsupported actions with no-store headers", async () => {
  const response = await POST(request("/api/ops/customer-records/inbound-shipping", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
    body: JSON.stringify({ action: "ship_it" }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.deepEqual(payload, { ok: false, error: "unsupported_action" });
});

test("inbound shipping route does not expose raw Supabase details to clients", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalConsoleError = console.error;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  console.error = (() => undefined) as typeof console.error;
  globalThis.fetch = (async () =>
    new Response("raw database detail with table names", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;

  try {
    const response = await GET(request("/api/ops/customer-records/inbound-shipping"));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Supabase Anfrage fehlgeschlagen.");
    assert.equal("details" in payload, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
