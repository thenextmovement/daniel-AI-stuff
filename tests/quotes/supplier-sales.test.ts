import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as supplierSalesGET, POST as supplierSalesPOST } from "@/app/api/ops/supplier-sales/route";
import {
  acknowledgeSupplierSalePostOrderChange,
  applyNoPaymentReminderShopifyTag,
  assignSupplierSale,
  buildShopifyOrderTrelloTitle,
  buildSupplierSaleBoardFromRows,
  buildSupplierSalesDiagnostics,
  buildSupplierSaleInputFromPayload,
  cleanupSupplierAssignmentTasks,
  deriveAssignmentStatus,
  derivePaymentDecisionStatus,
  deriveSupplierRecommendation,
  enrichSupplierSalesFromQuentinBoard,
  enrichSupplierSalesWithUniqueRequestTrelloCards,
  generateSupplierOrderConfirmationPdf,
  listSupplierSalesBoard,
  lookupSupplierSaleTrelloDescription,
  markSupplierSaleInProduction,
  normalizeDateOnly,
  normalizeShopifyPaymentStatus,
  prependSupplierSaleTrelloDescription,
  readSupplierSaleTrelloDescription,
  requestSupplierPaymentReminder,
  retrySupplierSaleShopifyTag,
  retrySupplierSaleTrelloProjection,
  runSupplierSalesLiveCheck,
  sendSupplierOrderConfirmationEmail,
  setSupplierSaleQuentinTrelloCard,
  supplierApprovedDesignSelection,
  supplierProductionDescription,
  supplierSaleQuentinTrelloCandidates,
  supplierSaleCompletionHideAt,
  supplierSaleNeedsDeadlineTask,
  supplierSaleReadyForProduction,
  supplierSaleShopifyConfirmed,
  supplierSaleTrelloConfirmed,
  supplierSaleVisibleInActiveOverview,
  syncCompletedOffersFromOffersApp,
  uploadSupplierSaleApprovedDesign,
  upsertSupplierSale,
  type SupplierSaleItemRow,
  type SupplierSaleRow,
} from "@/lib/ops/supplier-sales";

function saleRow(overrides: Partial<SupplierSaleRow>): SupplierSaleRow {
  return {
    id: "sale-1",
    sale_key: "shopify:order:1001",
    source: "shopify",
    shopify_order_id: "1001",
    shopify_order_name: "#1001",
    shopify_order_url: "https://admin.shopify.test/orders/1001",
    shopify_payment_status: "paid",
    payment_decision_status: "paid_confirmed",
    payment_due_at: null,
    last_payment_reminder_at: null,
    payment_reminder_count: 0,
    offer_id: "offer-1",
    offer_number: "A-1001",
    document_reference: "A/N 1001",
    offer_public_url: "https://angebote.test/o/1",
    final_pdf_url: "https://angebote.test/o/1/pdf",
    trello_card_id: "trello-1",
    request_id: "req-1",
    customer_name: "Ada Lovelace",
    customer_email: "ada@example.com",
    customer_phone: null,
    customer_company: "Ada GmbH",
    currency: "EUR",
    subtotal_price: 1000,
    total_price: 1190,
    customer_due_date: "2026-06-20",
    supplier_due_date: "2026-06-20",
    due_date_source: "payload",
    due_date_note: "2026-06-20",
    recommended_supplier: "said",
    recommendation_reasons: ["supplier_rules_v1_20260609:standard_neon_flex"],
    assigned_supplier: null,
    special_supplier_name: null,
    assignment_status: "ready_to_assign",
    assignment_note: null,
    assigned_at: null,
    assigned_by: null,
    shopify_tag_sync_status: "not_started",
    shopify_tag_value: null,
    shopify_tag_synced_at: null,
    shopify_tag_error: null,
    trello_projection_status: "not_started",
    supplier_trello_card_id: null,
    supplier_trello_card_url: null,
    trello_projection_error: null,
    task_sync_status: "not_started",
    active_task_id: null,
    task_sync_error: null,
    product_summary: "LED Neon Logo",
    primary_image_url: "https://cdn.test/mockup.jpg",
    raw_shopify: {},
    offer_snapshot: {},
    metadata: {},
    created_at: "2026-06-09T10:00:00.000Z",
    updated_at: "2026-06-09T10:00:00.000Z",
    ...overrides,
  };
}

function itemRow(overrides: Partial<SupplierSaleItemRow>): SupplierSaleItemRow {
  return {
    id: "item-1",
    sale_id: "sale-1",
    line_item_key: "line-1",
    title: "LED Neon Logo",
    sku: null,
    variant_title: null,
    quantity: 1,
    product_type: "products",
    image_url: "https://cdn.test/mockup.jpg",
    requires_quentin: false,
    rule_reasons: [],
    raw_line_item: {},
    created_at: "2026-06-09T10:00:00.000Z",
    updated_at: "2026-06-09T10:00:00.000Z",
    ...overrides,
  };
}

async function withMockedAssignmentFetch<T>(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  callback: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TRELLO_API_KEY",
    "TRELLO_TOKEN",
    "SUPPLIER_TRELLO_PROJECTION_ENABLED",
    "SUPPLIER_TRELLO_SAID_LIST_ID",
    "SHOPIFY_ADMIN_API_ACCESS_TOKEN",
    "SHOPIFY_ADMIN_TOKEN",
    "SHOPIFY_ADMIN_API_TOKEN",
    "SHOPIFY_ACCESS_TOKEN",
    "SHOPIFY_SHOP_DOMAIN",
    "SHOPIFY_STORE_DOMAIN",
    "SHOPIFY_SHOP",
    "SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
    "N8N_SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
    "SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "N8N_SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "ORDER_CONFIRMATION_WEBHOOK_URL",
    "SHOPIFY_NO_PAYMENT_REMINDER_TAG",
    "SUPPLIER_NO_PAYMENT_REMINDER_TAG",
    "SUPPLIER_ASSIGNMENT_TASKS_ENABLED",
    "NEONTRIP_OFFERS_BASE_URL",
    "OFFERS_BASE_URL",
    "NEXT_PUBLIC_OFFERS_BASE_URL",
    "NEONTRIP_OFFERS_INTERNAL_API_KEY",
    "OFFERS_INTERNAL_API_KEY",
    "QUOTE_INTERNAL_API_TOKEN",
    "OPS_INTERNAL_API_KEY",
    "OPS_PORTAL_TOKEN",
    "OPS_CLOUDFLARE_ACCESS_ISSUER",
    "OPS_CLOUDFLARE_ACCESS_AUD",
    "OPS_REQUIRE_CLOUDFLARE_ACCESS",
    "SUPPLIER_SALES_WEBHOOK_SECRET",
  ];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";
  process.env.SUPPLIER_TRELLO_SAID_LIST_ID = "said-list";
  delete process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  delete process.env.SHOPIFY_ADMIN_API_TOKEN;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  delete process.env.SHOPIFY_SHOP_DOMAIN;
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_SHOP;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    return handler(url, init);
  }) as typeof fetch;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("supplier recommendation sends UV print, outdoor, 3D and acrylic light boxes to Quentin", () => {
  const result = deriveSupplierRecommendation([
    { title: "UV-Print auf Acryl-Light-Box fuer aussen" },
    { title: "3D Buchstaben rueckbeleuchtet" },
  ]);

  assert.equal(result.recommendedSupplier, "quentin");
  assert.deepEqual(
    new Set(result.recommendationReasons.filter((reason) => !reason.includes(":quentin"))),
    new Set(["uv_print", "acryl_light_box", "outdoor", "three_d_letters", "backlit_letters"]),
  );
  assert.equal(result.lineItems[0].requiresQuentin, true);
});

test("supplier recommendation keeps standard LED neon flex with Quentin by default", () => {
  const result = deriveSupplierRecommendation([
    { title: "LED Neon Flex Schild", description: "Standard LED-Neon-Flex warmweiss" },
    { title: "Standard-Versand", section: "shipping" },
  ]);

  assert.equal(result.recommendedSupplier, "quentin");
  assert.ok(result.recommendationReasons.includes("standard_neon_flex"));
  assert.equal(result.lineItems[0].requiresQuentin, false);
});

test("supplier recommendation does not silently send unknown production types to Saeid", () => {
  const result = deriveSupplierRecommendation([{ title: "Metallbuchstaben ohne Neon" }]);

  assert.equal(result.recommendedSupplier, "quentin");
  assert.ok(result.recommendationReasons.includes("three_d_letters"));
});

test("supplier recommendation treats explicit non-neon production as Quentin work", () => {
  const result = deriveSupplierRecommendation([{ title: "Metallschild ohne Neon" }]);

  assert.equal(result.recommendedSupplier, "quentin");
  assert.ok(result.recommendationReasons.includes("non_standard_neon"));
});

test("payment and assignment states separate paid, unpaid approval and waiting", () => {
  assert.equal(normalizeShopifyPaymentStatus("pending_payment"), "pending");
  assert.equal(derivePaymentDecisionStatus("paid"), "paid_confirmed");
  assert.equal(derivePaymentDecisionStatus("pending", "manual_approved_unpaid"), "manual_approved_unpaid");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "paid_confirmed" }), "ready_to_assign");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "manual_approved_unpaid" }), "ready_to_assign");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "pending", completedOfferSource: true }), "ready_to_assign");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "wait_for_payment" }), "payment_open");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "wait_for_payment", completedOfferSource: true }), "payment_open");
  assert.equal(deriveAssignmentStatus({ paymentDecisionStatus: "paid_confirmed", assignedSupplier: "quentin" }), "assigned");
});

test("date normalization accepts Shopify note dates and German operator dates", () => {
  assert.equal(normalizeDateOnly("2026-06-20T12:00:00+02:00"), "2026-06-20");
  assert.equal(normalizeDateOnly("20.06.2026"), "2026-06-20");
  assert.equal(normalizeDateOnly("kein Datum"), null);
});

test("offer.completed payload becomes a supplier sale with snapshot links and due date", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    schemaVersion: 1,
    source: "neontrip-offers",
    event: "offer.completed",
    idempotencyKey: "offer:offer_123:shopify-sale:v1",
    deliveryDateIso: "2026-06-20",
    delivery: { requestedDate: "2026-06-20", requestedDays: 15, source: "accepted_offer_delivery_line" },
    offer: {
      id: "offer_123",
      offerNumber: "A-123",
      documentReference: "A/N 123",
      trelloCardId: "trello-card-123",
      publicUrl: "https://angebote.test/o/share",
      finalPdfUrl: "https://angebote.test/o/share/pdf",
      currency: "EUR",
      acceptedAt: "2026-06-16T13:45:00.000Z",
      signedAt: "2026-06-16T13:44:30.000Z",
    },
    customer: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ADA@EXAMPLE.COM",
      phone: "+49 123",
      company: "Ada GmbH",
    },
    totals: {
      subtotalNet: 1000,
      totalGross: 1190,
    },
    postOrderReview: {
      status: "open",
      signedAt: "2026-06-16T13:44:30.000Z",
      expiresAt: "2026-06-17T13:44:30.000Z",
      changeRequestedAt: null,
      message: null,
      eventId: null,
    },
    lineItems: [
      {
        id: "line-1",
        section: "products",
        title: "LED Neon Flex Logo",
        description: "Leuchtfarbe: Kaltweiss",
        quantity: 1,
        imageUrl: "https://angebote.test/api/public/offers/share/images/design-2?w=1800",
      },
    ],
    media: {
      mockups: [{ url: "https://cdn.test/mockup.jpg" }],
    },
  });

  assert.equal(parsed.sale.saleKey, "offer:offer_123");
  assert.equal(parsed.sale.offerPublicUrl, "https://angebote.test/o/share");
  assert.equal(parsed.sale.finalPdfUrl, "https://angebote.test/o/share/pdf");
  assert.equal(parsed.sale.customerName, "Ada Lovelace");
  assert.equal(parsed.sale.customerEmail, "ADA@EXAMPLE.COM");
  assert.equal(parsed.sale.customerDueDate, "2026-06-20");
  assert.equal(parsed.sale.dueDateSource, "payload");
  assert.equal(parsed.sale.primaryImageUrl, "https://cdn.test/mockup.jpg");
  assert.equal(parsed.sale.lineItems[0]?.imageUrl, "https://angebote.test/api/public/offers/share/images/design-2?w=1800");
  assert.equal(parsed.sale.metadata?.accepted_at, "2026-06-16T13:45:00.000Z");
  assert.equal(parsed.sale.metadata?.signed_at, "2026-06-16T13:44:30.000Z");
  assert.deepEqual(parsed.sale.metadata?.post_order_review, {
    status: "open",
    signedAt: "2026-06-16T13:44:30.000Z",
    expiresAt: "2026-06-17T13:44:30.000Z",
    changeRequestedAt: null,
    message: null,
    eventId: null,
  });
  assert.equal(deriveSupplierRecommendation(parsed.sale.lineItems).recommendedSupplier, "quentin");
});

test("supplier sale board exposes post-order review status and change message", () => {
  const board = buildSupplierSaleBoardFromRows([
    saleRow({
      id: "sale-post-order-change",
      metadata: {
        post_order_review: {
          status: "change_requested",
          signedAt: "2026-06-16T13:44:30.000Z",
          expiresAt: "2026-06-17T13:44:30.000Z",
          changeRequestedAt: "2026-06-16T14:00:00.000Z",
          message: "Bitte ohne UV-Druck produzieren.",
          eventId: "event-post-order-change",
        },
      },
    }),
  ], [], []);

  assert.equal(board.items[0]?.postOrderReview.status, "change_requested");
  assert.equal(board.items[0]?.postOrderReview.message, "Bitte ohne UV-Druck produzieren.");
});

test("supplier sale board treats acknowledged post-order change as closed while keeping message", () => {
  const board = buildSupplierSaleBoardFromRows([
    saleRow({
      id: "sale-post-order-change-closed",
      metadata: {
        post_order_review: {
          status: "closed",
          signedAt: "2026-06-16T13:44:30.000Z",
          expiresAt: "2026-06-17T13:44:30.000Z",
          changeRequestedAt: "2026-06-16T14:00:00.000Z",
          reviewedAt: "2026-06-16T14:15:00.000Z",
          reviewedBy: "Daniel",
          reviewNote: "Ohne UV-Druck eingetragen.",
          message: "Bitte ohne UV-Druck produzieren.",
          eventId: "event-post-order-change",
        },
      },
    }),
  ], [], []);

  assert.equal(board.items[0]?.postOrderReview.status, "closed");
  assert.equal(board.items[0]?.postOrderReview.message, "Bitte ohne UV-Druck produzieren.");
  assert.equal(board.items[0]?.postOrderReview.reviewedBy, "Daniel");
});

test("supplier post-order change can be acknowledged for later assignment", async () => {
  let row = saleRow({
    id: "sale-post-order-change-ack",
    metadata: {
      post_order_review: {
        status: "change_requested",
        signedAt: "2026-06-16T13:44:30.000Z",
        expiresAt: "2026-06-17T13:44:30.000Z",
        changeRequestedAt: "2026-06-16T14:00:00.000Z",
        message: "Bitte ohne UV-Druck produzieren.",
        eventId: "event-post-order-change",
      },
    },
  });
  let patchedMetadata: any = null;
  let eventPayload: any = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      const patch = JSON.parse(String(init?.body || "{}")) as Partial<SupplierSaleRow>;
      patchedMetadata = patch.metadata as Record<string, unknown>;
      row = { ...row, ...patch, updated_at: "2026-06-16T14:15:00.000Z" };
      return Response.json([row]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: row.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      eventPayload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({});
    }
    return Response.json([]);
  }, async () => {
    const sale = await acknowledgeSupplierSalePostOrderChange({
      saleId: row.id,
      operatorName: "Daniel",
      reviewNote: "Ohne UV-Druck eingetragen.",
    });

    assert.equal(sale.postOrderReview.status, "closed");
    assert.equal(sale.postOrderReview.reviewedBy, "Daniel");
    assert.equal(sale.postOrderReview.reviewNote, "Ohne UV-Druck eingetragen.");
  });

  const review = patchedMetadata?.post_order_review as Record<string, unknown>;
  assert.equal(review.status, "closed");
  assert.equal(review.reviewedBy, "Daniel");
  assert.equal(review.reviewNote, "Ohne UV-Druck eingetragen.");
  assert.equal(eventPayload?.event_type, "post_order_change_acknowledged");
});

test("neontrip offer events other than offer.completed are rejected for supplier sales", () => {
  assert.throws(() => buildSupplierSaleInputFromPayload({
    source: "neontrip-offers",
    event: "offer.viewed",
    offer: { id: "offer_123" },
  }), /offer\.completed/);
});

test("neontrip offer completed image fallback reads nested line item images", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    source: "neontrip-offers",
    event: "offer.completed",
    offer: { id: "offer_nested_image", offerNumber: "A/N 16001" },
    customer: { email: "kunde@example.com" },
    totals: { totalGross: 595 },
    lineItems: [
      {
        id: "line-1",
        title: "LED Neon Flex Logo",
        quantity: 1,
        image: { url: "https://cdn.test/nested-line.webp" },
      },
    ],
  });

  assert.equal(parsed.sale.primaryImageUrl, "https://cdn.test/nested-line.webp");
  assert.equal(parsed.sale.lineItems[0]?.imageUrl, "https://cdn.test/nested-line.webp");
});

test("neontrip offer does not stamp one generic offer image onto every purchased line item", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    source: "neontrip-offers",
    event: "offer.completed",
    offer: { id: "offer_generic_image", offerNumber: "A/N 16002" },
    customer: { email: "kunde@example.com" },
    totals: { totalGross: 595 },
    media: { mockups: [{ url: "https://cdn.test/general-offer-preview.webp" }] },
    lineItems: [{ id: "line-1", title: "Design 1", quantity: 1 }],
  });

  assert.equal(parsed.sale.primaryImageUrl, "https://cdn.test/general-offer-preview.webp");
  assert.equal(parsed.sale.lineItems[0]?.imageUrl, null);
});

test("shopify order payload preserves payment, images, customer and Quentin recommendation", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    id: 123456,
    admin_graphql_api_id: "gid://shopify/Order/123456",
    name: "#1234",
    financial_status: "paid",
    total_price: "1480.00",
    currency: "EUR",
    email: "kunde@example.com",
    customer: { first_name: "Max", last_name: "Mustermann" },
    note_attributes: [{ name: "deadline", value: "2026-06-22" }],
    line_items: [
      {
        id: 1,
        title: "Acryl Light Box Outdoor",
        quantity: 1,
        image: { src: "https://cdn.test/box.jpg" },
      },
    ],
  });

  assert.equal(parsed.sale.saleKey, "shopify:order:123456");
  assert.equal(parsed.sale.shopifyPaymentStatus, "paid");
  assert.equal(parsed.sale.customerName, "Max Mustermann");
  assert.equal(parsed.sale.customerDueDate, "2026-06-22");
  assert.equal(parsed.sale.primaryImageUrl, "https://cdn.test/box.jpg");
  assert.equal(deriveSupplierRecommendation(parsed.sale.lineItems).recommendedSupplier, "quentin");
});

