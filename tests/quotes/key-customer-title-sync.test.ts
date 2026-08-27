import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  qualifyKeyCustomerOrders,
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

test("preserves the complete Trello title and adds the canonical prefix once", () => {
  const title = "#NEONT5000 | Bestehender vollständiger Titel  mit  Abständen";
  assert.equal(buildKeyCustomerTrelloTitle(title), `KEY KUNDE | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`KEY KUNDE | ${title}`), `KEY KUNDE | ${title}`);
  assert.equal(buildKeyCustomerTrelloTitle(`key kunde|${title}`), `KEY KUNDE | ${title}`);
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
