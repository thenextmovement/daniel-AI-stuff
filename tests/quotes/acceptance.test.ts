import test from "node:test";
import assert from "node:assert/strict";
import { acceptQuote } from "../../src/lib/quotes/accept-quote";
import { calculateQuoteTotals } from "../../src/lib/quotes/calculate-totals";
import { buildOfferCompletedPayload } from "../../src/lib/quotes/ops-sales-sync";
import { validateAcceptQuotePayload, QuoteValidationError } from "../../src/lib/quotes/validation";
import type { AcceptQuotePayload, PublicQuote, QuoteItemRecord, QuoteRecord } from "../../src/lib/quotes/types";

const items: QuoteItemRecord[] = [
  {
    id: "product-1",
    section: "products",
    name: "Produkt",
    quantity: 1,
    unit_price: 1000,
    tax_rate: 19,
    optional: true,
    selected_default: true,
    quantity_editable: true,
    sort_order: 10,
  },
  {
    id: "addon-1",
    section: "addons",
    name: "Addon",
    quantity: 1,
    unit_price: 100,
    tax_rate: 19,
    optional: true,
    selected_default: false,
    quantity_editable: false,
    sort_order: 20,
  },
];

const address = {
  company: "",
  first_name: "Max",
  last_name: "Mustermann",
  street: "Musterstr. 1",
  postal_code: "40219",
  city: "Duesseldorf",
  country: "Deutschland",
};

function validPayload(): AcceptQuotePayload {
  return {
    selected_items: [
      { item_id: "product-1", selected: true, quantity: 2 },
      { item_id: "addon-1", selected: false, quantity: 1 },
    ],
    delivery_address: address,
    billing_address: address,
    signed_name: "Max Mustermann",
    terms_accepted: true,
  };
}

async function withSupabaseFetchMock<T>(
  handler: (url: URL, init?: RequestInit) => Response,
  callback: (calls: Array<{ url: URL; init?: RequestInit }>) => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: Array<{ url: URL; init?: RequestInit }> = [];

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;

  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

function quoteRecord(status = "viewed"): QuoteRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    request_id: "REQ-1",
    status,
    currency: "EUR",
    share_token: "share-token",
    subtotal_net: null,
    tax_amount: null,
    total_gross: null,
  };
}

test("calculateQuoteTotals uses selected items and quantities", () => {
  assert.deepEqual(calculateQuoteTotals(items, validPayload().selected_items), {
    subtotal_net: 2000,
    tax_amount: 380,
    total_gross: 2380,
  });
});

test("validateAcceptQuotePayload rejects missing signature and incomplete address", () => {
  const payload = validPayload();
  payload.signed_name = "";
  payload.delivery_address = { ...address, city: "" };

  assert.throws(() => validateAcceptQuotePayload(items, payload), QuoteValidationError);
});

test("validateAcceptQuotePayload rejects no relevant selected item", () => {
  const payload = validPayload();
  payload.selected_items = items.map((item) => ({ item_id: item.id, selected: false, quantity: 1 }));

  assert.throws(() => validateAcceptQuotePayload(items, payload), QuoteValidationError);
});

test("buildOfferCompletedPayload creates the supplier sales event from the accepted quote", () => {
  const quote: PublicQuote = {
    ...quoteRecord(),
    customer_email: "kunde@example.com",
    customer_name: "Max Mustermann",
    company: "Muster GmbH",
    country: "Deutschland",
    items,
    images: [
      {
        id: "image-1",
        storage_url: "https://cdn.example/mockup.jpg",
        label: "Mockup",
        sort_order: 10,
      },
    ],
  };

  const payload = buildOfferCompletedPayload({
    quote,
    payload: validPayload(),
    totals: { subtotal_net: 2000, tax_amount: 380, total_gross: 2380 },
  });

  assert.equal(payload.source, "neontrip-offers");
  assert.equal(payload.event, "offer.completed");
  assert.equal(payload.idempotencyKey, `offer:${quote.id}:accepted:v1`);
  assert.equal(payload.offer.id, quote.id);
  assert.equal(payload.offer.requestId, "REQ-1");
  assert.equal(payload.customer.email, "kunde@example.com");
  assert.equal(payload.customer.company, "Muster GmbH");
  assert.deepEqual(payload.totals, { subtotalNet: 2000, taxAmount: 380, totalGross: 2380 });
  assert.equal(payload.lineItems.length, 1);
  assert.equal(payload.lineItems[0].id, "product-1");
  assert.equal(payload.lineItems[0].quantity, 2);
  assert.equal(payload.media.mockups[0].url, "https://cdn.example/mockup.jpg");
});

