import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { isArrivalLabelsRequestAuthorized, isArrivalLabelsRunRequestAuthorized, isArrivalPrintWorkerAuthorized } from "../../src/lib/ops/arrival-labels/auth";
import {
  ArrivalIntegrationError,
  berlinDayBounds,
  collectDhlOutlookMessages,
  collectShopifyOrderNodes,
  fetchWithRetry,
  type ArrivalDataClients,
} from "../../src/lib/ops/arrival-labels/clients";
import {
  ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID,
  ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME,
  ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID,
  ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID,
  ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION,
  arrivalsFromDhlMessages,
  arrivalsFromTrelloSignShipped,
  assessDestinationGate,
  assessShopifyAutomationGate,
  assessTrelloAutomationGate,
  buildIdempotencyKey,
  classifyShipping,
  decideArrivalCase,
  extractDhlTrackingNumbers,
  extractTrailingDhlExpressTracking,
  findTrelloCardForTracking,
  isAutomationSafeOrderNote,
  isDimmerSpecialCase,
  lastSixOfTracking,
  mergeDhlArrivals,
  relevantOrderNote,
  resolveShopifyOrder,
  selectDpdProduct,
  type DhlMailEvidence,
  type ProductConfig,
  type ShopifyOrderEvidence,
  type TrelloCardEvidence,
  type TrelloSignShippedTriggerSettings,
} from "../../src/lib/ops/arrival-labels/domain";
import { runArrivalLabels } from "../../src/lib/ops/arrival-labels/service";

const standardOrder: ShopifyOrderEvidence = {
  id: "gid://shopify/Order/100",
  name: "#NEONT100",
  adminUrl: "https://neontrip.myshopify.com/admin/orders/100",
  customerName: "Ada Beispiel",
  financialStatus: "paid",
  note: null,
  shippingAddress: {
    name: "Ada Beispiel",
    company: null,
    address1: "Musterstrasse 1",
    address2: null,
    zip: "10115",
    city: "Berlin",
    provinceCode: "BE",
    country: "Deutschland",
    countryCodeV2: "DE",
  },
  customAttributes: [],
  tags: [],
  lineItems: [{ title: "Neonschild", quantity: 1 }],
  shippingLines: [{ title: "Standard Versand", code: "standard" }],
  fulfillments: [],
};

const config: ProductConfig = {
  version: "test-v1",
  enabled: true,
  standardProductCode: "DPD_CLASSIC_TEST",
  expressProductMapping: {
    express: "DPD_EXPRESS_TEST",
    express_09: "DPD_EXPRESS_09_TEST",
    express_12: "DPD_EXPRESS_12_TEST",
    urgent: "DPD_URGENT_TEST",
  },
  euProductMapping: {
    standard: "DPD_EU_CLASSIC_TEST",
    express: "DPD_EU_EXPRESS_TEST",
  },
  printerKey: "shipping-a6",
  printMedia: "A6",
  deliveryNotePrinterKey: "office-a4",
  deliveryNotePrintMedia: "A4",
};

const trelloTriggerSettings: TrelloSignShippedTriggerSettings = {
  enabled: true,
  enabledAfter: "2026-07-20T08:00:00Z",
  boardId: ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID,
  sourceListId: ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID,
  sourceListName: "Sign SHIPPED (NEON TRIP)",
  titlePatternVersion: ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION,
};

function arrival(trackingNumber = "1234567890") {
  return {
    trackingNumber,
    lastSix: trackingNumber.slice(-6),
    localDate: "2026-07-20",
    deliveryState: "due_today" as const,
    expectedArrivalAt: null,
    messageIds: ["mail-1"],
    sourceKinds: ["outlook_dhl" as const],
    trelloTrigger: null,
  };
}

function card(name = "1234567890 | #NEONT100 | Ada Beispiel"): TrelloCardEvidence {
  return { id: "card-1", name, url: "https://trello.example.invalid/card-1" };
}

function signShippedCard(name = "#NEONT100 | Ada Beispiel | 1234567890"): TrelloCardEvidence {
  return {
    id: "66a000000000000000000001",
    name,
    url: "https://trello.example.invalid/sign-shipped",
    boardId: ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID,
    listId: ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID,
    listName: "Sign SHIPPED (NEON TRIP)",
    dateLastActivity: "2026-07-20T08:01:00Z",
  };
}

