import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/workflow-audit/route";

const AUTH_KEY = "workflow-audit-route-test-key-123456";

function request(body: unknown, token = AUTH_KEY) {
  return new NextRequest("http://127.0.0.1:3100/api/internal/workflow-audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get("cache-control") || "", /no-store/);
}

test("workflow audit route requires internal bearer auth", async () => {
  const originalKey = process.env.OPS_INTERNAL_API_KEY;
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;

  try {
    const response = await POST(request({ workflowName: "x" }, "wrong-token"));
    const payload = await response.json();

    assert.equal(response.status, 401);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "unauthorized");
  } finally {
    if (originalKey === undefined) delete process.env.OPS_INTERNAL_API_KEY;
    else process.env.OPS_INTERNAL_API_KEY = originalKey;
  }
});

test("workflow audit route does not expose raw Supabase details to callers", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalInternalKey = process.env.OPS_INTERNAL_API_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.OPS_INTERNAL_API_KEY = AUTH_KEY;
  globalThis.fetch = (async () => new Response("sensitive sql detail", { status: 500 })) as typeof fetch;

  try {
    const response = await POST(request({
      workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
      action: "offer_send",
      status: "blocked",
      requestId: "REQ-1",
      errorMessage: "Guard blocked",
    }));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "supabase_error");
    assert.equal("details" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /sensitive sql detail/);
    assert.doesNotMatch(JSON.stringify(payload), /service-role-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    if (originalInternalKey === undefined) delete process.env.OPS_INTERNAL_API_KEY;
    else process.env.OPS_INTERNAL_API_KEY = originalInternalKey;
  }
});