test("shopify order payload extracts customer payment links from common Shopify fields", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    id: 123456,
    name: "#1234",
    financial_status: "pending",
    order_status_url: "https://neontrip.test/orders/123456/status",
    checkout: { web_url: "https://neontrip.test/checkouts/abc" },
    total_price: "1480.00",
    currency: "EUR",
    email: "kunde@example.com",
    note_attributes: [{ name: "deadline", value: "2026-06-22" }],
    line_items: [
      {
        id: 1,
        title: "LED Neon Flex Logo",
        quantity: 1,
      },
    ],
  });

  assert.equal(parsed.sale.metadata?.payment_link, "https://neontrip.test/orders/123456/status");
});

test("shopify order payload extracts NEONTRIP offer references from note attributes", () => {
  const parsed = buildSupplierSaleInputFromPayload({
    id: 8281257672971,
    admin_graphql_api_id: "gid://shopify/Order/8281257672971",
    name: "#NEONT4426",
    financial_status: "paid",
    total_price: "913.92",
    currency: "EUR",
    note_attributes: [
      { name: "NEONTRIP Offer ID", value: "cmq4yn9gu006fqm39t1si9xam" },
      { name: "NEONTRIP Offer Number", value: "A/N 14061" },
      { name: "NEONTRIP Offer URL", value: "https://angebote.neontrip.de/offer/ZMLrH8YijasUM6AKq3lwId2Nh-Y4V5I8oJ-o1cII4Mg" },
      { name: "NEONTRIP PDF Snapshot", value: "https://angebote.neontrip.de/offer/ZMLrH8YijasUM6AKq3lwId2Nh-Y4V5I8oJ-o1cII4Mg/pdf" },
      { name: "Trello Card ID", value: "6a267a745c0826d898eec8fd" },
      { name: "Nerdy-Forms_ID", value: "nerdy-request-123" },
      { name: "Idempotency Key", value: "offer:cmq4yn9gu006fqm39t1si9xam:shopify-sale:v1" },
    ],
    line_items: [
      {
        id: 1,
        title: "Acryl Light Box Outdoor",
        quantity: 1,
      },
    ],
  });

  assert.equal(parsed.sale.offerId, "cmq4yn9gu006fqm39t1si9xam");
  assert.equal(parsed.sale.offerNumber, "A/N 14061");
  assert.equal(parsed.sale.offerPublicUrl, "https://angebote.neontrip.de/offer/ZMLrH8YijasUM6AKq3lwId2Nh-Y4V5I8oJ-o1cII4Mg");
  assert.equal(parsed.sale.finalPdfUrl, "https://angebote.neontrip.de/offer/ZMLrH8YijasUM6AKq3lwId2Nh-Y4V5I8oJ-o1cII4Mg/pdf");
  assert.equal(parsed.sale.trelloCardId, "6a267a745c0826d898eec8fd");
  assert.equal(parsed.sale.requestId, "nerdy-request-123");
  assert.equal(parsed.sale.idempotencyKey, "offer:cmq4yn9gu006fqm39t1si9xam:shopify-sale:v1");
  assert.equal(parsed.sale.metadata?.idempotency_key, "offer:cmq4yn9gu006fqm39t1si9xam:shopify-sale:v1");
});

test("shopify order title helper prefixes once and replaces stale order prefixes", () => {
  assert.equal(buildShopifyOrderTrelloTitle("Check Info Ada", "#NEONT4426"), "#NEONT4426 | Check Info Ada");
  assert.equal(buildShopifyOrderTrelloTitle("#NEONT4426 | Check Info Ada", "#NEONT4426"), "#NEONT4426 | Check Info Ada");
  assert.equal(buildShopifyOrderTrelloTitle("#NEONT4426 Check Info Ada", "#NEONT4426"), "#NEONT4426 | Check Info Ada");
  assert.equal(buildShopifyOrderTrelloTitle("#NEONT4000 Check Info Ada", "#NEONT4426"), "#NEONT4426 | Check Info Ada");
});

test("shopify sale upsert prefixes all source Trello cards sharing the Nerdyforms request id", async () => {
  const currentRow = saleRow({
    id: "sale-shopify-title-sync",
    sale_key: "shopify:order:8281257672971",
    shopify_order_id: "8281257672971",
    shopify_order_name: "#NEONT4426",
    request_id: "nerdy-request-123",
    trello_card_id: "carda1234",
  });
  const trelloUpdates: Array<{ cardId: string; name: string | null }> = [];
  const eventTypes: string[] = [];

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (method === "GET" && url.pathname.includes("/cards/carda1234")) {
        return Response.json({ id: "carda1234", idBoard: "board-1", name: "Check Info Ada", customFieldItems: [] });
      }
      if (method === "GET" && url.pathname.includes("/cards/cardb1234")) {
        return Response.json({ id: "cardb1234", idBoard: "board-1", name: "#NEONT4426 Check Info Ada Update", customFieldItems: [] });
      }
      if (method === "GET" && url.pathname.includes("/boards/board-1/customFields")) {
        return Response.json([]);
      }
      if (method === "PUT" && url.pathname.includes("/cards/")) {
        trelloUpdates.push({
          cardId: url.pathname.split("/").pop() || "",
          name: url.searchParams.get("name"),
        });
        return Response.json({});
      }
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${currentRow.id}`) return Response.json([currentRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.request_id, "nerdy-request-123");
      assert.equal(payload.shopify_order_name, "#NEONT4426");
      return Response.json([currentRow]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      return Response.json([{ ...currentRow, ...JSON.parse(String(init?.body || "{}")) }]);
    }
    if (url.pathname.endsWith("/master_requests") && method === "GET") {
      assert.equal(url.searchParams.get("request_id"), "eq.nerdy-request-123");
      return Response.json([
        { request_id: "nerdy-request-123", trello_card_id: "carda1234", trello_card_url: null },
        { request_id: "nerdy-request-123", trello_card_id: null, trello_card_url: "https://trello.com/c/cardb1234/check-info-ada" },
      ]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      const payload = JSON.parse(String(init?.body || "{}"));
      eventTypes.push(payload.event_type);
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const sale = await upsertSupplierSale({
      saleKey: "shopify:order:8281257672971",
      source: "shopify",
      shopifyOrderId: "8281257672971",
      shopifyOrderName: "#NEONT4426",
      requestId: "nerdy-request-123",
      trelloCardId: "carda1234",
      shopifyPaymentStatus: "paid",
      lineItems: [{ title: "LED Neon Logo", quantity: 1 }],
    }, { operatorName: "Shopify Webhook" });

    assert.equal(sale.id, currentRow.id);
  });

  assert.deepEqual(trelloUpdates, [
    { cardId: "carda1234", name: "#NEONT4426 | Check Info Ada" },
    { cardId: "cardb1234", name: "#NEONT4426 | Check Info Ada Update" },
  ]);
  assert.ok(eventTypes.includes("source_trello_order_title_synced"));
});

test("supplier sales board counts deadlines, payment, assignment and sync issues", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({ id: "sale-ready", assignment_status: "ready_to_assign", shopify_payment_status: "paid", supplier_due_date: "2026-06-10" }),
      saleRow({
        id: "sale-payment",
        assignment_status: "payment_open",
        shopify_payment_status: "pending",
        payment_decision_status: "wait_for_payment",
        customer_due_date: "2026-06-08",
        supplier_due_date: "2026-06-08",
        product_summary: "Express 7 Werktage LED Neon Logo",
        raw_shopify: { created_at: "2026-06-01T09:30:00.000Z" },
        offer_snapshot: { delivery: { requestedDays: 7 } },
      }),
      saleRow({ id: "sale-assigned", assignment_status: "assigned", assigned_supplier: "quentin", recommended_supplier: "quentin", shopify_tag_sync_status: "failed", supplier_due_date: "2026-06-11" }),
    ],
    [
      itemRow({ sale_id: "sale-ready" }),
      itemRow({ id: "item-2", sale_id: "sale-payment" }),
      itemRow({ id: "item-3", sale_id: "sale-assigned", requires_quentin: true, rule_reasons: ["outdoor"] }),
    ],
    [],
    new Date("2026-06-09T12:00:00.000Z"),
  );

  assert.equal(board.counts.total, 3);
  assert.equal(board.counts.paidUnassigned, 1);
  assert.equal(board.counts.readyToAssign, 1);
  assert.equal(board.counts.paymentOpen, 1);
  assert.equal(board.counts.assigned, 1);
  assert.equal(board.counts.overdue, 1);
  assert.equal(board.counts.dueSoon, 2);
  assert.equal(board.counts.rushOrders, 1);
  assert.equal(board.counts.missingPaymentLinks, 1);
  assert.equal(board.counts.quentinRecommended, 1);
  assert.equal(board.counts.syncIssues, 1);
  assert.equal(board.items.find((item) => item.id === "sale-payment")?.rushOrder, true);
  assert.deepEqual(board.items.find((item) => item.id === "sale-payment")?.rushOrderDetails, {
    label: "Express",
    serviceDays: 7,
    orderedAt: "2026-06-01T09:30:00.000Z",
    deliveryDate: "2026-06-08",
  });
  assert.equal(board.items[0].id, "sale-ready");
  assert.ok(board.diagnostics.items.length);
});

test("supplier sales board exposes snapshot selection details and Trello lookup links", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({
        id: "sale-selection-details",
        shopify_order_name: "#NEONT7777",
        request_id: "nerdy-request-7777",
        trello_card_id: "6a267a745c0826d898eec8fd",
      }),
    ],
    [
      itemRow({
        sale_id: "sale-selection-details",
        raw_line_item: {
          description: "Ausgewaehlte Produktion laut Snapshot.",
          section: "LED Neon",
          size: "120cm",
          color: "warmweiss",
          cutType: "Konturschnitt",
          options: [{ name: "Rueckwand", value: "Acryl klar" }],
        },
      }),
    ],
    [],
  );

  const sale = board.items[0];
  assert.equal(sale?.sourceTrelloCardUrl, "https://trello.com/c/6a267a745c0826d898eec8fd");
  assert.equal(sale?.quentinTrelloBoardUrl, "https://trello.com/b/9QNAfkv4/quentin-neon-signs");
  assert.match(sale?.quentinTrelloSearchUrl || "", /board%3A62bae9b97705e7419ed64593/);
  assert.match(decodeURIComponent(sale?.quentinTrelloSearchUrl || ""), /nerdy-request-7777 board:62bae9b97705e7419ed64593/);
  assert.doesNotMatch(decodeURIComponent(sale?.quentinTrelloSearchUrl || ""), /#NEONT7777/);
  assert.equal(sale?.items[0]?.description, "Ausgewaehlte Produktion laut Snapshot.");
  assert.ok(sale?.items[0]?.selectionDetails.includes("Product Type: LED Neon Flex"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Size: 120cm"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Color: Warm white"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Cut: Cut to shape"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Backboard: Acrylic clear"));
});

test("supplier sales expose multiline Shopify description properties for existing sales", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-existing-description-property", shopify_order_name: "#NEONT4459" })],
    [
      itemRow({
        sale_id: "sale-existing-description-property",
        title: "Leuchtschild Design",
        product_type: "LED-Leuchtschild",
        raw_line_item: {
          properties: [
            {
              name: "Beschreibung",
              value: [
                "Größe: 140x31cm",
                "Rückplatte: Formzuschnitt / Mit UV Druck",
                "Leuchtfarbe: Kaltweiß",
                "Einsatzort: Innenbereich",
                "Kabelabgang: Kabelabgang egal",
              ].join("\n"),
            },
            { name: "Bereich", value: "LED-Leuchtschild" },
          ],
        },
      }),
    ],
    [],
  );

  assert.deepEqual(board.items[0]?.items[0]?.selectionDetails, [
    "Product Type: LED Sign",
    "Size: 140x31cm",
    "Backboard: Cut to shape / With UV print",
    "Color: Cold white",
    "Use: Indoor",
    "Cable Position: Any position ❗",
  ]);
});

test("supplier sales resolve one exact Trello card from the Nerdyforms request id and keep ambiguity closed", () => {
  const rows = enrichSupplierSalesWithUniqueRequestTrelloCards(
    [
      saleRow({ id: "sale-exact", request_id: "request-exact", trello_card_id: null }),
      saleRow({ id: "sale-ambiguous", request_id: "request-ambiguous", trello_card_id: null }),
      saleRow({ id: "sale-stored", request_id: "request-exact", trello_card_id: "stored-card" }),
    ],
    [
      { request_id: "request-exact", trello_card_url: "https://trello.com/c/abc12345/the-card" },
      { request_id: "request-ambiguous", trello_card_id: "first-card" },
      { request_id: "request-ambiguous", trello_card_id: "second-card" },
    ],
  );

  assert.equal(rows[0]?.trello_card_id, "abc12345");
  assert.equal(rows[1]?.trello_card_id, null);
  assert.equal(rows[2]?.trello_card_id, "stored-card");
});

test("supplier sales resolve a single Quentin card by request id or customer name and keep multiple matches unresolved", () => {
  const rows = enrichSupplierSalesFromQuentinBoard(
    [
      saleRow({ id: "sale-request", request_id: "Nerdy-ABC-77", customer_name: "Wrong Person", trello_card_id: null }),
      saleRow({ id: "sale-order", request_id: null, shopify_order_name: "#NEONT4536", customer_name: "Carole Bropsom", trello_card_id: null }),
      saleRow({ id: "sale-name", request_id: null, shopify_order_name: null, customer_name: "Anna Müller", trello_card_id: null }),
      saleRow({ id: "sale-stored", request_id: "Nerdy-ABC-77", trello_card_id: "stored-card" }),
    ],
    [
      { id: "request-card", name: "Request", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-20T10:00:00Z", customFieldValues: ["Nerdy-ABC-77"] },
      { id: "order-card", name: "#NEONT4536 | KONF | Carole Bropsom", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-21T10:00:00Z", customFieldValues: [] },
      { id: "old-name-card", name: "Müller Anna | LED Neon", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-19T10:00:00Z", customFieldValues: [] },
      { id: "new-name-card", name: "Anna Müller | 3D", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-22T10:00:00Z", customFieldValues: [] },
      { id: "wrong-board", name: "Anna Müller", desc: "Nerdy-ABC-77", idBoard: "other-board", url: null, closed: false, dateLastActivity: "2026-07-23T10:00:00Z", customFieldValues: [] },
    ],
  );

  assert.equal(rows[0]?.trello_card_id, null);
  assert.equal(rows[0]?.quentin_trello_card_id, "request-card");
  assert.equal(rows[1]?.quentin_trello_card_id, "order-card");
  assert.equal(rows[2]?.quentin_trello_card_id ?? null, null);
  assert.equal(rows[3]?.trello_card_id, "stored-card", "the Anfrage Management source card must remain intact");
  assert.equal(rows[3]?.quentin_trello_card_id, "request-card", "the Quentin card is tracked separately");
});

test("Quentin candidates prefer request id over customer name and list every match newest first", () => {
  const candidates = supplierSaleQuentinTrelloCandidates(
    saleRow({ request_id: "Nerdy-ABC-77", customer_name: "Anna Müller", trello_card_id: null }),
    [
      { id: "request-old", name: "Request old", desc: "Nerdy-ABC-77", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-20T10:00:00Z", customFieldValues: [] },
      { id: "request-new", name: "Request new", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-22T10:00:00Z", customFieldValues: ["Nerdy-ABC-77"] },
      { id: "name-newest", name: "Anna Müller | 3D", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-23T10:00:00Z", customFieldValues: [] },
    ],
  );

  assert.deepEqual(candidates.map((candidate) => candidate.cardId), ["request-new", "request-old"]);
  assert.ok(candidates.every((candidate) => candidate.matchBasis === "request_id"));
  assert.ok(candidates.every((candidate) => candidate.cardUrl.startsWith("https://trello.com/c/")));
});

test("Quentin lookup uses direct Trello search when the board batch omits the newest customer card", async () => {
  const olderCardId = "60f000000000000000000001";
  const newestCardId = "70f000000000000000000002";
  const row = saleRow({
    id: "sale-direct-trello-search",
    request_id: null,
    customer_name: "Antonia Lindner",
    trello_card_id: null,
    quentin_trello_card_id: null,
    supplier_trello_card_id: null,
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname === "/1/search") {
        assert.equal(url.searchParams.get("query"), "Antonia Lindner");
        assert.equal(url.searchParams.get("idBoards"), "62bae9b97705e7419ed64593");
        return Response.json({ cards: [
          { id: olderCardId, name: "Antonia Lindner | old", idBoard: "62bae9b97705e7419ed64593" },
          { id: newestCardId, name: "Antonia Lindner | current", idBoard: "62bae9b97705e7419ed64593" },
        ] });
      }
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      const cardId = url.pathname.split("/").at(-1);
      return Response.json({
        id: cardId,
        idBoard: "62bae9b97705e7419ed64593",
        idList: "quentin-list",
        name: cardId === newestCardId ? "Antonia Lindner | current" : "Antonia Lindner | old",
        desc: cardId === newestCardId ? "Current description" : "Old description",
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const result = await lookupSupplierSaleTrelloDescription(row.id);
    assert.equal(result.trelloDescription?.cardId, newestCardId);
    assert.equal(result.trelloDescription?.description, "Current description");
  });
});

test("supplier sales keep an equally current name-only Trello match unresolved", () => {
  const rows = enrichSupplierSalesFromQuentinBoard(
    [saleRow({ id: "sale-ambiguous-name", request_id: null, shopify_order_name: null, customer_name: "Same Name", trello_card_id: null })],
    [
      { id: "same-a", name: "Same Name | A", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-22T10:00:00Z", customFieldValues: [] },
      { id: "same-b", name: "Name Same | B", desc: "", idBoard: "62bae9b97705e7419ed64593", url: null, closed: false, dateLastActivity: "2026-07-22T10:00:00Z", customFieldValues: [] },
    ],
  );

  assert.equal(rows[0]?.quentin_trello_card_id ?? null, null);
});

test("supplier production details keep all manufacturing options and remove non-production data", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-configurator", customer_name: "Must not reach supplier", total_price: 379 })],
    [
      itemRow({
        sale_id: "sale-configurator",
        title: "Neon Schriftzug Konfigurator",
        product_type: "Neon Schriftzug Konfigurator",
        raw_line_item: {
          properties: [
            { name: "Text", value: "Frederik" },
            { name: "Größe", value: "Medium" },
            { name: "Höhe", value: "10-30cm" },
            { name: "Breite", value: "75cm" },
            { name: "Farbe", value: "warm_white" },
            { name: "Schriftart", value: "Avante" },
            { name: "Nutzung", value: "Drinnen" },
            { name: "Hintergrund Zuschnitt", value: "Formzuschnitt" },
            { name: "Stromstecker", value: "Deutschland/Europa" },
            { name: "Hintergrund", value: "Transparent" },
            { name: "Klebeset", value: "JA" },
            { name: "Hängeset", value: "NEIN" },
            { name: "Sonderangebot", value: "JA" },
            { name: "Price", value: "379" },
          ],
        },
      }),
    ],
    [],
  );
  const item = board.items[0]?.items[0];
  assert.ok(item);
  assert.deepEqual(item.selectionDetails, [
    "Product Type: LED Neon Flex",
    "Text: Frederik",
    "Size: 75cm",
    "Color: Warm white",
    "Font: Avante",
    "Use: Indoor",
    "Cut: Cut to shape",
    "Backboard: Transparent",
    "Adhesive mounting kit: YES ❗",
  ]);

  const description = supplierProductionDescription([item]);
  assert.ok(description.startsWith("Size: 75cm ❗"));
  assert.match(description, /Product Type: LED Neon Flex/);
  assert.match(description, /^Adhesive Strips ❗/m);
  assert.doesNotMatch(description, /Must not reach supplier|379|Hanging set|Height|Sonderangebot|Power plug/);
});

test("supplier production description supports normal offers and multiple products", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-normal-offer", source: "neontrip-offers" })],
    [
      itemRow({
        id: "item-backlit",
        sale_id: "sale-normal-offer",
        title: "3D letters",
        product_type: "Leuchtschilder",
        raw_line_item: { description: "Produktart: 3D\nBeleuchtungsart: Backlit / rückbeleuchtet\nGröße: 150x132cm\nFarbe: Gold\nStromstecker: United Kingdom" },
      }),
      itemRow({
        id: "item-addon",
        sale_id: "sale-normal-offer",
        title: "Dimmer with remote control",
        product_type: "Zusatzoptionen",
      }),
    ],
    [],
  );
  const description = supplierProductionDescription(board.items[0]?.items || []);
  assert.match(description, /Product Type: 3D Backlit/);
  assert.match(description, /Size: 150x132cm/);
  assert.match(description, /Color: Gold/);
  assert.match(description, /Power plug: United Kingdom/);
  assert.doesNotMatch(description, /Dimmer|remote control/);
  assert.doesNotMatch(description, /Kunde|E-Mail|Shopify-Link|Preis/);
});

test("supplier production description keeps only real products and essential English production details", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-clean-production-description", source: "neontrip-offers" })],
    [
      itemRow({
        id: "item-priority-production",
        sale_id: "sale-clean-production-description",
        title: "Priorisierte Produktion 12 Tage",
        product_type: "Priorisierte Produktion 12 Tage",
      }),
      itemRow({
        id: "item-generic-sign",
        sale_id: "sale-clean-production-description",
        title: "Leuchtschild Design",
        product_type: "Leuchtschild Design",
      }),
      itemRow({
        id: "item-adhesive",
        sale_id: "sale-clean-production-description",
        title: "Klebe-Set",
        product_type: "Klebe-Set",
        quantity: 2,
      }),
      itemRow({
        id: "item-white-power-supply",
        sale_id: "sale-clean-production-description",
        title: "Weißes Netzteil Premium-Version",
        product_type: "Zusatzoptionen",
      }),
      itemRow({
        id: "item-standard-dimmer",
        sale_id: "sale-clean-production-description",
        title: "Dimmer mit Bluetooth und Fernbedienung",
        product_type: "Zusatzoptionen",
      }),
      itemRow({
        id: "item-shipping",
        sale_id: "sale-clean-production-description",
        title: "Standardversand 20 Werktage",
        product_type: "Liefertermin",
      }),
    ],
    [],
  );

  assert.equal(
    supplierProductionDescription(board.items[0]?.items || []),
    "2x Adhesive Strips ❗\nPower Supply: White",
  );
});

test("supplier production description prioritizes cable position and keeps outdoor, RGB and product quantity", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-special-production-details", source: "neontrip-offers" })],
    [
      itemRow({
        id: "item-rgb-outdoor",
        sale_id: "sale-special-production-details",
        title: "Neon Schriftzug Konfigurator",
        product_type: "Neon Schriftzug Konfigurator",
        quantity: 2,
        raw_line_item: {
          properties: [
            { name: "Farbe", value: "RGB" },
            { name: "Nutzung", value: "Draußen" },
            { name: "Kabelabgang", value: "unten mittig" },
          ],
        },
      }),
    ],
    [],
  );

  assert.equal(
    supplierProductionDescription(board.items[0]?.items || []),
    [
      "Cable Position: Bottom center ❗",
      "Color: RGB ❗",
      "Use: Outdoor ❗",
      "Product Type: LED Neon Flex",
      "Quantity: 2 Pieces",
    ].join("\n"),
  );
});

test("supplier production description translates German cable position order and emits one alert", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-german-cable-position", source: "neontrip-offers" })],
    [
      itemRow({
        id: "item-german-cable-position",
        sale_id: "sale-german-cable-position",
        title: "LED Neonschild - FOOD EXPLORER",
        product_type: "LED Neon Flex",
        raw_line_item: {
          properties: [
            { name: "Kabelabgang", value: "Links unten ❗" },
          ],
        },
      }),
    ],
    [],
  );

  const description = supplierProductionDescription(board.items[0]?.items || []);
  assert.match(description, /^Cable Position: Bottom left ❗$/m);
  assert.doesNotMatch(description, /Links unten|❗\s*❗/);
});

test("supplier production description translates all common German cable position variants", () => {
  const expected = [
    ["rechts unten", "Bottom right"],
    ["links oben", "Top left"],
    ["rechts oben", "Top right"],
    ["mittig unten", "Bottom center"],
    ["mittig oben", "Top center"],
  ];

  for (const [position, english] of expected) {
    const board = buildSupplierSaleBoardFromRows(
      [saleRow({ id: `sale-${position}`, source: "neontrip-offers" })],
      [
        itemRow({
          id: `item-${position}`,
          sale_id: `sale-${position}`,
          title: "LED Neon Flex",
          product_type: "LED Neon Flex",
          raw_line_item: { properties: [{ name: "Kabelabgang", value: position }] },
        }),
      ],
      [],
    );

    assert.match(
      supplierProductionDescription(board.items[0]?.items || []),
      new RegExp(`^Cable Position: ${english} ❗$`, "m"),
    );
  }
});

test("supplier production description does not turn outdoor and hanging options into products and translates values", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-one-sign-with-production-options", source: "neontrip-offers" })],
    [
      itemRow({
        id: "item-main-sign",
        sale_id: "sale-one-sign-with-production-options",
        title: "Leuchtschild Design",
        product_type: "LED Neon Flex",
        raw_line_item: {
          properties: [
            { name: "Größe", value: "120x51cm" },
            { name: "Rückplatte", value: "Formzuschnitt / Mit UV Druck" },
            { name: "Leuchtfarbe", value: "Eisblau" },
            { name: "Einsatzort", value: "Außenbereich IP67" },
            { name: "Kabelabgang", value: "Kabelabgang egal" },
          ],
        },
      }),
      itemRow({
        id: "item-outdoor-option",
        sale_id: "sale-one-sign-with-production-options",
        title: "Outdoor/IP67 wasserfeste Ausführung",
        product_type: "Zusatzoptionen",
      }),
      itemRow({
        id: "item-hanging-option",
        sale_id: "sale-one-sign-with-production-options",
        title: "Deckenabhängung Drahtseile",
        product_type: "Zusatzoptionen",
      }),
      itemRow({
        id: "item-wall-mounting-option",
        sale_id: "sale-one-sign-with-production-options",
        title: "Wandmontage Set",
        product_type: "Zusatzoptionen",
      }),
      itemRow({
        id: "item-power-supply-option",
        sale_id: "sale-one-sign-with-production-options",
        title: "Weißes Netzteil Premium-Version",
        product_type: "Zusatzoptionen",
      }),
    ],
    [],
  );

  const description = supplierProductionDescription(
    board.items[0]?.items || [],
    "Do not split!\nOutdoor use + outdoor power supplies\nSign is for hanging",
  );

  assert.equal(
    description,
    [
      "Size: 120x51cm ❗",
      "Hanging Set ❗",
      "Wall Mounting Set ❗",
      "Use: Outdoor IP67 ❗",
      "Backboard: Cut to shape / With UV print ❗",
      "Product Type: LED Neon Flex",
      "Color: Ice blue",
      "Additional Information:",
      "Do not split!",
      "Outdoor use + outdoor power supplies",
      "Sign is for hanging",
      "Power Supply: White",
    ].join("\n"),
  );
  assert.doesNotMatch(description, /Product [123]|Any position|Außenbereich|Eisblau|Formzuschnitt|UV Druck|Kabelabgang|Drahtseile|Netzteil/);
  assert.throws(
    () => supplierProductionDescription(board.items[0]?.items || [], "Bitte nicht teilen"),
    /must be written in English/,
  );
});

test("approved design selection uses only real purchased products and names the exact preview", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-approved-design" })],
    [
      itemRow({
        id: "item-design",
        sale_id: "sale-approved-design",
        line_item_key: "line-design",
        title: "LED Neon Flex Logo",
        image_url: "https://cdn.test/customer-approved-design.png",
        raw_line_item: { image: { url: "https://cdn.test/customer-approved-design.png" } },
      }),
      itemRow({
        id: "item-shipping",
        sale_id: "sale-approved-design",
        title: "Express Versand 12 Tage",
        product_type: "Liefertermin",
        image_url: "https://cdn.test/shipping.png",
      }),
      itemRow({
        id: "item-addon",
        sale_id: "sale-approved-design",
        title: "Klebe-Set",
        product_type: "Zusatzoptionen",
        image_url: "https://cdn.test/adhesive.png",
      }),
    ],
    [],
  );

  assert.deepEqual(supplierApprovedDesignSelection(board.items[0]?.items || []), {
    designs: [{
      itemId: "item-design",
      lineItemKey: "line-design",
      title: "LED Neon Flex Logo",
      imageUrl: "https://cdn.test/customer-approved-design.png",
      attachmentName: "Approved Design",
    }],
    issue: null,
  });
});

test("approved design selection fails closed when multiple products share one fallback image", () => {
  const board = buildSupplierSaleBoardFromRows(
    [saleRow({ id: "sale-ambiguous-designs" })],
    [
      itemRow({ id: "design-1", sale_id: "sale-ambiguous-designs", title: "Design 1", image_url: "https://cdn.test/fallback.jpg", raw_line_item: { image: { url: "https://cdn.test/fallback.jpg" } } }),
      itemRow({ id: "design-2", sale_id: "sale-ambiguous-designs", title: "Design 2", image_url: "https://cdn.test/fallback.jpg", raw_line_item: { image: { url: "https://cdn.test/fallback.jpg" } } }),
    ],
    [],
  );

  const selection = supplierApprovedDesignSelection(board.items[0]?.items || []);
  assert.deepEqual(selection.designs, []);
  assert.match(selection.issue || "", /nicht eindeutig zugeordnet/);
});

test("approved design upload targets only the verified Quentin card and is idempotent", async () => {
  const cardId = "abcdef1234567890abcdef12";
  let currentRow = saleRow({
    id: "sale-approved-design-upload",
    trello_card_id: "source-anfrage-card",
    supplier_trello_card_id: cardId,
    supplier_trello_card_url: `https://trello.com/c/${cardId}`,
    assigned_supplier: "quentin",
    assignment_status: "assigned",
  });
  const attachments: Array<Record<string, unknown>> = [];
  let attachmentPostCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      if (url.pathname.endsWith("/attachments") && method === "POST") {
        attachmentPostCount += 1;
        const attachment = {
          id: `approved-attachment-${attachmentPostCount}`,
          name: url.searchParams.get("name"),
          fileName: null,
          url: url.searchParams.get("url"),
          mimeType: "image/png",
          previews: [],
        };
        attachments.push(attachment);
        return Response.json(attachment);
      }
      return Response.json({
        id: cardId,
        idBoard: "62bae9b97705e7419ed64593",
        idList: "new-sketch",
        name: "Exact Quentin production card",
        desc: "Existing supplier note",
        customFieldItems: [],
        attachments,
        actions: [],
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      return Response.json([itemRow({
        id: "item-exact-design",
        sale_id: currentRow.id,
        line_item_key: "line-exact-design",
        title: "Purchased LED Neon Design",
        image_url: "https://cdn.test/exact-purchased-design.png",
        raw_line_item: { image: { url: "https://cdn.test/exact-purchased-design.png" } },
      })]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    const first = await uploadSupplierSaleApprovedDesign({ saleId: currentRow.id, operatorName: "Rahim" });
    assert.equal(first.approvedDesignUpload.uploaded, 1);
    assert.equal(first.approvedDesignUpload.alreadyPresent, 0);
    assert.equal(first.approvedDesignUpload.attachments[0]?.name, "Approved Design");

    const second = await uploadSupplierSaleApprovedDesign({ saleId: currentRow.id, operatorName: "Rahim" });
    assert.equal(second.approvedDesignUpload.uploaded, 0);
    assert.equal(second.approvedDesignUpload.alreadyPresent, 1);
  });

  assert.equal(attachmentPostCount, 1, "a retry must not create a duplicate attachment");
  assert.equal(currentRow.trello_card_id, "source-anfrage-card", "the Anfrage Management source card must stay unchanged");
  assert.equal(currentRow.metadata.approved_design_card_id, cardId);
});

