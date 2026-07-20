import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { isArrivalLabelsRequestAuthorized } from "../../src/lib/ops/arrival-labels/auth";
import { berlinDayBounds, type ArrivalDataClients } from "../../src/lib/ops/arrival-labels/clients";
import {
  arrivalsFromDhlMessages,
  buildIdempotencyKey,
  classifyShipping,
  decideArrivalCase,
  extractDhlTrackingNumbers,
  findTrelloCardForTracking,
  isDimmerSpecialCase,
  lastFourOfTracking,
  resolveShopifyOrder,
  type DhlMailEvidence,
  type ProductConfig,
  type ShopifyOrderEvidence,
  type TrelloCardEvidence,
} from "../../src/lib/ops/arrival-labels/domain";
import { runArrivalLabels } from "../../src/lib/ops/arrival-labels/service";

const standardOrder: ShopifyOrderEvidence = {
  id: "gid://shopify/Order/100",
  name: "#NEONT100",
  customerName: "Ada Beispiel",
  note: null,
  tags: [],
  lineItems: [{ title: "Neonschild", quantity: 1 }],
  shippingLines: [{ title: "Standard Versand", code: "standard" }],
  fulfillments: [],
};

const config: ProductConfig = {
  version: "test-v1",
  enabled: true,
  standardProductCode: "DPD_CLASSIC_TEST",
  expressProductMapping: { express: "DPD_EXPRESS_TEST", urgent: "DPD_URGENT_TEST" },
};

function arrival(trackingNumber = "1234567890") {
  return {
    trackingNumber,
    lastFour: trackingNumber.slice(-4),
    localDate: "2026-07-20",
    deliveryState: "due_today" as const,
    expectedArrivalAt: null,
    messageIds: ["mail-1"],
  };
}

function card(name = "1234567890 | #NEONT100 | Ada Beispiel"): TrelloCardEvidence {
  return { id: "card-1", name, url: "https://trello.example.invalid/card-1" };
}

test("DHL tracking extraction is contextual, complete and deduplicated", () => {
  const text = "DHL Express Sendungsnummer: 2619 113 486; Tracking number 2619113486; Rechnung 1234567890";
  assert.deepEqual(extractDhlTrackingNumbers(text), ["2619113486"]);
  assert.equal(lastFourOfTracking("2619113486"), "3486");
  assert.throws(() => lastFourOfTracking("123"), /mindestens vier/);
});

test("today arrivals are deduplicated and retain all Outlook evidence", () => {
  const messages: DhlMailEvidence[] = ["a", "b"].map((messageId) => ({
    messageId,
    receivedAt: "2026-07-20T06:00:00Z",
    senderAddress: "DHL Express <tracking@example.invalid>",
    subject: "Ihre DHL Express Sendung kommt HEUTE",
    bodyText: "Sendungsnummer: 2619113486",
  }));
  const result = arrivalsFromDhlMessages(messages, "2026-07-20");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].messageIds, ["a", "b"]);
});

test("DHL relative dates are evaluated in Europe/Berlin, not by server UTC", () => {
  const messages: DhlMailEvidence[] = [{
    messageId: "tomorrow",
    receivedAt: "2026-07-19T21:30:00Z",
    senderAddress: "DHL Express <tracking@example.invalid>",
    subject: "Ihre Sendung kommt MORGEN",
    bodyText: "DHL Express Sendungsnummer: 1234567890",
  }];
  assert.equal(arrivalsFromDhlMessages(messages, "2026-07-20").length, 1);
  assert.equal(arrivalsFromDhlMessages(messages, "2026-07-19").length, 0);
});

test("Trello matching requires the complete incoming DHL number", () => {
  const cards = [card("2619113486 | #NEONT100"), card("3486 | falscher Kurztreffer")];
  assert.equal(findTrelloCardForTracking(cards, "2619113486").card?.name, cards[0].name);
  assert.equal(findTrelloCardForTracking(cards, "9999993486").card, null);
});

test("Shopify matching prefers an explicit exact order number and rejects ambiguity", () => {
  const explicit = resolveShopifyOrder({ card: card(), orders: [standardOrder], customerNameHints: [] });
  assert.equal(explicit.order?.id, standardOrder.id);
  const ambiguous = resolveShopifyOrder({
    card: card("1234567890 | Ada Beispiel"),
    orders: [standardOrder, { ...standardOrder, id: "gid://shopify/Order/101", name: "#NEONT101" }],
    customerNameHints: ["Ada Beispiel"],
  });
  assert.equal(ambiguous.order, null);
  assert.match(ambiguous.error || "", /2 Shopify/);
});

test("100 pieces single color dimmers are a special case without Shopify", () => {
  const special = card("5538051234 | 100 pieces Single color Dimmers");
  assert.equal(isDimmerSpecialCase(special), true);
  const decision = decideArrivalCase({
    arrival: arrival("5538051234"),
    trelloCards: [special],
    shopifyOrders: [],
    productConfig: config,
  });
  assert.equal(decision.status, "special_case");
  assert.equal(decision.shopifyOrder, null);
  assert.equal(decision.selectedDpdProduct, null);
});

test("express, urgent and conflicting instructions are detected deterministically", () => {
  assert.equal(classifyShipping({ ...standardOrder, note: "Expressversand" }).shippingClass, "express");
  assert.equal(classifyShipping({ ...standardOrder, note: "Eilauftrag" }).shippingClass, "urgent");
  const conflict = classifyShipping({ ...standardOrder, note: "Express Versand, aber kein Express" });
  assert.equal(conflict.shippingClass, "unknown");
  assert.match(conflict.conflict || "", /widersprechen/);
});