test("acceptQuote posts offer.completed to ops supplier sales when the internal key is configured", async () => {
  const originalKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  const originalUrl = process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL;

  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
  process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL = "https://ops.example.test/api/ops/supplier-sales";

  try {
    await withSupabaseFetchMock(
      (url, init) => {
        if (url.hostname === "ops.example.test") {
          const body = JSON.parse(String(init?.body || "{}")) as {
            action?: string;
            payload?: { source?: string; event?: string; offer?: { id?: string } };
          };
          assert.equal(init?.method, "POST");
          assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer internal-offers-key");
          assert.equal(body.action, "upsert_sale");
          assert.equal(body.payload?.source, "neontrip-offers");
          assert.equal(body.payload?.event, "offer.completed");
          assert.equal(body.payload?.offer?.id, quoteRecord().id);
          return Response.json({ ok: true, sale: { id: "sale-1" }, warnings: [] });
        }
        if (url.pathname.endsWith("/quotes")) {
          return Response.json([{ ...quoteRecord(), customer_email: "kunde@example.com" }]);
        }
        if (url.pathname.endsWith("/quote_items")) {
          return Response.json(items.map((item) => ({ ...item, quote_id: quoteRecord().id })));
        }
        if (url.pathname.endsWith("/quote_images")) {
          return Response.json([]);
        }
        if (url.pathname.endsWith("/quote_selections")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/quote_acceptances")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/quote_events")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/quotes")) return new Response(null, { status: 204 });
        return Response.json({ error: "unexpected path" }, { status: 500 });
      },
      async (calls) => {
        const result = await acceptQuote({ shareToken: "share-token", payload: validPayload() });
        assert.equal(result.status, "accepted");
        assert.deepEqual(result.opsSync, { status: "synced", saleId: "sale-1", warnings: [] });
        assert.equal(calls.some((call) => call.url.hostname === "ops.example.test"), true);
      },
    );
  } finally {
    if (originalKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL;
    else process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL = originalUrl;
  }
});

test("acceptQuote persists a failed ops supplier-sales sync event without blocking acceptance", async () => {
  const originalKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  const originalUrl = process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL;
  const quoteEvents: Array<{ event_type?: string; payload?: Record<string, unknown> }> = [];

  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "internal-offers-key";
  process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL = "https://ops.example.test/api/ops/supplier-sales";

  try {
    await withSupabaseFetchMock(
      (url, init) => {
        if (url.hostname === "ops.example.test") {
          return Response.json({ ok: false, error: "ops_down" }, { status: 503 });
        }
        if (url.pathname.endsWith("/quotes") && String(init?.method || "GET").toUpperCase() === "GET") {
          return Response.json([{ ...quoteRecord(), customer_email: "kunde@example.com" }]);
        }
        if (url.pathname.endsWith("/quote_items")) {
          return Response.json(items.map((item) => ({ ...item, quote_id: quoteRecord().id })));
        }
        if (url.pathname.endsWith("/quote_images")) {
          return Response.json([]);
        }
        if (url.pathname.endsWith("/quote_events")) {
          quoteEvents.push(JSON.parse(String(init?.body || "{}")));
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/quote_selections")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/quote_acceptances")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/quotes")) return new Response(null, { status: 204 });
        return Response.json({ error: "unexpected path" }, { status: 500 });
      },
      async () => {
        const result = await acceptQuote({ shareToken: "share-token", payload: validPayload() });
        assert.equal(result.status, "accepted");
        assert.equal(result.opsSync.status, "failed");
      },
    );
  } finally {
    if (originalKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL;
    else process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL = originalUrl;
  }

  const syncEvent = quoteEvents.find((event) => event.event_type === "accepted_ops_supplier_sales_failed");
  assert.ok(syncEvent);
  assert.equal(syncEvent.payload?.status, "failed");
  assert.equal(syncEvent.payload?.http_status, 503);
  assert.equal(syncEvent.payload?.idempotency_key, `offer:${quoteRecord().id}:accepted:v1`);
});
