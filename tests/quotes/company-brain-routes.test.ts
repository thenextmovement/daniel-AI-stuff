import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as POST_ACTION } from "@/app/api/ops/company-brain/actions/route";
import { POST as POST_RESOLVE } from "@/app/api/ops/company-brain/resolve/route";

function request(path: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3100${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
    body: JSON.stringify(body),
  });
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(response.headers.get("vary") || "", /Cookie/);
  assert.match(response.headers.get("vary") || "", /Cf-Access-Jwt-Assertion/);
}

async function withFetchTrap<T>(callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("unexpected downstream call");
  }) as typeof fetch;

  try {
    const result = await callback();
    assert.equal(calls, 0);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("company brain action route requires explicit Freigabe before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "guarded_offer_resend",
      requestId: "REQ-SAFE-1",
      confirmed: false,
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Bestätigung erforderlich/);
  });
});

test("company brain action route rejects unknown action keys before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "send_anyway",
      requestId: "REQ-SAFE-2",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Unbekannte Company-Brain-Aktion/);
  });
});

test("company brain action route rejects missing request ids before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "save_case_note",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Request-ID fehlt/);
  });
});

test("company brain action route does not expose raw Supabase details to clients", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  globalThis.fetch = (async () => new Response("internal secret sql detail", { status: 500 })) as typeof fetch;

  try {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "save_case_note",
      requestId: "REQ-SUPABASE-FAIL",
      confirmed: true,
      confirmationText: "Freigabe",
      note: "Interne Notiz",
    }));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "supabase_error");
    assert.equal("details" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /internal secret sql detail/);
    assert.doesNotMatch(JSON.stringify(payload), /service-role-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("company brain resolve route returns no-store validation errors", async () => {
  await withFetchTrap(async () => {
    const response = await POST_RESOLVE(request("/api/ops/company-brain/resolve", {
      query: "",
    }));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /mindestens 2 Zeichen/);
  });
});