test("DHL tracking extraction is contextual, complete and deduplicated", () => {
  const text = "DHL Express Sendungsnummer: 2619 113 486; Tracking number 2619113486; Rechnung 1234567890";
  assert.deepEqual(extractDhlTrackingNumbers(text), ["2619113486"]);
  assert.equal(lastSixOfTracking("2619113486"), "113486");
  assert.equal(lastSixOfTracking("2619000486"), "000486");
  assert.throws(() => lastSixOfTracking("12345"), /mindestens sechs/);
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

test("confirmed German and English delivery mails become delivered_today, future notices do not", () => {
  const base = {
    receivedAt: "2026-07-20T08:00:00Z",
    senderAddress: "DHL Express <tracking@express.dhl.com>",
    bodyText: "DHL Express Sendungsnummer: 2619113486",
  };
  for (const subject of ["Ihre Sendung wurde zugestellt", "Your shipment has been delivered", "Delivery complete"]) {
    const result = arrivalsFromDhlMessages([{ ...base, messageId: subject, subject }], "2026-07-20");
    assert.equal(result[0]?.deliveryState, "delivered_today", subject);
  }
  for (const subject of ["Ihre Sendung wird heute zugestellt", "Your shipment is out for delivery"]) {
    const result = arrivalsFromDhlMessages([{ ...base, messageId: subject, subject }], "2026-07-20");
    assert.notEqual(result[0]?.deliveryState, "delivered_today", subject);
  }
});

test("Trello matching requires the complete incoming DHL number", () => {
  const cards = [card("2619113486 | #NEONT100"), card("3486 | falscher Kurztreffer")];
  assert.equal(findTrelloCardForTracking(cards, "2619113486").card?.name, cards[0].name);
  assert.equal(findTrelloCardForTracking(cards, "9999993486").card, null);
});

test("Sign SHIPPED accepts only an exact ten-digit DHL number at the title end", () => {
  assert.equal(extractTrailingDhlExpressTracking("#NEONT100 | 2619113486"), "2619113486");
  for (const invalid of [
    "#NEONT100 | 2619113486 | Eilig",
    "#NEONT100 | 12619113486",
    "#NEONT100 | 261911348",
    "#NEONT100x2619113486",
  ]) {
    assert.equal(extractTrailingDhlExpressTracking(invalid), null, invalid);
  }

  const result = arrivalsFromTrelloSignShipped(
    [signShippedCard("#NEONT100 | Ada Beispiel | 2619113486")],
    "2026-07-20",
    trelloTriggerSettings,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].trackingNumber, "2619113486");
  assert.equal(result[0].lastSix, "113486");
  assert.equal(result[0].deliveryState, "unknown");
  assert.deepEqual(result[0].messageIds, []);
  assert.deepEqual(result[0].sourceKinds, ["trello_sign_shipped"]);
});

test("Create Invoice with tracking uses the same exact DHL suffix trigger", () => {
  const createInvoiceCard = {
    ...signShippedCard("50cm | #NEONT4568 Thomas Rehberg | 8109922111"),
    listId: ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID,
    listName: ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME,
  };
  const result = arrivalsFromTrelloSignShipped(
    [createInvoiceCard],
    "2026-08-12",
    trelloTriggerSettings,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].trackingNumber, "8109922111");
  assert.equal(result[0].lastSix, "922111");
  assert.deepEqual(result[0].sourceKinds, ["trello_create_invoice"]);
  assert.equal(result[0].trelloTrigger?.listId, ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID);
});

test("Sign SHIPPED uses current list membership even for cards last changed before activation", () => {
  const historical = { ...signShippedCard(), dateLastActivity: "2026-07-20T07:59:59Z" };
  const withoutActivity = { ...signShippedCard(), dateLastActivity: null };
  assert.equal(arrivalsFromTrelloSignShipped([historical], "2026-07-20", trelloTriggerSettings).length, 1);
  assert.equal(arrivalsFromTrelloSignShipped([withoutActivity], "2026-07-20", trelloTriggerSettings).length, 1);
});

test("Sign SHIPPED fails closed for disabled, wrong-board and wrong-list cards", () => {
  const valid = signShippedCard();
  const variants = [
    { ...valid, boardId: "66b000000000000000000001" },
    { ...valid, listId: "66c000000000000000000001" },
    { ...valid, listName: "Sign Arrived" },
  ];
  assert.deepEqual(arrivalsFromTrelloSignShipped([valid], "2026-07-20", { ...trelloTriggerSettings, enabled: false }), []);
  for (const variant of variants) {
    assert.deepEqual(arrivalsFromTrelloSignShipped([variant], "2026-07-20", trelloTriggerSettings), []);
  }
});

test("Create Invoice trigger fails closed for a spoofed list name or list id", () => {
  const valid = {
    ...signShippedCard("#NEONT4568 | Thomas Rehberg | 8109922111"),
    listId: ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID,
    listName: ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME,
  };
  const variants = [
    { ...valid, listName: "Create Invoice" },
    { ...valid, listId: "66c000000000000000000001" },
  ];
  for (const variant of variants) {
    assert.deepEqual(arrivalsFromTrelloSignShipped([variant], "2026-08-12", trelloTriggerSettings), []);
  }
});

