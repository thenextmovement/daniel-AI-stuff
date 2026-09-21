import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  qualifyKeyCustomerOrders,
  defaultKeyCustomerTitleSyncDeps,
  syncKeyCustomerTrelloTitle,
  type KeyCustomerOrderRow,
  type KeyCustomerTitleSyncDeps,
} from "@/lib/ops/key-customer-title-sync";
import { handleKeyCustomerTitleSyncPost } from "@/lib/ops/key-customer-title-sync-route";
import { buildKeyCustomerTrelloTitle } from "@/lib/ops/trello-card-title";

const requestCreatedAt = "2026-08-27T10:00:00.000Z";

function paidOrder(
  id: string,
  value: number,
  overrides: Partial<KeyCustomerOrderRow> = {},
): KeyCustomerOrderRow {
  return {
    id,
    shopify_order_id: `gid://shopify/Order/${id}`,
    shopify_order_number: `#${id}`,
    order_value: value,
    currency: "EUR",
    status: "paid",
    cancelled_at: null,
    shopify_created_at: "2026-08-01T10:00:00.000Z",
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function deps(overrides: Partial<KeyCustomerTitleSyncDeps> = {}) {
  const updates: Array<{ cardId: string; patch: { name?: string | null; desc?: string | null } }> = [];
  const audits: unknown[] = [];
  const value: KeyCustomerTitleSyncDeps & { updates: typeof updates; audits: typeof audits } = {
    async findRequest() {
      return {
        id: "11111111-1111-4111-8111-111111111111",
        request_id: "NF-KEY-1",
        customer_id: "22222222-2222-4222-8222-222222222222",
        trello_card_id: "trelloCard1",
        created_at: requestCreatedAt,
        updated_at: requestCreatedAt,
      };
    },
    async findCustomer() {
      return { id: "22222222-2222-4222-8222-222222222222", email: "kontakt@beispiel-gmbh.de" };
    },
    async getDomainFacts() {
      return {
        email_domain: "beispiel-gmbh.de",
        is_valid_dns_host: true,
        is_freemail: false,
        is_shared_provider: false,
        email_domain_cache_allowed: true,
      };
    },
    async listCustomersByDomain() {
      return [
        { id: "22222222-2222-4222-8222-222222222222", email: "kontakt@beispiel-gmbh.de" },
        { id: "33333333-3333-4333-8333-333333333333", email: "einkauf@beispiel-gmbh.de" },
      ];
    },
    async listPaidOrders() {
      return [paidOrder("1001", 650), paidOrder("1002", 600)];
    },
    async getCard() {
      return {
        id: "trelloCard1",
        idBoard: "board-1",
        name: "#NEONT5000 | Bestehender vollständiger Titel",
        customFields: {},
        attachments: [],
      };
    },
    async updateCard(cardId, patch) {
      updates.push({ cardId, patch });
    },
    async recordAudit(input) {
      audits.push(input);
      return { inserted: true };
    },
    trelloConfigured() {
      return true;
    },
    ...overrides,
    updates,
    audits,
  };
  return value;
}

test("qualifies only distinct historical paid EUR Shopify orders above 1,200 EUR", () => {
  const duplicate = paidOrder("1001-duplicate", 650, {
    shopify_order_id: "gid://shopify/Order/1001",
    shopify_order_number: "#1001",
  });
  const rows = [
    paidOrder("1001", 650),
    duplicate,
    paidOrder("1002", 550.01),
    paidOrder("pending", 900, { status: "pending" }),
    paidOrder("refunded", 900, { status: "refunded" }),
    paidOrder("cancelled", 900, { cancelled_at: "2026-08-05T10:00:00.000Z" }),
    paidOrder("future", 900, { shopify_created_at: "2026-08-28T10:00:00.000Z" }),
    paidOrder("usd", 900, { currency: "USD" }),
  ];

  assert.deepEqual(qualifyKeyCustomerOrders(rows, requestCreatedAt), {
    paidOrderCount: 2,
    paidOrderValueEur: 1200.01,
    eligible: true,
  });
});

test("requires a strict paid value above 1,200 EUR", () => {
  assert.deepEqual(
    qualifyKeyCustomerOrders([paidOrder("1001", 600), paidOrder("1002", 600)], requestCreatedAt),
    { paidOrderCount: 2, paidOrderValueEur: 1200, eligible: false },
  );
});

test("counts retained payments after partial refunds without counting the refunded amount", () => {
  const rows = [
    paidOrder("1001", 3511.69, { status: "partially_refunded", net_payment_value: 3406.34 }),
    paidOrder("1002", 254.66, { status: "partially_refunded", net_payment_value: 247.02 }),
  ];
  assert.deepEqual(qualifyKeyCustomerOrders(rows, requestCreatedAt), {
    paidOrderCount: 2, paidOrderValueEur: 3653.36, eligible: true,
  });
  assert.deepEqual(qualifyKeyCustomerOrders(rows.map((row) => ({ ...row, net_payment_value: 600 })), requestCreatedAt), {
    paidOrderCount: 2, paidOrderValueEur: 1200, eligible: false,
  });
  for (const row of [
    paidOrder("1001", 3511.69, { status: "partially_refunded" }),
    paidOrder("1001", 3511.69, { status: "partially_refunded", net_payment_value: 0 }),
    paidOrder("1001", 3511.69, { status: "refunded", net_payment_value: 3406.34 }),
    paidOrder("1001", 3511.69, { status: "pending", net_payment_value: 3406.34 }),
    paidOrder("1001", 3511.69, { status: "partially_refunded", net_payment_value: 3406.34, cancelled_at: requestCreatedAt }),
  ]) {
    assert.equal(qualifyKeyCustomerOrders([row], requestCreatedAt).paidOrderCount, 0);
  }
});

test("reads partial-refund payment evidence and blocks title writes when it is unavailable", async () => {
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_API_ACCESS_TOKEN"] as const;
  const before = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "test-only",
    SHOPIFY_SHOP_DOMAIN: "neontrip-test.myshopify.com", SHOPIFY_ADMIN_API_ACCESS_TOKEN: "test-only",
  });
  let shopifyReads = 0;
  let providerMode = "valid";
  let sourceStatus = "partially_refunded";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "db.test") {
      assert.equal(url.pathname, "/rest/v1/master_orders");
      assert.equal(url.searchParams.get("status"), "in.(paid,partially_refunded)");
      return Response.json([
        paidOrder("1001", 3511.69, { status: sourceStatus }),
        paidOrder("1002", 254.66, { status: sourceStatus }),
      ]);
    }
    assert.equal(url.hostname, "neontrip-test.myshopify.com");
    shopifyReads++;
    const request = JSON.parse(String(init?.body));
    assert.match(request.query, /query KeyCustomerRetainedPayments/);
    assert.deepEqual(request.variables.ids, ["gid://shopify/Order/1001", "gid://shopify/Order/1002"]);
    if (providerMode === "failed") return Response.json({ errors: [{ message: "unavailable" }] }, { status: 503 });
    if (providerMode === "missing") return Response.json({ data: { nodes: [null] } });
    return Response.json({ data: { nodes: request.variables.ids.map((id: string, index: number) => ({
      id, displayFinancialStatus: providerMode === "refunded" ? "REFUNDED" : "PARTIALLY_REFUNDED",
      cancelledAt: providerMode === "cancelled" ? "2026-08-20T12:00:00Z" : null,
      netPaymentSet: { shopMoney: { amount: index ? "247.02" : "3406.34", currencyCode: "EUR" } },
    })) } });
  };
  try {
    const testDeps = deps({ listPaidOrders: defaultKeyCustomerTitleSyncDeps.listPaidOrders });
    const result = await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, testDeps);
    assert.equal(result.status, "updated");
    assert.equal(result.qualification.paidOrderValueEur, 3653.36);
    assert.equal(shopifyReads, 1);
    for (const mode of ["failed", "missing"]) {
      providerMode = mode;
      const blocked = deps({ listPaidOrders: defaultKeyCustomerTitleSyncDeps.listPaidOrders });
      await assert.rejects(syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, blocked), /Shopify-Zahlungsnachweis/);
      assert.deepEqual(blocked.updates, []);
    }
    for (const mode of ["refunded", "cancelled"]) {
      providerMode = mode;
      const blocked = deps({ listPaidOrders: defaultKeyCustomerTitleSyncDeps.listPaidOrders });
      assert.equal((await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, blocked)).status, "skipped");
      assert.deepEqual(blocked.updates, []);
    }
    sourceStatus = "paid";
    const readsBefore = shopifyReads;
    await defaultKeyCustomerTitleSyncDeps.listPaidOrders(["customer-1"]);
    assert.equal(shopifyReads, readsBefore, "unchanged paid-only history needs no additional Shopify call");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});

