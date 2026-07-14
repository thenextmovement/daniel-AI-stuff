import { buildCustomerName, normalizeEmail } from "./customer";
import { buildAddonItems, buildProductItems, buildShippingItems } from "./build-items";
import { getFactor } from "./pricing";
import { getTaxRate } from "./tax";
import { generateSecureShareToken } from "./tokens";
import { downloadTrelloAttachment, getTrelloCard } from "./trello";
import { attachmentName, selectMockupAttachments } from "./mockups";
import {
  findActiveQuoteByRequestId,
  findCustomerRequest,
  insertQuote,
  insertQuoteEvent,
  insertQuoteImages,
  insertQuoteItems,
  uploadImageToSupabaseStorage,
  voidActiveQuotes,
} from "./supabase-rest";
import { assertQuoteCreationInput, QuoteValidationError } from "./validation";

function getCustomField(customFields: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const direct = customFields[name];
    if (direct !== null && direct !== undefined && String(direct).trim()) return String(direct).trim();
    const foundKey = Object.keys(customFields).find((key) => key.toLowerCase() === name.toLowerCase());
    const value = foundKey ? customFields[foundKey] : undefined;
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function quoteBaseUrl() {
  return (process.env.QUOTE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function safeStorageName(name: string, index: number) {
  const ext = name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || ".jpg";
  return `mockup-${String(index + 1).padStart(2, "0")}${ext}`;
}

async function uploadImagesToStorage(cardId: string, attachments: ReturnType<typeof selectMockupAttachments>) {
  const bucket = process.env.SUPABASE_QUOTE_IMAGES_BUCKET || "quote-images";
  const stored = [];

  for (const [index, attachment] of attachments.entries()) {
    const name = attachmentName(attachment);
    const downloaded = await downloadTrelloAttachment(attachment);
    const path = `${cardId}/${safeStorageName(name, index)}`;
    const storageUrl = await uploadImageToSupabaseStorage({
      bucket,
      path,
      contentType: downloaded.contentType,
      body: downloaded.body,
    });

    stored.push({
      source_url: attachment.url || null,
      storage_url: storageUrl,
      label: name,
      sort_order: index * 10,
    });
  }

  return stored;
}

export async function createQuoteFromTrello(cardId: string, options: { forceNew?: boolean } = {}) {
  if (!cardId || cardId.length < 6) {
    throw new QuoteValidationError("Trello Card ID fehlt oder ist ungueltig.");
  }

  const card = await getTrelloCard(cardId);
  const requestId = getCustomField(card.customFields, "Nerdy-Forms_ID", "nerdyforms_id", "request_id");
  const request = requestId ? await findCustomerRequest(requestId, card.id) : null;

  if (!request) {
    throw new QuoteValidationError("Kundendaten zur Nerdy-Forms_ID wurden nicht gefunden.", [
      `Keine Supabase master_requests Zeile fuer request_id=${requestId || "leer"} / card=${card.id}.`,
    ]);
  }

  const factor = getFactor(card.customFields);
  const taxRate = getTaxRate(request.country);
  const products = buildProductItems(card.customFields, { factor, taxRate });
  const addons = buildAddonItems(card.customFields, { factor, taxRate });
  const shipping = buildShippingItems(card.customFields, { factor, taxRate });

  assertQuoteCreationInput({
    requestId,
    email: request.email,
    productCount: products.length,
  });

  const existing = await findActiveQuoteByRequestId(requestId);
  if (existing && !options.forceNew) {
    return {
      quote: existing,
      quote_url: `${quoteBaseUrl()}/quote/${existing.share_token}`,
      reused_existing: true,
    };
  }

  if (existing && options.forceNew) await voidActiveQuotes(requestId);

  const customerName = buildCustomerName(request.first_name, request.last_name);
  const quote = await insertQuote({
    request_id: requestId,
    customer_id: request.customer_id || null,
    trello_card_id: card.id,
    customer_email: normalizeEmail(request.email),
    customer_name: customerName,
    company: request.company || null,
    country: request.country || null,
    share_token: generateSecureShareToken(),
  });

  await insertQuoteItems(quote.id, [...products, ...addons, ...shipping]);

  const mockups = selectMockupAttachments(card.attachments);
  const storedImages = await uploadImagesToStorage(card.id, mockups);
  await insertQuoteImages(quote.id, storedImages);

  await insertQuoteEvent(quote.id, "created", {
    trello_card_id: card.id,
    request_id: requestId,
    product_count: products.length,
    mockup_count: storedImages.length,
  });

  return {
    quote,
    quote_url: `${quoteBaseUrl()}/quote/${quote.share_token}`,
    reused_existing: false,
  };
}