test("Outlook pagination reaches a DHL message after the former five-page boundary", async () => {
  let calls = 0;
  const messages = await collectDhlOutlookMessages(
    "https://graph.microsoft.com/v1.0/users/support%40neontrip.de/mailFolders/inbox/messages?$top=100",
    "test-token",
    {
      allowedDomains: ["dhl.com"],
      maxPages: 10,
      async fetchPage() {
        calls += 1;
        if (calls < 6) {
          return Response.json({
            value: [],
            "@odata.nextLink": `https://graph.microsoft.com/v1.0/users/support%40neontrip.de/mailFolders/inbox/messages?$skiptoken=${calls}`,
          });
        }
        return Response.json({
          value: [{
            id: "late-dhl-mail",
            subject: "DHL Express Zustellung heute",
            body: { content: "Sendungsnummer 1234567890", contentType: "text" },
            receivedDateTime: "2026-08-10T08:00:00Z",
            from: { emailAddress: { address: "tracking@express.dhl.com", name: "DHL Express" } },
          }],
        });
      },
    },
  );
  assert.equal(calls, 6);
  assert.equal(messages[0]?.messageId, "late-dhl-mail");
});

test("Outlook pagination fails visibly instead of silently truncating", async () => {
  await assert.rejects(
    () => collectDhlOutlookMessages(
      "https://graph.microsoft.com/v1.0/users/support%40neontrip.de/mailFolders/inbox/messages?$top=100",
      "test-token",
      {
        allowedDomains: ["dhl.com"],
        maxPages: 2,
        async fetchPage() {
          return Response.json({
            value: [],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/support%40neontrip.de/mailFolders/inbox/messages?$skiptoken=next",
          });
        },
      },
    ),
    (error: unknown) => error instanceof ArrivalIntegrationError && error.code === "graph_outlook_page_limit_exceeded",
  );
});