test("approved design upload stops before Trello access when the product image is missing", async () => {
  const row = saleRow({ id: "sale-approved-design-missing", supplier_trello_card_id: "abcdef1234567890abcdef12" });
  let trelloRequestCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") trelloRequestCount += 1;
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      return Response.json([itemRow({ sale_id: row.id, image_url: null })]);
    }
    return Response.json([]);
  }, async () => {
    await assert.rejects(
      uploadSupplierSaleApprovedDesign({ saleId: row.id }),
      /nicht eindeutig zugeordnet/,
    );
  });

  assert.equal(trelloRequestCount, 0);
});

test("Quentin assignment and retry preserve the description while updating neighboring card details", async () => {
  const cardId = "70f000000000000000000099";
  let currentRow = saleRow({
    id: "sale-complete-quentin-projection",
    request_id: "Nerdy-Complete-99",
    customer_name: "Antonia Lindner",
    assignment_status: "ready_to_assign",
    payment_decision_status: "paid_confirmed",
    quentin_trello_card_id: cardId,
    trello_card_id: null,
  });
  const purchasedItem = itemRow({
    id: "item-approved-140",
    sale_id: currentRow.id,
    line_item_key: "line-approved-140",
    image_url: "https://cdn.test/approved-140.png",
    raw_line_item: {
      image: { url: "https://cdn.test/approved-140.png" },
      properties: [
        { name: "Größe", value: "140x31cm" },
        { name: "Rückplatte", value: "Formzuschnitt / Mit UV Druck" },
        { name: "Leuchtfarbe", value: "Kaltweiß" },
        { name: "Einsatzort", value: "Innenbereich" },
      ],
    },
  });
  let cardName = "Update size 90cm | Antonia Lindner | Color as logo";
  let cardDescription = "Existing production note";
  let descriptionWriteCount = 0;
  const attachments: Array<Record<string, unknown>> = [];

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      if (url.pathname.endsWith("/attachments") && method === "POST") {
        const attachment = {
          id: "approved-140-attachment",
          name: url.searchParams.get("name"),
          url: url.searchParams.get("url"),
          fileName: null,
          mimeType: "image/png",
          previews: [],
        };
        attachments.push(attachment);
        return Response.json(attachment);
      }
      if (url.pathname.endsWith(`/${cardId}`) && method === "PUT") {
        cardName = url.searchParams.get("name") || cardName;
        if (url.searchParams.has("desc")) {
          descriptionWriteCount += 1;
          cardDescription = url.searchParams.get("desc") || cardDescription;
        }
        return Response.json({});
      }
      return Response.json({
        id: cardId,
        idBoard: "62bae9b97705e7419ed64593",
        idList: "quentin-production",
        name: cardName,
        desc: cardDescription,
        customFieldItems: [],
        attachments,
        actions: [],
      });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([purchasedItem]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "PATCH") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SUPPLIER_TRELLO_PROJECTION_ENABLED = "true";
    const sale = await assignSupplierSale({
      saleId: currentRow.id,
      supplier: "quentin",
      requestedDeliveryDate: "2026-08-13",
      paymentDecisionStatus: "paid_confirmed",
      operatorName: "Rahim",
    });
    assert.equal(sale.trelloProjectionStatus, "synced");
    const retried = await retrySupplierSaleTrelloProjection({ saleId: currentRow.id, operatorName: "Rahim" });
    assert.equal(retried.trelloProjectionStatus, "synced");
  });

  assert.equal(cardName, "140x31cm | Antonia Lindner | Color as logo");
  assert.equal(cardDescription, "Existing production note");
  assert.equal(descriptionWriteCount, 0);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.name, "Approved Design");
  assert.equal(currentRow.metadata.approved_design_card_id, cardId);
});

