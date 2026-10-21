import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ArrivalIntegrationError, createShopifyClient } from "../../src/lib/ops/arrival-labels/clients";
import type { TrelloCardEvidence } from "../../src/lib/ops/arrival-labels/domain";

function setup(t: TestContext) {
  const keys = ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_API_ACCESS_TOKEN", "SHOPIFY_ADMIN_API_VERSION"];
  const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, {
    SHOPIFY_SHOP_DOMAIN: "galaxybuzzdk.myshopify.com",
    SHOPIFY_ADMIN_API_ACCESS_TOKEN: "test-only",
    SHOPIFY_ADMIN_API_VERSION: "2026-01",
  });
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
  }));
  return createShopifyClient();
}
function page(ids: number[], cursor: string | null = null) {
  return { data: { orders: {
    nodes: ids.map(id => ({ id: `gid://shopify/Order/${id}`, name: `#NEONT${id}`, displayFinancialStatus: "PAID", tags: [], customAttributes: [], lineItems: { nodes: [] }, shippingLines: { nodes: [] }, fulfillments: [] })),
    pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
  } } };
}
function throttled(cost: unknown = { requestedQueryCost: 266, actualQueryCost: null, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 144, restoreRate: 100 } }) {
  return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost } };
}
function fastWaits(t: TestContext) {
  const waits: number[] = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    waits.push(Number(ms));
    return original(callback, 0, ...args);
  }) as typeof setTimeout);
  return waits;
}

test("Shopify search windows do not compete for quota; pagination and deduplication remain complete", async t => {
  const client = setup(t);
  let active = 0;
  let maxActive = 0;
  const searches: string[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const { query, after } = JSON.parse(String(init.body)).variables;
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    searches.push(query);
    return Response.json(query.startsWith("created_at:") ? after ? page([2]) : page([1], "next") : page([2, 3]));
  });
  const cards = [{ name: "#NEONT3" }] as TrelloCardEvidence[];
  const orders = await client.listRecentOrders("2026-10-20", cards);
  assert.equal(maxActive, 1);
  assert.deepEqual(orders.map(order => order.id), ["gid://shopify/Order/1", "gid://shopify/Order/2", "gid://shopify/Order/3"]);
  assert.deepEqual(searches, ["created_at:>=2026-06-22", "created_at:>=2026-06-22", "name:NEONT3"]);
});

test("HTTP 200 THROTTLED retries the same page after Shopify budget recovery without skipping orders", async t => {
  const client = setup(t);
  const waits = fastWaits(t);
  const cursors: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    assert.equal(init.method, "POST");
    const { after } = JSON.parse(String(init.body)).variables;
    cursors.push(after);
    return Response.json(cursors.length === 1 ? page([1], "next") : cursors.length === 2 ? throttled() : page([2]));
  });
  const orders = await client.listRecentOrders("2026-10-20");
  assert.deepEqual(cursors, [null, "next", "next"]);
  assert.deepEqual(orders.map(order => order.id), ["gid://shopify/Order/1", "gid://shopify/Order/2"]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1220 && waits[0] <= 2000, "wait for the reported 122-point deficit at 100 points/second");
});

test("persistent Shopify throttling terminates with a retryable sanitized failure instead of partial success", async t => {
  const client = setup(t);
  const waits = fastWaits(t);
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; return Response.json(throttled()); });
  await assert.rejects(client.listRecentOrders("2026-10-20"), error => {
    assert.ok(error instanceof ArrivalIntegrationError);
    assert.equal(error.code, "shopify_graphql_throttled");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(attempts, 4);
  assert.equal(waits.length, 3);
});

for (const cost of [null, { requestedQueryCost: 266, throttleStatus: { currentlyAvailable: 0, restoreRate: 0 } }, { requestedQueryCost: 99999999, throttleStatus: { currentlyAvailable: 0, restoreRate: 1 } }]) {
  test(`invalid or excessive throttle metadata uses a finite bounded wait: ${JSON.stringify(cost)}`, async t => {
    const client = setup(t);
    const waits = fastWaits(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => Response.json(++calls === 1 ? throttled(cost) : page([1])));
    assert.equal((await client.listRecentOrders("2026-10-20")).length, 1);
    assert.equal(waits.length, 1);
    assert.ok(Number.isFinite(waits[0]) && waits[0] >= 1000 && waits[0] <= 10000);
  });
}

for (const codes of [["ACCESS_DENIED"], ["THROTTLED", "ACCESS_DENIED"]]) {
  test(`non-throttle GraphQL errors fail immediately without revealing response content: ${codes}`, async t => {
    const client = setup(t);
    const waits = fastWaits(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ ...page([1]), errors: codes.map(code => ({ message: "private upstream content", extensions: { code } })) });
    });
    await assert.rejects(client.listRecentOrders("2026-10-20"), error => {
      assert.ok(error instanceof ArrivalIntegrationError);
      assert.equal(error.code, "shopify_graphql_error");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /private upstream/);
      return true;
    });
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });
}