test("Shopify pagination includes orders after the first 250 results", async () => {
  const cursors: Array<string | null> = [];
  const nodes = await collectShopifyOrderNodes("created_at:>=2026-04-12", async (_query, after) => {
    cursors.push(after);
    if (after === null) {
      return {
        nodes: [{ id: "gid://shopify/Order/first-page" }],
        pageInfo: { hasNextPage: true, endCursor: "cursor-250" },
      };
    }
    return {
      nodes: [{ id: "gid://shopify/Order/second-page" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  });
  assert.deepEqual(cursors, [null, "cursor-250"]);
  assert.deepEqual(nodes.map((node) => node.id), [
    "gid://shopify/Order/first-page",
    "gid://shopify/Order/second-page",
  ]);
});

test("Shopify pagination fails visibly instead of silently truncating", async () => {
  await assert.rejects(
    () => collectShopifyOrderNodes(
      "created_at:>=2026-04-12",
      async (_query, after) => ({
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: after === null ? "cursor-1" : "cursor-2" },
      }),
      2,
    ),
    (error: unknown) => error instanceof ArrivalIntegrationError && error.code === "shopify_page_limit_exceeded",
  );
});

test("Outlook and Trello signals merge by full DHL number and preserve delivery evidence", () => {
  const outlook = arrivalsFromDhlMessages([{
    messageId: "mail-merge",
    receivedAt: "2026-07-20T08:05:00Z",
    senderAddress: "DHL Express <tracking@express.dhl.com>",
    subject: "Ihre DHL Express Sendung kommt HEUTE",
    bodyText: "Sendungsnummer: 1234567890",
  }], "2026-07-20");
  const trello = arrivalsFromTrelloSignShipped([signShippedCard()], "2026-07-20", trelloTriggerSettings);
  const merged = mergeDhlArrivals(outlook, trello);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deliveryState, "due_today");
  assert.deepEqual(merged[0].sourceKinds, ["outlook_dhl", "trello_sign_shipped"]);
  assert.deepEqual(merged[0].messageIds, ["mail-merge"]);
  assert.deepEqual(merged[0].trelloTrigger?.cardIds, ["66a000000000000000000001"]);
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

test("Shopify matching uses exact Trello Card ID before customer-name fallback", () => {
  const trelloCard = card("6282003033 | UPDATE: OUTDOOR | David Thom");
  trelloCard.id = "6a4f3ae8fa1d99955edebf3f";
  const wrongSameCustomer: ShopifyOrderEvidence = {
    ...standardOrder,
    id: "gid://shopify/Order/4527",
    name: "#NEONT4527",
    customerName: "David Thom",
    customAttributes: [{ key: "Trello Card ID", value: "6a509e3710385084448c0b42" }],
  };
  const rightSameCustomer: ShopifyOrderEvidence = {
    ...standardOrder,
    id: "gid://shopify/Order/4528",
    name: "#NEONT4528",
    customerName: "David Thom",
    customAttributes: [{ key: "Trello Card ID", value: "6a4f3ae8fa1d99955edebf3f" }],
  };
  const result = resolveShopifyOrder({
    card: trelloCard,
    orders: [wrongSameCustomer, rightSameCustomer],
    customerNameHints: ["David Thom"],
  });
  assert.equal(result.order?.id, "gid://shopify/Order/4528");
  assert.equal(result.error, null);
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

test("manual Trello lists are hard stops and can only block automation", () => {
  for (const listName of ["Problem with Sign", "Problems with Signs", "Problem mit Schild", "Manual Review", "Manuelle Prüfung", "Sonderfälle"]) {
    assert.equal(assessTrelloAutomationGate({ ...card(), listName }).blocked, true, listName);
  }
  const manualCard = { ...card(), listName: "Problem with Sign" };
  const decision = decideArrivalCase({
    arrival: arrival(),
    trelloCards: [manualCard],
    shopifyOrders: [standardOrder],
    productConfig: config,
  });
  assert.equal(decision.status, "manual_review");
  assert.equal(decision.shopifyOrder?.id, standardOrder.id);
  assert.equal(decision.selectedDpdProduct, null);
  assert.deepEqual(decision.reasons, ["trello_manual_list"]);
});

test("express, urgent and conflicting instructions are detected deterministically", () => {
  assert.equal(classifyShipping({ ...standardOrder, note: "Expressversand" }).shippingClass, "express");
  assert.equal(classifyShipping({ ...standardOrder, note: "Expresszustellung bis 9:00 Uhr" }).shippingClass, "express_09");
  assert.equal(classifyShipping({ ...standardOrder, note: "Express 12:00 Uhr" }).shippingClass, "express_12");
  assert.equal(classifyShipping({ ...standardOrder, note: "Eilauftrag" }).shippingClass, "urgent");
  assert.deepEqual(
    classifyShipping(
      { ...standardOrder, note: "Liefertermin Standardlieferung" },
      { ...card(), description: "Anlieferung naechstmoeglich, aber erstmal kein Express" },
    ),
    { shippingClass: "standard", conflict: null },
  );
  const conflict = classifyShipping({ ...standardOrder, note: "Express Versand, aber kein Express" });
  assert.equal(conflict.shippingClass, "unknown");
  assert.match(conflict.conflict || "", /widersprechen/);
  const deadlineConflict = classifyShipping({ ...standardOrder, note: "Express 9:00 Uhr oder Express 12:00 Uhr" });
  assert.equal(deadlineConflict.shippingClass, "unknown");
  assert.match(deadlineConflict.conflict || "", /Zustellzeiten/);
  assert.equal(selectDpdProduct("express_09", config), "DPD_EXPRESS_09_TEST");
  assert.equal(selectDpdProduct("express_12", config), "DPD_EXPRESS_12_TEST");
  assert.equal(selectDpdProduct("express_18", config), null);
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

test("open Shopify payment status is audit-only and never blocks an otherwise valid arrival label", () => {
  for (const financialStatus of ["pending", "authorized", "partially_paid", "unknown"] as const) {
    const order: ShopifyOrderEvidence = { ...standardOrder, financialStatus };
    const decision = decideArrivalCase({
      arrival: arrival(),
      trelloCards: [card()],
      shopifyOrders: [order],
      productConfig: config,
    });
    assert.equal(decision.status, "label_planned", financialStatus);
    assert.equal(decision.selectedDpdProduct, "DPD_CLASSIC_TEST", financialStatus);
    assert.equal(decision.shopifyOrder?.financialStatus, financialStatus);
    assert.deepEqual(decision.reasons, []);
  }
});

test("refunded, voided and expired orders remain manual-review cases", () => {
  for (const financialStatus of ["refunded", "voided", "expired"] as const) {
    const decision = decideArrivalCase({
      arrival: arrival(),
      trelloCards: [card()],
      shopifyOrders: [{ ...standardOrder, financialStatus }],
      productConfig: config,
    });
    assert.equal(decision.status, "manual_review", financialStatus);
    assert.equal(decision.selectedDpdProduct, null, financialStatus);
    assert.ok(decision.reasons.includes("payment_terminal_status"), financialStatus);
  }
});

test("only the exact NEONTRIP offer note and attribute schema passes the Shopify gate", () => {
  const offerId = "cmabc123456789";
  const publicToken = "_xRsfRkigEtPxgkXGBn7uDigErOGrmodund2IhoRALI";
  const note = [
    "NEONTRIP Angebot: A/N 14258",
    `Angebotslink: https://angebote.neontrip.de/offer/${publicToken}`,
    `PDF Snapshot: https://angebote.neontrip.de/offer/${publicToken}/pdf`,
    "Netto: 903 / MwSt: 171.57 / Brutto: 1074.57",
  ].join("\n");
  const customAttributes = [
    { key: "NEONTRIP Offer ID", value: offerId },
    { key: "NEONTRIP Offer Number", value: "A/N 14258" },
    { key: "NEONTRIP Offer URL", value: `https://angebote.neontrip.de/offer/${publicToken}` },
    { key: "NEONTRIP PDF Snapshot", value: `https://angebote.neontrip.de/offer/${publicToken}/pdf` },
    { key: "Trello Card ID", value: "0123456789abcdef01234567" },
    { key: "Idempotency Key", value: `offer:${offerId}:shopify-sale:v1` },
    { key: "Invoice Mail Intended", value: "yes_private_email" },
  ];
  assert.equal(assessShopifyAutomationGate({ ...standardOrder, note, customAttributes }).blocked, false);
  const legacyPdfUrl = `https://angebote.neontrip.de/api/public/offers/${publicToken}/pdf`;
  const legacyNote = note.replace(`https://angebote.neontrip.de/offer/${publicToken}/pdf`, legacyPdfUrl);
  const legacyAttributes = customAttributes.map((attribute) => attribute.key === "NEONTRIP PDF Snapshot"
    ? { ...attribute, value: legacyPdfUrl }
    : attribute);
  assert.equal(assessShopifyAutomationGate({ ...standardOrder, note: legacyNote, customAttributes: legacyAttributes }).blocked, false);
  const mismatchedPdfToken = assessShopifyAutomationGate({
    ...standardOrder,
    note,
    customAttributes: customAttributes.map((attribute) => attribute.key === "NEONTRIP PDF Snapshot"
      ? { ...attribute, value: "https://angebote.neontrip.de/offer/differentToken123/pdf" }
      : attribute),
  });
  assert.equal(mismatchedPdfToken.blocked, true);
  assert.ok(mismatchedPdfToken.reasonCodes.includes("non_standard_shopify_attribute"));
  const extraLine = assessShopifyAutomationGate({ ...standardOrder, note: `${note}\nBitte hinten ablegen`, customAttributes });
  assert.equal(extraLine.blocked, true);
  assert.ok(extraLine.reasonCodes.includes("non_standard_shopify_note"));
  const unknownAttribute = assessShopifyAutomationGate({
    ...standardOrder,
    note,
    customAttributes: [...customAttributes, { key: "Abweichung", value: "manuell" }],
  });
  assert.equal(unknownAttribute.blocked, true);
  assert.ok(unknownAttribute.reasonCodes.includes("non_standard_shopify_attribute"));
});

test("validated NEONTRIP form, reverse-charge and accepted-segment metadata remain automation-safe", () => {
  const offerId = "cmabc123456789";
  const publicToken = "_xRsfRkigEtPxgkXGBn7uDigErOGrmodund2IhoRALI";
  const baseNote = [
    "NEONTRIP Angebot: A/N 14258",
    `Angebotslink: https://angebote.neontrip.de/offer/${publicToken}`,
    `PDF Snapshot: https://angebote.neontrip.de/offer/${publicToken}/pdf`,
    "Netto: 903 / MwSt: 171.57 / Brutto: 1074.57",
  ];
  const baseAttributes = [
    { key: "NEONTRIP Offer ID", value: offerId },
    { key: "NEONTRIP Offer Number", value: "A/N 14258" },
    { key: "NEONTRIP Offer URL", value: `https://angebote.neontrip.de/offer/${publicToken}` },
    { key: "NEONTRIP PDF Snapshot", value: `https://angebote.neontrip.de/offer/${publicToken}/pdf` },
    { key: "Trello Card ID", value: "0123456789abcdef01234567" },
    { key: "Idempotency Key", value: `offer:${offerId}:shopify-sale:v1` },
  ];
  const formId = "101dcb01-291d-4a22-a624-5fb0f2dbcccd";

  const formOrder = {
    ...standardOrder,
    note: [baseNote[0], `Nerdy-Forms_ID: ${formId}`, ...baseNote.slice(1)].join("\n"),
    customAttributes: [
      ...baseAttributes,
      { key: "Invoice Mail Intended", value: "yes_private_email" },
      { key: "Nerdy-Forms_ID", value: formId },
    ],
  };
  assert.equal(assessShopifyAutomationGate(formOrder).blocked, false);

  const reverseChargeOrder = {
    ...standardOrder,
    note: [...baseNote, "Reverse Charge / steuerfrei mit USt-IdNr.: ATU70010347"].join("\n"),
    customAttributes: [
      ...baseAttributes,
      { key: "Invoice Mail Intended", value: "business_email_no_shopify_receipt" },
      { key: "Reverse Charge", value: "yes_vies_validated" },
      { key: "USt-IdNr.", value: "ATU70010347" },
    ],
  };
  assert.equal(assessShopifyAutomationGate(reverseChargeOrder).blocked, false);

  const segmentOrder = {
    ...formOrder,
    customAttributes: [
      ...baseAttributes,
      { key: "Invoice Mail Intended", value: "segment_nt-2_no_shopify_receipt" },
      { key: "Nerdy-Forms_ID", value: formId },
      { key: "Request Segment", value: "NT-2" },
      { key: "Request S-Kategorie", value: "S3" },
      { key: "Request Segment Status", value: "accepted" },
    ],
  };
  assert.equal(assessShopifyAutomationGate(segmentOrder).blocked, false);

  const mismatchedForm = {
    ...formOrder,
    customAttributes: formOrder.customAttributes.map((attribute) => attribute.key === "Nerdy-Forms_ID"
      ? { ...attribute, value: "201dcb01-291d-4a22-a624-5fb0f2dbcccd" }
      : attribute),
  };
  assert.ok(assessShopifyAutomationGate(mismatchedForm).reasonCodes.includes("non_standard_shopify_attribute"));
  const incompleteReverseCharge = {
    ...reverseChargeOrder,
    customAttributes: reverseChargeOrder.customAttributes.filter((attribute) => attribute.key !== "Reverse Charge"),
  };
  assert.ok(assessShopifyAutomationGate(incompleteReverseCharge).reasonCodes.includes("non_standard_shopify_attribute"));
  const incompleteSegment = {
    ...segmentOrder,
    customAttributes: segmentOrder.customAttributes.filter((attribute) => attribute.key !== "Request Segment Status"),
  };
  assert.ok(assessShopifyAutomationGate(incompleteSegment).reasonCodes.includes("non_standard_shopify_attribute"));
});

test("bare internal UUID notes are automation-safe but human note text still blocks", () => {
  const note = "101dcb01-291d-4a22-a624-5fb0f2dbcccd";
  assert.equal(isAutomationSafeOrderNote(note), true);
  assert.equal(relevantOrderNote(note), null);
  assert.equal(assessShopifyAutomationGate({ ...standardOrder, note }).blocked, false);

  const humanNote = `${note}\nBitte andere Adresse verwenden`;
  const gate = assessShopifyAutomationGate({ ...standardOrder, note: humanNote });
  assert.equal(gate.blocked, true);
  assert.ok(gate.reasonCodes.includes("non_standard_shopify_note"));
  assert.equal(relevantOrderNote(humanNote), humanNote);
});

test("pickup wording blocks label purchase and print even when a DPD label already exists", () => {
  const order = {
    ...standardOrder,
    note: "Ladenlokal holt ab – nicht versenden",
    fulfillments: [{
      id: "gid://shopify/Fulfillment/1",
      status: "SUCCESS",
      trackingCompany: "DPD",
      trackingNumber: "01476817678011",
      trackingUrl: null,
    }],
  };
  const decision = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [order], productConfig: config });
  assert.equal(decision.status, "manual_review");
  assert.equal(decision.selectedDpdProduct, null);
  assert.equal(decision.existingDpdTracking, "01476817678011");
  assert.ok(decision.reasons.includes("pickup_instruction"));
});

test("common German and English pickup variants are recognized deterministically", () => {
  for (const note of ["Abholer", "Selbstabholung", "zur Abholung bereit", "Kunde holt ab", "wird abgeholt", "Laden lokal", "vor Ort", "Local pickup"]) {
    const gate = assessShopifyAutomationGate({ ...standardOrder, note });
    assert.ok(gate.reasonCodes.includes("pickup_instruction"), note);
  }
});

test("Switzerland and other non-EU destinations are always routed to manual review", () => {
  for (const [countryCodeV2, country, expectedCode] of [
    ["CH", "Schweiz", "destination_switzerland_manual"],
    ["GB", "Vereinigtes Koenigreich", "destination_non_eu_manual"],
  ] as const) {
    const order: ShopifyOrderEvidence = {
      ...standardOrder,
      shippingAddress: { ...standardOrder.shippingAddress!, countryCodeV2, country },
    };
    const gate = assessDestinationGate(order, config);
    assert.equal(gate.blocked, true);
    assert.equal(gate.reasonCode, expectedCode);
    const decision = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [order], productConfig: config });
    assert.equal(decision.status, "manual_review");
    assert.equal(decision.selectedDpdProduct, null);
    assert.ok(decision.reasons.includes(expectedCode));
  }
});

test("missing Shopify destination country fails closed before any existing-label shortcut", () => {
  const order: ShopifyOrderEvidence = {
    ...standardOrder,
    shippingAddress: null,
    fulfillments: [{
      id: "gid://shopify/Fulfillment/1",
      status: "SUCCESS",
      trackingCompany: "DPD",
      trackingNumber: "01476817678011",
      trackingUrl: null,
    }],
  };
  const decision = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [order], productConfig: config });
  assert.equal(decision.status, "manual_review");
  assert.equal(decision.destinationClass, "unknown");
  assert.equal(decision.existingDpdTracking, "01476817678011");
  assert.ok(decision.reasons.includes("destination_country_missing"));
});

test("EU destinations require a complete address, an explicit EU DPD product and an A4 delivery-note printer", () => {
  const austria: ShopifyOrderEvidence = {
    ...standardOrder,
    shippingAddress: {
      ...standardOrder.shippingAddress!,
      zip: "1010",
      city: "Wien",
      provinceCode: "9",
      country: "Oesterreich",
      countryCodeV2: "AT",
    },
  };
  const decision = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [austria], productConfig: config });
  assert.equal(decision.status, "label_planned");
  assert.equal(decision.destinationClass, "eu");
  assert.equal(decision.deliveryNoteRequired, true);
  assert.equal(decision.deliveryNoteStatus, "planned");
  assert.equal(decision.selectedDpdProduct, "DPD_EU_CLASSIC_TEST");

  const noA4 = decideArrivalCase({
    arrival: arrival(), trelloCards: [card()], shopifyOrders: [austria],
    productConfig: { ...config, deliveryNotePrinterKey: null },
  });
  assert.equal(noA4.status, "manual_review");
  assert.ok(noA4.reasons.includes("delivery_note_printer_not_configured"));

  const samePrinter = decideArrivalCase({
    arrival: arrival(), trelloCards: [card()], shopifyOrders: [austria],
    productConfig: { ...config, deliveryNotePrinterKey: config.printerKey },
  });
  assert.equal(samePrinter.status, "manual_review");
  assert.ok(samePrinter.reasons.includes("delivery_note_printer_not_separate"));

  const noEuProduct = decideArrivalCase({
    arrival: arrival(), trelloCards: [card()], shopifyOrders: [austria],
    productConfig: { ...config, euProductMapping: {} },
  });
  assert.equal(noEuProduct.status, "manual_review");
  assert.match(noEuProduct.manualReviewReason || "", /EU-DPD-Produkt/);
});

