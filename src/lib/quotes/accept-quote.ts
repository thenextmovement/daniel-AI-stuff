import { calculateQuoteTotals } from "./calculate-totals";
import {
  getQuoteByShareToken,
  insertQuoteEvent,
  replaceQuoteSelections,
  saveQuoteAcceptance,
} from "./supabase-rest";
import { syncAcceptedQuoteToOps } from "./ops-sales-sync";
import type { AcceptQuotePayload } from "./types";
import { assertAcceptableStatus, validateAcceptQuotePayload, QuoteValidationError } from "./validation";

async function recordOpsSyncStatus(quoteId: string, requestId: string | null | undefined, opsSync: Awaited<ReturnType<typeof syncAcceptedQuoteToOps>>) {
  const eventType =
    opsSync.status === "synced"
      ? "accepted_ops_supplier_sales_synced"
      : opsSync.status === "skipped"
        ? "accepted_ops_supplier_sales_skipped"
        : "accepted_ops_supplier_sales_failed";

  try {
    await insertQuoteEvent(quoteId, eventType, {
      request_id: requestId || null,
      status: opsSync.status,
      sale_id: opsSync.status === "synced" ? opsSync.saleId || null : null,
      warnings: opsSync.status === "synced" ? opsSync.warnings : [],
      reason: opsSync.status === "skipped" ? opsSync.reason : null,
      http_status: opsSync.status === "failed" ? opsSync.httpStatus || null : null,
      error: opsSync.status === "failed" ? opsSync.error : null,
      idempotency_key: `offer:${quoteId}:accepted:v1`,
    });
  } catch (eventError) {
    console.error("accepted quote ops supplier-sales sync event failed", {
      quoteId,
      requestId,
      error: eventError instanceof Error ? eventError.message : "quote_event_failed",
    });
  }
}

export async function acceptQuote(input: {
  shareToken: string;
  payload: AcceptQuotePayload;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const quote = await getQuoteByShareToken(input.shareToken);
  if (!quote) throw new QuoteValidationError("Angebot wurde nicht gefunden.", [], 404);

  assertAcceptableStatus(quote.status);
  validateAcceptQuotePayload(quote.items, input.payload);

  const totals = calculateQuoteTotals(quote.items, input.payload.selected_items);
  await replaceQuoteSelections(quote.id, input.payload.selected_items);
  await saveQuoteAcceptance({
    quote,
    payload: input.payload,
    totals,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const opsSync = await syncAcceptedQuoteToOps({ quote, payload: input.payload, totals });
  await recordOpsSyncStatus(quote.id, quote.request_id, opsSync);
  if (opsSync.status === "failed") {
    console.error("accepted quote ops supplier-sales sync failed", {
      quoteId: quote.id,
      requestId: quote.request_id,
      status: opsSync.httpStatus || null,
      error: opsSync.error,
    });
  }

  return { quote_id: quote.id, status: "accepted", totals, opsSync };
}
