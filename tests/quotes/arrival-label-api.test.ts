import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as runArrivalLabels } from "../../src/app/api/internal/arrival-labels/run/route";

const TOKEN = "arrival-label-agent-test-token";

function request(body: Record<string, unknown>, token = TOKEN, contentType = "application/json") {
  return new NextRequest("https://ops.example.invalid/api/internal/arrival-labels/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

async function withEnvironment<T>(run: () => Promise<T>) {
  const previous = {
    token: process.env.ARRIVAL_LABEL_AGENT_API_TOKEN,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = TOKEN;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  try {
    return await run();
  } finally {
    if (previous.token === undefined) delete process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = previous.token;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
}

test("arrival-label run API rejects missing auth before external access", async () => {
  await withEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const response = await runArrivalLabels(request({ mode: "dry_run" }, "wrong-token"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(called, false);
  });
});

test("arrival-label run API enforces bounded strict JSON input", async () => {
  await withEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const wrongType = await runArrivalLabels(request({ mode: "dry_run" }, TOKEN, "text/plain"));
    assert.equal(wrongType.status, 400);
    const unknownField = await runArrivalLabels(request({ mode: "dry_run", createLabel: true }));
    assert.equal(unknownField.status, 400);
    assert.equal(called, false);
  });
});

test("arrival-label run API hides downstream details and returns a request ID", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async () => new Response("contains-sensitive-database-detail", { status: 500 });
    const response = await runArrivalLabels(request({ mode: "dry_run", persist: false, triggerType: "n8n_email" }));
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(payload), /sensitive-database-detail/);
  });
});