test("EU tax and customs special territories remain manual even with an EU country code", () => {
  const canaryIslands: ShopifyOrderEvidence = {
    ...standardOrder,
    shippingAddress: {
      ...standardOrder.shippingAddress!,
      zip: "35001",
      city: "Las Palmas de Gran Canaria",
      country: "Spanien",
      countryCodeV2: "ES",
    },
  };
  const decision = decideArrivalCase({ arrival: arrival(), trelloCards: [card()], shopifyOrders: [canaryIslands], productConfig: config });
  assert.equal(decision.status, "manual_review");
  assert.equal(decision.destinationClass, "special_territory");
  assert.ok(decision.reasons.includes("destination_special_territory_manual"));
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

test("a previously handled DHL tracking is never planned again when Shopify history is outside the live search", async () => {
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return []; } },
    trello: { async listQuentinCards() { return [signShippedCard()]; } },
    shopify: { async listRecentOrders() { return []; } },
    existingLabels: {
      async findForOrders() { return new Map(); },
      async findHandledCasesForIncomingTrackings() {
        return new Map([["1234567890", {
          caseId: "case-completed",
          idempotencyKey: "shopify:gid://shopify/Order/100:dhl:1234567890",
          trackingNumber: "1234567890",
          status: "completed",
          existingDpdTracking: "01476817890573",
          shopifyOrderId: "gid://shopify/Order/100",
          shopifyOrderName: "#NEONT100",
        }]]);
      },
    },
  };
  const result = await runArrivalLabels({
    localDate: "2026-07-20",
    clients,
    productConfig: config,
    trelloTriggerSettings,
  });
  assert.equal(result.cases[0].status, "existing_label");
  assert.equal(result.cases[0].existingDpdTracking, "01476817890573");
  assert.equal(result.cases[0].idempotencyKey, "shopify:gid://shopify/Order/100:dhl:1234567890");
  assert.equal(result.summary.labelPlanned, 0);
  assert.equal(result.summary.existingLabel, 1);
});

