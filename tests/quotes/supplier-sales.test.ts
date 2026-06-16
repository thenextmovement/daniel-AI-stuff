import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as supplierSalesGET, POST as supplierSalesPOST } from "@/app/api/ops/supplier-sales/route";
import {
  assignSupplierSale,
  buildSupplierSaleBoardFromRows,
  buildSupplierSalesDiagnostics,
  buildSupplierSaleInputFromPayload,
  deriveAssignmentStatus,
  derivePaymentDecisionStatus,
  deriveSupplierRecommendation,
  normalizeDateOnly,
  normalizeShopifyPaymentStatus,
  requestSupplierPaymentReminder,
  retrySupplierSaleShopifyTag,
  supplierSaleNeedsDeadlineTask,
  syncCompletedOffersFromOffersApp,
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
    "NEONTRIP_OFFERS_BASE_URL",
    "OFFERS_BASE_URL",
    "NEXT_PUBLIC_OFFERS_BASE_URL",
    "NEONTRIP_OFFERS_INTERNAL_API_KEY",
    "OFFERS_INTERNAL_API_KEY",
    "QUOTE_INTERNAL_API_TOKEN",
    "OPS_INTERNAL_API_KEY",
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
  assert.equal(deriveSupplierRecommendation(parsed.sale.lineItems).recommendedSupplier, "said");
});

test("neontrip offer events other than offer.completed are rejected for supplier sales", () => {
  assert.throws(() => buildSupplierSaleInputFromPayload({
    source: "neontrip-offers",
    event: "offer.viewed",
    offer: { id: "offer_123" },
  }), /offer\.completed/);
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

test("supplier sales board counts deadlines, payment, assignment and sync issues", () => {
  const board = buildSupplierSaleBoardFromRows(
    [
      saleRow({ id: "sale-ready", assignment_status: "ready_to_assign", supplier_due_date: "2026-06-10" }),
      saleRow({ id: "sale-payment", assignment_status: "payment_open", shopify_payment_status: "pending", payment_decision_status: "wait_for_payment", supplier_due_date: "2026-06-08" }),
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
  assert.equal(board.counts.readyToAssign, 1);
  assert.equal(board.counts.paymentOpen, 1);
  assert.equal(board.counts.assigned, 1);
  assert.equal(board.counts.overdue, 1);
  assert.equal(board.counts.dueSoon, 2);
  assert.equal(board.counts.quentinRecommended, 1);
  assert.equal(board.counts.syncIssues, 1);
  assert.equal(board.items[0].id, "sale-ready");
  assert.ok(board.diagnostics.items.length);
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
      assert.deepEqual(body.variables.tags, ["Quentin (schon bezahlt)"]);
      return Response.json({ data: { tagsAdd: { node: { id: "gid://shopify/Order/987654321" }, userErrors: [] } } });
    }

    assert.equal(url.origin, "https://supabase.test");
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
  });

  assert.equal(shopifyLookupCount, 1);
  assert.equal(shopifyTagCount, 1);
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
      assert.deepEqual(body.variables.tags, ["Quentin (schon bezahlt)"]);
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
    process.env.SUPPLIER_TAG_QUENTIN = "Quentin (schon bezahlt)";
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
