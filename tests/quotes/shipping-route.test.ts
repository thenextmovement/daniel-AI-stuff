import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/ops/customer-records/shipping/route";

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

test("shipping route rejects unsupported scope filters", async () => {
  const response = await GET(request("/api/ops/customer-records/shipping?scope=stale-ish"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Ungueltiger Versand-Filter/);
  assert.deepEqual(payload.issues, ["scope=stale-ish ist nicht unterstuetzt."]);
});

test("shipping route rejects unsupported carrier filters", async () => {
  const response = await GET(request("/api/ops/customer-records/shipping?carrier=ups"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Ungueltiger Carrier-Filter/);
  assert.deepEqual(payload.issues, ["carrier=ups ist nicht unterstuetzt."]);
});

test("shipping route defaults to active shipments", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const calls: URL[] = [];
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    return Response.json([]);
  }) as typeof fetch;

  try {
    const response = await GET(request("/api/ops/customer-records/shipping"));
    const payload = await response.json();
    const shipmentRequest = calls.find((url) => url.pathname.endsWith("/shipping_shipments"));

    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.equal(payload.ok, true);
    assert.equal(shipmentRequest?.searchParams.get("status"), "not.in.(delivered,returned,closed)");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
