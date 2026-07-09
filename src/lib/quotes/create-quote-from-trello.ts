import { buildCustomerName, normalizeEmail } from "./customer";
import { buildAddonItems, buildProductItems, buildShippingItems } from "./build-items";
import { getFactor } from "./pricing";
import { getTaxRate } from "./tax";
import { generateSecureShareToken } from "./tokens";
import { downloadTrelloAttachment, getTrelloCard } from "./trello";
import { attachmentName, selectMockupAttachments } from "./mockups";
import {
  listOfferSizeLadderDrafts,
  type OfferSizeLadderDraft,
  type OfferSizeLadderOption,
} from "@/lib/ops/offer-size-ladder";
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
import type { QuoteItemInput } from "./types";

export type QuoteSizeLadderMode = "off" | "optional" | "required";

type QuoteSizeLadderPlan = {
  mode: QuoteSizeLadderMode;
  applied: boolean;
  draft: OfferSizeLadderDraft | null;
  items: QuoteItemInput[] | null;
  issues: string[];
};

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

function quoteSizeLadderMode(value?: string | null): QuoteSizeLadderMode {
  const normalized = String(value || process.env.QUOTE_SIZE_LADDER_MODE || "optional").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled") return "off";
  if (normalized === "required" || normalized === "require") return "required";
  return "optional";
}

function stripSizeLines(description?: string | null) {
  return String(description || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(größe|groesse|grösse|size|maße|masse|abmessung|abmessungen)\s*:/i.test(line));
}

function sizeLadderQuoteItemName(option: OfferSizeLadderOption, index: number) {
  return `LED-Leuchtschild ${option.sizeLabel}${index === 0 ? " (kleinstmögliche Größe)" : ""}`;
}

export function buildQuoteProductItemsFromSizeLadderDraft(input: {
  draft: OfferSizeLadderDraft;
  taxRate: number;
  baseProduct?: QuoteItemInput | null;
}) {
  const validOptions = input.draft.options
    .filter((option) => option.reviewStatus !== "blocked")
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (!validOptions.length) return [];
  const defaultOption = validOptions.find((option) => option.isDefault) || validOptions[0]!;
  const baseLines = stripSizeLines(input.baseProduct?.description);

  return validOptions.map((option, index): QuoteItemInput => ({
    section: "products",
    name: sizeLadderQuoteItemName(option, index),
    description: [`Größe: ${option.sizeLabel}`, ...baseLines].join("\n"),
    quantity: 1,
    unit_price: option.customerUnitPriceNet,
    tax_rate: input.taxRate,
    optional: true,
    selected_default: option.sizeLabel === defaultOption.sizeLabel,
    quantity_editable: false,
    sort_order: 10 + index * 10,
    metadata: {
      size_ladder: true,
      selection_mode: "single",
      selection_group: "size_ladder",
      anchor_set_id: input.draft.anchorSetId,
      trello_card_id: input.draft.trelloCardId,
      size_label: option.sizeLabel,
      width_cm: option.widthCm,
      height_cm: option.heightCm,
      long_side_cm: option.longSideCm,
      supplier_total_estimated: option.supplierTotalEstimated,
      customer_factor: option.customerFactor,
      confidence: option.confidence,
      review_status: option.reviewStatus,
      review_reason: option.reviewReason,
    },
  }));
}

function sizeLadderDraftIssues(draft: OfferSizeLadderDraft) {
  const issues = [...draft.issues];
  if (draft.status === "blocked") issues.push("size_ladder_draft_blocked");
  if (!draft.options.length) issues.push("size_ladder_draft_has_no_options");
  if (draft.options.every((option) => option.reviewStatus === "blocked")) {
    issues.push("size_ladder_draft_has_only_blocked_options");
  }
  return [...new Set(issues)];
}