test("preserves the complete Trello title and adds the canonical prefix once", () => {
  const title = "#NEONT5000 | Bestehender vollständiger Titel  mit  Abständen";
  assert.equal(buildKeyCustomerTrelloTitle(title), `KEY KUNDE | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`KEY KUNDE | ${title}`), `KEY KUNDE | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`key kunde|${title}`), `KEY KUNDE | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`LED Neon Flex | KEY KUNDE | ${title}`), `KEY KUNDE | LED Neon Flex | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`KEY KUNDE | LED Neon Flex | KEY KUNDE | ${title}`), `KEY KUNDE | LED Neon Flex | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`⚠️ MOCKUP PRÜFEN · KEY KUNDE | ${title}`), `KEY KUNDE | ⚠️ MOCKUP PRÜFEN · ${title}`);
});

test("updates only the Trello card name for an eligible business domain", async () => {
  const testDeps = deps();
  const result = await syncKeyCustomerTrelloTitle(
    { requestId: "11111111-1111-4111-8111-111111111111", operatorName: "n8n test" },
    testDeps,
  );

  assert.equal(result.status, "updated");
  assert.equal(result.qualification.shippingIncluded, true);
  assert.equal(result.qualification.paidOrderCount, 2);
  assert.equal(result.qualification.paidOrderValueEur, 1250);
  assert.deepEqual(testDeps.updates, [{
    cardId: "trelloCard1",
    patch: { name: "KEY KUNDE | #NEONT5000 | Bestehender vollständiger Titel" },
  }]);
  assert.equal(testDeps.audits.length, 1);
  assert.equal((testDeps.audits[0] as { metadata?: Record<string, unknown> }).metadata?.shipping_included, true);
});

test("does not write when paid order value is exactly 1,200 EUR", async () => {
  const testDeps = deps({
    async listPaidOrders() {
      return [paidOrder("1001", 600), paidOrder("1002", 600)];
    },
  });
  const result = await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, testDeps);

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "paid_value_not_over_threshold");
  assert.equal(testDeps.updates.length, 0);
});

test("blocks freemail and shared providers before reading order history", async () => {
  let historyRead = false;
  const testDeps = deps({
    async findCustomer() {
      return { id: "22222222-2222-4222-8222-222222222222", email: "kunde@gmail.com" };
    },
    async getDomainFacts() {
      return {
        email_domain: "gmail.com",
        is_valid_dns_host: true,
        is_freemail: true,
        is_shared_provider: true,
        email_domain_cache_allowed: false,
      };
    },
    async listPaidOrders() {
      historyRead = true;
      return [paidOrder("1001", 10000), paidOrder("1002", 10000)];
    },
  });
  const result = await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, testDeps);

  assert.equal(result.reason, "not_business_domain");
  assert.equal(historyRead, false);
  assert.equal(testDeps.updates.length, 0);
});

test("is replay-safe when the key customer prefix is already present", async () => {
  const testDeps = deps({
    async getCard() {
      return {
        id: "trelloCard1",
        idBoard: "board-1",
        name: "KEY KUNDE | #NEONT5000 | Bestehender Titel",
        customFields: {},
        attachments: [],
      };
    },
  });
  const result = await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1" }, testDeps);

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "already_current");
  assert.equal(testDeps.updates.length, 0);
});

test("supports a non-writing dry run", async () => {
  const testDeps = deps();
  const result = await syncKeyCustomerTrelloTitle({ requestId: "NF-KEY-1", dryRun: true }, testDeps);

  assert.equal(result.status, "would_update");
  assert.equal(result.nextTitle, "KEY KUNDE | #NEONT5000 | Bestehender vollständiger Titel");
  assert.equal(testDeps.updates.length, 0);
});

test("internal route requires the existing automation bearer token", async () => {
  const previous = process.env.OPS_INTERNAL_API_KEY;
  process.env.OPS_INTERNAL_API_KEY = "test-internal-key-with-at-least-24-characters";
  try {
    const unauthorized = await handleKeyCustomerTitleSyncPost(new NextRequest(
      "https://ops.neontrip.de/api/internal/key-customer-title-sync",
      { method: "POST", body: JSON.stringify({ requestId: "NF-KEY-1" }) },
    ), deps());
    assert.equal(unauthorized.status, 401);

    const authorized = await handleKeyCustomerTitleSyncPost(new NextRequest(
      "https://ops.neontrip.de/api/internal/key-customer-title-sync",
      {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPS_INTERNAL_API_KEY}` },
        body: JSON.stringify({ requestId: "NF-KEY-1", dryRun: true }),
      },
    ), deps());
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).status, "would_update");
  } finally {
    if (previous === undefined) delete process.env.OPS_INTERNAL_API_KEY;
    else process.env.OPS_INTERNAL_API_KEY = previous;
  }
});