test("supplier Trello description is freshly read and prepended without deleting existing text", async () => {
  const originalDescription = "Manual supplier note\nDo not remove this line.";
  let currentDescription = originalDescription;
  let currentRow = saleRow({
    id: "sale-trello-description",
    trello_card_id: "abcdef1234567890abcdef12",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
  });
  let trelloPutCount = 0;
  const eventPayload: { current?: Record<string, unknown> } = {};

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      if (method === "PUT") {
        trelloPutCount += 1;
        currentDescription = String(url.searchParams.get("desc") || "");
        return Response.json({ id: currentRow.trello_card_id });
      }
      return Response.json({
        id: currentRow.trello_card_id,
        idBoard: "62bae9b97705e7419ed64593",
        idList: "new-sketch",
        name: "KONF | Example",
        desc: currentDescription,
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      return Response.json([itemRow({ sale_id: currentRow.id, raw_line_item: { size: "75cm", color: "warm white" } })]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      eventPayload.current = JSON.parse(String(init?.body || "{}")).payload;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    const loaded = await readSupplierSaleTrelloDescription(currentRow.id);
    assert.equal(loaded.description, "Manual supplier note\nDo not remove this line.");
    assert.match(loaded.suggestedPrependText, /Product Type:/);

    const result = await prependSupplierSaleTrelloDescription({
      saleId: currentRow.id,
      prependText: "Product Type: LED Neon Flex\nSize: 75cm",
      operatorName: "Rahim",
    });
    assert.equal(result.trelloDescription.description, "Product Type: LED Neon Flex\nSize: 75cm\n\nManual supplier note\nDo not remove this line.");
    assert.equal(result.sale.trelloProjectionStatus, "synced");
    assert.equal(result.sale.supplierTrelloCardId, currentRow.trello_card_id);

    await prependSupplierSaleTrelloDescription({
      saleId: currentRow.id,
      prependText: "Product Type: LED Neon Flex\nSize: 75cm",
      operatorName: "Rahim",
    });
  });

  assert.equal(trelloPutCount, 1, "the exact same confirmed block must be idempotent");
  assert.equal(currentDescription.endsWith("Manual supplier note\nDo not remove this line."), true);
  assert.equal(eventPayload.current?.previous_description_length, currentDescription.length);
});

test("supplier Trello description blocks a card outside the exact Quentin board", async () => {
  let trelloPutCount = 0;
  const row = saleRow({ id: "sale-wrong-trello-board", trello_card_id: "abcdef1234567890abcdef12" });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (method === "PUT") trelloPutCount += 1;
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      return Response.json({
        id: row.trello_card_id,
        idBoard: "another-board",
        name: "Wrong board",
        desc: "Keep me",
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    await assert.rejects(
      prependSupplierSaleTrelloDescription({ saleId: row.id, prependText: "Do not write" }),
      /gehoert nicht zum Quentin-Board/,
    );
  });

  assert.equal(trelloPutCount, 0);
});

test("supplier Trello description ignores an Anfrage Management source card and resolves the Quentin card", async () => {
  const sourceCardId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const quentinCardId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const row = saleRow({
    id: "sale-source-and-quentin",
    trello_card_id: sourceCardId,
    supplier_trello_card_id: null,
    request_id: "Nerdy-Quentin-991",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      if (url.pathname.includes("/boards/62bae9b97705e7419ed64593/cards/open")) {
        return Response.json([{
          id: quentinCardId,
          idBoard: "62bae9b97705e7419ed64593",
          name: "Nerdy-Quentin-991 | Production",
          desc: "Existing Quentin production note",
          closed: false,
          dateLastActivity: "2026-07-22T14:00:00.000Z",
          customFieldItems: [],
        }]);
      }
      const requestedId = url.pathname.split("/").filter(Boolean).at(-1);
      return Response.json({
        id: requestedId,
        idBoard: requestedId === quentinCardId ? "62bae9b97705e7419ed64593" : "anfrage-management-board",
        idList: "list-1",
        name: requestedId === quentinCardId ? "Nerdy-Quentin-991 | Production" : "Anfrage Management source",
        desc: requestedId === quentinCardId ? "Existing Quentin production note" : "Customer intake note",
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const result = await readSupplierSaleTrelloDescription(row.id);
    assert.equal(result.cardId, quentinCardId);
    assert.equal(result.cardUrl, `https://trello.com/c/${quentinCardId}`);
    assert.equal(result.description, "Existing Quentin production note");
  });
});

test("manual Quentin Trello link is verified, stored separately and invalidates the old confirmation", async () => {
  const sourceCardId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const previousSupplierCardId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const nextSupplierCardId = "cccccccccccccccccccccccc";
  let currentRow = saleRow({
    id: "sale-manual-trello-link",
    trello_card_id: sourceCardId,
    supplier_trello_card_id: previousSupplierCardId,
    supplier_trello_card_url: `https://trello.com/c/${previousSupplierCardId}`,
    trello_projection_status: "synced",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    metadata: {
      trello_description_confirmed_at: "2026-07-22T12:00:00.000Z",
      trello_description_confirmed_card_id: previousSupplierCardId,
    },
  });
  let trelloWriteCount = 0;
  let eventType: string | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (method !== "GET") trelloWriteCount += 1;
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      return Response.json({
        id: nextSupplierCardId,
        idBoard: "62bae9b97705e7419ed64593",
        idList: "new-sketch",
        name: "Correct Quentin production card",
        desc: "Existing supplier note",
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      eventType = JSON.parse(String(init?.body || "{}")).event_type;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    const result = await setSupplierSaleQuentinTrelloCard({
      saleId: currentRow.id,
      trelloCard: `https://trello.com/c/${nextSupplierCardId}/correct-card`,
      operatorName: "Rahim",
    });
    assert.equal(result.changed, true);
    assert.equal(result.trelloDescription.cardId, nextSupplierCardId);
    assert.equal(result.trelloDescription.description, "Existing supplier note");
  });

  assert.equal(trelloWriteCount, 0, "relinking must not modify the Trello card itself");
  assert.equal(currentRow.trello_card_id, sourceCardId, "the Anfrage Management source card must stay intact");
  assert.equal(currentRow.supplier_trello_card_id, nextSupplierCardId);
  assert.equal(currentRow.trello_projection_status, "not_started");
  assert.equal(currentRow.metadata.trello_description_confirmed_card_id, null);
  assert.equal(eventType, "supplier_trello_card_relinked");
});

test("manual Quentin Trello link rejects a foreign board without changing the stored card", async () => {
  const previousSupplierCardId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const foreignCardId = "dddddddddddddddddddddddd";
  const row = saleRow({
    id: "sale-foreign-manual-trello-link",
    supplier_trello_card_id: previousSupplierCardId,
    supplier_trello_card_url: `https://trello.com/c/${previousSupplierCardId}`,
  });
  let supplierSalePatchCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      if (url.pathname.endsWith("/customFields")) return Response.json([]);
      return Response.json({
        id: foreignCardId,
        idBoard: "anfrage-management-board",
        name: "Wrong board",
        desc: "Do not use",
        customFieldItems: [],
        attachments: [],
        actions: [],
      });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") supplierSalePatchCount += 1;
    return Response.json([]);
  }, async () => {
    await assert.rejects(
      setSupplierSaleQuentinTrelloCard({ saleId: row.id, trelloCard: `https://trello.com/c/${foreignCardId}` }),
      /gehoert nicht zum Quentin-Board/,
    );
  });

  assert.equal(supplierSalePatchCount, 0);
  assert.equal(row.supplier_trello_card_id, previousSupplierCardId);
});

test("manual Quentin Trello link rejects malformed input before Trello access", async () => {
  const row = saleRow({ id: "sale-invalid-manual-trello-link" });
  let trelloRequestCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") trelloRequestCount += 1;
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    return Response.json([]);
  }, async () => {
    await assert.rejects(
      setSupplierSaleQuentinTrelloCard({ saleId: row.id, trelloCard: "not a Trello link" }),
      /ungueltig/,
    );
  });

  assert.equal(trelloRequestCount, 0);
});

test("supplier sales board sorts newest sales first by accepted snapshot", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({
        id: "sale-old",
        offer_snapshot: { offer: { acceptedAt: "2026-06-14T10:00:00.000Z" } },
        created_at: "2026-06-16T12:00:00.000Z",
        supplier_due_date: "2026-06-18",
      }),
      saleRow({
        id: "sale-new",
        offer_snapshot: { offer: { acceptedAt: "2026-06-16T13:30:00.000Z" } },
        created_at: "2026-06-16T11:00:00.000Z",
        supplier_due_date: "2026-06-30",
      }),
    ],
    [],
    [],
    new Date("2026-06-16T14:00:00.000Z"),
  );

  assert.equal(board.items[0].id, "sale-new");
});

test("supplier sales board prioritizes open repeat customers after paid sales", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({
        id: "sale-new-unpaid",
        customer_email: "new@example.com",
        shopify_payment_status: "pending",
        payment_decision_status: "wait_for_payment",
        assignment_status: "payment_open",
        created_at: "2026-06-18T10:00:00.000Z",
      }),
      saleRow({
        id: "sale-repeat-unpaid",
        customer_email: "repeat@example.com",
        shopify_payment_status: "pending",
        payment_decision_status: "wait_for_payment",
        assignment_status: "payment_open",
        created_at: "2026-06-17T10:00:00.000Z",
        metadata: {
          prior_paid_customer: {
            has_prior_paid_order: true,
            paid_order_count: 2,
            last_paid_at: "2026-05-20T10:00:00.000Z",
            last_paid_order_name: "#1000",
          },
        },
      }),
      saleRow({
        id: "sale-paid",
        shopify_payment_status: "paid",
        payment_decision_status: "paid_confirmed",
        assignment_status: "ready_to_assign",
        created_at: "2026-06-16T10:00:00.000Z",
      }),
    ],
    [],
    [],
    new Date("2026-06-18T12:00:00.000Z"),
  );

  assert.deepEqual(board.items.map((item) => item.id), ["sale-paid", "sale-repeat-unpaid", "sale-new-unpaid"]);
  assert.equal(board.items[1]?.priorPaidCustomer.hasPriorPaidOrder, true);
  assert.equal(board.items[1]?.priorPaidCustomer.lastPaidOrderName, "#1000");
  assert.equal(board.counts.priorPaidCustomerOpen, 1);
});

test("supplier sales deadline board keeps due-date priority", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({
        id: "sale-new-later",
        offer_snapshot: { offer: { acceptedAt: "2026-06-16T13:30:00.000Z" } },
        supplier_due_date: "2026-06-30",
      }),
      saleRow({
        id: "sale-old-sooner",
        offer_snapshot: { offer: { acceptedAt: "2026-06-14T10:00:00.000Z" } },
        supplier_due_date: "2026-06-18",
      }),
    ],
    [],
    [],
    new Date("2026-06-16T14:00:00.000Z"),
    "deadline",
  );

  assert.equal(board.items[0].id, "sale-old-sooner");
});

test("supplier sale deadline task eligibility is due-date based and idempotent", () => {
  const now = new Date("2026-06-11T10:00:00.000Z");

  assert.equal(supplierSaleNeedsDeadlineTask(saleRow({ supplier_due_date: "2026-06-11" }), now), true);
  assert.equal(supplierSaleNeedsDeadlineTask(saleRow({ supplier_due_date: "2026-06-12" }), now), false);
  assert.equal(supplierSaleNeedsDeadlineTask(saleRow({ supplier_due_date: "2026-06-10", assignment_status: "completed" }), now), false);
  assert.equal(supplierSaleNeedsDeadlineTask(saleRow({ supplier_due_date: "2026-06-10", metadata: { deadline_task_id: "task-1" } }), now), false);
});

test("additional supplier assignment requires and audits the manual Shopify tag confirmation", async () => {
  let currentRow = saleRow({
    id: "sale-additional-supplier",
    assignment_status: "ready_to_assign",
    payment_decision_status: "paid_confirmed",
    assigned_supplier: null,
    special_supplier_name: null,
  });
  let externalWriteCount = 0;
  const attemptMetadata: Array<Record<string, unknown>> = [];

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin !== "https://supabase.test") {
      externalWriteCount += 1;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "POST") {
      const metadata = JSON.parse(String(init?.body || "{}")).metadata;
      if (metadata && typeof metadata === "object") attemptMetadata.push(metadata);
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "PATCH") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    await assert.rejects(
      assignSupplierSale({
        saleId: currentRow.id,
        supplier: "special",
        specialSupplierName: "Supplier Test",
        requestedDeliveryDate: "2026-07-30",
        paymentDecisionStatus: "paid_confirmed",
      }),
      /Shopify-Supplier-Tag ist nicht bestaetigt/,
    );

    const assigned = await assignSupplierSale({
      saleId: currentRow.id,
      supplier: "special",
      specialSupplierName: "Supplier Test",
      shopifySupplierTagConfirmed: true,
      requestedDeliveryDate: "2026-07-30",
      paymentDecisionStatus: "paid_confirmed",
    });

    assert.equal(assigned.assignedSupplier, "special");
    assert.equal(assigned.specialSupplierName, "Supplier Test");
    assert.equal(assigned.shopifyTagValue, null);
    assert.equal(assigned.shopifyTagSyncStatus, "skipped");
    assert.equal(assigned.shopifyTagError, null);
  });

  assert.equal(externalWriteCount, 0);
  assert.equal(attemptMetadata[0]?.shopify_supplier_tag_confirmed, true);
});

test("supplier assignment duplicate attempt does not rerun projections", async () => {
  let supplierSalePatchCount = 0;
  let attemptPostCount = 0;
  let trelloPostCount = 0;
  const assignedRow = saleRow({
    assigned_supplier: "said",
    assignment_status: "assigned",
    supplier_due_date: "2026-06-20",
    trello_projection_status: "synced",
    supplier_trello_card_id: "trello-existing",
    supplier_trello_card_url: "https://trello.test/c/existing",
    task_sync_status: "synced",
    active_task_id: "task-existing",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      trelloPostCount += 1;
      return Response.json({ id: "trello-new", url: "https://trello.test/c/new" });
    }
    assert.equal(url.origin, "https://supabase.test");

    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      return Response.json([assignedRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") {
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "POST") {
      attemptPostCount += 1;
      return Response.json({ message: "duplicate attempt" }, { status: 409 });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      supplierSalePatchCount += 1;
      return Response.json([assignedRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      return Response.json({ message: "duplicate event" }, { status: 409 });
    }
    return Response.json([]);
  }, async () => {
    const sale = await assignSupplierSale({
      saleId: "sale-1",
      supplier: "said",
      requestedDeliveryDate: "2026-06-20",
      paymentDecisionStatus: "paid_confirmed",
      operatorName: "Fabienne",
    });

    assert.equal(sale.supplierTrelloCardId, "trello-existing");
  });

  assert.equal(attemptPostCount, 1);
  assert.equal(supplierSalePatchCount, 0);
  assert.equal(trelloPostCount, 0);
});

test("supplier assignment finds Shopify order by offer reference before tagging", async () => {
  let shopifyLookupCount = 0;
  let shopifyTagCount = 0;
  let assignmentTaskWriteCount = 0;
  let currentRow = saleRow({
    id: "sale-offer-shopify-lookup",
    sale_key: "offer:offer-shopify-lookup",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-shopify-lookup",
    offer_number: "A/N 15101",
    document_reference: "A-N-15101-ABCDEF",
    customer_name: "Mia Muster",
    customer_email: "mia@example.com",
    assignment_status: "ready_to_assign",
    payment_decision_status: "manual_approved_unpaid",
    active_task_id: "task-existing",
    task_sync_status: "synced",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(body.query || "").includes("orders(")) {
        shopifyLookupCount += 1;
        assert.equal(body.variables.query, "A-N-15101-ABCDEF");
        return Response.json({
          data: {
            orders: {
              nodes: [{ id: "gid://shopify/Order/987654321", name: "#1234", email: "mia@example.com", tags: [] }],
            },
          },
        });
      }
      shopifyTagCount += 1;
      assert.equal(body.variables.id, "gid://shopify/Order/987654321");
      assert.deepEqual(body.variables.tags, ["Quentin (noch bezahlen)"]);
      return Response.json({ data: { tagsAdd: { node: { id: "gid://shopify/Order/987654321" }, userErrors: [] } } });
    }

    assert.equal(url.origin, "https://supabase.test");
    if ((url.pathname.endsWith("/ops_internal_tasks") || url.pathname.endsWith("/sales_tasks")) && method === "POST") {
      assignmentTaskWriteCount += 1;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "PATCH") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const sale = await assignSupplierSale({
      saleId: currentRow.id,
      supplier: "quentin",
      requestedDeliveryDate: "2026-07-13",
      paymentDecisionStatus: "manual_approved_unpaid",
      operatorName: "Ops",
    });

    assert.equal(sale.assignmentStatus, "assigned");
    assert.equal(sale.shopifyOrderId, "gid://shopify/Order/987654321");
    assert.equal(sale.shopifyTagSyncStatus, "synced");
    assert.equal(sale.shopifyTagError, null);
    assert.equal(sale.taskSyncStatus, "skipped");
    assert.equal(sale.activeTaskId, null);
  });

  assert.equal(shopifyLookupCount, 1);
  assert.equal(shopifyTagCount, 1);
  assert.equal(assignmentTaskWriteCount, 0);
});

test("supplier assignment is allowed while post-order review window is open", async () => {
  let attemptPostCount = 0;
  let trelloPostCount = 0;
  let currentRow = saleRow({
    id: "sale-open-post-order-review",
    source: "neontrip-offers",
    payment_decision_status: "paid_confirmed",
    assignment_status: "ready_to_assign",
    metadata: {
      post_order_review: {
        status: "open",
        signedAt: "2026-06-16T13:44:30.000Z",
        expiresAt: "2099-06-17T13:44:30.000Z",
      },
    },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "api.trello.com") {
      trelloPostCount += 1;
      return Response.json({ id: "trello-open-review", url: "https://trello.test/c/open-review" });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "POST") {
      attemptPostCount += 1;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_assignment_attempts") && method === "PATCH") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    return Response.json([]);
  }, async () => {
    const sale = await assignSupplierSale({
      saleId: currentRow.id,
      supplier: "said",
      requestedDeliveryDate: "2026-07-13",
      paymentDecisionStatus: "paid_confirmed",
      operatorName: "Ops",
    });

    assert.equal(sale.assignmentStatus, "assigned");
    assert.equal(sale.assignedSupplier, "said");
    assert.equal(sale.trelloProjectionStatus, "skipped");
    assert.equal(sale.supplierTrelloCardId, null);
    assert.equal(sale.postOrderReview.status, "open");
  });

  assert.equal(attemptPostCount, 1);
  assert.equal(trelloPostCount, 0);
});

test("supplier assignment task cleanup archives only supplier sale projections", async () => {
  let dedicatedPatchCount = 0;
  let fallbackPatchCount = 0;
  let supplierSalesPatchCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");

    if (url.pathname.endsWith("/ops_internal_tasks") && method === "GET") {
      assert.equal(url.searchParams.get("source_app"), "eq.supplier_sales");
      assert.equal(url.searchParams.get("source_ref"), "like.supplier_sale:%");
      assert.equal(url.searchParams.get("status"), "in.(open,in_progress,waiting)");
      return Response.json([{ id: "task-dedicated-1" }, { id: "task-dedicated-2" }]);
    }
    if (url.pathname.endsWith("/ops_internal_tasks") && method === "PATCH") {
      dedicatedPatchCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.status, "archived");
      assert.equal(url.searchParams.get("id"), "in.(task-dedicated-1,task-dedicated-2)");
      return Response.json({});
    }

    if (url.pathname.endsWith("/sales_tasks") && method === "GET") {
      assert.equal(url.searchParams.get("source"), "eq.ops_internal");
      assert.equal(url.searchParams.get("source_ref"), "like.supplier_sale:%");
      assert.equal(url.searchParams.get("status"), "in.(open,waiting,blocked)");
      return Response.json([{ id: "task-fallback-1" }]);
    }
    if (url.pathname.endsWith("/sales_tasks") && method === "PATCH") {
      fallbackPatchCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.status, "closed");
      assert.equal(url.searchParams.get("id"), "in.(task-fallback-1)");
      return Response.json({});
    }

    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      assert.equal(url.searchParams.get("active_task_id"), "not.is.null");
      return Response.json([{ id: "sale-task-1" }, { id: "sale-task-2" }]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      supplierSalesPatchCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.active_task_id, null);
      assert.equal(body.task_sync_status, "skipped");
      assert.equal(url.searchParams.get("id"), "in.(sale-task-1,sale-task-2)");
      return Response.json({});
    }

    return Response.json([]);
  }, async () => {
    const result = await cleanupSupplierAssignmentTasks();
    assert.deepEqual(result, {
      archivedDedicatedTasks: 2,
      closedFallbackTasks: 1,
      clearedSales: 2,
    });
  });

  assert.equal(dedicatedPatchCount, 1);
  assert.equal(fallbackPatchCount, 1);
  assert.equal(supplierSalesPatchCount, 1);
});