test("Sign SHIPPED alone plans the label immediately while retaining unknown delivery state", async () => {
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return []; } },
    trello: { async listQuentinCards() { return [signShippedCard()]; } },
    shopify: { async listRecentOrders() { return [standardOrder]; } },
    existingLabels: { async findForOrders() { return new Map(); } },
  };
  const result = await runArrivalLabels({
    localDate: "2026-07-20",
    clients,
    productConfig: config,
    trelloTriggerSettings,
  });
  assert.equal(result.cases[0].status, "label_planned");
  assert.equal(result.cases[0].lastSix, "567890");
  assert.match(result.cases[0].expectedArrival, /\(unknown\)$/);
  assert.equal(result.summary.outlookTriggered, 0);
  assert.equal(result.summary.trelloSignShippedTriggered, 1);
});

test("Create Invoice with tracking alone plans through the same guarded service path", async () => {
  const createInvoiceCard = {
    ...signShippedCard("#NEONT100 | Ada Beispiel | 1234567890"),
    listId: ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID,
    listName: ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME,
  };
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return []; } },
    trello: { async listQuentinCards() { return [createInvoiceCard]; } },
    shopify: { async listRecentOrders() { return [standardOrder]; } },
    existingLabels: { async findForOrders() { return new Map(); } },
  };
  const result = await runArrivalLabels({
    localDate: "2026-08-12",
    clients,
    productConfig: config,
    trelloTriggerSettings,
  });
  assert.equal(result.cases[0].status, "label_planned");
  assert.equal(result.cases[0].lastSix, "567890");
  assert.equal(result.summary.outlookTriggered, 0);
  assert.equal(result.summary.trelloSignShippedTriggered, 0);
  assert.equal(result.summary.trelloCreateInvoiceTriggered, 1);
});

