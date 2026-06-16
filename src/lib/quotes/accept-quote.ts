import { calculateQuoteTotals } from "./calculate-totals";
import {
  getQuoteByShareToken,
  replaceQuoteSelections,
  saveQuoteAcceptance,
} from "./supabase-rest";
import { syncAcceptedQuoteToOps } from "./ops-sales-sync";
import type { AcceptQuotePayload } from "./types";
import { assertAcceptableStatus, validateAcceptQuotePayload, QuoteValidationError } from "./validation";

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
