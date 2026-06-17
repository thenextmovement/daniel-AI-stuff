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

test("inbound shipping route defaults to active shipments", async () => {
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
    const response = await GET(request("/api/ops/customer-records/inbound-shipping"));
    const payload = await response.json();
    const shipmentRequest = calls.find((url) => url.pathname.endsWith("/inbound_shipments"));

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(shipmentRequest?.searchParams.get("status"), "not.in.(delivered,closed)");
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

test("inbound shipping route serves delivery note PDFs with download headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.pathname.endsWith("/rest/v1/inbound_shipments")) {
      return json([
        {
          id: "inbound-route-pdf-1",
          shipment_key: "trello:card-route:dhl:7055403121",
          source: "trello",
          trello_card_id: null,
          trello_card_name: "Route PDF Test",
          trello_card_url: null,
          trello_list_id: "list-1",
          trello_list_name: "sign shipped",
          carrier: "dhl",
          tracking_number: "7055403121",
          tracking_raw: "DHL Express 7055403121",
          status: "in_transit",
          status_reason: null,
          risk_level: "normal",
          first_seen_at: "2026-06-16T08:00:00.000Z",
          tracking_first_seen_at: "2026-06-16T08:00:00.000Z",
          tendered_at: "2026-06-16T09:00:00.000Z",
          last_event_at: "2026-06-16T09:30:00.000Z",
          last_movement_at: "2026-06-16T09:30:00.000Z",
          last_checked_at: "2026-06-16T10:00:00.000Z",
          next_check_at: null,
          delivered_at: null,
          created_at: "2026-06-16T08:00:00.000Z",
          updated_at: "2026-06-16T10:00:00.000Z",
        },
      ]);
    }
    if (url.pathname.endsWith("/rest/v1/inbound_tracking_events")) return json([]);

    return new Response(JSON.stringify({ error: `unexpected ${url.pathname}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const response = await GET(request("/api/ops/customer-records/inbound-shipping?action=delivery_note_pdf&shipmentId=inbound-route-pdf-1"));
    const content = Buffer.from(await response.arrayBuffer()).toString("latin1");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") || "", /attachment; filename="lieferschein-/);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.match(content, /^%PDF-1\.4/);
    assert.match(content, /Lieferschein/);
    assert.match(content, /7055403121/);
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