test("supplier sales active board hides rows already tagged in Shopify and uses bounded limit", async () => {
  const unassignedRow = saleRow({
    id: "sale-visible",
    sale_key: "shopify:order:visible",
    shopify_order_id: "visible",
    shopify_order_name: "#2001",
    primary_image_url: null,
    metadata: {},
    raw_shopify: { tags: [], statusPageUrl: "https://shopify.test/orders/visible/status" },
  });
  const taggedRow = saleRow({
    id: "sale-tagged",
    sale_key: "shopify:order:tagged",
    shopify_order_id: "tagged",
    shopify_order_name: "#2002",
    assignment_status: "ready_to_assign",
    assigned_supplier: null,
    shopify_tag_value: null,
    shopify_tag_sync_status: "not_started",
    raw_shopify: { tags: ["Quentin (schon bezahlt)"] },
  });
  const internalRow = saleRow({
    id: "sale-internal",
    sale_key: "shopify:order:internal",
    shopify_order_id: "internal",
    shopify_order_name: "#INTERNAL",
    assignment_status: "payment_open",
    raw_shopify: { tags: ["internal_only", "do_not_fulfill"] },
  });
  const fulfilledRow = saleRow({
    id: "sale-fulfilled",
    sale_key: "shopify:order:fulfilled",
    shopify_order_id: "fulfilled",
    shopify_order_name: "#2003",
    assignment_status: "ready_to_assign",
    raw_shopify: { tags: [], displayFulfillmentStatus: "FULFILLED" },
  });
  const similarTagRow = saleRow({
    id: "sale-similar-tag",
    sale_key: "shopify:order:similar-tag",
    shopify_order_id: "similar-tag",
    shopify_order_name: "#2004",
    assignment_status: "ready_to_assign",
    raw_shopify: { tags: ["Quentin - schon bezahlt"] },
  });
  const assignedTaggedRow = saleRow({
    id: "sale-assigned-tagged",
    sale_key: "shopify:order:assigned-tagged",
    shopify_order_id: "assigned-tagged",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    shopify_tag_sync_status: "failed",
    trello_projection_status: "skipped",
    raw_shopify: { tags: ["Quentin (noch zahlen)"] },
  });
  const assignedSaidTaggedRow = saleRow({
    id: "sale-assigned-said-tagged",
    sale_key: "shopify:order:assigned-said-tagged",
    shopify_order_id: "assigned-said-tagged",
    assignment_status: "assigned",
    assigned_supplier: "said",
    shopify_tag_sync_status: "failed",
    trello_projection_status: "skipped",
    raw_shopify: { tags: ["Saed"] },
  });
  const assignedWithoutTagRow = saleRow({
    id: "sale-assigned-without-tag",
    sale_key: "shopify:order:assigned-without-tag",
    shopify_order_id: "assigned-without-tag",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    shopify_tag_sync_status: "failed",
    trello_projection_status: "skipped",
    raw_shopify: { tags: [] },
  });
  const supplierSalesGetLimits: string[] = [];
  let itemSaleFilter: string | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      const limit = url.searchParams.get("limit");
      supplierSalesGetLimits.push(limit || "");
      if (limit === "200") assert.equal(url.searchParams.get("assignment_status"), "not.in.(completed,canceled)");
      return Response.json([
        internalRow,
        taggedRow,
        fulfilledRow,
        similarTagRow,
        assignedTaggedRow,
        assignedSaidTaggedRow,
        assignedWithoutTagRow,
        unassignedRow,
      ]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      itemSaleFilter = url.searchParams.get("sale_id");
      return Response.json([
        itemRow({ sale_id: unassignedRow.id, image_url: "https://cdn.test/item-fallback.jpg" }),
        itemRow({ id: "item-similar", sale_id: similarTagRow.id }),
      ]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    assert.deepEqual(
      new Set(board.items.map((item) => item.id)),
      new Set(["sale-visible", "sale-similar-tag", "sale-assigned-without-tag"]),
    );
    const visible = board.items.find((item) => item.id === "sale-visible");
    assert.equal(visible?.primaryImageUrl, "https://cdn.test/item-fallback.jpg");
    assert.equal(visible?.paymentLink, "https://shopify.test/orders/visible/status");
  });

  assert.deepEqual(supplierSalesGetLimits, ["2000", "200"]);
  assert.equal(itemSaleFilter, "in.(sale-similar-tag,sale-assigned-without-tag,sale-visible)");
});

test("supplier production completion is fail-closed and remains visible for exactly ten minutes", () => {
  const confirmedAt = "2026-07-22T12:00:00.000Z";
  const sale = buildSupplierSaleBoardFromRows([
    saleRow({
      assignment_status: "assigned",
      assigned_supplier: "quentin",
      shopify_tag_sync_status: "synced",
      trello_projection_status: "synced",
      supplier_trello_card_id: "trello-confirmed",
      supplier_trello_card_url: "https://trello.test/c/confirmed",
    }),
  ], []).items[0];
  assert.ok(sale);
  assert.equal(supplierSaleShopifyConfirmed(sale), true);
  assert.equal(supplierSaleTrelloConfirmed(sale), true);
  assert.equal(supplierSaleReadyForProduction(sale), true);

  const missingTrello = { ...sale, trelloProjectionStatus: "failed" as const, supplierTrelloCardId: null, supplierTrelloCardUrl: null };
  assert.equal(supplierSaleReadyForProduction(missingTrello), false);

  const specialWithoutConfirmation = { ...sale, assignedSupplier: "special" as const, shopifyTagSyncStatus: "skipped" as const, manualShopifySupplierTagConfirmedAt: null };
  assert.equal(supplierSaleShopifyConfirmed(specialWithoutConfirmation), false);
  assert.equal(supplierSaleShopifyConfirmed({ ...specialWithoutConfirmation, manualShopifySupplierTagConfirmedAt: confirmedAt }), true);

  const inProduction = { ...sale, assignmentStatus: "in_production" as const, productionConfirmedAt: confirmedAt };
  assert.equal(supplierSaleCompletionHideAt(inProduction), "2026-07-22T12:10:00.000Z");
  assert.equal(supplierSaleVisibleInActiveOverview(inProduction, new Date("2026-07-22T12:09:59.999Z")), true);
  assert.equal(supplierSaleVisibleInActiveOverview(inProduction, new Date("2026-07-22T12:10:00.000Z")), false);
});

test("supplier sales active board hides fully assigned rows but keeps failed assignments and recent production confirmations", async () => {
  const now = Date.now();
  const assigned = saleRow({
    id: "sale-assigned-hidden",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    shopify_tag_sync_status: "synced",
    trello_projection_status: "synced",
    supplier_trello_card_id: "assigned-card",
    supplier_trello_card_url: "https://trello.test/c/assigned-card",
  });
  const failedAssignment = saleRow({
    id: "sale-assigned-failed-visible",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    shopify_tag_sync_status: "synced",
    trello_projection_status: "failed",
  });
  const recentProduction = saleRow({
    id: "sale-production-recent",
    assignment_status: "in_production",
    assigned_supplier: "quentin",
    metadata: { production_confirmed_at: new Date(now - 9 * 60 * 1000).toISOString() },
  });
  const expiredProduction = saleRow({
    id: "sale-production-expired",
    assignment_status: "in_production",
    assigned_supplier: "quentin",
    metadata: { production_confirmed_at: new Date(now - 11 * 60 * 1000).toISOString() },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      return Response.json([assigned, failedAssignment, recentProduction, expiredProduction]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    assert.deepEqual(new Set(board.items.map((item) => item.id)), new Set([failedAssignment.id, recentProduction.id]));
  });
});

test("production confirmation is persisted once and duplicate clicks are idempotent", async () => {
  let currentRow = saleRow({
    id: "sale-production-confirm",
    assignment_status: "assigned",
    assigned_supplier: "quentin",
    assigned_at: "2026-07-22T12:00:00.000Z",
    shopify_tag_sync_status: "synced",
    trello_projection_status: "synced",
    supplier_trello_card_id: "trello-production-confirm",
    supplier_trello_card_url: "https://trello.test/c/production-confirm",
  });
  let patchCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      patchCount += 1;
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    return Response.json([]);
  }, async () => {
    const first = await markSupplierSaleInProduction({ saleId: currentRow.id, operatorName: "Rahim" });
    assert.equal(first.assignmentStatus, "in_production");
    assert.ok(first.productionConfirmedAt);
    assert.equal(first.productionConfirmedBy, "Rahim");

    const second = await markSupplierSaleInProduction({ saleId: currentRow.id, operatorName: "Rahim" });
    assert.equal(second.productionConfirmedAt, first.productionConfirmedAt);
  });

  assert.equal(patchCount, 1);
});

