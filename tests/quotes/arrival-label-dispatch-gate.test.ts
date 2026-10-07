import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as printResult } from "../../src/app/api/internal/arrival-labels/print-jobs/[jobId]/result/route";
import { POST as browserResult } from "../../src/app/api/internal/arrival-labels/browser-purchases/[jobId]/result/route";

const ID = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const GID = "gid://shopify/Order/1234567890";
const WORKER = "test-worker-01";
const TOKEN = "test-only-dispatch-token-32-characters-long";
const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ARRIVAL_LABEL_PRINT_API_TOKEN", "ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN", "SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_API_ACCESS_TOKEN", "SHOPIFY_ADMIN_API_VERSION"] as const;

async function scenario(kind: "print" | "browser", options: { note?: string | null; pickup?: boolean; missingOrder?: boolean; malformed?: boolean; wrongOwner?: boolean; holdFails?: boolean; result?: string; parcelKind?: string; shopDomain?: string; held?: boolean; auditedHold?: boolean } = {}) {
  const previous = keys.map(key => process.env[key]);
  const beforeFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: "https://database.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only", ARRIVAL_LABEL_PRINT_API_TOKEN: TOKEN, ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN: TOKEN, SHOPIFY_SHOP_DOMAIN: options.shopDomain || "galaxybuzzdk.myshopify.com", SHOPIFY_ADMIN_API_ACCESS_TOKEN: "test-only", SHOPIFY_ADMIN_API_VERSION: "2026-07" });
  const calls: string[] = [];
  let hold: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("arrival_label_print_jobs") || url.pathname.endsWith("arrival_label_browser_purchase_jobs")) {
      assert.equal(url.searchParams.get("lease_owner"), `eq.${WORKER}`);
      return Response.json(options.wrongOwner ? [] : [{ id: ID, case_id: CASE, status: options.held ? "manual_review" : kind === "browser" ? "validated" : "claimed", shopify_order_id: GID, lease_owner: WORKER, lease_expires_at: new Date(Date.now() + 60_000).toISOString(), parcel_kind: options.parcelKind || "main" }]);
    }
    if (url.pathname.endsWith("arrival_label_events")) return Response.json(options.auditedHold ? [{ event_key: `shopify-dispatch-hold:${kind}:${ID}` }] : []);
    if (url.pathname.endsWith("arrival_label_cases")) return Response.json([{ id: CASE, shopify_order_id: GID }]);
    if (url.pathname.endsWith("graphql.json")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.variables.id, GID);
      assert.equal(init?.cache, "no-store");
      return Response.json({ data: { order: options.missingOrder ? null : {
        id: GID, name: "#TEST", displayFinancialStatus: "PAID", note: options.note ?? null,
        tags: [], customAttributes: [], shippingLines: { nodes: [{ title: options.pickup ? "Abholung" : "Standard", code: null }], pageInfo: { hasNextPage: false } },
        lineItems: { nodes: [{ title: "Acryl LED-Tischgerät", quantity: 1 }] },
        ...(options.malformed ? { customAttributes: null } : {}),
      } } });
    }
    if (url.pathname.endsWith("rpc/arrival_labels_hold_before_dispatch")) {
      hold = JSON.parse(String(init?.body));
      return options.holdFails ? new Response("private failure", { status: 500 }) : Response.json({ status: "manual_review" });
    }
    if (/rpc\/arrival_labels_update_(print_job|browser_purchase)$/.test(url.pathname)) return Response.json([{ id: ID, status: options.result || "dispatching", cups_job_id: null }]);
    throw new Error(`unexpected test request ${url.pathname}`);
  };
  try {
    const request = new NextRequest("https://ops.example.invalid/api/result", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", [`x-neontrip-${kind === "print" ? "print" : "browser"}-worker`]: WORKER }, body: JSON.stringify({ workerId: WORKER, result: options.result || "dispatching", cupsJobId: options.result === "printed" ? "Brother-123" : undefined }) });
    const response = await (kind === "print" ? printResult : browserResult)(request, { params: Promise.resolve({ jobId: ID }) });
    return { response, payload: await response.json(), calls, hold: hold as Record<string, unknown> | null };
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    globalThis.fetch = beforeFetch;
  }
}

for (const kind of ["print", "browser"] as const) {
  test(`${kind}: a fresh package-opening note blocks dispatch and persists manual review`, async () => {
    const result = await scenario(kind, { note: "Paket öffnen und Tischgerät beilegen" });
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.error, "shopify_manual_review");
    assert.equal(result.hold?.p_job_kind, kind);
    assert.match(String(result.hold?.p_reason), /Shopify/);
    assert.equal(result.calls.some(path => path.includes("rpc/arrival_labels_update_")), false);
  });
  test(`${kind}: pickup shipping method blocks even with empty notes`, async () => {
    const result = await scenario(kind, { pickup: true });
    assert.equal(result.response.status, 409);
    assert.equal(result.calls.some(path => path.includes("rpc/arrival_labels_update_")), false);
  });
  for (const parcelKind of ["main", "acrylic_table_device"]) test(`${kind}: acrylic item alone remains allowed (${parcelKind})`, async () => {
    const result = await scenario(kind, { parcelKind });
    assert.equal(result.response.status, 200);
    assert.equal(result.hold, null);
    const freshRead = result.calls.findIndex(path => path.endsWith("graphql.json"));
    assert.ok(freshRead >= 0 && freshRead < result.calls.findIndex(path => path.includes("rpc/arrival_labels_update_")));
  });
  test(`${kind}: permitted internal metadata does not block`, async () => {
    assert.equal((await scenario(kind, { note: CASE })).response.status, 200);
  });
  for (const option of ["missingOrder", "malformed", "wrongOwner", "holdFails"] as const) test(`${kind}: ${option} never grants dispatch`, async () => {
    const result = await scenario(kind, { [option]: true, note: option === "holdFails" ? "Paket öffnen" : null });
    assert.equal(result.response.status, 500);
    assert.equal(result.calls.some(path => path.includes("rpc/arrival_labels_update_")), false);
    assert.doesNotMatch(JSON.stringify(result.payload), /private failure/);
  });
  test(`${kind}: a different Shopify store fails closed`, async () => {
    const result = await scenario(kind, { shopDomain: "offerstudio.myshopify.com" });
    assert.equal(result.response.status, 500);
    assert.equal(result.calls.some(path => path.endsWith("graphql.json")), false);
  });
}

test("CUPS completion is still recorded after dispatch without reclassifying the order", async () => {
  const result = await scenario("print", { result: "printed", note: "Paket öffnen" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.calls, ["/rest/v1/rpc/arrival_labels_update_print_job"]);
});

for (const kind of ["print", "browser"] as const) {
  test(`${kind}: legacy worker can acknowledge audited hold without restarting dispatch`, async () => {
    const result = await scenario(kind, { result: "retryable_error", held: true, auditedHold: true });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.status, "manual_review");
    assert.equal(result.calls.some(path => path.includes("/rpc/") || path.endsWith("graphql.json")), false);
  });
  test(`${kind}: other uncertain/manual states still use existing transition restrictions`, async () => {
    const result = await scenario(kind, { result: "retryable_error", held: true });
    assert.ok(result.calls.some(path => path.includes("rpc/arrival_labels_update_")));
  });
}
