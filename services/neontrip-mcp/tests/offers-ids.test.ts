import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import type { GatewayConfig } from "../src/config.js";
import type { Scope } from "../src/types.js";
import { createGatewayApp } from "../src/server.js";

const token = "synthetic-offers-test-token";
const cuid = "cm00000000000000000000000";
const itemId = "cm00000000000000000000001";
const imageId = "cm00000000000000000000002";
const uuid = "00000000-0000-4000-8000-000000000001";
const version = "2026-10-05T10:00:00.000Z";
type Call = { url: string; method: string; body?: Record<string, unknown> };

async function harness(context: TestContext, scopes: Scope[] = ["system:read", "offers:read", "offers:write", "offers:send", "billing:read"]) {
  const calls: Call[] = [];
  let currentVersion = version;
  const config: GatewayConfig = {
    env: "test", host: "127.0.0.1", port: 8787,
    publicUrl: new URL("http://127.0.0.1:8787/mcp"), allowedHosts: ["127.0.0.1"], allowedOrigins: [],
    identities: [{ clientId: "offers-test", actor: "offers-test@neontrip", role: "operator", tokenSha256: createHash("sha256").update(token).digest("hex"), scopes, expiresAt: Math.floor(Date.now() / 1000) + 3600 }],
    offers: { baseUrl: new URL("https://offers.example.invalid"), apiKey: "synthetic-key" },
    requiredServices: [], requestTimeoutMs: 1000, maxResponseBytes: 10000, requestsPerMinute: 100, allowDecisionCustomerEmail: false,
  };
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return Response.json({ ok: true, offer: { id: cuid, updatedAt: currentVersion } });
  };
  const { app, close } = createGatewayApp({ config, fetchImpl, audit: () => undefined });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  context.after(async () => { await close(); await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())); });
  let id = 0;
  async function request(method: string, params: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const line = raw.split("\n").find((entry) => entry.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : raw);
  }
  const call = (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args });
  return { calls, call, request, setVersion: (value: string) => { currentVersion = value; } };
}

function succeeded(response: { result?: { isError?: boolean }; error?: unknown }) {
  assert.equal(response.error, undefined);
  assert.ok(response.result);
  assert.notEqual(response.result.isError, true, JSON.stringify(response));
}
const update = { offerId: cuid, expectedUpdatedAt: version, reason: "Synthetic test", patch: { items: [{ id: itemId, title: "Test item" }], images: [{ id: imageId, title: "Test image" }] } };
const send = { offerId: cuid, expectedUpdatedAt: version, recipientEmail: "test@example.invalid", subject: "Synthetic test", message: "Test only", reason: "Synthetic confirmed request", idempotencyKey: "test-offer-send-1" };

test("Offers reads accept Prisma CUIDs and retain UUID compatibility", async (context) => {
  const h = await harness(context);
  for (const id of [cuid, uuid]) {
    succeeded(await h.call("offers_get", { offerId: id }));
    assert.equal(h.calls.at(-1)?.url, `https://offers.example.invalid/api/internal/offers/${id}`);
  }
});

test("CUID preview and update preserve item/image IDs, version guard and readback", async (context) => {
  const h = await harness(context);
  succeeded(await h.call("offers_preview_update", update));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.method, "PATCH");
  assert.match(h.calls[0]!.url, /\?dryRun=true$/);
  assert.deepEqual(h.calls[0]?.body?.items, update.patch.items);
  assert.deepEqual(h.calls[0]?.body?.images, update.patch.images);
  succeeded(await h.call("offers_update", update));
  assert.deepEqual(h.calls.slice(1).map((call) => call.method), ["PATCH", "PATCH", "GET"]);
  assert.match(h.calls[1]!.url, /\?dryRun=true$/);
  assert.ok(!h.calls[2]!.url.includes("dryRun=true"));
  assert.deepEqual(h.calls[1]?.body, h.calls[2]?.body);
  assert.equal(h.calls[2]?.body?.expectedUpdatedAt, version);
  assert.equal(h.calls[2]?.body?.actor, "offers-test@neontrip");
});

test("CUID send reaches only fake upstream and still refuses changed versions", async (context) => {
  const h = await harness(context);
  succeeded(await h.call("offers_send", send));
  assert.deepEqual(h.calls.map((call) => call.method), ["GET", "POST"]);
  assert.equal(h.calls[1]?.url, `https://offers.example.invalid/api/internal/offers/${cuid}/send`);
  assert.equal(h.calls[1]?.body?.idempotencyKey, send.idempotencyKey);
  h.setVersion("2026-10-05T11:00:00.000Z");
  const changed = await h.call("offers_send", { ...send, idempotencyKey: "test-offer-send-2" });
  assert.equal(changed.result?.isError, true);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("Malformed offer, item and image IDs are rejected before upstream; billing remains UUID-only", async (context) => {
  const h = await harness(context);
  for (const id of ["../send", `${cuid}/send`, `${cuid}?x=y`, ` ${cuid}`, `${cuid}\n`, "cshort"]) {
    for (const [name, args] of [
      ["offers_get", { offerId: id }],
      ["offers_preview_update", { ...update, offerId: id }],
      ["offers_update", { ...update, patch: { items: [{ id, title: "Test" }] } }],
      ["offers_preview_update", { ...update, patch: { images: [{ id, title: "Test" }] } }],
      ["offers_send", { ...send, offerId: id }],
    ] as const) {
      assert.equal((await h.call(name, args)).result?.isError, true);
    }
  }
  assert.equal((await h.call("billing_get_case", { caseId: cuid })).result?.isError, true);
  assert.equal(h.calls.length, 0);
});

test("Offers read scope exposes previews but neither update nor send", async (context) => {
  const h = await harness(context, ["system:read", "offers:read"]);
  const catalog = await h.request("tools/list", {});
  const names = catalog.result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("offers_preview_update"));
  assert.ok(!names.includes("offers_update"));
  assert.ok(!names.includes("offers_send"));
  assert.ok((await h.call("offers_send", send)).error);
  assert.equal(h.calls.length, 0);
});
