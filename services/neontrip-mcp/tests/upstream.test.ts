import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayConfig } from "../src/config.js";
import { NeontripApi } from "../src/upstream.js";

function config(): GatewayConfig {
  return {
    env: "test",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: new URL("http://localhost:8787/mcp"),
    allowedHosts: ["localhost"],
    allowedOrigins: [],
    identities: [],
    requiredServices: ["billing", "offers"],
    requestTimeoutMs: 1_000,
    maxResponseBytes: 10_000,
    requestsPerMinute: 240,
    allowDecisionCustomerEmail: false,
    ops: { baseUrl: new URL("https://ops.example.test"), accessClientId: "ops-id", accessClientSecret: "ops-secret" },
    offers: { baseUrl: new URL("https://offers.example.test"), apiKey: "offers-secret" },
  };
}

test("billing requests use only the fixed OPS origin and service-token headers", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const api = new NeontripApi(config(), async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return Response.json({ ok: true, cases: [] });
  });
  await api.listBillingCases({ query: "//evil.example", status: "PENDING", limit: 5 });
  assert.equal(calls[0]?.url.origin, "https://ops.example.test");
  assert.equal(calls[0]?.url.pathname, "/api/ops/billing");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["CF-Access-Client-Id"], "ops-id");
  assert.equal(headers["CF-Access-Client-Secret"], "ops-secret");
  assert.equal(calls[0]?.init?.redirect, "error");
});

test("oversized upstream responses are rejected", async () => {
  const api = new NeontripApi(config(), async () => new Response("x".repeat(10_001), {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "10001" },
  }));
  await assert.rejects(() => api.getOffer("00000000-0000-4000-8000-000000000000"), /zu groß/);
});

test("non-JSON upstream responses are rejected before parsing", async () => {
  const api = new NeontripApi(config(), async () => new Response("<html>login</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  await assert.rejects(() => api.getOffer("00000000-0000-4000-8000-000000000000"), /JSON-Antwort/);
});