test("a pickup order produces no label plan and one internal review notification preview", async () => {
  const messages: DhlMailEvidence[] = [{
    messageId: "mail-pickup", receivedAt: "2026-07-20T06:00:00Z", senderAddress: "DHL Express <tracking@example.invalid>",
    subject: "DHL Express kommt HEUTE", bodyText: "Sendungsnummer: 1234567890",
  }];
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return messages; } },
    trello: { async listQuentinCards() { return [card()]; } },
    shopify: { async listRecentOrders() { return [{ ...standardOrder, note: "Abholer – Ladenlokal" }]; } },
    existingLabels: { async findForOrders() { return new Map(); } },
  };
  const result = await runArrivalLabels({ localDate: "2026-07-20", clients, productConfig: config });
  assert.equal(result.cases[0].status, "manual_review");
  assert.equal(result.cases[0].selectedDpdProduct, null);
  assert.equal(result.summary.reviewNotifications, 1);
  assert.equal(result.reviewNotifications[0].recipientEmail, "info@neontrip.de");
  assert.equal(result.reviewNotifications[0].shopifyOrderUrl, standardOrder.adminUrl);
});

test("Berlin day bounds remain correct across daylight saving transitions", () => {
  const winter = berlinDayBounds("2026-01-20");
  const summer = berlinDayBounds("2026-07-20");
  assert.equal(Temporal.Instant.from(winter.startUtc).toZonedDateTimeISO("Europe/Berlin").hour, 0);
  assert.equal(Temporal.Instant.from(summer.startUtc).toZonedDateTimeISO("Europe/Berlin").hour, 0);
  assert.match(winter.startUtc, /23:00:00Z$/);
  assert.match(summer.startUtc, /22:00:00Z$/);
});