test("supplier sales board reads payment link from offer snapshot fallback", async () => {
  const snapshotPaymentRow = saleRow({
    id: "sale-snapshot-payment",
    sale_key: "offer:snapshot-payment",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    raw_shopify: {},
    metadata: {},
    offer_snapshot: {
      shopifyOrder: {
        statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/snapshot-payment/status",
      },
    },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([snapshotPaymentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: snapshotPaymentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    assert.equal(board.items[0]?.paymentLink, "https://galaxybuzzdk.myshopify.com/orders/snapshot-payment/status");
  });
});

test("supplier sales board marks unpaid active rows when the same customer paid before", async () => {
  const repeatOpenRow = saleRow({
    id: "sale-repeat-open",
    sale_key: "offer:repeat-open",
    customer_email: "repeat@example.com",
    customer_name: "Repeat Customer",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-21T10:00:00.000Z",
    updated_at: "2026-06-21T10:00:00.000Z",
  });
  const newOpenRow = saleRow({
    id: "sale-new-open",
    sale_key: "offer:new-open",
    customer_email: "new@other.test",
    customer_name: "New Customer",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-22T10:00:00.000Z",
    updated_at: "2026-06-22T10:00:00.000Z",
  });
  const priorPaidRow = saleRow({
    id: "sale-repeat-paid-before",
    sale_key: "shopify:order:repeat-before",
    customer_email: "repeat@example.com",
    customer_name: "Repeat Customer",
    shopify_order_name: "#9001",
    shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/9001",
    shopify_payment_status: "paid",
    payment_decision_status: "paid_confirmed",
    assignment_status: "completed",
    created_at: "2026-05-20T10:00:00.000Z",
    updated_at: "2026-05-20T10:00:00.000Z",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("or") === "(shopify_payment_status.eq.paid,payment_decision_status.eq.paid_confirmed)") {
        return Response.json([priorPaidRow]);
      }
      return Response.json([newOpenRow, repeatOpenRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    assert.deepEqual(board.items.map((item) => item.id), ["sale-repeat-open", "sale-new-open"]);
    assert.equal(board.items[0]?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(board.items[0]?.priorPaidCustomer.lastPaidOrderName, "#9001");
    assert.equal(board.items[0]?.priorPaidCustomer.lastPaidOrderUrl, "https://galaxybuzzdk.myshopify.com/admin/orders/9001");
    assert.equal(board.counts.priorPaidCustomerOpen, 1);
  });
});

test("supplier sales board finds prior paid Shopify orders through a real exact-email filter", async () => {
  const repeatOpenRow = saleRow({
    id: "sale-repeat-email-open",
    sale_key: "shopify:NEONT4586",
    customer_email: "nadine.mohamed@wearesocial.net",
    customer_name: "Nadine Mohamed",
    shopify_order_name: "#NEONT4586",
    shopify_payment_status: "pending",
    payment_decision_status: "pending",
    assignment_status: "payment_open",
    created_at: "2026-08-11T13:51:22.683Z",
    updated_at: "2026-08-12T09:41:48.442Z",
  });
  let exactEmailFilter: string | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("or") === "(shopify_payment_status.eq.paid,payment_decision_status.eq.paid_confirmed)") {
        return Response.json([]);
      }
      return Response.json([repeatOpenRow]);
    }
    if (url.pathname.endsWith("/v_orders_by_email") && method === "GET") {
      const filter = url.searchParams.get("email");
      if (filter) {
        exactEmailFilter = filter;
        if (filter === "in.(nadine.mohamed@wearesocial.net)") {
          return Response.json([
            {
              email: "nadine.mohamed@wearesocial.net",
              order_number: "#NEONT3520",
              financial_status: "paid",
              created_at: "2025-07-29T14:02:00.000Z",
            },
          ]);
        }
      }
      return Response.json([]);
    }
    if (url.pathname.endsWith("/crm_sales") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    const sale = board.items.find((item) => item.id === repeatOpenRow.id);
    assert.equal(exactEmailFilter, "in.(nadine.mohamed@wearesocial.net)");
    assert.equal(exactEmailFilter?.includes("%40"), false);
    assert.equal(sale?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(sale?.priorPaidCustomer.matchBasis, "exact_email");
    assert.equal(sale?.priorPaidCustomer.lastPaidOrderName, "#NEONT3520");
    assert.equal(board.counts.priorPaidCustomerOpen, 1);
  });
});

test("supplier sales board uses internal paid history by business domain and customer name", async () => {
  const businessOpenRow = saleRow({
    id: "sale-internal-business-open",
    sale_key: "offer:internal-business-open",
    customer_email: "buyer@company.test",
    customer_name: "Business Buyer",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-24T10:00:00.000Z",
    updated_at: "2026-06-24T10:00:00.000Z",
  });
  const nameOpenRow = saleRow({
    id: "sale-internal-name-open",
    sale_key: "offer:internal-name-open",
    customer_email: null,
    customer_name: "Filippo Melena",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-23T10:00:00.000Z",
    updated_at: "2026-06-23T10:00:00.000Z",
  });
  const paidDomainRow = saleRow({
    id: "sale-internal-business-paid-before",
    sale_key: "shopify:order:internal-business-before",
    customer_email: "finance@company.test",
    customer_name: "Company Finance",
    shopify_order_id: "9002",
    shopify_order_name: "#9002",
    shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/9002",
    shopify_payment_status: "paid",
    payment_decision_status: "paid_confirmed",
    assignment_status: "completed",
    created_at: "2026-05-20T10:00:00.000Z",
    updated_at: "2026-05-20T10:00:00.000Z",
  });
  const paidNameRow = saleRow({
    id: "sale-internal-name-paid-before",
    sale_key: "shopify:order:internal-name-before",
    customer_email: "old.email@example.test",
    customer_name: "Filippo Melena",
    shopify_order_id: "9003",
    shopify_order_name: "#9003",
    shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/9003",
    shopify_payment_status: "paid",
    payment_decision_status: "paid_confirmed",
    assignment_status: "completed",
    created_at: "2026-05-21T10:00:00.000Z",
    updated_at: "2026-05-21T10:00:00.000Z",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      const or = url.searchParams.get("or") || "";
      if (or.includes("customer_email.ilike")) return Response.json([paidDomainRow]);
      if (or.includes("customer_name.ilike")) return Response.json([paidNameRow]);
      if (or === "(shopify_payment_status.eq.paid,payment_decision_status.eq.paid_confirmed)") return Response.json([]);
      return Response.json([businessOpenRow, nameOpenRow]);
    }
    if (url.pathname.endsWith("/v_orders_by_email") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/crm_sales") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    const byId = new Map(board.items.map((item) => [item.id, item]));
    assert.equal(byId.get("sale-internal-business-open")?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(byId.get("sale-internal-business-open")?.priorPaidCustomer.matchBasis, "company_domain");
    assert.equal(byId.get("sale-internal-business-open")?.priorPaidCustomer.lastPaidOrderName, "#9002");
    assert.equal(byId.get("sale-internal-business-open")?.priorPaidCustomer.lastPaidOrderUrl, "https://galaxybuzzdk.myshopify.com/admin/orders/9002");
    assert.equal(byId.get("sale-internal-name-open")?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(byId.get("sale-internal-name-open")?.priorPaidCustomer.matchBasis, "customer_name");
    assert.equal(byId.get("sale-internal-name-open")?.priorPaidCustomer.lastPaidOrderName, "#9003");
    assert.equal(board.counts.priorPaidCustomerOpen, 2);
  });
});

test("supplier sales board uses Shopify paid history by business domain, exact private email and name", async () => {
  const businessOpenRow = saleRow({
    id: "sale-business-open",
    sale_key: "offer:business-open",
    customer_email: "buyer@company.test",
    customer_name: "Business Buyer",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-24T10:00:00.000Z",
    updated_at: "2026-06-24T10:00:00.000Z",
  });
  const privateExactOpenRow = saleRow({
    id: "sale-private-exact-open",
    sale_key: "offer:private-exact-open",
    customer_email: "buyer@gmail.com",
    customer_name: "Private Exact",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-23T10:00:00.000Z",
    updated_at: "2026-06-23T10:00:00.000Z",
  });
  const privateDomainOnlyOpenRow = saleRow({
    id: "sale-private-domain-open",
    sale_key: "offer:private-domain-open",
    customer_email: "someone@gmail.com",
    customer_name: "Private Domain Only",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-25T10:00:00.000Z",
    updated_at: "2026-06-25T10:00:00.000Z",
  });
  const nameOpenRow = saleRow({
    id: "sale-name-open",
    sale_key: "offer:name-open",
    customer_email: null,
    customer_name: "Filippo Melena",
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    created_at: "2026-06-22T10:00:00.000Z",
    updated_at: "2026-06-22T10:00:00.000Z",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("or") === "(shopify_payment_status.eq.paid,payment_decision_status.eq.paid_confirmed)") {
        return Response.json([]);
      }
      return Response.json([privateDomainOnlyOpenRow, businessOpenRow, privateExactOpenRow, nameOpenRow]);
    }
    if (url.pathname.endsWith("/v_orders_by_email") && method === "GET") {
      return Response.json([
        { email: "finance@company.test", order_number: "#BIZ-OLD", financial_status: "paid", created_at: "2026-05-01T10:00:00.000Z" },
        { email: "other@gmail.com", order_number: "#GMAIL-OTHER", financial_status: "paid", created_at: "2026-05-02T10:00:00.000Z" },
        { email: "buyer@gmail.com", order_number: "#GMAIL-EXACT", financial_status: "paid", created_at: "2026-05-03T10:00:00.000Z" },
      ]);
    }
    if (url.pathname.endsWith("/crm_sales") && method === "GET") {
      return Response.json([
        {
          id: "crm-paid-name",
          shopify_order_id: "123456789",
          shopify_order_name: "#NAME-OLD",
          financial_status: "paid",
          customer_name: "Filippo Melena",
          customer_email: "old.customer@example.test",
          shopify_created_at: "2026-05-04T10:00:00.000Z",
          created_at: "2026-05-04T10:00:00.000Z",
        },
      ]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active" });
    const byId = new Map(board.items.map((item) => [item.id, item]));
    assert.equal(byId.get("sale-business-open")?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(byId.get("sale-business-open")?.priorPaidCustomer.matchBasis, "company_domain");
    assert.equal(byId.get("sale-business-open")?.priorPaidCustomer.lastPaidOrderName, "#BIZ-OLD");
    assert.equal(byId.get("sale-business-open")?.priorPaidCustomer.lastPaidOrderUrl, "https://neontrip.myshopify.com/admin/orders?query=%23BIZ-OLD");
    assert.equal(byId.get("sale-private-exact-open")?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(byId.get("sale-private-exact-open")?.priorPaidCustomer.matchBasis, "exact_email");
    assert.equal(byId.get("sale-private-domain-open")?.priorPaidCustomer.hasPriorPaidOrder, false);
    assert.equal(byId.get("sale-name-open")?.priorPaidCustomer.hasPriorPaidOrder, true);
    assert.equal(byId.get("sale-name-open")?.priorPaidCustomer.matchBasis, "customer_name");
    assert.equal(byId.get("sale-name-open")?.priorPaidCustomer.lastPaidOrderUrl, "https://neontrip.myshopify.com/admin/orders/123456789");
    assert.equal(board.counts.priorPaidCustomerOpen, 3);
  });
});

test("supplier sales board filters express and rush orders", async () => {
  const rushRow = saleRow({
    id: "sale-rush",
    sale_key: "shopify:order:rush",
    product_summary: "Eilauftrag LED Neon Logo",
    raw_shopify: { tags: [] },
  });
  const standardRow = saleRow({
    id: "sale-standard",
    sale_key: "shopify:order:standard",
    product_summary: "Standard LED Neon Logo",
    raw_shopify: { tags: [] },
  });
  const supplierSalesGetLimits: string[] = [];
  let itemSaleFilter: string | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      supplierSalesGetLimits.push(url.searchParams.get("limit") || "");
      return Response.json([standardRow, rushRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      itemSaleFilter = url.searchParams.get("sale_id");
      return Response.json([itemRow({ sale_id: rushRow.id })]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    const board = await listSupplierSalesBoard({ scope: "active", urgency: "rush" });
    assert.deepEqual(board.items.map((item) => item.id), ["sale-rush"]);
    assert.equal(board.items[0]?.rushOrder, true);
    assert.equal(board.counts.rushOrders, 1);
    assert.equal(board.counts.readyToAssign, 1);
  });

  assert.deepEqual(supplierSalesGetLimits, ["2000", "200"]);
  assert.equal(itemSaleFilter, "in.(sale-rush)");
});

test("supplier Shopify tag retry resolves existing assigned offer sale", async () => {
  let shopifyLookupCount = 0;
  let shopifyTagCount = 0;
  let currentRow = saleRow({
    id: "sale-offer-shopify-retry",
    sale_key: "offer:offer-shopify-retry",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-shopify-retry",
    offer_number: "A/N 15102",
    document_reference: "A-N-15102-ABCDEF",
    customer_name: "Mia Muster",
    customer_email: "mia@example.com",
    assigned_supplier: "quentin",
    assignment_status: "assigned",
    shopify_tag_value: "Quentin (schon bezahlt)",
    shopify_tag_sync_status: "skipped",
    shopify_tag_error: "Shopify Order-ID fehlt.",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(body.query || "").includes("orders(")) {
        shopifyLookupCount += 1;
        assert.equal(body.variables.query, "A-N-15102-ABCDEF");
        return Response.json({
          data: {
            orders: {
              nodes: [{ id: "gid://shopify/Order/987654322", name: "#1235", email: "mia@example.com", tags: [] }],
            },
          },
        });
      }
      shopifyTagCount += 1;
      assert.equal(body.variables.id, "gid://shopify/Order/987654322");
      assert.deepEqual(body.variables.tags, ["Quentin (noch bezahlen)"]);
      return Response.json({ data: { tagsAdd: { node: { id: "gid://shopify/Order/987654322" }, userErrors: [] } } });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const sale = await retrySupplierSaleShopifyTag({ saleId: currentRow.id, operatorName: "Ops" });

    assert.equal(sale.shopifyOrderId, "gid://shopify/Order/987654322");
    assert.equal(sale.shopifyTagSyncStatus, "synced");
    assert.equal(sale.shopifyTagError, null);
  });

  assert.equal(shopifyLookupCount, 1);
  assert.equal(shopifyTagCount, 1);
});

test("supplier payment reminder duplicate reservation does not resend webhook", async () => {
  let reminderReservationCount = 0;
  let reminderWebhookCount = 0;
  let supplierSalePatchCount = 0;
  const pendingRow = saleRow({
    shopify_payment_status: "pending",
    payment_decision_status: "wait_for_payment",
    assignment_status: "payment_open",
    customer_email: "kunde@example.com",
    metadata: { payment_link: "https://pay.test/order-1" },
    payment_reminder_count: 1,
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://reminder.test") {
      reminderWebhookCount += 1;
      return Response.json({ messageId: "msg-new" });
    }
    assert.equal(url.origin, "https://supabase.test");

    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      return Response.json([pendingRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") {
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") {
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_payment_reminders") && method === "POST") {
      reminderReservationCount += 1;
      return Response.json({ message: "duplicate reminder" }, { status: 409 });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      supplierSalePatchCount += 1;
      return Response.json([pendingRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL = "https://reminder.test/send";
    const sale = await requestSupplierPaymentReminder({
      saleId: "sale-1",
      recipientEmail: "kunde@example.com",
      paymentLink: "https://pay.test/order-1",
      operatorName: "Fabienne",
      idempotencyKey: "reminder:sale-1:today",
    });

    assert.equal(sale.paymentReminderCount, 1);
  });

  assert.equal(reminderReservationCount, 1);
  assert.equal(reminderWebhookCount, 0);
  assert.equal(supplierSalePatchCount, 0);
});

test("completed offers pull imports offer.completed payloads idempotently", async () => {
  let offersFeedCount = 0;
  let salePostCount = 0;
  let itemPostCount = 0;
  let eventPostCount = 0;
  const importedRow = saleRow({
    id: "sale-completed-offer",
    sale_key: "offer:offer-completed-1",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-completed-1",
    offer_number: "A/N 15099",
    document_reference: "A-N-15099",
    customer_name: "Mia Muster",
    customer_email: "mia@example.com",
    total_price: 595,
    supplier_due_date: "2026-06-30",
    assignment_status: "payment_open",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") {
      offersFeedCount += 1;
      assert.equal(url.pathname, "/api/internal/offers/completed-sales");
      assert.equal(init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string>).Authorization, "Bearer internal-offers-key");
      return Response.json({
        ok: true,
        sales: [{
          offerId: "offer-completed-1",
          payload: {
            source: "neontrip-offers",
            event: "offer.completed",
            idempotencyKey: "offer:offer-completed-1:supplier-sales:v1",
            deliveryDateIso: "2026-06-30",
            offer: {
              id: "offer-completed-1",
              offerNumber: "A/N 15099",
              documentReference: "A-N-15099",
              publicUrl: "https://angebote.test/offer/public-token",
              finalPdfUrl: "https://angebote.test/offer/public-token/pdf",
              currency: "EUR",
              acceptedAt: "2026-06-16T08:00:00.000Z",
              signedAt: "2026-06-16T08:00:00.000Z"
            },
            customer: {
              firstName: "Mia",
              lastName: "Muster",
              email: "mia@example.com"
            },
            billingAddress: { name: "Mia Muster" },
            deliveryAddress: { name: "Mia Muster" },
            totals: { subtotalNet: 500, vatAmount: 95, totalGross: 595, vatRate: 19 },
            lineItems: [{
              id: "line-1",
              section: "LED-Neon-Flex",
              title: "LED Neon Logo",
              quantity: 1,
              lineNet: 500,
              lineGross: 595
            }]
          }
        }]
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${importedRow.id}`) return Response.json([importedRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([importedRow]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      return Response.json([importedRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") {
      itemPostCount += 1;
      return Response.json([itemRow({ sale_id: importedRow.id, title: "LED Neon Logo" })]);
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      eventPostCount += 1;
      return Response.json({});
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.checked, 1);
    assert.equal(result.upserted, 1);
    assert.equal(result.failed, 0);
  });

  assert.equal(offersFeedCount, 1);
  assert.equal(salePostCount, 1);
  assert.equal(itemPostCount, 1);
  assert.equal(eventPostCount, 1);
});

test("completed offers pull falls back to service role when the dedicated offers key is rejected", async () => {
  const attemptedAuth: string[] = [];

  await withMockedAssignmentFetch(async (url, init) => {
    assert.equal(url.origin, "https://angebote.test");
    const authorization = init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string>).Authorization;
    attemptedAuth.push(String(authorization || ""));
    if (authorization === "Bearer stale-offers-key") {
      return Response.json({ ok: false, error: { message: "Unauthorized" } }, { status: 401 });
    }
    assert.equal(authorization, "Bearer service-role");
    return Response.json({ ok: true, sales: [], count: 0 });
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "stale-offers-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.checked, 0);
    assert.equal(result.upserted, 0);
    assert.equal(result.warnings.some((warning) => warning.includes("alternativen internen Server-Key")), true);
  });

  assert.deepEqual(attemptedAuth, ["Bearer stale-offers-key", "Bearer service-role"]);
});

test("completed offers sync reports partial when offers import but Shopify fallback fails", async () => {
  let salePostCount = 0;
  const importedRow = saleRow({
    id: "sale-partial-completed-offer",
    sale_key: "offer:offer-partial-1",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-partial-1",
    offer_number: "A/N 15999",
    document_reference: "A-N-15999",
    customer_email: "partial@example.com",
    total_price: 806,
    assignment_status: "payment_open",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") {
      return Response.json({
        ok: true,
        sales: [{
          offerId: "offer-partial-1",
          payload: {
            source: "neontrip-offers",
            event: "offer.completed",
            idempotencyKey: "offer:offer-partial-1:supplier-sales:v1",
            offer: {
              id: "offer-partial-1",
              offerNumber: "A/N 15999",
              documentReference: "A-N-15999",
              currency: "EUR",
              acceptedAt: "2026-06-29T08:00:00.000Z",
            },
            customer: { email: "partial@example.com" },
            totals: { totalGross: 806 },
            lineItems: [{ id: "line-1", title: "LED Neon Logo", quantity: 1, lineGross: 806 }],
          },
        }],
      });
    }
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({ errors: [{ message: "Shopify temporarily unavailable" }] }, { status: 500 });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${importedRow.id}`) return Response.json([importedRow]);
      if (url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)") return Response.json([]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([importedRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "partial", JSON.stringify(result));
    assert.equal(result.sources?.completedOffers.upserted, 1);
    assert.equal(result.sources?.shopifyOrders.failed, 1);
    assert.equal(result.upserted, 1);
    assert.equal(result.failed, 1);
  });

  assert.equal(salePostCount, 1);
});

test("completed offers sync imports recent Shopify orders as fallback", async () => {
  let shopifyOrderLookupCount = 0;
  let salePostCount = 0;
  const importedRow = saleRow({
    id: "sale-shopify-fallback",
    sale_key: "shopify:order:987654321",
    source: "shopify",
    shopify_order_id: "987654321",
    shopify_order_name: "#1235",
    customer_name: "Mira Fallback",
    customer_email: "mira@example.com",
    total_price: 238,
    assignment_status: "ready_to_assign",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") {
      return Response.json({ ok: true, sales: [], count: 0 });
    }
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      shopifyOrderLookupCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.match(body.variables.query, /^created_at:>=20\d{2}-\d{2}-\d{2}$/);
      assert.doesNotMatch(body.query, /billingAddress\s*\{[^}]*\bemail\b/);
      assert.doesNotMatch(body.query, /shippingAddress\s*\{[^}]*\bemail\b/);
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654321",
              name: "#1235",
              email: "mira@example.com",
              statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/987654321/status",
              createdAt: "2026-06-16T12:30:00Z",
              processedAt: "2026-06-16T12:31:00Z",
              displayFinancialStatus: "PAID",
              customAttributes: [{ key: "deadline", value: "2026-06-28" }],
              totalPriceSet: { shopMoney: { amount: "238.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "200.00", currencyCode: "EUR" } },
              customer: { firstName: "Mira", lastName: "Fallback", email: "mira@example.com", phone: null },
              billingAddress: { name: "Mira Fallback", company: null, email: "mira@example.com", phone: null, address1: null, address2: null, city: null, zip: null, country: "Germany", countryCodeV2: "DE" },
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/1",
                  title: "LED Neon Logo",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: { url: "https://cdn.test/shopify.jpg" },
                  product: { productType: "LED-Neon-Flex" },
                }],
              },
            }],
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${importedRow.id}`) return Response.json([importedRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.source, "shopify");
      assert.equal(payload.shopify_order_id, "987654321");
      assert.equal(payload.shopify_payment_status, "paid");
      assert.equal(payload.customer_due_date, "2026-06-28");
      assert.equal(payload.metadata?.payment_link, "https://galaxybuzzdk.myshopify.com/orders/987654321/status");
      return Response.json([importedRow]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") return Response.json([importedRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: importedRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.checked, 1);
    assert.equal(result.upserted, 1);
    assert.equal(result.sources?.completedOffers.checked, 0);
    assert.equal(result.sources?.shopifyOrders.checked, 1);
  });

  assert.equal(shopifyOrderLookupCount, 1);
  assert.equal(salePostCount, 1);
});

test("shopify fallback enriches existing completed offer by unique customer email and total", async () => {
  let salePatchCount = 0;
  let salePostCount = 0;
  const existingOfferRow = saleRow({
    id: "sale-offer-payment-link",
    sale_key: "offer:offer-payment-link",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-payment-link",
    offer_number: "A/N 16001",
    document_reference: "A-N-16001",
    customer_name: "Filippo Melena",
    customer_email: "giulian.melena@icloud.com",
    total_price: 806,
    assignment_status: "payment_open",
    metadata: {},
    raw_shopify: {},
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654806",
              name: "#1806",
              email: "giulian.melena@icloud.com",
              statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/987654806/status",
              createdAt: "2026-06-29T08:00:00Z",
              processedAt: "2026-06-29T08:01:00Z",
              displayFinancialStatus: "PENDING",
              displayFulfillmentStatus: "UNFULFILLED",
              customAttributes: [],
              totalPriceSet: { shopMoney: { amount: "806.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "677.31", currencyCode: "EUR" } },
              customer: { firstName: "Filippo", lastName: "Melena", email: "giulian.melena@icloud.com", phone: null },
              billingAddress: null,
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/806",
                  title: "LED Neon Logo",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: null,
                  variant: { image: null },
                  product: { productType: "LED-Neon-Flex" },
                }],
              },
            }],
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("shopify_order_id") === "eq.987654806") return Response.json([]);
      if (
        url.searchParams.get("source") === "eq.neontrip-offers" &&
        url.searchParams.get("shopify_order_id") === "is.null" &&
        url.searchParams.get("customer_email") === "eq.giulian.melena@icloud.com" &&
        url.searchParams.get("total_price") === "eq.806"
      ) {
        return Response.json([existingOfferRow]);
      }
      if (url.searchParams.get("id") === `eq.${existingOfferRow.id}`) {
        return Response.json([{
          ...existingOfferRow,
          source: "shopify",
          shopify_order_id: "987654806",
          shopify_order_name: "#1806",
          shopify_payment_status: "pending",
          shopify_order_url: "https://galaxybuzzdk.myshopify.com/orders/987654806/status",
          metadata: {
            payment_link: "https://galaxybuzzdk.myshopify.com/orders/987654806/status",
            admin_graphql_api_id: "gid://shopify/Order/987654806",
          },
        }]);
      }
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      salePatchCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.shopify_order_id, "987654806");
      assert.equal(payload.shopify_order_name, "#1806");
      assert.equal(payload.metadata?.payment_link, "https://galaxybuzzdk.myshopify.com/orders/987654806/status");
      return Response.json([{ ...existingOfferRow, ...payload }]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: existingOfferRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: existingOfferRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.shopifyOrders.checked, 1);
    assert.equal(result.sources?.shopifyOrders.upserted, 1);
  });

  assert.equal(salePatchCount, 1);
  assert.equal(salePostCount, 0);
});

test("shopify fallback skips missing orders that already have a supplier tag", async () => {
  let salePostCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654333",
              name: "#1236",
              email: "tagged@example.com",
              tags: ["Saeid (schon bezahlt)"],
              createdAt: "2026-06-16T12:40:00Z",
              processedAt: "2026-06-16T12:41:00Z",
              displayFinancialStatus: "PAID",
              customAttributes: [{ key: "deadline", value: "2026-06-29" }],
              totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
              customer: { firstName: "Tagged", lastName: "Sale", email: "tagged@example.com", phone: null },
              billingAddress: null,
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/2",
                  title: "LED Neon Schriftzug",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: null,
                  product: { productType: "LED-Neon-Flex" },
                }],
              },
            }],
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") {
      throw new Error("supplier-tagged Shopify orders must not create sale items");
    }
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.shopifyOrders.checked, 1);
    assert.equal(result.sources?.shopifyOrders.upserted, 0);
    assert.equal(result.sources?.shopifyOrders.skippedSupplierTagged, 1);
    assert.equal(result.upserted, 0);
  });

  assert.equal(salePostCount, 0);
});

test("shopify fallback skips internal incident orders before creating sales", async () => {
  let supplierSalesRequestCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654399",
              name: "#INTERNAL",
              email: "internal@example.com",
              tags: ["internal_only", "do_not_fulfill", "incident_placeholder", "order_gap_repair"],
              createdAt: "2026-06-16T12:40:00Z",
              processedAt: "2026-06-16T12:41:00Z",
              displayFinancialStatus: "PAID",
              displayFulfillmentStatus: "UNFULFILLED",
              customAttributes: [],
              totalPriceSet: { shopMoney: { amount: "1.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "0.84", currencyCode: "EUR" } },
              customer: { firstName: "Internal", lastName: "Incident", email: "internal@example.com", phone: null },
              billingAddress: null,
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/99",
                  title: "Internal placeholder",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: null,
                  variant: { image: null },
                  product: { productType: "Internal" },
                }],
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    if (url.pathname.endsWith("/supplier_sales") && String(init?.method || "GET").toUpperCase() !== "GET") {
      supplierSalesRequestCount += 1;
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.shopifyOrders.checked, 1);
    assert.equal(result.sources?.shopifyOrders.upserted, 0);
    assert.equal(result.sources?.shopifyOrders.skippedInternal, 1);
  });

  assert.equal(supplierSalesRequestCount, 0);
});

test("shopify fallback paginates the complete 90-day window", async () => {
  let recentOrdersPageCalls = 0;
  let saleMutationCount = 0;
  const existingRow = saleRow({
    id: "sale-pagination-existing",
    sale_key: "shopify:order:987654336",
    source: "shopify",
    shopify_order_id: "987654336",
    shopify_order_name: "#1239",
  });

  function graphqlOrder(input: { id: string; name: string; tags?: string[] }) {
    return {
      id: `gid://shopify/Order/${input.id}`,
      name: input.name,
      email: `${input.id}@example.com`,
      tags: input.tags || [],
      createdAt: "2026-06-16T12:40:00Z",
      processedAt: "2026-06-16T12:41:00Z",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      customAttributes: [],
      totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
      subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
      customer: { firstName: "Page", lastName: input.name, email: `${input.id}@example.com`, phone: null },
      billingAddress: null,
      shippingAddress: null,
      lineItems: {
        nodes: [{
          id: `gid://shopify/LineItem/${input.id}`,
          title: "LED Neon Schriftzug",
          sku: null,
          quantity: 1,
          variantTitle: null,
          customAttributes: [],
          image: null,
          variant: { image: null },
          product: { productType: "LED-Neon-Flex" },
        }],
      },
    };
  }

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      const request = JSON.parse(String(init?.body || "{}"));
      if (String(request.query || "").includes("SupplierSalesRecentOrders")) {
        recentOrdersPageCalls += 1;
        assert.equal(request.variables.first, 100);
        assert.match(request.variables.query, /^created_at:>=\d{4}-\d{2}-\d{2}$/);
        if (recentOrdersPageCalls === 1) {
          assert.equal(request.variables.after, null);
          return Response.json({
            data: {
              orders: {
                nodes: [graphqlOrder({ id: "987654335", name: "#1238", tags: ["Saeid (schon bezahlt)"] })],
                pageInfo: { hasNextPage: true, endCursor: "cursor-page-1" },
              },
            },
          });
        }
        assert.equal(request.variables.after, "cursor-page-1");
        return Response.json({
          data: {
            orders: {
              nodes: [graphqlOrder({ id: "987654336", name: "#1239" })],
              pageInfo: { hasNextPage: false, endCursor: "cursor-page-2" },
            },
          },
        });
      }
      return Response.json({ data: { orders: { nodes: [] } } });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("shopify_order_id") === "eq.987654336") return Response.json([existingRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && ["POST", "PATCH"].includes(method)) {
      saleMutationCount += 1;
      return Response.json([]);
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.shopifyOrders.checked, 2);
    assert.equal(result.sources?.shopifyOrders.pagesChecked, 2);
    assert.equal(result.sources?.shopifyOrders.daysBack, 90);
    assert.equal(result.sources?.shopifyOrders.truncated, false);
    assert.equal(result.sources?.shopifyOrders.skippedSupplierTagged, 1);
    assert.equal(result.sources?.shopifyOrders.skippedExisting, 1);
  });

  assert.equal(recentOrdersPageCalls, 2);
  assert.equal(saleMutationCount, 0);
});

test("shopify fallback does not duplicate an order already linked in supplier sales", async () => {
  let saleMutationCount = 0;
  const existingRow = saleRow({
    id: "sale-shopify-existing",
    sale_key: "shopify:order:987654334",
    source: "shopify",
    shopify_order_id: "987654334",
    shopify_order_name: "#1237",
    assignment_status: "completed",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654334",
              name: "#1237",
              email: "existing@example.com",
              tags: [],
              createdAt: "2026-06-16T12:40:00Z",
              processedAt: "2026-06-16T12:41:00Z",
              displayFinancialStatus: "PAID",
              displayFulfillmentStatus: "FULFILLED",
              customAttributes: [],
              totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
              customer: { firstName: "Existing", lastName: "Sale", email: "existing@example.com", phone: null },
              billingAddress: null,
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/3",
                  title: "LED Neon Schriftzug",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: null,
                  variant: { image: null },
                  product: { productType: "LED-Neon-Flex" },
                }],
              },
            }],
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("shopify_order_id") === "eq.987654334") return Response.json([existingRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && ["POST", "PATCH"].includes(method)) {
      saleMutationCount += 1;
      return Response.json([]);
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.shopifyOrders.checked, 1);
    assert.equal(result.sources?.shopifyOrders.upserted, 0);
    assert.equal(result.sources?.shopifyOrders.skippedExisting, 1);
  });

  assert.equal(saleMutationCount, 0);
});