test("reference order with existing DPD fulfillment can never plan a second label", () => {
  const reference: ShopifyOrderEvidence = {
    ...standardOrder,
    id: "gid://shopify/Order/4498",
    name: "#NEONT4498",
    customerName: "Alexander Walden",
    fulfillments: [{
      id: "gid://shopify/Fulfillment/reference",
      status: "SUCCESS",
      trackingCompany: "DPD",
      trackingNumber: "01476817678011",
      trackingUrl: null,
    }],
  };
  const decision = decideArrivalCase({
    arrival: arrival("2619113486"),
    trelloCards: [card("2619113486 | #NEONT4498 | Alexander Walden")],
    shopifyOrders: [reference],
    productConfig: config,
  });
  assert.equal(decision.status, "existing_label");
  assert.equal(decision.existingDpdTracking, "01476817678011");
  assert.equal(decision.selectedDpdProduct, null);
});

test("non-standard Shopify notes and missing product mapping fail to manual review", () => {
  const withNote = decideArrivalCase({
    arrival: arrival(), trelloCards: [card()], shopifyOrders: [{ ...standardOrder, note: "Bitte andere Farbe" }], productConfig: config,
  });
  assert.equal(withNote.status, "manual_review");
  assert.match(withNote.manualReviewReason || "", /Notiz/);
  const noConfig = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [standardOrder], productConfig: null });
  assert.equal(noConfig.status, "manual_review");
  assert.match(noConfig.manualReviewReason || "", /DPD-Produkt/);
});

test("idempotency key uses Shopify order ID plus the full DHL tracking number", () => {
  const key = buildIdempotencyKey("gid://shopify/Order/4498", "2619113486");
  assert.equal(key, "shopify:gid://shopify/Order/4498:dhl:2619113486");
  assert.notEqual(key, buildIdempotencyKey("gid://shopify/Order/4498", "9999993486"));
});

test("repeated dry runs produce the same decisions and idempotency keys", async () => {
  const messages: DhlMailEvidence[] = [{
    messageId: "mail-1", receivedAt: "2026-07-20T06:00:00Z", senderAddress: "DHL Express <tracking@example.invalid>",
    subject: "DHL Express kommt HEUTE", bodyText: "Sendungsnummer: 1234567890",
  }];
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return messages; } },
    trello: { async listQuentinCards() { return [card()]; } },
    shopify: { async listRecentOrders() { return [standardOrder]; } },
    existingLabels: { async findForOrders() { return new Map(); } },
  };
  const first = await runArrivalLabels({ localDate: "2026-07-20", clients, productConfig: config });
  const second = await runArrivalLabels({ localDate: "2026-07-20", clients, productConfig: config });
  assert.deepEqual(first.cases, second.cases);
  assert.equal(first.cases[0].status, "label_planned");
});

test("Berlin day bounds remain correct across daylight saving transitions", () => {
  const winter = berlinDayBounds("2026-01-20");
  const summer = berlinDayBounds("2026-07-20");
  assert.equal(Temporal.Instant.from(winter.startUtc).toZonedDateTimeISO("Europe/Berlin").hour, 0);
  assert.equal(Temporal.Instant.from(summer.startUtc).toZonedDateTimeISO("Europe/Berlin").hour, 0);
  assert.match(winter.startUtc, /23:00:00Z$/);
  assert.match(summer.startUtc, /22:00:00Z$/);
});

test("saved reference fixture contains the protected NEONT4498 tracking evidence", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/arrival-labels/reference-dry-run.json", "utf8"));
  assert.equal(fixture.orders[0].name, "#NEONT4498");
  assert.equal(fixture.orders[0].fulfillments[0].trackingNumber, "01476817678011");
});

test("internal arrival-label API requires its dedicated sufficiently long bearer token", () => {
  const previous = process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
  try {
    process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = "arrival-label-test-token-at-least-24";
    assert.equal(isArrivalLabelsRequestAuthorized(new Headers({ Authorization: "Bearer wrong-token" })), false);
    assert.equal(isArrivalLabelsRequestAuthorized(new Headers({ Authorization: "Bearer arrival-label-test-token-at-least-24" })), true);
  } finally {
    if (previous === undefined) delete process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = previous;
  }
});

test("execute mode remains fail-closed even when the feature flag is set", async () => {
  const previous = process.env.ARRIVAL_LABEL_WRITES_ENABLED;
  process.env.ARRIVAL_LABEL_WRITES_ENABLED = "true";
  try {
    const clients: ArrivalDataClients = {
      outlook: { async listMessagesForLocalDate() { return []; } },
      trello: { async listQuentinCards() { return []; } },
      shopify: { async listRecentOrders() { return []; } },
      existingLabels: { async findForOrders() { return new Map(); } },
    };
    await assert.rejects(
      runArrivalLabels({ mode: "execute", localDate: "2026-07-20", clients, productConfig: config }),
      /EasyDPD-Write-Adapter ist noch nicht freigegeben/,
    );
  } finally {
    if (previous === undefined) delete process.env.ARRIVAL_LABEL_WRITES_ENABLED;
    else process.env.ARRIVAL_LABEL_WRITES_ENABLED = previous;
  }
});
