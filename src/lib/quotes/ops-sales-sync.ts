import type { AcceptQuotePayload, PublicQuote, QuoteItemRecord, QuoteTotals } from "./types";

type OpsSalesSyncResult =
  | { status: "skipped"; reason: "missing_api_key" }
  | { status: "synced"; saleId?: string | null; warnings: string[] }
  | { status: "failed"; error: string; httpStatus?: number };

function quoteBaseUrl() {
  return (process.env.QUOTE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://angebote.neontrip.de").replace(/\/$/, "");
}

function opsSupplierSalesUrl() {
  return (
    process.env.NEONTRIP_OPS_SUPPLIER_SALES_URL ||
    process.env.OPS_SUPPLIER_SALES_URL ||
    "https://ops.neontrip.de/api/ops/supplier-sales"
  ).trim();
}

function internalApiKey() {
  return String(process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY || process.env.QUOTE_INTERNAL_API_TOKEN || "").trim();
}

function parseOpsResponse(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as { sale?: { id?: string | null }; warnings?: string[]; error?: string };
  } catch {
    return { error: text };
  }
}

function splitName(name?: string | null) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) || "" };
}

function selectedLineItems(quote: PublicQuote, payload: AcceptQuotePayload) {
  const selections = new Map(payload.selected_items.map((selection) => [selection.item_id, selection]));
  return quote.items
    .map((item) => {
      const selection = selections.get(item.id);
      return selection?.selected ? { item, quantity: Math.max(1, Number(selection.quantity || item.quantity || 1)) } : null;
    })
    .filter((entry): entry is { item: QuoteItemRecord; quantity: number } => Boolean(entry));
}

function lineItemPayload(entry: { item: QuoteItemRecord; quantity: number }) {
  const metadata = entry.item.metadata || {};
  return {
    id: entry.item.id,
    section: entry.item.section,
    title: entry.item.name,
    description: entry.item.description || null,
    quantity: entry.quantity,
    unitPrice: entry.item.unit_price,
    taxRate: entry.item.tax_rate,
    sku: String(metadata.addon_slug || metadata.shipping_slug || metadata.design_index || "").trim() || null,
    metadata,
  };
}

export function buildOfferCompletedPayload(input: {
  quote: PublicQuote;
  payload: AcceptQuotePayload;
  totals: QuoteTotals;
}) {
  const signedName = splitName(input.payload.signed_name || input.quote.customer_name);
  const idempotencyKey = `offer:${input.quote.id}:accepted:v1`;
  const publicUrl = `${quoteBaseUrl()}/quote/${input.quote.share_token}`;
  const primaryImage = input.quote.images[0]?.storage_url || input.quote.images[0]?.source_url || null;

  return {
    schemaVersion: 1,
    source: "neontrip-offers",
    event: "offer.completed",
    idempotencyKey,
    offer: {
      id: input.quote.id,
      offerNumber: input.quote.request_id,
      documentReference: input.quote.request_id,
      trelloCardId: input.quote.trello_card_id || null,
      requestId: input.quote.request_id,
      publicUrl,
      finalPdfUrl: null,
      currency: input.quote.currency || "EUR",
    },
    customer: {
      firstName: signedName.firstName,
      lastName: signedName.lastName,
      signerName: input.payload.signed_name,
      email: input.quote.customer_email || null,
      phone: null,
      company: input.quote.company || input.payload.billing_address.company || input.payload.delivery_address.company || null,
      country: input.quote.country || input.payload.delivery_address.country || null,
    },
    totals: {
      subtotalNet: input.totals.subtotal_net,
      taxAmount: input.totals.tax_amount,
      totalGross: input.totals.total_gross,
    },
    deliveryAddress: input.payload.delivery_address,
    billingAddress: input.payload.billing_address,
    lineItems: selectedLineItems(input.quote, input.payload).map(lineItemPayload),
    media: {
      mockups: input.quote.images.map((image) => ({
        id: image.id,
        url: image.storage_url || image.source_url || null,
        label: image.label || null,
      })),
      posterUrl: primaryImage,
    },
  };
}

export async function syncAcceptedQuoteToOps(input: {
  quote: PublicQuote;
  payload: AcceptQuotePayload;
  totals: QuoteTotals;
}): Promise<OpsSalesSyncResult> {
  const apiKey = internalApiKey();
  if (!apiKey) return { status: "skipped", reason: "missing_api_key" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(opsSupplierSalesUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "upsert_sale",
        payload: buildOfferCompletedPayload(input),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const responseText = await response.text();
    const body = parseOpsResponse(responseText);

    if (!response.ok) {
      return {
        status: "failed",
        httpStatus: response.status,
        error: String(body.error || responseText || "ops_supplier_sales_sync_failed").slice(0, 240),
      };
    }

    return {
      status: "synced",
      saleId: body.sale?.id || null,
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "ops_supplier_sales_sync_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