test("shopify fallback matches existing offer sale by offer number and default Quentin tag", async () => {
  let salePatchCount = 0;
  let salePostCount = 0;
  const existingRow = saleRow({
    id: "sale-existing-offer-tagged",
    sale_key: "offer:offer-existing-tagged",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: null,
    offer_number: "A/N 15222",
    document_reference: "A-N-15222-ABCDEF",
    assigned_supplier: null,
    assignment_status: "ready_to_assign",
    shopify_tag_value: null,
    shopify_tag_sync_status: "not_started",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      return Response.json({
        data: {
          orders: {
            nodes: [{
              id: "gid://shopify/Order/987654444",
              name: "#1244",
              email: "tagged@example.com",
              tags: ["Quentin (noch bezahlen)"],
              createdAt: "2026-06-16T12:40:00Z",
              processedAt: "2026-06-16T12:41:00Z",
              statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/status",
              displayFinancialStatus: "PAID",
              customAttributes: [{ key: "NEONTRIP Offer Number", value: "A/N 15222" }],
              totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
              subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
              customer: { firstName: "Tagged", lastName: "Sale", email: "tagged@example.com", phone: null },
              billingAddress: null,
              shippingAddress: null,
              lineItems: {
                nodes: [{
                  id: "gid://shopify/LineItem/2",
                  title: "LED Neon Schriftzug",
                  sku: null,
                  quantity: 1,
                  variantTitle: null,
                  customAttributes: [],
                  image: null,
                  product: { productType: "LED-Neon-Flex" },
                }],
              },
            }],
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("shopify_order_id") === "eq.987654444") return Response.json([]);
      if (url.searchParams.get("offer_number") === "eq.A/N 15222") return Response.json([existingRow]);
      if (url.searchParams.get("id") === `eq.${existingRow.id}`) return Response.json([existingRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      salePatchCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.assigned_supplier, "quentin");
      assert.equal(payload.assignment_status, "assigned");
      assert.equal(payload.shopify_tag_value, "Quentin (noch bezahlen)");
      assert.equal(payload.shopify_tag_sync_status, "synced");
      return Response.json([{ ...existingRow, ...payload }]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([existingRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.upserted, 1);
  });

  assert.equal(salePatchCount, 1);
  assert.equal(salePostCount, 0);
});

test("completed offers sync resolves old unlinked active offer sales by Shopify offer reference", async () => {
  let unlinkedRowsLookupCount = 0;
  let shopifySearchCount = 0;
  let shopifyNodeLookupCount = 0;
  let salePatchCount = 0;
  const existingRow = saleRow({
    id: "sale-old-unlinked-offer",
    sale_key: "offer:old-unlinked-offer",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "old-unlinked-offer",
    offer_number: "A/N 14045",
    document_reference: "A-N-14045-EE79E7E5BC",
    customer_email: "denis.rybalchenko@haness.io",
    total_price: 580.72,
    assignment_status: "ready_to_assign",
    metadata: {},
    raw_shopify: {},
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(body.query || "").includes("SupplierSalesRecentOrders")) {
        return Response.json({ data: { orders: { nodes: [] } } });
      }
      if (String(body.query || "").includes("SupplierSalesOrderLookup")) {
        shopifySearchCount += 1;
        return Response.json({
          data: {
            orders: { nodes: [] },
          },
        });
      }
      shopifyNodeLookupCount += 1;
      assert.equal(body.variables.id, "gid://shopify/Order/8302046970123");
      return Response.json({
        data: {
          node: {
            id: "gid://shopify/Order/8302046970123",
            name: "#NEONT4454",
            email: "denis.rybalchenko@harness.io",
            tags: ["Quentin (noch bezahlen)"],
            statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/8302046970123/status",
            createdAt: "2026-06-17T11:45:53Z",
            processedAt: "2026-06-17T11:46:00Z",
            displayFinancialStatus: "PAID",
            displayFulfillmentStatus: "FULFILLED",
            customAttributes: [{ key: "NEONTRIP Offer Number", value: "A/N 14045" }],
            totalPriceSet: { shopMoney: { amount: "580.72", currencyCode: "EUR" } },
            subtotalPriceSet: { shopMoney: { amount: "487.999", currencyCode: "EUR" } },
            customer: { firstName: "Denis", lastName: "Rybalchenko", email: "denis.rybalchenko@harness.io", phone: null },
            billingAddress: null,
            shippingAddress: null,
            lineItems: { nodes: [{ id: "gid://shopify/LineItem/4454", title: "LED Neon", quantity: 1, customAttributes: [], image: null, variant: { image: null }, product: { productType: "LED-Neon-Flex" } }] },
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/shopify_orders") && method === "GET") {
      assert.equal(url.searchParams.get("match_text"), "ilike.*a-n-14045-ee79e7e5bc*");
      return Response.json([{
        shopify_order_id: "8302046970123",
        name: "#NEONT4454",
        email: "denis.rybalchenko@harness.io",
        kunde_email: "denis.rybalchenko@harness.io",
        total_price: "580.72",
        match_text: "angebot: a-n-14045-ee79e7e5bc",
        created_at: "2026-06-17T11:45:53Z",
      }]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" && url.searchParams.get("shopify_order_id") === "not.is.null") return Response.json([]);
      if (url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" && url.searchParams.get("shopify_order_id") === "is.null") {
        unlinkedRowsLookupCount += 1;
        return Response.json([existingRow]);
      }
      if (url.searchParams.get("shopify_order_id") === "eq.8302046970123") return Response.json([]);
      if (url.searchParams.get("offer_number") === "eq.A/N 14045") return Response.json([existingRow]);
      if (url.searchParams.get("id") === `eq.${existingRow.id}`) {
        return Response.json([{
          ...existingRow,
          source: "shopify",
          shopify_order_id: "8302046970123",
          shopify_order_name: "#NEONT4454",
          shopify_payment_status: "paid",
          assignment_status: "completed",
          metadata: { payment_link: "https://galaxybuzzdk.myshopify.com/orders/8302046970123/status" },
        }]);
      }
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      salePatchCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.shopify_order_id, "8302046970123");
      assert.equal(payload.shopify_order_name, "#NEONT4454");
      assert.equal(payload.shopify_payment_status, "paid");
      assert.equal(payload.assignment_status, "completed");
      assert.equal(payload.metadata?.payment_link, "https://galaxybuzzdk.myshopify.com/orders/8302046970123/status");
      return Response.json([{ ...existingRow, ...payload }]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 20 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.unlinkedActiveShopifyRows?.checked, 1);
    assert.equal(result.sources?.unlinkedActiveShopifyRows?.upserted, 1);
  });

  assert.equal(unlinkedRowsLookupCount, 1);
  assert.equal(shopifySearchCount, 0);
  assert.equal(shopifyNodeLookupCount, 1);
  assert.equal(salePatchCount, 1);
});

test("completed offers sync reconciles existing active supplier rows against Shopify tags", async () => {
  let activeRowsLookupCount = 0;
  let activeRowsLookupLimit: string | null = null;
  let shopifyNodeLookupCount = 0;
  let salePatchCount = 0;
  const existingRow = saleRow({
    id: "sale-active-stale-tag",
    sale_key: "shopify:order:987654777",
    source: "shopify",
    shopify_order_id: "987654777",
    shopify_order_name: "#1277",
    assigned_supplier: "quentin",
    assignment_status: "assigned",
    shopify_tag_value: "Quentin (noch bezahlen)",
    shopify_tag_sync_status: "failed",
    raw_shopify: { tags: [] },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") return Response.json({ ok: true, sales: [], count: 0 });
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(body.query || "").includes("orders(")) {
        return Response.json({ data: { orders: { nodes: [] } } });
      }
      shopifyNodeLookupCount += 1;
      assert.equal(body.variables.id, "gid://shopify/Order/987654777");
      return Response.json({
        data: {
          node: {
            id: "gid://shopify/Order/987654777",
            name: "#1277",
            email: "tagged@example.com",
            tags: ["Quentin (noch zahlen)"],
            statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/status",
            createdAt: "2026-05-01T12:00:00Z",
            processedAt: "2026-05-01T12:01:00Z",
            displayFinancialStatus: "PAID",
            displayFulfillmentStatus: "UNFULFILLED",
            customAttributes: [],
            totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
            subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
            customer: { firstName: "Tagged", lastName: "Sale", email: "tagged@example.com", phone: null },
            billingAddress: null,
            shippingAddress: null,
            lineItems: { nodes: [{ id: "gid://shopify/LineItem/7", title: "LED Neon", quantity: 1, customAttributes: [], image: null, variant: { image: null }, product: { productType: "LED-Neon-Flex" } }] },
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (
        url.searchParams.get("assignment_status") === "eq.assigned" &&
        url.searchParams.get("shopify_tag_sync_status") === "not.eq.synced" &&
        url.searchParams.get("shopify_order_id") === "not.is.null"
      ) {
        activeRowsLookupCount += 1;
        activeRowsLookupLimit = url.searchParams.get("limit");
        return Response.json([existingRow]);
      }
      if (
        url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" &&
        url.searchParams.get("shopify_order_id") === "not.is.null"
      ) return Response.json([]);
      if (
        url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" &&
        url.searchParams.get("shopify_order_id") === "is.null"
      ) return Response.json([]);
      if (url.searchParams.get("shopify_order_id") === "eq.987654777") return Response.json([existingRow]);
      if (url.searchParams.get("id") === `eq.${existingRow.id}`) return Response.json([{ ...existingRow, assigned_supplier: "quentin", assignment_status: "assigned", shopify_tag_value: "Quentin (schon bezahlt)", shopify_tag_sync_status: "synced" }]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      salePatchCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.assigned_supplier, "quentin");
      assert.equal(payload.assignment_status, "assigned");
      assert.equal(payload.shopify_tag_sync_status, "synced");
      return Response.json([{ ...existingRow, ...payload }]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await syncCompletedOffersFromOffersApp({ operatorName: "Ops" }, { limit: 25 });
    assert.equal(result.status, "synced", JSON.stringify(result));
    assert.equal(result.sources?.activeShopifyRows?.checked, 1);
    assert.equal(result.sources?.activeShopifyRows?.upserted, 1);
  });

  assert.equal(activeRowsLookupCount, 1);
  assert.equal(activeRowsLookupLimit, "25");
  assert.equal(shopifyNodeLookupCount, 1);
  assert.equal(salePatchCount, 1);
});

test("supplier sales sync_shopify_supplier_tags accepts automation bearer access", async () => {
  let activeRowsLookupCount = 0;
  let shopifyNodeLookupCount = 0;
  let salePatchCount = 0;
  const existingRow = saleRow({
    id: "sale-route-active-stale-tag",
    sale_key: "shopify:order:987654778",
    source: "shopify",
    shopify_order_id: "987654778",
    shopify_order_name: "#1278",
    assigned_supplier: null,
    assignment_status: "ready_to_assign",
    shopify_tag_value: null,
    shopify_tag_sync_status: "not_started",
    raw_shopify: { tags: [] },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      shopifyNodeLookupCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.variables.id, "gid://shopify/Order/987654778");
      return Response.json({
        data: {
          node: {
            id: "gid://shopify/Order/987654778",
            name: "#1278",
            email: "tagged-route@example.com",
            tags: ["Quentin (noch bezahlen)"],
            statusPageUrl: "https://galaxybuzzdk.myshopify.com/orders/status",
            createdAt: "2026-05-01T12:00:00Z",
            processedAt: "2026-05-01T12:01:00Z",
            displayFinancialStatus: "PENDING",
            displayFulfillmentStatus: "UNFULFILLED",
            customAttributes: [],
            totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "EUR" } },
            subtotalPriceSet: { shopMoney: { amount: "151.26", currencyCode: "EUR" } },
            customer: { firstName: "Tagged", lastName: "Route", email: "tagged-route@example.com", phone: null },
            billingAddress: null,
            shippingAddress: null,
            lineItems: { nodes: [{ id: "gid://shopify/LineItem/8", title: "LED Neon", quantity: 1, customAttributes: [], image: null, variant: { image: null }, product: { productType: "LED-Neon-Flex" } }] },
          },
        },
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (
        url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" &&
        url.searchParams.get("shopify_order_id") === "not.is.null"
      ) {
        activeRowsLookupCount += 1;
        assert.equal(url.searchParams.get("limit"), "50");
        return Response.json([existingRow]);
      }
      if (
        url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)" &&
        url.searchParams.get("shopify_order_id") === "is.null"
      ) return Response.json([]);
      if (url.searchParams.get("shopify_order_id") === "eq.987654778") return Response.json([existingRow]);
      if (url.searchParams.get("id") === `eq.${existingRow.id}`) return Response.json([{ ...existingRow, assigned_supplier: "quentin", assignment_status: "assigned", shopify_tag_value: "Quentin (noch bezahlen)", shopify_tag_sync_status: "synced" }]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      salePatchCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.assigned_supplier, "quentin");
      assert.equal(payload.assignment_status, "assigned");
      assert.equal(payload.shopify_tag_value, "Quentin (noch bezahlen)");
      return Response.json([{ ...existingRow, ...payload }]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: existingRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.SUPPLIER_SALES_AGENT_API_TOKEN = "stale-agent-key";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const response = await supplierSalesPOST(new NextRequest("https://ops.neontrip.de/api/ops/supplier-sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer internal-offers-key",
      },
      body: JSON.stringify({ action: "sync_shopify_supplier_tags", limit: 50, operatorName: "n8n Shopify Supplier Tag Sync" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.shopifySupplierTagSync.status, "synced", JSON.stringify(payload.shopifySupplierTagSync));
    assert.equal(payload.shopifySupplierTagSync.checked, 1);
    assert.equal(payload.shopifySupplierTagSync.upserted, 1);
  });

  assert.equal(activeRowsLookupCount, 1);
  assert.equal(shopifyNodeLookupCount, 1);
  assert.equal(salePatchCount, 1);
});

test("supplier sale action sets Shopify no payment reminder tag", async () => {
  let shopifyTagCount = 0;
  let currentRow = saleRow({
    id: "sale-no-reminder",
    shopify_order_id: "987654555",
    shopify_order_name: "#1255",
    metadata: {},
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.hostname === "galaxybuzzdk.myshopify.com") {
      shopifyTagCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.variables.id, "gid://shopify/Order/987654555");
      assert.deepEqual(body.variables.tags, ["Keine Zahlungserinnerung n8n"]);
      return Response.json({ data: { tagsAdd: { node: { id: "gid://shopify/Order/987654555" }, userErrors: [] } } });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      currentRow = { ...currentRow, ...JSON.parse(String(init?.body || "{}")) };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify-token";
    process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
    const result = await applyNoPaymentReminderShopifyTag({ saleId: currentRow.id, operatorName: "Ops" });
    assert.equal(result.tag.status, "synced");
    assert.equal(result.tag.tagValue, "Keine Zahlungserinnerung n8n");
    assert.equal(result.sale.id, currentRow.id);
  });

  assert.equal(shopifyTagCount, 1);
});

test("supplier order confirmation PDF is generated from offer snapshot", async () => {
  const row = saleRow({
    id: "sale-order-confirmation",
    offer_number: "A/N 15333",
    document_reference: "A-N-15333-ABCDEF",
    customer_name: "Mia Muster",
    customer_company: "Muster GmbH",
    customer_email: "mia@muster.de",
    offer_snapshot: {
      acceptedAt: "2026-06-16T12:00:00.000Z",
      offer: {
        offerNumber: "A/N 15333",
        documentReference: "A-N-15333-ABCDEF",
        currency: "EUR",
      },
      customer: {
        signerName: "Mia Muster",
        email: "mia@muster.de",
        company: "Muster GmbH",
      },
      deliveryAddress: {
        company: "Muster GmbH",
        name: "Mia Muster",
        address1: "Musterstrasse 1",
        zip: "10115",
        city: "Berlin",
        country: "Deutschland",
      },
      billingAddress: {
        company: "Muster GmbH",
        name: "Mia Muster",
        address1: "Musterstrasse 1",
        zip: "10115",
        city: "Berlin",
        country: "Deutschland",
      },
      totals: {
        subtotalNet: 1000,
        vatAmount: 190,
        totalGross: 1190,
      },
      lineItems: [
        {
          id: "line-1",
          title: "LED Neon Logo",
          description: "Individuelle Fertigung laut freigegebenem Angebot.",
          quantity: 2,
          unitPriceNet: 500,
          lineNet: 1000,
        },
      ],
    },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: row.id })]);
    return Response.json([]);
  }, async () => {
    const pdf = await generateSupplierOrderConfirmationPdf(row.id);
    const text = Buffer.from(pdf.bytes).toString("utf8");
    assert.equal(pdf.fileName, "auftragsbestaetigung-A-N-15333-ABCDEF.pdf");
    assert.equal(text.startsWith("%PDF-1.4"), true);
    assert.equal(text.includes("/Type /Catalog"), true);
    assert.equal(text.includes("/BaseFont /Helvetica-Bold"), true);
    assert.equal(text.includes("(NEONTRIP)"), true);
    assert.equal(text.includes("þÿ"), false);
    assert.ok(pdf.bytes.length > 1000);
  });
});

test("supplier sales route downloads order confirmation PDF", async () => {
  const row = saleRow({
    id: "sale-order-confirmation-route",
    document_reference: "A-N-15334-ABCDEF",
    offer_snapshot: {
      acceptedAt: "2026-06-16T12:00:00.000Z",
      totals: { subtotalNet: 1000, taxAmount: 190, totalGross: 1190 },
      lineItems: [{ title: "LED Neon Logo", quantity: 1, unitPrice: 1000 }],
    },
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: row.id })]);
    return Response.json([]);
  }, async () => {
    const request = new NextRequest(`http://127.0.0.1:3100/api/ops/supplier-sales?action=order_confirmation_pdf&saleId=${row.id}`, {
      headers: { host: "127.0.0.1:3100" },
    });
    const response = await supplierSalesGET(request);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^application\/pdf/);
    assert.match(response.headers.get("content-disposition") || "", /auftragsbestaetigung-A-N-15334-ABCDEF\.pdf/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString("utf8", 0, 8), "%PDF-1.4");

    const snapshotRequest = new NextRequest(`http://127.0.0.1:3100/api/ops/supplier-sales?action=snapshot_pdf&saleId=${row.id}`, {
      headers: { host: "127.0.0.1:3100" },
    });
    const snapshotResponse = await supplierSalesGET(snapshotRequest);
    assert.equal(snapshotResponse.status, 200);
    assert.match(snapshotResponse.headers.get("content-type") || "", /^application\/pdf/);
  });
});

test("supplier order confirmation email sends generated PDF through configured webhook", async () => {
  let currentRow = saleRow({
    id: "sale-order-confirmation-email",
    document_reference: "A-N-15335-ABCDEF",
    customer_name: "Mia Muster",
    customer_email: "mia@muster.de",
    offer_snapshot: {
      acceptedAt: "2026-06-16T12:00:00.000Z",
      totals: { subtotalNet: 1000, vatAmount: 190, totalGross: 1190 },
      lineItems: [{ title: "LED Neon Logo", quantity: 1, unitPriceNet: 1000, lineNet: 1000 }],
    },
  });
  let webhookCount = 0;
  let eventCount = 0;
  let patchedMetadata: Record<string, unknown> | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://order-confirmation.test") {
      webhookCount += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.kind, "supplier_order_confirmation");
      assert.equal(body.recipientEmail, "mia@muster.de");
      assert.equal(body.subject, "Auftragsbestätigung A-N-15335-ABCDEF");
      assert.equal(body.signature, "fabienne_neontrip");
      assert.equal(body.attachment.filename, "auftragsbestaetigung-A-N-15335-ABCDEF.pdf");
      assert.equal(Buffer.from(body.attachment.contentBase64, "base64").toString("utf8", 0, 8), "%PDF-1.4");
      return Response.json({ messageId: "outlook-message-1" });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([currentRow]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: currentRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      eventCount += 1;
      return Response.json({});
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      const patch = JSON.parse(String(init?.body || "{}"));
      patchedMetadata = patch.metadata;
      currentRow = { ...currentRow, ...patch };
      return Response.json([currentRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL = "https://order-confirmation.test/send";
    const result = await sendSupplierOrderConfirmationEmail({ saleId: currentRow.id, operatorName: "Fabienne" });

    assert.equal(result.status, "sent");
    assert.equal(result.providerMessageId, "outlook-message-1");
    assert.equal(result.recipientEmail, "mia@muster.de");
    assert.equal(result.sale.orderConfirmationEmail?.status, "sent");
  });

  assert.equal(webhookCount, 1);
  assert.equal(eventCount, 2);
  assert.ok(patchedMetadata);
  const orderConfirmationEmailMeta = (patchedMetadata as { order_confirmation_email?: Record<string, unknown> }).order_confirmation_email;
  assert.equal(orderConfirmationEmailMeta?.provider_message_id, "outlook-message-1");
});

test("supplier order confirmation email duplicate reservation does not resend webhook", async () => {
  const row = saleRow({
    id: "sale-order-confirmation-duplicate",
    document_reference: "A-N-15336-ABCDEF",
    customer_email: "mia@muster.de",
    metadata: {
      order_confirmation_email: {
        status: "sent",
        recipient_email: "mia@muster.de",
        requested_at: "2026-06-16T12:00:00.000Z",
        sent_at: "2026-06-16T12:00:01.000Z",
        provider_message_id: "existing-message",
      },
    },
    offer_snapshot: {
      totals: { subtotalNet: 1000, vatAmount: 190, totalGross: 1190 },
      lineItems: [{ title: "LED Neon Logo", quantity: 1, unitPriceNet: 1000, lineNet: 1000 }],
    },
  });
  let webhookCount = 0;
  let reservationCount = 0;
  let patchCount = 0;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://order-confirmation.test") {
      webhookCount += 1;
      return Response.json({ messageId: "should-not-send" });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") return Response.json([row]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "GET") return Response.json([itemRow({ sale_id: row.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") {
      reservationCount += 1;
      return Response.json({ message: "duplicate" }, { status: 409 });
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      patchCount += 1;
      return Response.json([row]);
    }
    return Response.json([]);
  }, async () => {
    process.env.SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL = "https://order-confirmation.test/send";
    const result = await sendSupplierOrderConfirmationEmail({ saleId: row.id, operatorName: "Fabienne" });

    assert.equal(result.status, "sent");
    assert.equal(result.providerMessageId, "existing-message");
  });

  assert.equal(reservationCount, 1);
  assert.equal(webhookCount, 0);
  assert.equal(patchCount, 0);
});

test("supplier sales live check compares latest completed offers with vergabe rows without PII", async () => {
  const latestRow = saleRow({
    id: "sale-live-1",
    sale_key: "offer:offer-live-1:supplier-sales:v1",
    source: "offers",
    shopify_order_id: null,
    shopify_order_name: "#2001",
    offer_id: "offer-live-1",
    offer_number: "A-2001",
    document_reference: "AN-2001",
    created_at: "2026-06-16T12:35:00.000Z",
    updated_at: "2026-06-16T12:35:00.000Z",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") {
      return Response.json({
        ok: true,
        sales: [
          {
            offerId: "offer-live-1",
            offerNumber: "A-2001",
            documentReference: "AN-2001",
            status: "COMPLETED",
            acceptedAt: "2026-06-16T12:30:00.000Z",
            updatedAt: "2026-06-16T12:31:00.000Z",
            payload: { customerEmail: "secret@example.com" },
          },
          {
            offerId: "offer-live-2",
            offerNumber: "A-2002",
            documentReference: "AN-2002",
            status: "COMPLETED",
            acceptedAt: "2026-06-16T12:20:00.000Z",
            updatedAt: "2026-06-16T12:21:00.000Z",
            payload: { customerEmail: "missing@example.com" },
          },
        ],
      });
    }
    assert.equal(url.origin, "https://supabase.test");
    assert.equal(method, "GET");
    if (url.pathname.endsWith("/supplier_sales") && url.searchParams.get("offer_id")?.includes("offer-live")) {
      return Response.json([latestRow]);
    }
    if (url.pathname.endsWith("/supplier_sales")) {
      return Response.json([latestRow]);
    }
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    const result = await runSupplierSalesLiveCheck({ limit: 10 });
    assert.equal(result.status, "warning");
    assert.equal(result.offersFeed.checked, 2);
    assert.equal(result.latestCompletedOffers[0]?.inVergabe, true);
    assert.equal(result.latestCompletedOffers[1]?.inVergabe, false);
    assert.deepEqual(result.missingOfferIds, ["offer-live-2"]);
    assert.equal(result.sortCheck.latestCompletedOfferInTopVergabe, true);
    assert.equal(JSON.stringify(result).includes("secret@example.com"), false);
    assert.equal(JSON.stringify(result).includes("missing@example.com"), false);
  });
});