test("external integration failures retain a sanitized source in the audit error", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  try {
    await assert.rejects(
      fetchWithRetry("https://example.invalid", {}, {
        attempts: 1,
        integration: "microsoft graph token/../../secret",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ArrivalIntegrationError);
        assert.equal(error.code, "microsoft_graph_token_______secret_http_error");
        assert.match(error.message, /^microsoft_graph_token_______secret: Externe API antwortete mit HTTP 401\.$/);
        assert.doesNotMatch(error.message, /example\.invalid/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("saved reference fixture contains the protected NEONT4498 tracking evidence", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/arrival-labels/reference-dry-run.json", "utf8"));
  assert.equal(fixture.orders[0].name, "#NEONT4498");
  assert.equal(fixture.orders[0].fulfillments[0].trackingNumber, "01476817678011");
});

test("internal arrival-label API requires its dedicated sufficiently long bearer token", () => {
  const previous = process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
  const previousLocal = process.env.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN;
  try {
    process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = "arrival-label-test-token-at-least-24";
    process.env.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN = "local-scheduler-test-token-at-least-24";
    assert.equal(isArrivalLabelsRequestAuthorized(new Headers({ Authorization: "Bearer wrong-token" })), false);
    assert.equal(isArrivalLabelsRequestAuthorized(new Headers({ Authorization: "Bearer arrival-label-test-token-at-least-24" })), true);
    assert.equal(isArrivalLabelsRequestAuthorized(new Headers({ Authorization: "Bearer local-scheduler-test-token-at-least-24" })), false);
    assert.equal(isArrivalLabelsRunRequestAuthorized(new Headers({ Authorization: "Bearer local-scheduler-test-token-at-least-24" })), true);
  } finally {
    if (previous === undefined) delete process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = previous;
    if (previousLocal === undefined) delete process.env.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN;
    else process.env.ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN = previousLocal;
  }
});

test("execute mode remains fail-closed without a persisted audit even when the feature flag is set", async () => {
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
      /persistiertes Audit/,
    );
  } finally {
    if (previous === undefined) delete process.env.ARRIVAL_LABEL_WRITES_ENABLED;
    else process.env.ARRIVAL_LABEL_WRITES_ENABLED = previous;
  }
});

test("local print API uses a separate 32-character bearer secret", () => {
  const previous = process.env.ARRIVAL_LABEL_PRINT_API_TOKEN;
  try {
    process.env.ARRIVAL_LABEL_PRINT_API_TOKEN = "print-worker-test-token-at-least-32-characters";
    assert.equal(isArrivalPrintWorkerAuthorized(new Headers({ Authorization: "Bearer arrival-label-test-token-at-least-24" })), false);
    assert.equal(isArrivalPrintWorkerAuthorized(new Headers({ Authorization: "Bearer print-worker-test-token-at-least-32-characters" })), true);
  } finally {
    if (previous === undefined) delete process.env.ARRIVAL_LABEL_PRINT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_PRINT_API_TOKEN = previous;
  }
});
