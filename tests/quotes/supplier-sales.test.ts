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
  generateSupplierOrderConfirmationPdf,
  listSupplierSalesBoard,
  normalizeDateOnly,
  normalizeShopifyPaymentStatus,
  requestSupplierPaymentReminder,
  retrySupplierSaleShopifyTag,
  runSupplierSalesLiveCheck,
  sendSupplierOrderConfirmationEmail,
  supplierSaleNeedsDeadlineTask,
  syncCompletedOffersFromOffersApp,
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

test("supplier recommendation keeps standard LED neon flex with Saeid", () => {
  const result = deriveSupplierRecommendation([
    { title: "LED Neon Flex Schild", description: "Standard LED-Neon-Flex warmweiss" },
    { title: "Standard-Versand", section: "shipping" },
  ]);

  assert.equal(result.recommendedSupplier, "said");
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
  assert.equal(deriveSupplierRecommendation(parsed.sale.lineItems).recommendedSupplier, "said");
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
  assert.equal(buildShopifyOrderTrelloTitle("Check Info Ada", "#NEONT4426"), "#NEONT4426 Check Info Ada");
  assert.equal(buildShopifyOrderTrelloTitle("#NEONT4426 Check Info Ada", "#NEONT4426"), "#NEONT4426 Check Info Ada");
  assert.equal(buildShopifyOrderTrelloTitle("#NEONT4000 Check Info Ada", "#NEONT4426"), "#NEONT4426 Check Info Ada");
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
    { cardId: "carda1234", name: "#NEONT4426 Check Info Ada" },
  ]);
  assert.ok(eventTypes.includes("source_trello_order_title_synced"));
});

test("supplier sales board counts deadlines, payment, assignment and sync issues", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({ id: "sale-ready", assignment_status: "ready_to_assign", shopify_payment_status: "paid", supplier_due_date: "2026-06-10" }),
      saleRow({ id: "sale-payment", assignment_status: "payment_open", shopify_payment_status: "pending", payment_decision_status: "wait_for_payment", supplier_due_date: "2026-06-08", product_summary: "Eilauftrag LED Neon Logo" }),
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
  assert.equal(board.items[0].id, "sale-ready");
  assert.ok(board.diagnostics.items.length);
});

test("supplier sales board exposes snapshot selection details and Trello lookup links", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({
        id: "sale-selection-details",
        shopify_order_name: "#NEONT7777",
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
  assert.equal(sale?.items[0]?.description, "Ausgewaehlte Produktion laut Snapshot.");
  assert.ok(sale?.items[0]?.selectionDetails.includes("Groesse: 120cm"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Farbe: warmweiss"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Zuschnitt: Konturschnitt"));
  assert.ok(sale?.items[0]?.selectionDetails.includes("Rueckwand: Acryl klar"));
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
    assert.equal(sale.postOrderReview.status, "open");
  });

  assert.equal(attemptPostCount, 1);
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
  const supplierSalesGetLimits: string[] = [];
  let itemSaleFilter: string | null = null;

  await withMockedAssignmentFetch(async (url, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    assert.equal(url.origin, "https://supabase.test");
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      const limit = url.searchParams.get("limit");
      supplierSalesGetLimits.push(limit || "");
      if (limit === "200") assert.equal(url.searchParams.get("assignment_status"), "not.in.(assigned,in_production,completed,canceled)");
      return Response.json([taggedRow, fulfilledRow, similarTagRow, unassignedRow]);
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
    assert.deepEqual(new Set(board.items.map((item) => item.id)), new Set(["sale-visible", "sale-similar-tag"]));
    const visible = board.items.find((item) => item.id === "sale-visible");
    assert.equal(visible?.primaryImageUrl, "https://cdn.test/item-fallback.jpg");
    assert.equal(visible?.paymentLink, "https://shopify.test/orders/visible/status");
  });

  assert.deepEqual(supplierSalesGetLimits, ["2000", "200"]);
  assert.equal(itemSaleFilter, "in.(sale-similar-tag,sale-visible)");
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

test("shopify fallback treats existing supplier tags as already assigned", async () => {
  let salePostCount = 0;
  const importedRow = saleRow({
    id: "sale-shopify-tagged",
    sale_key: "shopify:order:987654333",
    source: "shopify",
    shopify_order_id: "987654333",
    shopify_order_name: "#1236",
    assigned_supplier: "said",
    assignment_status: "assigned",
    shopify_tag_value: "Saeid (schon bezahlt)",
    shopify_tag_sync_status: "synced",
  });

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
    if (url.pathname.endsWith("/supplier_sales") && method === "GET") {
      if (url.searchParams.get("id") === `eq.${importedRow.id}`) return Response.json([importedRow]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/supplier_sales") && method === "POST") {
      salePostCount += 1;
      const payload = JSON.parse(String(init?.body || "{}"));
      assert.equal(payload.assigned_supplier, "said");
      assert.equal(payload.assignment_status, "assigned");
      assert.equal(payload.shopify_tag_value, "Saeid (schon bezahlt)");
      assert.equal(payload.shopify_tag_sync_status, "synced");
      assert.equal(typeof payload.shopify_tag_synced_at, "string");
      return Response.json([importedRow]);
    }
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
    assert.equal(result.sources?.shopifyOrders.checked, 1);
    assert.equal(result.upserted, 1);
  });

  assert.equal(salePostCount, 1);
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
    assigned_supplier: null,
    assignment_status: "ready_to_assign",
    shopify_tag_value: null,
    shopify_tag_sync_status: "not_started",
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
            tags: ["Quentin (schon bezahlt)"],
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
      if (url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)") {
        activeRowsLookupCount += 1;
        activeRowsLookupLimit = url.searchParams.get("limit");
        return Response.json([existingRow]);
      }
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
      if (url.searchParams.get("assignment_status") === "not.in.(assigned,in_production,completed,canceled)") {
        activeRowsLookupCount += 1;
        assert.equal(url.searchParams.get("limit"), "50");
        return Response.json([existingRow]);
      }
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
    assert.equal(ready.items.find((item) => item.key === "supplier_trello_projection")?.status, "warning");
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