test("supplier sales sync_completed_offers accepts automation bearer access", async () => {
  let offersFeedCount = 0;
  let salePostCount = 0;
  const importedRow = saleRow({
    id: "sale-route-completed-offer",
    sale_key: "offer:offer-route-completed-1",
    source: "neontrip-offers",
    shopify_order_id: null,
    shopify_order_name: null,
    offer_id: "offer-route-completed-1",
    offer_number: "A/N 15100",
    document_reference: "A-N-15100",
    customer_name: "Max Muster",
    customer_email: "max@example.com",
    total_price: 1190,
    assignment_status: "ready_to_assign",
  });

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (url.origin === "https://angebote.test") {
      offersFeedCount += 1;
      return Response.json({
        ok: true,
        sales: [{
          offerId: "offer-route-completed-1",
          payload: {
            source: "neontrip-offers",
            event: "offer.completed",
            idempotencyKey: "offer:offer-route-completed-1:supplier-sales:v1",
            offer: {
              id: "offer-route-completed-1",
              offerNumber: "A/N 15100",
              documentReference: "A-N-15100",
              publicUrl: "https://angebote.test/offer/public-token",
              finalPdfUrl: "https://angebote.test/offer/public-token/pdf",
              currency: "EUR",
              acceptedAt: "2026-06-16T09:00:00.000Z",
              signedAt: "2026-06-16T09:00:00.000Z",
            },
            customer: {
              firstName: "Max",
              lastName: "Muster",
              email: "max@example.com",
            },
            billingAddress: { name: "Max Muster" },
            deliveryAddress: { name: "Max Muster" },
            totals: { subtotalNet: 1000, vatAmount: 190, totalGross: 1190, vatRate: 19 },
            lineItems: [{
              id: "line-1",
              section: "LED-Neon-Flex",
              title: "LED Neon Logo",
              quantity: 1,
              lineNet: 1000,
              lineGross: 1190,
            }],
          },
        }],
      });
    }

    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${importedRow.id}`) return Response.json([importedRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      return Response.json([importedRow]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "PATCH") {
      return Response.json([importedRow]);
    }
    if (url.pathname.endsWith("/supplier_sale_items") && method === "DELETE") return Response.json([]);
    if (url.pathname.endsWith("/supplier_sale_items") && method === "POST") return Response.json([itemRow({ sale_id: importedRow.id })]);
    if (url.pathname.endsWith("/supplier_sale_events") && method === "POST") return Response.json({});
    if (url.pathname.endsWith("/ops_tasks") && method === "GET") return Response.json([]);
    if (url.pathname.endsWith("/ops_tasks") && method === "POST") return Response.json([]);
    return Response.json([]);
  }, async () => {
    process.env.NEONTRIP_OFFERS_BASE_URL = "https://angebote.test";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
    const response = await supplierSalesPOST(new NextRequest("https://ops.neontrip.de/api/ops/supplier-sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer internal-offers-key",
      },
      body: JSON.stringify({ action: "sync_completed_offers", limit: 20, operatorName: "Automation" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.completedOffersSync.status, "synced", JSON.stringify(payload.completedOffersSync));
    assert.equal(payload.completedOffersSync.upserted, 1);
  });

  assert.equal(offersFeedCount, 1);
  assert.equal(salePostCount, 1);
});

test("supplier sales route rejects stale signed automation requests", async () => {
  await withMockedAssignmentFetch(async () => {
    assert.fail("stale signed request must not reach downstream systems");
  }, async () => {
    process.env.SUPPLIER_SALES_WEBHOOK_SECRET = "supplier-secret";
    const body = JSON.stringify({ action: "sync_completed_offers", limit: 20, operatorName: "Automation" });
    const timestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));
    const signature = "sha256=" + createHmac("sha256", "supplier-secret").update(`${timestamp}.${body}`).digest("hex");
    const response = await supplierSalesPOST(new NextRequest("https://ops.neontrip.de/api/ops/supplier-sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-neontrip-timestamp": timestamp,
        "x-neontrip-signature": signature,
      },
      body,
    }));
    const payload = await response.json();

    assert.equal(response.status, 401, JSON.stringify(payload));
    assert.equal(payload.error, "unauthorized");
  });
});

test("supplier sales live diagnosis requires an ops session", async () => {
  await withMockedAssignmentFetch(async () => {
    assert.fail("unauthorized live diagnosis must not reach downstream systems");
  }, async () => {
    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://neontrip.cloudflareaccess.com";
    process.env.OPS_CLOUDFLARE_ACCESS_AUD = "supplier-sales-aud";
    process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";
    const response = await supplierSalesPOST(new NextRequest("https://ops.neontrip.de/api/ops/supplier-sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "diagnose_sales_flow", limit: 10, operatorName: "Automation" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 401, JSON.stringify(payload));
    assert.equal(payload.error, "unauthorized");
  });
});

test("supplier sales route does not expose raw Supabase details to clients", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalConsoleError = console.error;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  console.error = (() => undefined) as typeof console.error;
  globalThis.fetch = (async () =>
    new Response("raw supplier sales database detail", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    })) as typeof fetch;

  try {
    const response = await supplierSalesGET(new NextRequest("http://127.0.0.1:3100/api/ops/supplier-sales", {
      headers: { host: "127.0.0.1:3100" },
    }));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Supabase Anfrage fehlgeschlagen.");
    assert.equal("details" in payload, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("supplier sales diagnostics expose missing and configured production links", () => {
  const keys = [
    "SUPPLIER_SALES_AGENT_API_TOKEN",
    "QUOTE_INTERNAL_API_TOKEN",
    "OPS_INTERNAL_API_KEY",
    "NEONTRIP_OFFERS_INTERNAL_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPPLIER_SALES_WEBHOOK_SECRET",
    "SHOPIFY_SALE_WEBHOOK_SECRET",
    "SHOPIFY_ADMIN_API_ACCESS_TOKEN",
    "SHOPIFY_ADMIN_TOKEN",
    "SHOPIFY_ADMIN_API_TOKEN",
    "SHOPIFY_ACCESS_TOKEN",
    "SHOPIFY_SHOP_DOMAIN",
    "SHOPIFY_STORE_DOMAIN",
    "SHOPIFY_SHOP",
    "SUPPLIER_TAG_QUENTIN",
    "SUPPLIER_TAG_SAID",
    "SUPPLIER_TAG_SPECIAL",
    "TRELLO_API_KEY",
    "TRELLO_TOKEN",
    "SUPPLIER_TRELLO_PROJECTION_ENABLED",
    "SUPPLIER_TRELLO_QUENTIN_LIST_ID",
    "SUPPLIER_TRELLO_SAID_LIST_ID",
    "SUPPLIER_TRELLO_SPECIAL_LIST_ID",
    "SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    const missing = buildSupplierSalesDiagnostics();
    assert.equal(missing.ready, false);
    assert.ok(missing.missing.includes("incoming_sales_auth"));
    assert.ok(missing.missing.includes("completed_offers_pull"));
    assert.ok(missing.missing.includes("shopify_admin_api"));
    assert.equal(missing.items.find((item) => item.key === "shopify_supplier_tags")?.status, "warning");
    assert.equal(missing.missing.includes("shopify_supplier_tags"), false);
    assert.ok(missing.missing.includes("trello_api_key"));

    process.env.SUPPLIER_SALES_AGENT_API_TOKEN = "agent";
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key".repeat(2);
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN = "shopify";
    process.env.SUPPLIER_TAG_QUENTIN = "Quentin (noch bezahlen)";
    process.env.SUPPLIER_TAG_SAID = "Saeid (schon bezahlt)";
    process.env.TRELLO_API_KEY = "trello-key";
    process.env.TRELLO_TOKEN = "trello-token";

    const ready = buildSupplierSalesDiagnostics();
    assert.equal(ready.ready, true);
    assert.equal(ready.items.find((item) => item.key === "incoming_sales_auth")?.status, "ok");
    assert.equal(ready.items.find((item) => item.key === "completed_offers_pull")?.status, "ok");
    assert.equal(ready.items.find((item) => item.key === "shopify_admin_api")?.status, "ok");
    assert.equal(ready.items.find((item) => item.key === "shopify_supplier_tags")?.status, "ok");
    assert.equal(ready.items.find((item) => item.key === "trello_api_key")?.status, "ok");
    assert.equal(ready.items.find((item) => item.key === "supplier_trello_projection")?.status, "ok");
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("supplier sales diagnostics accept internal key alias for incoming sales auth", () => {
  const keys = [
    "SUPPLIER_SALES_AGENT_API_TOKEN",
    "QUOTE_INTERNAL_API_TOKEN",
    "OPS_INTERNAL_API_KEY",
    "NEONTRIP_OFFERS_INTERNAL_API_KEY",
    "SUPPLIER_SALES_WEBHOOK_SECRET",
    "SHOPIFY_SALE_WEBHOOK_SECRET",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key".repeat(2);

    const diagnostics = buildSupplierSalesDiagnostics();
    assert.equal(diagnostics.items.find((item) => item.key === "incoming_sales_auth")?.status, "ok");
    assert.equal(diagnostics.missing.includes("incoming_sales_auth"), false);
    assert.equal(diagnostics.items.find((item) => item.key === "completed_offers_pull")?.status, "ok");
    assert.equal(diagnostics.missing.includes("completed_offers_pull"), false);
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