async function resolveQuoteSizeLadderPlan(input: {
  trelloCardId: string;
  taxRate: number;
  baseProducts: QuoteItemInput[];
  mode: QuoteSizeLadderMode;
}): Promise<QuoteSizeLadderPlan> {
  if (input.mode === "off") {
    return { mode: input.mode, applied: false, draft: null, items: null, issues: [] };
  }

  let drafts: OfferSizeLadderDraft[] = [];
  try {
    drafts = await listOfferSizeLadderDrafts({ trelloCardId: input.trelloCardId, limit: 1 });
  } catch (error) {
    if (input.mode === "required") throw error;
    console.warn("quote creation size ladder lookup failed", {
      trelloCardId: input.trelloCardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { mode: input.mode, applied: false, draft: null, items: null, issues: ["size_ladder_lookup_failed"] };
  }

  const draft = drafts[0] || null;
  if (!draft) {
    if (input.mode === "required") {
      throw new QuoteValidationError(
        "Größenleiter-Draft fehlt. Angebot wurde nicht automatisch erstellt.",
        ["price_review_size_ladder_draft_missing"],
        409,
      );
    }
    return { mode: input.mode, applied: false, draft: null, items: null, issues: ["size_ladder_draft_missing"] };
  }

  const issues = sizeLadderDraftIssues(draft);
  if (issues.length) {
    if (input.mode === "required") {
      throw new QuoteValidationError(
        "Größenleiter-Draft ist nicht verwendbar. Angebot wurde nicht automatisch erstellt.",
        issues,
        409,
      );
    }
    return { mode: input.mode, applied: false, draft, items: null, issues };
  }

  const items = buildQuoteProductItemsFromSizeLadderDraft({
    draft,
    taxRate: input.taxRate,
    baseProduct: input.baseProducts[0] || null,
  });
  if (!items.length) {
    if (input.mode === "required") {
      throw new QuoteValidationError(
        "Größenleiter-Draft enthält keine freigegebenen Größen.",
        ["size_ladder_draft_has_no_quote_items"],
        409,
      );
    }
    return { mode: input.mode, applied: false, draft, items: null, issues: ["size_ladder_draft_has_no_quote_items"] };
  }

  return { mode: input.mode, applied: true, draft, items, issues: [] };
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

export async function createQuoteFromTrello(cardId: string, options: { forceNew?: boolean; sizeLadderMode?: QuoteSizeLadderMode | string | null } = {}) {
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
  const baseProducts = buildProductItems(card.customFields, { factor, taxRate });
  const sizeLadderMode = quoteSizeLadderMode(options.sizeLadderMode);
  const sizeLadderPlan = await resolveQuoteSizeLadderPlan({
    trelloCardId: card.id,
    taxRate,
    baseProducts,
    mode: sizeLadderMode,
  });
  const products = sizeLadderPlan.items || baseProducts;
  const addons = buildAddonItems(card.customFields, { factor, taxRate });
  const shipping = buildShippingItems(card.customFields, { factor, taxRate });

  assertQuoteCreationInput({
    requestId,
    email: request.email,
    productCount: products.length,
    allowManyProducts: sizeLadderPlan.applied,
  });

  const existing = await findActiveQuoteByRequestId(requestId);
  if (existing && !options.forceNew) {
    if (sizeLadderMode === "required") {
      throw new QuoteValidationError(
        "Aktives Angebot existiert bereits. Größenleiter wurde nicht automatisch auf ein bestehendes Angebot angewendet.",
        ["active_quote_exists_size_ladder_not_applied"],
        409,
      );
    }
    return {
      quote: existing,
      quote_url: `${quoteBaseUrl()}/quote/${existing.share_token}`,
      reused_existing: true,
      size_ladder: {
        mode: sizeLadderPlan.mode,
        applied: false,
        reason: "existing_quote_reused",
      },
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
    size_ladder: {
      mode: sizeLadderPlan.mode,
      applied: sizeLadderPlan.applied,
      anchor_set_id: sizeLadderPlan.draft?.anchorSetId || null,
      option_count: sizeLadderPlan.items?.length || 0,
      status: sizeLadderPlan.draft?.status || null,
      confidence: sizeLadderPlan.draft?.confidence || null,
      issues: sizeLadderPlan.issues,
    },
  });

  return {
    quote,
    quote_url: `${quoteBaseUrl()}/quote/${quote.share_token}`,
    reused_existing: false,
    size_ladder: {
      mode: sizeLadderPlan.mode,
      applied: sizeLadderPlan.applied,
      anchor_set_id: sizeLadderPlan.draft?.anchorSetId || null,
      option_count: sizeLadderPlan.items?.length || 0,
      issues: sizeLadderPlan.issues,
    },
  };
}
