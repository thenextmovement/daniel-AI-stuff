import { createHash } from "node:crypto";
import { addTrelloCardComment, createTrelloBoardCustomField, getTrelloCard, updateTrelloCustomField } from "@/lib/quotes/trello";
import type { CustomFieldMap, TrelloCardData, TrelloEditableCustomField } from "@/lib/quotes/types";
import { getFactorOverride, roundDownToFive } from "@/lib/quotes/pricing";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  getOfferById,
  getOfferByTrelloCardId,
  OpsOfferApiError,
  patchOfferById,
  patchOfferByTrelloCardId,
  type OpsOfferItem,
  type OpsOfferPatchInput,
  type OpsOfferPatchResult,
  type OpsOfferSnapshot,
} from "@/lib/ops/offers";

export const OFFER_SIZE_LADDER_CUSTOMER_FACTOR = 2.3;
export const OFFER_SIZE_LADDER_MODEL_KEY = "anchored_offer_size_ladder";
export const OFFER_SIZE_LADDER_MODEL_VERSION = "anchored_offer_size_ladder_v1";
export const OFFER_SIZE_LADDER_MAX_OFFER_ITEMS = 300;
export const OFFER_SIZE_LADDER_MAX_OPTIONS = 300;

export type OfferSizeLadderCoreAnchorRole = "minimum" | "requested" | "max_250";
export type OfferSizeLadderAnchorRole = OfferSizeLadderCoreAnchorRole | `anchor_${number}`;
export type OfferSizeLadderProductModel =
  | "neonflex"
  | "uv_print"
  | "three_d"
  | "full_glow"
  | "outdoor"
  | "acryl_light_box"
  | "unsupported"
  | "unknown";
export type OfferSizeLadderReviewStatus = "auto_ok" | "needs_review" | "blocked";
export type OfferSizeLadderSetStatus = "draft" | "needs_review" | "approved" | "blocked" | "applied" | "superseded";

export type OfferSizeLadderAnchorInput = {
  role: OfferSizeLadderAnchorRole;
  widthCm: number;
  heightCm: number;
  productionPrice: number;
  shippingPrice: number;
  currency?: string | null;
  source?: "trello_ocr" | "manual" | "supplier_form" | "custom_fields";
  confidence?: number | null;
  rawText?: string | null;
};

export type OfferSizeLadderGenerateInput = {
  trelloCardId: string;
  trelloCardUrl?: string | null;
  offerId?: string | null;
  offerItemId?: string | null;
  designId?: string | null;
  productModel?: OfferSizeLadderProductModel | null;
  sourceText?: string | null;
  anchors: OfferSizeLadderAnchorInput[];
  stepCm?: number | null;
  maxLongSideCm?: number | null;
  customerFactor?: number | null;
  createdBy?: string | null;
  persist?: boolean;
};

export type OfferSizeLadderAnchor = Required<Pick<OfferSizeLadderAnchorInput, "role">> & {
  widthCm: number;
  heightCm: number;
  longSideCm: number;
  areaCm2: number;
  productionPrice: number;
  shippingPrice: number;
  supplierTotal: number;
  currency: string;
  source: "trello_ocr" | "manual" | "supplier_form" | "custom_fields";
  confidence: number | null;
  rawText: string | null;
};

export type OfferSizeLadderOption = {
  sizeLabel: string;
  widthCm: number;
  heightCm: number;
  longSideCm: number;
  areaCm2: number;
  productionPriceEstimated: number;
  shippingPriceEstimated: number;
  supplierTotalEstimated: number;
  customerFactor: number;
  customerUnitPriceNet: number;
  currency: string;
  customerCurrency: "EUR";
  modelKey: typeof OFFER_SIZE_LADDER_MODEL_KEY;
  modelVersion: typeof OFFER_SIZE_LADDER_MODEL_VERSION;
  confidence: number;
  reviewStatus: OfferSizeLadderReviewStatus;
  reviewReason: string | null;
  issues: string[];
  isDefault: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type OfferSizeLadderResult = {
  setKey: string;
  trelloCardId: string;
  trelloCardUrl: string | null;
  offerId: string | null;
  offerItemId: string | null;
  designId: string | null;
  productModel: OfferSizeLadderProductModel;
  pricingBasis: "new_supplier_direct_2_6";
  customerFactor: number;
  status: OfferSizeLadderSetStatus;
  confidence: number;
  issues: string[];
  warnings: string[];
  anchors: Record<OfferSizeLadderCoreAnchorRole, OfferSizeLadderAnchor>;
  anchorList: OfferSizeLadderAnchor[];
  options: OfferSizeLadderOption[];
  persisted?: {
    anchorSetId: string;
    optionCount: number;
    trelloProjection?: {
      written: boolean;
      fieldName: string;
      optionCount: number;
      createdField?: boolean;
      error?: string;
    };
  } | null;
};

type OfferSizeLadderAnchorSetRow = {
  id: string;
  set_key?: string;
  trello_card_id?: string;
  trello_card_url?: string | null;
  offer_id?: string | null;
  offer_item_id?: string | null;
  design_id?: string | null;
  product_model?: OfferSizeLadderProductModel;
  pricing_basis?: "new_supplier_direct_2_6" | "legacy_supplier_2_3" | "manual";
  customer_factor?: number | string;
  status?: OfferSizeLadderSetStatus;
  confidence?: number | string | null;
  issues?: string[] | null;
  warnings?: string[] | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type OfferSizeLadderOptionRow = {
  id: string;
  anchor_set_id: string;
  offer_id: string | null;
  offer_item_id: string | null;
  size_label: string;
  width_cm: number | string;
  height_cm: number | string;
  long_side_cm: number | string;
  area_cm2: number | string;
  production_price_estimated: number | string;
  shipping_price_estimated: number | string;
  supplier_total_estimated: number | string;
  customer_factor: number | string;
  customer_unit_price_net: number | string;
  currency: string;
  customer_currency: "EUR";
  model_key: typeof OFFER_SIZE_LADDER_MODEL_KEY;
  model_version: typeof OFFER_SIZE_LADDER_MODEL_VERSION;
  confidence: number | string;
  review_status: OfferSizeLadderReviewStatus;
  review_reason: string | null;
  issues: string[] | null;
  is_default: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
};

export type OfferSizeLadderDraft = Omit<OfferSizeLadderResult, "anchors" | "anchorList" | "persisted" | "pricingBasis"> & {
  anchorSetId: string;
  anchorList?: OfferSizeLadderAnchor[];
  pricingBasis: "new_supplier_direct_2_6" | "legacy_supplier_2_3" | "manual";
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OfferSizeLadderDraftLookupInput = {
  trelloCardId?: string | null;
  offerId?: string | null;
  offerItemId?: string | null;
  limit?: number | string | null;
};

export type OfferSizeLadderTrelloGenerateInput = Omit<OfferSizeLadderGenerateInput, "anchors" | "trelloCardId" | "trelloCardUrl"> & {
  trelloCard: string;
  optionOverrides?: OfferSizeLadderOptionOverrideInput[];
};

export type OfferSizeLadderOptionOverrideInput = {
  optionKey?: string | null;
  sizeLabel?: string | null;
  widthCm?: number | string | null;
  heightCm?: number | string | null;
  longSideCm?: number | string | null;
  customerUnitPriceNet?: number | string | null;
};

export type OfferSizeLadderTrelloAnchorExtraction = {
  anchors: OfferSizeLadderAnchorInput[];
  sourceText: string;
  warnings: string[];
};

export type OfferSizeLadderIndexedAnchorInput = OfferSizeLadderAnchorInput & {
  fieldIndex: number;
};

export type QuoteReadySizeLadderPreflightStatus = "ready" | "needs_review" | "blocked";
export type QuoteReadyOfferStructureProductType =
  | "neon"
  | "three_d"
  | "ultra_thin"
  | "lightbox_double_sided"
  | "acrylic_lightbox";

export type QuoteReadySizeLadderPreflightInput = Omit<OfferSizeLadderGenerateInput, "trelloCardId" | "trelloCardUrl" | "anchors"> & {
  trelloCard: string;
  projectToTrello?: boolean;
  commentToTrello?: boolean;
};

export type QuoteReadySizeLadderPreflightDesign = {
  designId: string;
  designIndex: number;
  sourceMockupName: string;
  sourceMockupNames: string[];
  anchorFieldIndexes: number[];
  anchorCount: number;
  productModel: OfferSizeLadderProductModel;
  sizeLadder: OfferSizeLadderResult;
};

export type QuoteReadySizeLadderPreflightResult = {
  status: QuoteReadySizeLadderPreflightStatus;
  trelloCardId: string;
  trelloCardUrl: string | null;
  trelloCardName: string | null;
  structureProductType: QuoteReadyOfferStructureProductType;
  sourceMockupsPerDesign: 1 | 2;
  sourceMockupCount: number;
  expectedDesignCount: number;
  anchorCount: number;
  anchorsPerDesign: number | null;
  issues: string[];
  warnings: string[];
  designs: QuoteReadySizeLadderPreflightDesign[];
  offerItemsJson: string | null;
  trelloComment: string;
  trelloProjection?: {
    written: boolean;
    fieldName: string;
    optionCount: number;
    createdField?: boolean;
    error?: string;
  } | null;
  commentProjection?: {
    written: boolean;
    skipped?: boolean;
    id?: string;
    error?: string;
  } | null;
};

export type ManualReleaseSizeLadderDecision = "ready" | "skipped" | "blocked";

export type ManualReleaseSizeLadderResult = {
  decision: ManualReleaseSizeLadderDecision;
  reason: string;
  manuallyApproved: true;
  trelloCardId: string;
  structureProductType: QuoteReadyOfferStructureProductType;
  productModels: OfferSizeLadderProductModel[];
  technicalIssues: string[];
  ignoredReviewWarnings: string[];
  offerItemsProjected: boolean;
  optionCount: number;
  quoteReadySizeLadder: QuoteReadySizeLadderPreflightResult;
};

export type OfferSizeLadderOfferApplyInput = OfferSizeLadderTrelloGenerateInput & {
  anchors?: OfferSizeLadderAnchorInput[];
  trelloCardId?: string | null;
  trelloCardUrl?: string | null;
  dryRun?: boolean;
  revisionReason?: string | null;
};

export type OfferSizeLadderOfferApplyResult = {
  dryRun: boolean;
  offer: OpsOfferSnapshot;
  diff: OpsOfferPatchResult["diff"];
  sizeLadder: OfferSizeLadderResult;
  applied: {
    targetItemId: string;
    targetItemTitle: string;
    optionCount: number;
    defaultSizeLabel: string;
    defaultUnitPriceNet: number;
    skippedBlockedOptions: number;
  };
};

function trimNullable(value: unknown) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function normalizeTrelloCardIdentifier(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const urlMatch = normalized.match(/trello\.com\/c\/([^/?#\s]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const prefixed = normalized.match(/^trello:([^/\s]+)$/i);
  if (prefixed?.[1]) return prefixed[1];
  if (/^[A-Za-z0-9]{6,32}$/.test(normalized)) return normalized;
  return null;
}

function normalizeFieldName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function compactFieldName(value: unknown) {
  return normalizeFieldName(value).replace(/[^a-z0-9]/g, "");
}

function customFieldEntries(customFields: CustomFieldMap) {
  return Object.entries(customFields || {})
    .map(([key, value]) => ({
      key,
      normalizedKey: normalizeFieldName(key),
      value: String(value || "").trim(),
    }))
    .filter((entry) => entry.value);
}

function findEditableCustomField(fields: TrelloEditableCustomField[] | undefined, names: string[]) {
  const wanted = new Set(names.map(normalizeFieldName));
  const compactWanted = new Set(names.map(compactFieldName));
  return (fields || []).find((field) => {
    const name = field.name || "";
    return wanted.has(normalizeFieldName(name)) || compactWanted.has(compactFieldName(name));
  }) || null;
}

function formatCmValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function offerItemPatch(item: OpsOfferItem): NonNullable<OpsOfferPatchInput["items"]>[number] {
  return {
    id: item.id,
    section: item.section || "LED-Leuchtschild",
    title: item.title,
    description: item.description || null,
    quantity: item.quantity,
    unitPriceNet: item.unitPriceNet,
    listPriceNet: item.listPriceNet,
    discountLabel: item.discountLabel || null,
    selectable: item.selectable,
    selectedByDefault: item.selectedByDefault,
    quantityEditable: item.quantityEditable,
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity,
    sortOrder: item.sortOrder,
  };
}

function isLikelySignOfferItem(item: OpsOfferItem) {
  const haystack = `${item.section || ""}\n${item.title || ""}`.toLowerCase();
  if (/\b(tischgeraet|tischgerät|tabletop|aufsteller|fernbedienung|dimmer|netzteil|trafo|montage|versand|shipping|express)\b/i.test(haystack)) {
    return false;
  }
  return /\b(led|neon|leucht|schild|logo|wandschild)\b/i.test(haystack);
}

function offerItemCandidateLabel(item: OpsOfferItem) {
  const size = sizeLabelFromOfferItem(item);
  return [
    `${item.id}: ${item.title}`,
    size ? size : null,
    Number.isFinite(item.unitPriceNet) ? `${item.unitPriceNet} EUR netto` : null,
  ].filter(Boolean).join(" · ");
}

function resolveOfferTargetItem(offer: OpsOfferSnapshot, itemId?: string | null) {
  const explicitItemId = trimNullable(itemId);
  if (explicitItemId) {
    const item = offer.items.find((entry) => entry.id === explicitItemId);
    if (!item) throw new QuoteValidationError("Ausgewaehlte Angebotsposition wurde nicht gefunden.", [], 404);
    return item;
  }

  const candidates = offer.items.filter(isLikelySignOfferItem);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0 && offer.items.length === 1) return offer.items[0];
  if (candidates.length > 1) {
    const selectedCandidates = candidates.filter((item) => item.selectedByDefault === true);
    if (selectedCandidates.length === 1) return selectedCandidates[0];
  }
  if (candidates.length > 1) {
    throw new QuoteValidationError(
      "Mehrere moegliche Schildpositionen im Angebot gefunden. Bitte zuerst die Offer Item ID der Zielposition eintragen.",
      candidates.map(offerItemCandidateLabel),
      409,
    );
  }
  throw new QuoteValidationError("Keine passende Schildposition im Angebot gefunden.", [], 409);
}

function upsertSizeLine(description: string | null | undefined, sizeLabel: string) {
  const lines = String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const nextLine = `Größe: ${sizeLabel}`;
  const index = lines.findIndex((line) => /^gr(?:ö|oe|o)ße\s*:/i.test(line));
  if (index >= 0) lines[index] = nextLine;
  else lines.unshift(nextLine);
  return lines.join("\n");
}

const internalOfferLinePattern =
  /(^|\b)(request[-_\s]?id|nerdy[-_\s]?forms[-_\s]?id|activecampaign|trello|kartenbeschreibung|karten[-_\s]?titel|board|list|workflow|n8n|internal|intern|interne notiz|öffentliche notiz|oeffentliche notiz|designgruppe\s*:\s*single-design|check\s*info|mockup\s*(prüfen|pruefen)|fehler|support@neontrip\.de)\b/i;
const internalOfferTitlePattern =
  /(^|\b)(request[-_\s]?id|activecampaign|trello|kartenbeschreibung|karten[-_\s]?titel|workflow|n8n|check\s*info|mockup\s*(prüfen|pruefen)|fehler)\b/i;

function sanitizeSizeLadderOfferLine(value: string | null | undefined) {
  const cleaned = String(value || "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || internalOfferLinePattern.test(cleaned)) return null;
  return cleaned;
}

function sanitizeSizeLadderOfferDescription(value: string | null | undefined) {
  const lines = String(value || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => sanitizeSizeLadderOfferLine(line))
    .filter((line): line is string => Boolean(line));
  return lines.length ? lines.join("\n") : null;
}

function sanitizeSizeLadderOfferTitle(value: string | null | undefined) {
  const cleaned = titleWithoutSizeFragments(value);
  if (!cleaned || internalOfferTitlePattern.test(cleaned)) return "Leuchtschild Design";
  return cleaned;
}

function normalizedDescriptionWithoutSize(value: string | null | undefined) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((line) => !/^(größe|groesse|grösse|size|maße|masse|abmessung|abmessungen|breite|höhe|hoehe|width|height)\s*:/i.test(line))
    .join("|");
}

function sizeLabelFromDescription(value: string | null | undefined) {
  const explicit = String(value || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^gr(?:ö|oe|o)ße\s*:/i.test(line));
  if (explicit) return explicit.replace(/^gr(?:ö|oe|o)ße\s*:\s*/i, "").trim();
  return null;
}

function hasSizeSignal(value: string | null | undefined) {
  const text = String(value || "");
  return /(\d+(?:[.,]\d+)?)\s*(?:x|\*|×|\/)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i.test(text) ||
    /\b\d+(?:[.,]\d+)?\s*cm\b/i.test(text);
}

function sizeLabelFromOfferItem(item: OpsOfferItem) {
  const explicit = sizeLabelFromDescription(item.description);
  if (explicit) return explicit;
  const parsed = parseSizeText(`${item.title}\n${item.description || ""}`);
  if (parsed) return `${formatCmValue(parsed.widthCm)} x ${formatCmValue(parsed.heightCm)}cm`;
  return null;
}

function titleWithoutSizeFragments(value: string | null | undefined) {
  const cleaned = String(value || "")
    .replace(/\b(?:\d+(?:[.,]\d+)?\s*\/\s*)+\d+(?:[.,]\d+)?\s*cm\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x|\*|×|\/)\s*\d+(?:[.,]\d+)?\s*(?:cm)?\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*cm\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || String(value || "").trim();
}

function normalizedOfferItemTitle(value: string | null | undefined) {
  return titleWithoutSizeFragments(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isSameTitleSignItem(item: OpsOfferItem, normalizedTitle: string) {
  return isLikelySignOfferItem(item) && normalizedOfferItemTitle(item.title) === normalizedTitle;
}

function hasCompatibleVariantDescription(item: OpsOfferItem, targetSpec: string) {
  const itemSpec = normalizedDescriptionWithoutSize(item.description);
  if (itemSpec === targetSpec) return true;
  if (!targetSpec || !hasSizeSignal(`${item.title}\n${item.description || ""}`)) return false;
  if (!itemSpec) return true;
  return itemSpec.includes(targetSpec) || targetSpec.includes(itemSpec);
}

function sameDesignSizeVariantItems(offer: OpsOfferSnapshot, targetItem: OpsOfferItem) {
  const targetTitle = normalizedOfferItemTitle(targetItem.title);
  const targetSpec = normalizedDescriptionWithoutSize(targetItem.description);
  const exactOrCompatible = offer.items
    .filter((item) => {
      if (item.id === targetItem.id) return true;
      if (!isSameTitleSignItem(item, targetTitle)) return false;
      return hasCompatibleVariantDescription(item, targetSpec);
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const variantsById = new Map(exactOrCompatible.map((item) => [item.id, item]));
  const targetIndex = offer.items.findIndex((item) => item.id === targetItem.id);

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const item = offer.items[index];
    if (!item || !isSameTitleSignItem(item, targetTitle) || !hasSizeSignal(`${item.title}\n${item.description || ""}`)) break;
    variantsById.set(item.id, item);
  }
  for (let index = targetIndex + 1; index < offer.items.length; index += 1) {
    const item = offer.items[index];
    if (!item || !isSameTitleSignItem(item, targetTitle) || !hasSizeSignal(`${item.title}\n${item.description || ""}`)) break;
    variantsById.set(item.id, item);
  }

  return Array.from(variantsById.values()).sort((left, right) => left.sortOrder - right.sortOrder);
}

function readCustomFieldValue(customFields: CustomFieldMap, names: string[]) {
  const entries = customFieldEntries(customFields);
  const wanted = new Set(names.map(normalizeFieldName));
  return entries.find((entry) => wanted.has(entry.normalizedKey))?.value || null;
}

function readCustomFieldByPattern(customFields: CustomFieldMap, patterns: RegExp[]) {
  return customFieldEntries(customFields).find((entry) => patterns.some((pattern) => pattern.test(entry.normalizedKey)))?.value || null;
}

function numericText(value: string) {
  return Number(String(value || "").replace(",", "."));
}

function parseSizeText(value: string | null | undefined) {
  const match = String(value || "").match(/(\d+(?:[.,]\d+)?)\s*(?:x|\*|×|\/)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i);
  if (!match) return null;
  const widthCm = numericText(match[1] || "");
  const heightCm = numericText(match[2] || "");
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) return null;
  return { widthCm, heightCm, raw: match[0] };
}

function parseMoneyNumber(value: string | null | undefined) {
  const match = String(value || "").match(/(?:us\$|\$|usd|eur)?\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return null;
  const parsed = numericText(match[1] || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePriceAfterLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*(?:price|cost|preis)?\\s*:?\\s*(?:us\\$|\\$|usd|eur)?\\s*(\\d+(?:[.,]\\d+)?)`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return numericText(match[1]);
  }
  return null;
}

function moneyNumbersAfterSize(text: string, sizeRaw?: string | null) {
  const withoutSize = sizeRaw ? text.replace(sizeRaw, " ") : text;
  return Array.from(withoutSize.matchAll(/(?:us\$|\$|usd|eur)?\s*(\d+(?:[.,]\d+)?)/gi))
    .map((match) => numericText(match[1] || ""))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function splitTotalSupplierPrice(total: number) {
  const productionPrice = round2(total * 0.45);
  return {
    productionPrice,
    shippingPrice: round2(total - productionPrice),
  };
}

const CORE_ANCHOR_ROLES = ["minimum", "requested", "max_250"] as const;
const NOMINAL_MAX_ANCHOR_LONG_SIDE_CM = 250;
const NOMINAL_MAX_ANCHOR_TOLERANCE_CM = 0.5;

const ROLE_ALIASES: Record<OfferSizeLadderCoreAnchorRole, { index: number; names: string[] }> = {
  minimum: {
    index: 1,
    names: ["minimum", "min", "kleinst", "kleinstmoeglich", "kleinstmoglich", "smallest", "custom field 1", "field 1", "anker 1", "anchor 1"],
  },
  requested: {
    index: 2,
    names: ["kundenwunsch", "kunde", "requested", "customer request", "angefragt", "anfrage", "custom field 2", "field 2", "anker 2", "anchor 2"],
  },
  max_250: {
    index: 3,
    names: ["250", "250cm", "250 cm", "max 250", "maximum", "custom field 3", "field 3", "anker 3", "anchor 3"],
  },
};

function indexedFieldNames(index: number, kind: "size" | "production" | "shipping" | "total") {
  if (kind === "size") return [`Size_${index}`, `Size ${index}`, `Größe ${index}`, `Groesse ${index}`, `Mass ${index}`, `Maß ${index}`];
  if (kind === "production") return [`Production_${index}`, `Production ${index}`, `Production Price_${index}`, `Production Price ${index}`, `Prod_${index}`, `Prod ${index}`];
  if (kind === "shipping") return [`Shipping_${index}`, `Shipping ${index}`, `Shipping Cost_${index}`, `Shipping Cost ${index}`, `Ship_${index}`, `Ship ${index}`];
  return [`Price_${index}`, `Price ${index}`, `Preis ${index}`, `Total_${index}`, `Total ${index}`, `Supplier Total ${index}`];
}

function roleFieldNames(role: OfferSizeLadderCoreAnchorRole, kind: "size" | "production" | "shipping" | "total") {
  const { index, names } = ROLE_ALIASES[role];
  const suffixNames = indexedFieldNames(index, kind);
  const roleNames = names.flatMap((name) => {
    if (kind === "size") return [`${name} size`, `${name} groesse`, `${name} größe`, `${name} mass`, `${name} maß`];
    if (kind === "production") return [`${name} production`, `${name} production price`, `${name} prod`];
    if (kind === "shipping") return [`${name} shipping`, `${name} shipping cost`, `${name} ship`];
    return [`${name} price`, `${name} preis`, `${name} total`, `${name} supplier total`];
  });
  return [...suffixNames, ...roleNames];
}

function combinedRoleFieldValues(customFields: CustomFieldMap, role: OfferSizeLadderCoreAnchorRole) {
  const aliases = ROLE_ALIASES[role].names.map(normalizeFieldName);
  return customFieldEntries(customFields)
    .filter((entry) => aliases.some((alias) => entry.normalizedKey === alias || entry.normalizedKey.includes(alias)))
    .map((entry) => `${entry.key}: ${entry.value}`);
}

function parseAnchorFromText(role: OfferSizeLadderAnchorRole, text: string, warnings: string[]) {
  const size = parseSizeText(text);
  const productionPrice =
    parsePriceAfterLabels(text, ["production", "prod", "herstellung"]) ??
    null;
  const shippingPrice =
    parsePriceAfterLabels(text, ["shipping", "ship", "versand", "fracht"]) ??
    null;
  if (size && productionPrice !== null && shippingPrice !== null) {
    return {
      role,
      widthCm: size.widthCm,
      heightCm: size.heightCm,
      productionPrice,
      shippingPrice,
      currency: "USD",
      source: "custom_fields" as const,
      confidence: 0.9,
      rawText: text,
    };
  }

  const numbers = moneyNumbersAfterSize(text, size?.raw);
  if (size && numbers.length >= 2) {
    return {
      role,
      widthCm: size.widthCm,
      heightCm: size.heightCm,
      productionPrice: numbers[0]!,
      shippingPrice: numbers[1]!,
      currency: "USD",
      source: "custom_fields" as const,
      confidence: 0.72,
      rawText: text,
    };
  }

  if (size && numbers.length === 1) {
    warnings.push(`${role}_total_only_estimated_split`);
    return {
      role,
      widthCm: size.widthCm,
      heightCm: size.heightCm,
      ...splitTotalSupplierPrice(numbers[0]!),
      currency: "USD",
      source: "custom_fields" as const,
      confidence: 0.48,
      rawText: text,
    };
  }
  return null;
}

function customFieldIndexes(customFields: CustomFieldMap) {
  const indexes = new Set<number>();
  for (const entry of customFieldEntries(customFields)) {
    const match = entry.normalizedKey.match(/(?:^| )(?:size|groesse|production|production price|prod|shipping|shipping cost|ship|price|preis|total|supplier total) (\d+)(?:$| )/);
    const index = Number(match?.[1]);
    if (Number.isInteger(index) && index > 0 && index <= 20) indexes.add(index);
  }
  return Array.from(indexes).sort((a, b) => a - b);
}

function sortedAnchorRole(anchor: Pick<OfferSizeLadderAnchorInput, "widthCm" | "heightCm">, index: number): OfferSizeLadderAnchorRole {
  const longSideCm = Math.max(Number(anchor.widthCm), Number(anchor.heightCm));
  if (index === 0) return "minimum";
  if (Math.abs(longSideCm - NOMINAL_MAX_ANCHOR_LONG_SIDE_CM) <= NOMINAL_MAX_ANCHOR_TOLERANCE_CM) return "max_250";
  if (index === 1) return "requested";
  return `anchor_${index + 1}`;
}

function normalizeExtractedAnchorRoles<T extends OfferSizeLadderAnchorInput>(anchors: T[]): T[] {
  const sorted = [...anchors].sort((left, right) => {
    const leftLongSide = Math.max(Number(left.widthCm), Number(left.heightCm));
    const rightLongSide = Math.max(Number(right.widthCm), Number(right.heightCm));
    if (Math.abs(leftLongSide - rightLongSide) > 0.001) return leftLongSide - rightLongSide;
    return Number(left.widthCm) * Number(left.heightCm) - Number(right.widthCm) * Number(right.heightCm);
  });
  return sorted.map((anchor, index) => {
    const role = sortedAnchorRole(anchor, index);
    return { ...anchor, role } as T;
  });
}

function extractIndexedTrelloAnchors(customFields: CustomFieldMap, warnings: string[]): OfferSizeLadderIndexedAnchorInput[] {
  const anchors: OfferSizeLadderIndexedAnchorInput[] = [];
  for (const index of customFieldIndexes(customFields)) {
    const role = `anchor_${index}` as OfferSizeLadderAnchorRole;
    const sizeText = readCustomFieldValue(customFields, indexedFieldNames(index, "size"));
    const productionText = readCustomFieldValue(customFields, indexedFieldNames(index, "production"));
    const shippingText = readCustomFieldValue(customFields, indexedFieldNames(index, "shipping"));
    const totalText = readCustomFieldValue(customFields, indexedFieldNames(index, "total"));
    const size = parseSizeText(sizeText);
    if (!size) continue;

    const productionPrice = parseMoneyNumber(productionText);
    const shippingPrice = parseMoneyNumber(shippingText);
    if (productionPrice !== null && shippingPrice !== null) {
      anchors.push({
        role,
        fieldIndex: index,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
        productionPrice,
        shippingPrice,
        currency: "USD",
        source: "custom_fields",
        confidence: 0.9,
        rawText: [sizeText, productionText, shippingText].filter(Boolean).join(" | "),
      });
      continue;
    }

    const totalPrice = parseMoneyNumber(totalText);
    if (totalPrice !== null) {
      warnings.push(`anchor_${index}_total_only_estimated_split`);
      anchors.push({
        role,
        fieldIndex: index,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
        ...splitTotalSupplierPrice(totalPrice),
        currency: "USD",
        source: "custom_fields",
        confidence: 0.48,
        rawText: [sizeText, totalText].filter(Boolean).join(" | "),
      });
    }
  }
  return normalizeExtractedAnchorRoles(anchors);
}

export function extractOfferSizeLadderAnchorsFromTrelloFields(customFields: CustomFieldMap): OfferSizeLadderTrelloAnchorExtraction {
  const warnings: string[] = [];
  const sourceText = customFieldEntries(customFields).map((entry) => `${entry.key}: ${entry.value}`).join("\n");
  const indexedAnchors = extractIndexedTrelloAnchors(customFields, warnings);
  if (indexedAnchors.length >= 1) return { anchors: indexedAnchors, sourceText, warnings };

  const anchors: OfferSizeLadderAnchorInput[] = [];
  for (const role of CORE_ANCHOR_ROLES) {
    const sizeText =
      readCustomFieldValue(customFields, roleFieldNames(role, "size")) ||
      readCustomFieldByPattern(customFields, [
        new RegExp(`(?:^| )size ${ROLE_ALIASES[role].index}(?:$| )`),
        new RegExp(`(?:^| )groesse ${ROLE_ALIASES[role].index}(?:$| )`),
      ]);
    const productionText = readCustomFieldValue(customFields, roleFieldNames(role, "production"));
    const shippingText = readCustomFieldValue(customFields, roleFieldNames(role, "shipping"));
    const totalText = readCustomFieldValue(customFields, roleFieldNames(role, "total"));
    const size = parseSizeText(sizeText);
    const productionPrice = parseMoneyNumber(productionText);
    const shippingPrice = parseMoneyNumber(shippingText);

    if (size && productionPrice !== null && shippingPrice !== null) {
      anchors.push({
        role,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
        productionPrice,
        shippingPrice,
        currency: "USD",
        source: "custom_fields",
        confidence: 0.9,
        rawText: [sizeText, productionText, shippingText].filter(Boolean).join(" | "),
      });
      continue;
    }

    const totalPrice = parseMoneyNumber(totalText);
    if (size && totalPrice !== null) {
      warnings.push(`${role}_total_only_estimated_split`);
      anchors.push({
        role,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
        ...splitTotalSupplierPrice(totalPrice),
        currency: "USD",
        source: "custom_fields",
        confidence: 0.48,
        rawText: [sizeText, totalText].filter(Boolean).join(" | "),
      });
      continue;
    }

    const combinedText = combinedRoleFieldValues(customFields, role).join("\n");
    const combinedAnchor = combinedText ? parseAnchorFromText(role, combinedText, warnings) : null;
    if (combinedAnchor) anchors.push(combinedAnchor);
  }

  if (anchors.length < 2) {
    const present = new Set(anchors.map((anchor) => anchor.role));
    for (const role of CORE_ANCHOR_ROLES) {
      if (!present.has(role)) warnings.push(`${role}_custom_field_anchor_missing`);
    }
  }

  return { anchors: normalizeExtractedAnchorRoles(anchors), sourceText, warnings };
}

function requiredPositiveNumber(name: string, value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new QuoteValidationError(`${name} muss groesser 0 sein.`);
  }
  return parsed;
}

function nonNegativeNumber(name: string, value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new QuoteValidationError(`${name} darf nicht negativ sein.`);
  }
  return parsed;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function roundDimension(value: number) {
  return Math.round(value * 10) / 10;
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function numberFromRow(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArrayFromRow(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item === null || item === undefined) return "";
      if (typeof item === "string") return item;
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      if (typeof item === "object") {
        const record = item as Record<string, unknown>;
        const preferred = record.message || record.error || record.code || record.reason || record.text;
        if (preferred) return String(preferred);
        try {
          return JSON.stringify(record);
        } catch {
          return "unlesbarer_issue_eintrag";
        }
      }
      return String(item);
    })
    .filter(Boolean);
}

function defaultSizeLabel(widthCm: number, heightCm: number) {
  const width = Number.isInteger(widthCm) ? String(widthCm) : widthCm.toFixed(1);
  const height = Number.isInteger(heightCm) ? String(heightCm) : heightCm.toFixed(1);
  return `${width} x ${height}cm`;
}

function optionOverrideKey(option: Pick<OfferSizeLadderOption, "longSideCm" | "widthCm" | "heightCm" | "sizeLabel">) {
  return `${option.longSideCm}:${option.widthCm}:${option.heightCm}:${option.sizeLabel}`;
}

function optionOverrideInputKey(input: OfferSizeLadderOptionOverrideInput) {
  const explicit = trimNullable(input.optionKey);
  if (explicit) return explicit;
  const sizeLabel = trimNullable(input.sizeLabel);
  if (
    sizeLabel &&
    input.longSideCm !== null &&
    input.longSideCm !== undefined &&
    input.widthCm !== null &&
    input.widthCm !== undefined &&
    input.heightCm !== null &&
    input.heightCm !== undefined
  ) {
    return `${Number(input.longSideCm)}:${Number(input.widthCm)}:${Number(input.heightCm)}:${sizeLabel}`;
  }
  return null;
}

export function applyOfferSizeLadderOptionOverrides(
  result: OfferSizeLadderResult,
  overrides: OfferSizeLadderOptionOverrideInput[] | null | undefined,
) {
  if (!overrides?.length) return result;
  const overrideByKey = new Map<string, number>();
  for (const override of overrides) {
    const key = optionOverrideInputKey(override);
    if (!key) continue;
    const price = nonNegativeNumber("Manueller Angebotspreis", override.customerUnitPriceNet);
    if (price > 1_000_000) {
      throw new QuoteValidationError("Manueller Angebotspreis ist unplausibel hoch.", [key], 400);
    }
    overrideByKey.set(key, round2(price));
  }
  if (!overrideByKey.size) return result;

  let changedCount = 0;
  const options = result.options.map((option) => {
    const overridePrice = overrideByKey.get(optionOverrideKey(option));
    if (overridePrice === undefined) return option;
    const changed = Math.abs(overridePrice - option.customerUnitPriceNet) >= 0.01;
    if (!changed) return option;
    changedCount += 1;
    return {
      ...option,
      customerUnitPriceNet: overridePrice,
      reviewStatus: option.reviewStatus === "auto_ok" ? ("needs_review" as const) : option.reviewStatus,
      reviewReason: option.reviewReason || "manual_offer_price_override",
      issues: !option.issues.includes("manual_offer_price_override")
        ? [...option.issues, "manual_offer_price_override"]
        : option.issues,
      metadata: {
        ...option.metadata,
        manual_offer_price_override: true,
        calculated_customer_unit_price_net: option.customerUnitPriceNet,
      },
    };
  });
  if (!changedCount) return result;

  return {
    ...result,
    status: result.status === "draft" ? "needs_review" : result.status,
    warnings: result.warnings.includes("manual_offer_price_overrides")
      ? result.warnings
      : [...result.warnings, "manual_offer_price_overrides"],
    options,
  };
}

export function validateOfferItemsJsonProjection(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new QuoteValidationError("Trello offer_items_json ist kein gültiges JSON.", ["offer_items_json"], 422);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new QuoteValidationError("Trello offer_items_json muss mindestens eine Angebotsposition enthalten.", ["offer_items_json"], 422);
  }
  if (parsed.length > OFFER_SIZE_LADDER_MAX_OFFER_ITEMS) {
    throw new QuoteValidationError(
      `Trello offer_items_json enthält ${parsed.length} Positionen, erlaubt sind maximal ${OFFER_SIZE_LADDER_MAX_OFFER_ITEMS}.`,
      ["offer_items_json"],
      422,
    );
  }

  const requireText = (item: Record<string, unknown>, index: number, field: "section" | "title") => {
    if (typeof item[field] !== "string" || !item[field].trim()) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1}: ${field} fehlt.`,
        [`items.${index}.${field}`],
        422,
      );
    }
  };
  const optionalPositiveInt = (item: Record<string, unknown>, index: number, field: "minQuantity" | "maxQuantity") => {
    const fieldValue = item[field];
    if (fieldValue === undefined || fieldValue === null) return undefined;
    if (!Number.isInteger(fieldValue) || Number(fieldValue) < 1 || Number(fieldValue) > 999) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1}: ${field} muss eine ganze Zahl zwischen 1 und 999 sein.`,
        [`items.${index}.${field}`],
        422,
      );
    }
    return Number(fieldValue);
  };

  parsed.forEach((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1} ist kein gültiges Objekt.`,
        [`items.${index}`],
        422,
      );
    }
    const item = rawItem as Record<string, unknown>;
    requireText(item, index, "section");
    requireText(item, index, "title");
    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1}: quantity muss eine ganze Zahl zwischen 1 und 999 sein.`,
        [`items.${index}.quantity`],
        422,
      );
    }
    const unitPrice = item.customerUnitPriceNet ?? item.unitPriceNet;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1}: customerUnitPriceNet ist ungültig.`,
        [`items.${index}.customerUnitPriceNet`],
        422,
      );
    }
    for (const field of ["selectable", "selectedByDefault", "quantityEditable"] as const) {
      if (item[field] !== undefined && typeof item[field] !== "boolean") {
        throw new QuoteValidationError(
          `Angebotsposition ${index + 1}: ${field} muss boolean sein.`,
          [`items.${index}.${field}`],
          422,
        );
      }
    }
    const minQuantity = optionalPositiveInt(item, index, "minQuantity");
    const maxQuantity = optionalPositiveInt(item, index, "maxQuantity");
    if (minQuantity !== undefined && maxQuantity !== undefined && minQuantity > maxQuantity) {
      throw new QuoteValidationError(
        `Angebotsposition ${index + 1}: minQuantity darf nicht größer als maxQuantity sein.`,
        [`items.${index}.minQuantity`, `items.${index}.maxQuantity`],
        422,
      );
    }
  });

  return parsed as Array<Record<string, unknown>>;
}

function offerItemsJsonForTrelloProjection(card: TrelloCardData, result: OfferSizeLadderResult) {
  const options = result.options
    .filter((option) => option.reviewStatus !== "blocked")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.longSideCm - b.longSideCm);
  if (!options.length) {
    throw new QuoteValidationError("Keine freigegebenen Größenoptionen für Trello offer_items_json vorhanden.", [], 409);
  }
  if (options.length > OFFER_SIZE_LADDER_MAX_OPTIONS) {
    throw new QuoteValidationError("Zu viele Größenoptionen für Trello offer_items_json.", [], 409);
  }

  const customFields = card.customFields || {};
  const color = readCustomFieldValue(customFields, ["Color_1", "Color", "Farbe_1", "Farbe", "Light_Color_1", "Leuchtfarbe_1"]);
  const backboard = readCustomFieldValue(customFields, ["Backboard_1", "Backboard", "Rueckplatte_1", "Rückplatte_1", "Rueckplatte", "Rückplatte"]);
  const usage = readCustomFieldValue(customFields, ["Usage_1", "Usage", "Einsatzort_1", "Einsatzort", "Einsatzbereich"]);
  const defaultOption = options.find((option) => option.isDefault) || options[0]!;

  return JSON.stringify(options.map((option) => ({
    section: "LED-Leuchtschild",
    title: "Leuchtschild Design",
    description: [
      `Größe: ${option.sizeLabel}`,
      color ? `Leuchtfarbe: ${color}` : null,
      backboard ? `Rückplatte: ${backboard}` : null,
      usage ? `Einsatzort: ${usage}` : null,
    ].filter(Boolean).join("\n"),
    quantity: 1,
    customerUnitPriceNet: option.customerUnitPriceNet,
    selectable: true,
    selectedByDefault: option === defaultOption,
    quantityEditable: true,
    minQuantity: 1,
    sizeLadder: {
      source: "ops_price_review",
      modelKey: option.modelKey,
      modelVersion: option.modelVersion,
      confidence: option.confidence,
      reviewStatus: option.reviewStatus,
      widthCm: option.widthCm,
      heightCm: option.heightCm,
      longSideCm: option.longSideCm,
    },
  })));
}

async function projectOfferSizeLadderToTrello(card: TrelloCardData, result: OfferSizeLadderResult) {
  let field = findEditableCustomField(card.editableFields, ["offer_items_json", "Offer Items JSON", "Offer_Items_JSON"]);
  let createdField = false;

  if (!field) {
    if (!card.idBoard) {
      return {
        written: false,
        fieldName: "offer_items_json",
        optionCount: result.options.filter((option) => option.reviewStatus !== "blocked").length,
        error: "trello_offer_items_json_board_missing",
      };
    }

    const created = await createTrelloBoardCustomField({
      boardId: card.idBoard,
      name: "offer_items_json",
      type: "text",
      pos: "bottom",
      displayCardFront: false,
    });
    field = {
      id: created.id,
      name: created.name || "offer_items_json",
      type: created.type || "text",
      value: null,
      displayValue: null,
      options: [],
    };
    createdField = true;
  }

  const value = offerItemsJsonForTrelloProjection(card, result);
  validateOfferItemsJsonProjection(value);
  await updateTrelloCustomField({
    cardId: card.id,
    fieldId: field.id,
    type: field.type || "text",
    value,
  });
  return {
    written: true,
    fieldName: field.name,
    optionCount: JSON.parse(value).length,
    createdField,
  };
}

const QUOTE_READY_SIZE_LADDER_COMMENT_MARKER = "[NEONTRIP_SIZE_LADDER_PREFLIGHT]";
const mockupFilePattern = /^Mockup((?:\d+)|(?:(?:_\d+)+)(?:\.\d+)*)(?:_ai_(\d+))?\.(jpe?g|png|webp)$/i;

function trelloAttachmentName(attachment: { name?: string | null; fileName?: string | null }) {
  return String(attachment.name || attachment.fileName || "").trim();
}

function parseMockupName(name: string | null | undefined) {
  const match = String(name || "").trim().match(mockupFilePattern);
  if (!match) return null;
  const sourceToken = match[1] || "";
  const normalizedSourceToken = sourceToken.replace(/\./g, "_").toLowerCase();
  const aiIndex = match[2] ? Number(match[2]) : null;
  if (aiIndex !== null && (!Number.isFinite(aiIndex) || aiIndex < 1)) return null;
  return { sourceToken, normalizedSourceToken, aiIndex };
}

function isQuoteReadySourceMockupName(name: string | null | undefined) {
  const normalized = String(name || "").trim();
  if (!normalized) return false;
  if (/(?:^|[_\-\s])(?:ai|ki)(?:[_\-\s]|\d)/i.test(normalized)) return false;
  const parsed = parseMockupName(normalized);
  return Boolean(parsed && parsed.aiIndex === null);
}

function sourceMockupSortValue(name: string) {
  const parsed = parseMockupName(name);
  if (!parsed) return Number.POSITIVE_INFINITY;
  const numeric = Number(parsed.normalizedSourceToken.replace(/_/g, ""));
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

function listQuoteReadySourceMockups(card: TrelloCardData) {
  return (card.attachments || [])
    .map((attachment) => ({ name: trelloAttachmentName(attachment), attachment }))
    .filter((entry) => isQuoteReadySourceMockupName(entry.name))
    .sort((left, right) => sourceMockupSortValue(left.name) - sourceMockupSortValue(right.name) || left.name.localeCompare(right.name, "de"));
}

type QuoteReadyOfferStructure = {
  productType: QuoteReadyOfferStructureProductType;
  sourceMockupsPerDesign: 1 | 2;
};

function detectQuoteReadyProductType(text: string | null | undefined): QuoteReadyOfferStructureProductType | null {
  const normalized = String(text || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase();
  if (!normalized.trim()) return null;

  if (
    /(?:light\s*box|lightbox|lichtbox|lichtkasten)\s*(?:double\s*-?\s*sided|doppelseitig|zweiseitig|beidseitig)|(?:double\s*-?\s*sided|doppelseitig|zweiseitig|beidseitig)\s*(?:light\s*box|lightbox|lichtbox|lichtkasten)|nasenschild/.test(normalized)
  ) {
    return "lightbox_double_sided";
  }
  if (/ultra\s*-?\s*thin/.test(normalized)) return "ultra_thin";
  if (/acryl(?:ic)?\s*-?\s*(?:light\s*-?\s*box|lightbox)|(?:light\s*-?\s*box|lightbox)\s*-?\s*acryl(?:ic)?/.test(normalized)) {
    return "acrylic_lightbox";
  }
  if (/\b3\s*-?\s*d\b|front\s*-?\s*lit|front\s*beleuchtet|back\s*-?\s*lit|r(?:ü|ue|u)ck\s*beleuchtet|hinter\s*(?:be)?leuchtet|non\s*-?\s*lit|nonlit|unbeleuchtet|nicht\s*beleuchtet|full\s*-?\s*glow|fullglow/.test(normalized)) {
    return "three_d";
  }
  if (/led\s*-?\s*neon|neon\s*flex|neonflex|led\s*flex|(?:led|neon)?\s*schriftzug/.test(normalized)) {
    return "neon";
  }
  return null;
}

function explicitQuoteReadyProductContext(customFields: CustomFieldMap) {
  return customFieldEntries(customFields)
    .filter(({ normalizedKey }) => /^(?:product|produkt|product type|produkttyp|produktart|template|offer template|angebot template|schildart|sign type)(?: \d+)?$/.test(normalizedKey))
    .map(({ value }) => value)
    .join("\n");
}

export function resolveQuoteReadyOfferStructure(card: TrelloCardData): QuoteReadyOfferStructure {
  const productType = detectQuoteReadyProductType(card.name)
    || detectQuoteReadyProductType(explicitQuoteReadyProductContext(card.customFields || {}))
    || "neon";
  return {
    productType,
    sourceMockupsPerDesign: productType === "neon" ? 1 : 2,
  };
}

function groupQuoteReadySourceMockups(
  sourceMockups: ReturnType<typeof listQuoteReadySourceMockups>,
  sourceMockupsPerDesign: 1 | 2,
) {
  const groups: Array<typeof sourceMockups> = [];
  for (let index = 0; index < sourceMockups.length; index += sourceMockupsPerDesign) {
    groups.push(sourceMockups.slice(index, index + sourceMockupsPerDesign));
  }
  return groups;
}

function productModelForQuoteReadyStructure(
  structure: QuoteReadyOfferStructure,
  sourceText: string,
): OfferSizeLadderProductModel {
  if (structure.productType === "three_d") {
    return /full\s*-?\s*glow|fullglow/i.test(sourceText) ? "full_glow" : "three_d";
  }
  if (structure.productType !== "neon") return "acryl_light_box";

  const normalized = sourceText.toLowerCase();
  if (/uv[\s-]*print|uvdruck|uv[\s-]*druck|print\s+on\s+acrylic/.test(normalized)) return "uv_print";
  if (/outdoor|aussen|außen|wasserdicht|wetterfest|ip65|ip67/.test(normalized)) return "outdoor";
  if (/neon\s*flex|neonflex|led\s*flex|led\s+logo|wandschild|led[\s-]*neon/.test(normalized)) return "neonflex";
  return "unknown";
}

function indexedDesignFieldValue(customFields: CustomFieldMap, index: number, kind: "color" | "backboard" | "usage" | "product") {
  if (kind === "color") {
    return readCustomFieldValue(customFields, [
      `Color_${index}`,
      `Color ${index}`,
      `Farbe_${index}`,
      `Farbe ${index}`,
      `Light_Color_${index}`,
      `Leuchtfarbe_${index}`,
      "Color",
      "Farbe",
      "Light_Color",
      "Leuchtfarbe",
    ]);
  }
  if (kind === "backboard") {
    return readCustomFieldValue(customFields, [
      `Backboard_${index}`,
      `Backboard ${index}`,
      `Rueckplatte_${index}`,
      `Rückplatte_${index}`,
      `Rueckplatte ${index}`,
      `Rückplatte ${index}`,
      "Backboard",
      "Rueckplatte",
      "Rückplatte",
    ]);
  }
  if (kind === "usage") {
    return readCustomFieldValue(customFields, [
      `Usage_${index}`,
      `Usage ${index}`,
      `Einsatzort_${index}`,
      `Einsatzort ${index}`,
      `Einsatzbereich_${index}`,
      "Usage",
      "Einsatzort",
      "Einsatzbereich",
    ]);
  }
  return readCustomFieldValue(customFields, [
    `Product_${index}`,
    `Product ${index}`,
    `Produkt_${index}`,
    `Produkt ${index}`,
    `Product Type_${index}`,
    `Product Type ${index}`,
    `Produkttyp_${index}`,
    `Produktart_${index}`,
    "Product",
    "Produkt",
    "Product Type",
    "Produkttyp",
    "Produktart",
  ]);
}

function sourceTextForAnchorGroup(params: {
  card: TrelloCardData;
  inputSourceText?: string | null;
  sourceMockupName: string;
  fieldIndexes: number[];
  anchors: OfferSizeLadderAnchorInput[];
}) {
  const { card, fieldIndexes } = params;
  const customFields = card.customFields || {};
  const indexedValues = fieldIndexes.flatMap((index) => [
    indexedDesignFieldValue(customFields, index, "product"),
    indexedDesignFieldValue(customFields, index, "color"),
    indexedDesignFieldValue(customFields, index, "backboard"),
    indexedDesignFieldValue(customFields, index, "usage"),
  ]);
  return [
    card.name,
    card.desc,
    params.inputSourceText,
    params.sourceMockupName,
    ...indexedValues,
    ...params.anchors.map((anchor) => anchor.rawText),
  ].filter(Boolean).join("\n");
}

function distributeAnchorGroups(anchors: OfferSizeLadderIndexedAnchorInput[], designCount: number) {
  const sorted = [...anchors].sort((left, right) => left.fieldIndex - right.fieldIndex);
  const base = Math.floor(sorted.length / designCount);
  const remainder = sorted.length % designCount;
  const groups: OfferSizeLadderIndexedAnchorInput[][] = [];
  let offset = 0;
  for (let index = 0; index < designCount; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    groups.push(sorted.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}

function publicOfferItemsForQuoteReadyPreflight(card: TrelloCardData, result: QuoteReadySizeLadderPreflightResult) {
  const items: Array<Record<string, unknown>> = [];
  for (const design of result.designs) {
    const options = design.sizeLadder.options
      .filter((option) => option.reviewStatus !== "blocked")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.longSideCm - b.longSideCm);
    if (!options.length) continue;

    const firstFieldIndex = design.anchorFieldIndexes[0] || design.designIndex;
    const customFields = card.customFields || {};
    const color = indexedDesignFieldValue(customFields, firstFieldIndex, "color");
    const backboard = indexedDesignFieldValue(customFields, firstFieldIndex, "backboard");
    const usage = indexedDesignFieldValue(customFields, firstFieldIndex, "usage");
    const defaultOption = options.find((option) => option.isDefault) || options[0]!;
    const title = result.expectedDesignCount > 1 ? `Leuchtschild Design ${design.designIndex}` : "Leuchtschild Design";

    for (const option of options) {
      items.push({
        section: "LED-Leuchtschild",
        title,
        description: [
          `Größe: ${option.sizeLabel}`,
          color ? `Leuchtfarbe: ${color}` : null,
          backboard ? `Rückplatte: ${backboard}` : null,
          usage ? `Einsatzort: ${usage}` : null,
        ].filter(Boolean).join("\n"),
        quantity: 1,
        customerUnitPriceNet: option.customerUnitPriceNet,
        selectable: true,
        selectedByDefault: option === defaultOption,
        quantityEditable: true,
        minQuantity: 1,
        sizeLadder: {
          source: "ops_quote_ready_preflight",
          designId: design.designId,
          modelKey: option.modelKey,
          modelVersion: option.modelVersion,
          confidence: option.confidence,
          reviewStatus: option.reviewStatus,
          widthCm: option.widthCm,
          heightCm: option.heightCm,
          longSideCm: option.longSideCm,
        },
      });
    }
  }

  if (!items.length) {
    throw new QuoteValidationError("Keine freigegebenen Größenoptionen für Trello offer_items_json vorhanden.", [], 409);
  }
  if (items.length > OFFER_SIZE_LADDER_MAX_OFFER_ITEMS) {
    throw new QuoteValidationError(
      `Quote-ready Groessenleiter erzeugt ${items.length} Angebotspositionen, erlaubt sind maximal ${OFFER_SIZE_LADDER_MAX_OFFER_ITEMS}.`,
      [],
      409,
    );
  }
  return JSON.stringify(items);
}

async function projectQuoteReadySizeLadderToTrello(card: TrelloCardData, result: QuoteReadySizeLadderPreflightResult) {
  let field = findEditableCustomField(card.editableFields, ["offer_items_json", "Offer Items JSON", "Offer_Items_JSON"]);
  let createdField = false;

  if (!field) {
    if (!card.idBoard) {
      return {
        written: false,
        fieldName: "offer_items_json",
        optionCount: 0,
        error: "trello_offer_items_json_board_missing",
      };
    }
    const created = await createTrelloBoardCustomField({
      boardId: card.idBoard,
      name: "offer_items_json",
      type: "text",
      pos: "bottom",
      displayCardFront: false,
    });
    field = {
      id: created.id,
      name: created.name || "offer_items_json",
      type: created.type || "text",
      value: null,
      displayValue: null,
      options: [],
    };
    createdField = true;
  }

  const value = result.offerItemsJson || publicOfferItemsForQuoteReadyPreflight(card, result);
  validateOfferItemsJsonProjection(value);
  await updateTrelloCustomField({
    cardId: card.id,
    fieldId: field.id,
    type: field.type || "text",
    value,
  });
  return {
    written: true,
    fieldName: field.name,
    optionCount: JSON.parse(value).length,
    createdField,
  };
}

function quoteReadyPreflightStatus(input: {
  issues: string[];
  warnings: string[];
  designs: QuoteReadySizeLadderPreflightDesign[];
}): QuoteReadySizeLadderPreflightStatus {
  if (input.issues.length || input.designs.some((design) => design.sizeLadder.status === "blocked")) return "blocked";
  if (input.warnings.length || input.designs.some((design) => design.sizeLadder.status === "needs_review")) return "needs_review";
  return "ready";
}

export function formatQuoteReadySizeLadderPreflightComment(result: QuoteReadySizeLadderPreflightResult) {
  const statusLabel = result.status === "ready" ? "READY" : result.status === "needs_review" ? "NEEDS REVIEW" : "BLOCKED";
  const lines = [
    QUOTE_READY_SIZE_LADDER_COMMENT_MARKER,
    `Quote ready Groessenleiter: ${statusLabel}`,
    `Produkttyp: ${result.structureProductType} | Regel: ${result.sourceMockupsPerDesign} Ausgangsmockup${result.sourceMockupsPerDesign === 1 ? "" : "s"} = 1 Design`,
    `Designs: ${result.expectedDesignCount} | Ausgangsmockups: ${result.sourceMockupCount} | Supplier-Anker: ${result.anchorCount}`,
    result.anchorsPerDesign ? `Anker pro Design: ${result.anchorsPerDesign}` : null,
    result.designs.length ? "" : null,
    ...result.designs.map((design) => {
      const defaultOption = design.sizeLadder.options.find((option) => option.isDefault) || design.sizeLadder.options[0];
      return [
        `Design ${design.designIndex}: ${design.anchorCount} Anker (${design.anchorFieldIndexes.join(", ")})`,
        defaultOption ? `Start: ${defaultOption.sizeLabel} / ${defaultOption.customerUnitPriceNet} EUR netto` : null,
        `Status: ${design.sizeLadder.status}, Modell: ${design.productModel}, Confidence: ${Math.round(design.sizeLadder.confidence * 100)}%`,
      ].filter(Boolean).join(" | ");
    }),
    result.issues.length ? "" : null,
    ...result.issues.map((issue) => `BLOCKER: ${issue}`),
    result.warnings.length ? "" : null,
    ...result.warnings.map((warning) => `CHECK: ${warning}`),
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

export async function buildQuoteReadySizeLadderPreflightFromTrelloCard(
  card: TrelloCardData,
  input: Omit<QuoteReadySizeLadderPreflightInput, "trelloCard"> & { trelloCard?: string | null } = {},
): Promise<QuoteReadySizeLadderPreflightResult> {
  const canonicalTrelloCardId = card.id || normalizeTrelloCardIdentifier(input.trelloCard) || "";
  if (!canonicalTrelloCardId) throw new QuoteValidationError("Trello Card ID fehlt.");

  const warnings: string[] = [];
  const issues: string[] = [];
  const sourceMockups = listQuoteReadySourceMockups(card);
  const structure = resolveQuoteReadyOfferStructure(card);
  const sourceMockupGroups = groupQuoteReadySourceMockups(sourceMockups, structure.sourceMockupsPerDesign);
  const expectedDesignCount = sourceMockupGroups.length;
  const indexedAnchors = extractIndexedTrelloAnchors(card.customFields || {}, warnings);
  const customerFactor = getFactorOverride(card.customFields || {}) ?? input.customerFactor;

  if (!sourceMockups.length) issues.push("source_mockups_missing");
  if (sourceMockups.length % structure.sourceMockupsPerDesign !== 0) {
    issues.push("source_mockup_pair_incomplete");
  }
  if (!indexedAnchors.length) issues.push("supplier_anchor_fields_missing");
  if (expectedDesignCount && indexedAnchors.length < expectedDesignCount) {
    issues.push("anchor_count_below_design_count");
  }
  if (expectedDesignCount && indexedAnchors.length > 0 && indexedAnchors.length % expectedDesignCount !== 0) {
    warnings.push("anchor_count_not_evenly_divisible_by_design_count");
  }

  const designs: QuoteReadySizeLadderPreflightDesign[] = [];
  const anchorGroups = expectedDesignCount && indexedAnchors.length >= expectedDesignCount
    ? distributeAnchorGroups(indexedAnchors, expectedDesignCount)
    : [];

  for (let index = 0; index < anchorGroups.length; index += 1) {
    const group = anchorGroups[index] || [];
    const sourceMockupGroup = sourceMockupGroups[index] || [];
    const sourceMockup = sourceMockupGroup[0];
    if (!sourceMockup || sourceMockupGroup.length !== structure.sourceMockupsPerDesign || !group.length) continue;
    const anchors = normalizeExtractedAnchorRoles(group.map(({ fieldIndex: _fieldIndex, ...anchor }) => anchor));
    const fieldIndexes = group.map((anchor) => anchor.fieldIndex);
    const sourceText = sourceTextForAnchorGroup({
      card,
      inputSourceText: input.sourceText,
      sourceMockupName: sourceMockupGroup.map((mockup) => mockup.name).join("\n"),
      fieldIndexes,
      anchors,
    });
    const productModel = input.productModel || productModelForQuoteReadyStructure(structure, sourceText);
    const designId = `design_${index + 1}`;
    const sizeLadder = await generateOfferSizeLadder({
      trelloCardId: canonicalTrelloCardId,
      trelloCardUrl: input.trelloCard && String(input.trelloCard).includes("trello.com/c/") ? String(input.trelloCard) : null,
      offerId: input.offerId,
      offerItemId: input.offerItemId,
      designId,
      productModel,
      sourceText,
      stepCm: input.stepCm,
      maxLongSideCm: input.maxLongSideCm,
      customerFactor,
      createdBy: input.createdBy,
      persist: input.persist === true,
      anchors,
    });
    designs.push({
      designId,
      designIndex: index + 1,
      sourceMockupName: sourceMockup.name,
      sourceMockupNames: sourceMockupGroup.map((mockup) => mockup.name),
      anchorFieldIndexes: fieldIndexes,
      anchorCount: anchors.length,
      productModel,
      sizeLadder,
    });
  }

  for (const design of designs) {
    for (const warning of design.sizeLadder.warnings) {
      const scoped = `${design.designId}:${warning}`;
      if (!warnings.includes(scoped)) warnings.push(scoped);
    }
    for (const issue of design.sizeLadder.issues) {
      const scoped = `${design.designId}:${issue}`;
      if (!issues.includes(scoped)) issues.push(scoped);
    }
  }

  const status = quoteReadyPreflightStatus({ issues, warnings, designs });
  const result: QuoteReadySizeLadderPreflightResult = {
    status,
    trelloCardId: canonicalTrelloCardId,
    trelloCardUrl: input.trelloCard && String(input.trelloCard).includes("trello.com/c/") ? String(input.trelloCard) : null,
    trelloCardName: trimNullable(card.name),
    structureProductType: structure.productType,
    sourceMockupsPerDesign: structure.sourceMockupsPerDesign,
    sourceMockupCount: sourceMockups.length,
    expectedDesignCount,
    anchorCount: indexedAnchors.length,
    anchorsPerDesign: expectedDesignCount && indexedAnchors.length >= expectedDesignCount
      ? Math.floor(indexedAnchors.length / expectedDesignCount)
      : null,
    issues,
    warnings,
    designs,
    offerItemsJson: null,
    trelloComment: "",
    trelloProjection: null,
    commentProjection: null,
  };

  if (designs.length && status !== "blocked") {
    result.offerItemsJson = publicOfferItemsForQuoteReadyPreflight(card, result);
  }
  result.trelloComment = formatQuoteReadySizeLadderPreflightComment(result);

  if (input.projectToTrello !== false && result.offerItemsJson && status !== "blocked") {
    try {
      result.trelloProjection = await projectQuoteReadySizeLadderToTrello(card, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trello offer_items_json Projektion fehlgeschlagen.";
      result.trelloProjection = {
        written: false,
        fieldName: "offer_items_json",
        optionCount: 0,
        error: message,
      };
      result.warnings = [...result.warnings, "trello_offer_items_json_projection_failed"];
      result.status = result.status === "ready" ? "needs_review" : result.status;
      result.trelloComment = formatQuoteReadySizeLadderPreflightComment(result);
    }
  }

  if (input.commentToTrello === true) {
    const existingComment = (card.actions || []).some((action) => String(action.data?.text || "").includes(QUOTE_READY_SIZE_LADDER_COMMENT_MARKER));
    if (existingComment) {
      result.commentProjection = { written: false, skipped: true };
    } else {
      try {
        const comment = await addTrelloCardComment({ cardId: canonicalTrelloCardId, text: result.trelloComment });
        result.commentProjection = { written: Boolean(comment?.id), id: comment?.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Trello Kommentar fehlgeschlagen.";
        result.commentProjection = { written: false, error: message };
        result.warnings = [...result.warnings, "trello_comment_projection_failed"];
        result.status = result.status === "ready" ? "needs_review" : result.status;
        result.trelloComment = formatQuoteReadySizeLadderPreflightComment(result);
      }
    }
  }

  return result;
}

export async function prepareQuoteReadySizeLadderPreflight(input: QuoteReadySizeLadderPreflightInput): Promise<QuoteReadySizeLadderPreflightResult> {
  const trelloCardId = normalizeTrelloCardIdentifier(input.trelloCard);
  if (!trelloCardId) throw new QuoteValidationError("Trello Card ID fehlt.");
  const card = await getTrelloCard(trelloCardId);
  return buildQuoteReadySizeLadderPreflightFromTrelloCard(card, input);
}

export function classifyManualReleaseSizeLadderPreflight(
  preflight: QuoteReadySizeLadderPreflightResult,
): Pick<ManualReleaseSizeLadderResult, "decision" | "reason" | "productModels" | "technicalIssues" | "ignoredReviewWarnings"> {
  const productModels = [...new Set(preflight.designs.map((design) => design.productModel))];
  if (preflight.structureProductType !== "neon") {
    return {
      decision: "skipped",
      reason: "special_product_uses_existing_offer_flow",
      productModels,
      technicalIssues: [],
      ignoredReviewWarnings: preflight.warnings,
    };
  }
  const supportedNeonModels: OfferSizeLadderProductModel[] = ["neonflex", "uv_print", "outdoor"];
  if (productModels.some((model) => !supportedNeonModels.includes(model))) {
    if (productModels.includes("unknown")) {
      return {
        decision: "blocked",
        reason: "technical_size_ladder_validation_failed",
        productModels,
        technicalIssues: ["product_model_unknown"],
        ignoredReviewWarnings: preflight.warnings.filter((warning) => warning !== "design_1:product_model_unknown"),
      };
    }
    return {
      decision: "skipped",
      reason: "non_standard_neon_product_uses_existing_offer_flow",
      productModels,
      technicalIssues: [],
      ignoredReviewWarnings: preflight.warnings,
    };
  }

  const technicalIssues = [...preflight.issues];
  if (
    preflight.expectedDesignCount > 1
    && preflight.warnings.includes("anchor_count_not_evenly_divisible_by_design_count")
  ) {
    technicalIssues.push("anchor_count_not_evenly_divisible_by_design_count");
  }
  for (const warning of preflight.warnings) {
    if (/larger_but_cheaper_than/i.test(warning)) technicalIssues.push(warning);
  }
  if (!preflight.designs.length && !technicalIssues.length) technicalIssues.push("size_ladder_designs_missing");
  if (!preflight.offerItemsJson && !technicalIssues.length) technicalIssues.push("offer_items_json_missing");

  if (technicalIssues.length) {
    return {
      decision: "blocked",
      reason: "technical_size_ladder_validation_failed",
      productModels,
      technicalIssues: [...new Set(technicalIssues)],
      ignoredReviewWarnings: preflight.warnings.filter((warning) => !technicalIssues.includes(warning)),
    };
  }

  return {
    decision: "ready",
    reason: preflight.status === "needs_review"
      ? "manual_move_approved_review_warnings"
      : "manual_move_approved",
    productModels,
    technicalIssues: [],
    ignoredReviewWarnings: preflight.warnings,
  };
}

export async function ensureManualReleaseSizeLadder(
  input: QuoteReadySizeLadderPreflightInput,
): Promise<ManualReleaseSizeLadderResult> {
  const trelloCardId = normalizeTrelloCardIdentifier(input.trelloCard);
  if (!trelloCardId) throw new QuoteValidationError("Trello Card ID fehlt.");
  const card = await getTrelloCard(trelloCardId);
  const quoteReadySizeLadder = await buildQuoteReadySizeLadderPreflightFromTrelloCard(card, {
    ...input,
    trelloCard: input.trelloCard,
    projectToTrello: false,
    commentToTrello: false,
  });
  const classification = classifyManualReleaseSizeLadderPreflight(quoteReadySizeLadder);
  let offerItemsProjected = false;
  let optionCount = 0;

  if (classification.decision === "ready" && input.projectToTrello !== false) {
    try {
      const projection = await projectQuoteReadySizeLadderToTrello(card, quoteReadySizeLadder);
      quoteReadySizeLadder.trelloProjection = projection;
      offerItemsProjected = projection.written;
      optionCount = projection.optionCount;
      if (!projection.written) {
        classification.decision = "blocked";
        classification.reason = "trello_offer_items_json_projection_failed";
        classification.technicalIssues = [projection.error || "trello_offer_items_json_projection_failed"];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trello offer_items_json Projektion fehlgeschlagen.";
      quoteReadySizeLadder.trelloProjection = {
        written: false,
        fieldName: "offer_items_json",
        optionCount: 0,
        error: message,
      };
      classification.decision = "blocked";
      classification.reason = "trello_offer_items_json_projection_failed";
      classification.technicalIssues = ["trello_offer_items_json_projection_failed"];
    }
  } else if (classification.decision === "ready") {
    optionCount = quoteReadySizeLadder.offerItemsJson
      ? validateOfferItemsJsonProjection(quoteReadySizeLadder.offerItemsJson).length
      : 0;
  }

  return {
    ...classification,
    manuallyApproved: true,
    trelloCardId,
    structureProductType: quoteReadySizeLadder.structureProductType,
    offerItemsProjected,
    optionCount,
    quoteReadySizeLadder,
  };
}

export function detectOfferSizeLadderProductModel(text: string): OfferSizeLadderProductModel {
  const normalized = text.toLowerCase();
  if (/full\s*glow|vollflaechig|vollflächig/.test(normalized)) return "full_glow";
  if (/\b3d\b|3[\s-]*d|profilbuchstaben|channel\s*letter|buchstaben/.test(normalized)) return "three_d";
  if (/acryl[\s-]*light[\s-]*box|acrylbox|light[\s-]*box|leuchtkasten/.test(normalized)) return "acryl_light_box";
  if (/uv[\s-]*print|uvdruck|uv[\s-]*druck|print\s+on\s+acrylic/.test(normalized)) return "uv_print";
  if (/outdoor|aussen|außen|wasserdicht|wetterfest|ip65|ip67/.test(normalized)) return "outdoor";
  if (/non\s*-?\s*lit|ohne\s+neon|kein\s+neon/.test(normalized)) return "unsupported";
  if (/neon\s*flex|neonflex|led\s*flex|led\s+logo|wandschild|led[\s-]*neon/.test(normalized)) return "neonflex";
  return "unknown";
}

function normalizeAnchor(input: OfferSizeLadderAnchorInput): OfferSizeLadderAnchor {
  const widthCm = roundDimension(requiredPositiveNumber(`${input.role} Breite`, input.widthCm));
  const heightCm = roundDimension(requiredPositiveNumber(`${input.role} Hoehe`, input.heightCm));
  const productionPrice = round2(nonNegativeNumber(`${input.role} Production`, input.productionPrice));
  const shippingPrice = round2(nonNegativeNumber(`${input.role} Shipping`, input.shippingPrice));
  if (productionPrice + shippingPrice <= 0) {
    throw new QuoteValidationError(`${input.role} Supplier Total muss groesser 0 sein.`);
  }
  return {
    role: input.role,
    widthCm,
    heightCm,
    longSideCm: roundDimension(Math.max(widthCm, heightCm)),
    areaCm2: round2(widthCm * heightCm),
    productionPrice,
    shippingPrice,
    supplierTotal: round2(productionPrice + shippingPrice),
    currency: trimNullable(input.currency) || "USD",
    source: input.source || "manual",
    confidence: input.confidence === null || input.confidence === undefined ? null : roundConfidence(Number(input.confidence)),
    rawText: trimNullable(input.rawText),
  };
}

function normalizeAnchorList(inputs: OfferSizeLadderAnchorInput[]) {
  const normalized = inputs.map(normalizeAnchor).sort((left, right) => {
    if (Math.abs(left.longSideCm - right.longSideCm) > 0.001) return left.longSideCm - right.longSideCm;
    return left.areaCm2 - right.areaCm2;
  });
  if (normalized.length < 1) {
    throw new QuoteValidationError("Mindestens ein Supplier-Anker ist fuer eine Groessenleiter erforderlich.");
  }
  return normalized.map((anchor, index) => {
    const role = sortedAnchorRole(anchor, index);
    return { ...anchor, role };
  });
}

function anchorsByRole(anchorList: OfferSizeLadderAnchor[]) {
  const minimum = anchorList[0];
  const requested = anchorList[1] || anchorList[0];
  const max = anchorList[anchorList.length - 1];
  if (!minimum || !requested || !max) {
    throw new QuoteValidationError("Mindestens ein Supplier-Anker ist fuer eine Groessenleiter erforderlich.");
  }
  return {
    minimum: { ...minimum, role: "minimum" as const },
    requested: { ...requested, role: "requested" as const },
    max_250: { ...max, role: "max_250" as const },
  };
}

function interpolateByArea(
  targetArea: number,
  lowerArea: number,
  lowerValue: number,
  upperArea: number,
  upperValue: number,
  mode: "log" | "linear",
  clamp = true,
) {
  if (Math.abs(upperArea - lowerArea) < 0.001) return round2(lowerValue);
  const bounded = clamp ? Math.max(Math.min(targetArea, upperArea), lowerArea) : targetArea;
  const t = (bounded - lowerArea) / (upperArea - lowerArea);
  if (mode === "log" && lowerValue > 0 && upperValue > 0 && lowerArea > 0 && upperArea > 0) {
    const logT = (Math.log(bounded) - Math.log(lowerArea)) / (Math.log(upperArea) - Math.log(lowerArea));
    return round2(Math.exp(Math.log(lowerValue) + logT * (Math.log(upperValue) - Math.log(lowerValue))));
  }
  return round2(lowerValue + t * (upperValue - lowerValue));
}

function estimateSingleAnchorPrice(targetArea: number, anchor: OfferSizeLadderAnchor, field: "productionPrice" | "shippingPrice") {
  if (Math.abs(anchor.areaCm2 - targetArea) < 1) return anchor[field];
  const areaRatio = Math.max(targetArea / anchor.areaCm2, 0.001);
  const exponent = field === "productionPrice" ? 0.82 : 0.78;
  return round2(anchor[field] * Math.pow(areaRatio, exponent));
}

function interpolatePrice(targetArea: number, sortedAnchors: OfferSizeLadderAnchor[], field: "productionPrice" | "shippingPrice") {
  const exact = sortedAnchors.find((anchor) => Math.abs(anchor.areaCm2 - targetArea) < 1);
  if (exact) return exact[field];
  if (sortedAnchors.length === 1) return estimateSingleAnchorPrice(targetArea, sortedAnchors[0]!, field);

  for (let index = 0; index < sortedAnchors.length - 1; index += 1) {
    const lower = sortedAnchors[index];
    const upper = sortedAnchors[index + 1];
    if (targetArea >= lower.areaCm2 && targetArea <= upper.areaCm2) {
      return interpolateByArea(
        targetArea,
        lower.areaCm2,
        lower[field],
        upper.areaCm2,
        upper[field],
        field === "productionPrice" ? "log" : "linear",
      );
    }
  }

  const lower = sortedAnchors[sortedAnchors.length - 2];
  const upper = sortedAnchors[sortedAnchors.length - 1];
  return interpolateByArea(
    targetArea,
    lower.areaCm2,
    lower[field],
    upper.areaCm2,
    upper[field],
    field === "productionPrice" ? "log" : "linear",
    false,
  );
}

function addAnchorConsistencyIssue(params: {
  issues: string[];
  warnings: string[];
  lower: OfferSizeLadderAnchor;
  upper: OfferSizeLadderAnchor;
}) {
  const areaRatio = params.upper.areaCm2 / params.lower.areaCm2;
  const totalRatio = params.upper.supplierTotal / params.lower.supplierTotal;
  if (areaRatio > 1.03 && totalRatio < 0.98) {
    const problem = `${params.upper.role}_larger_but_cheaper_than_${params.lower.role}`;
    if (Math.abs(params.upper.longSideCm - NOMINAL_MAX_ANCHOR_LONG_SIDE_CM) <= NOMINAL_MAX_ANCHOR_TOLERANCE_CM) {
      params.issues.push(problem);
    } else {
      params.warnings.push(problem);
    }
  }
  if (areaRatio >= 1.75 && totalRatio < 1.18) {
    params.issues.push(`${params.upper.role}_area_increase_price_increase_too_low`);
  } else if (areaRatio >= 1.35 && totalRatio < 1.08) {
    params.warnings.push(`${params.upper.role}_area_increase_price_increase_low`);
  }
  if (params.upper.shippingPrice + 20 < params.lower.shippingPrice && areaRatio > 1.1) {
    params.warnings.push(`${params.upper.role}_shipping_drops_despite_larger_size`);
  }
}

function ladderLongSides(minLongSide: number, maxLongSide: number, stepCm: number, anchorLongSides: number[]) {
  const values = new Set<number>(anchorLongSides.map(roundDimension));
  const firstStep = Math.ceil(minLongSide / stepCm) * stepCm;
  for (let value = firstStep; value <= maxLongSide + 0.001; value += stepCm) {
    if (value >= minLongSide - 0.001) values.add(roundDimension(value));
  }
  return Array.from(values).sort((a, b) => a - b);
}

function optionDimensionsForLongSide(anchor: OfferSizeLadderAnchor, longSideCm: number) {
  const scale = longSideCm / anchor.longSideCm;
  return {
    widthCm: roundDimension(anchor.widthCm * scale),
    heightCm: roundDimension(anchor.heightCm * scale),
  };
}

function stableSetKey(input: { trelloCardId: string; offerId?: string | null; offerItemId?: string | null; anchors: OfferSizeLadderAnchor[] }) {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      trelloCardId: input.trelloCardId,
      offerId: input.offerId || null,
      offerItemId: input.offerItemId || null,
      anchors: input.anchors.map((anchor) => [
        anchor.role,
        anchor.widthCm,
        anchor.heightCm,
        anchor.productionPrice,
        anchor.shippingPrice,
      ]),
      modelVersion: OFFER_SIZE_LADDER_MODEL_VERSION,
    }))
    .digest("hex")
    .slice(0, 20);
  return `offer-size-ladder:${input.trelloCardId}:${hash}`;
}

async function persistOfferSizeLadder(input: OfferSizeLadderGenerateInput, result: OfferSizeLadderResult) {
  const existingRows = await supabaseRequest<OfferSizeLadderAnchorSetRow[]>("offer_size_quote_anchor_sets", undefined, {
    select: "id",
    set_key: `eq.${result.setKey}`,
    limit: 1,
  });
  const existing = existingRows[0] || null;
  const payload = {
    set_key: result.setKey,
    trello_card_id: result.trelloCardId,
    trello_card_url: result.trelloCardUrl,
    offer_id: result.offerId,
    offer_item_id: result.offerItemId,
    design_id: result.designId,
    product_model: result.productModel,
    pricing_basis: result.pricingBasis,
    customer_factor: result.customerFactor,
    min_long_side_cm: result.anchors.minimum.longSideCm,
    requested_long_side_cm: result.anchors.requested.longSideCm,
    max_long_side_cm: result.anchors.max_250.longSideCm,
    step_cm: input.stepCm || 10,
    status: result.status,
    confidence: result.confidence,
    issues: result.issues,
    warnings: result.warnings,
    source_text: trimNullable(input.sourceText),
    metadata: {
      model_key: OFFER_SIZE_LADDER_MODEL_KEY,
      model_version: OFFER_SIZE_LADDER_MODEL_VERSION,
      option_count: result.options.length,
      supplier_anchor_count: result.anchorList.length,
      supplier_anchor_roles: result.anchorList.map((anchor) => anchor.role),
    },
    created_by: trimNullable(input.createdBy),
    updated_at: new Date().toISOString(),
  };

  const rows = await supabaseRequest<OfferSizeLadderAnchorSetRow[]>(
    "offer_size_quote_anchor_sets",
    {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify(payload),
      headers: { Prefer: "return=representation" },
    },
    existing ? { id: `eq.${existing.id}` } : undefined,
  );
  const anchorSetId = rows[0]?.id || existing?.id;
  if (!anchorSetId) throw new QuoteValidationError("Size-Ladder Anchor Set konnte nicht gespeichert werden.");

  await supabaseRequest("offer_size_options", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, { anchor_set_id: `eq.${anchorSetId}` });
  await supabaseRequest("offer_size_quote_anchors", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, { anchor_set_id: `eq.${anchorSetId}` });

  for (const anchor of result.anchorList) {
    await supabaseRequest("offer_size_quote_anchors", {
      method: "POST",
      body: JSON.stringify({
        anchor_set_id: anchorSetId,
        role: anchor.role,
        width_cm: anchor.widthCm,
        height_cm: anchor.heightCm,
        production_price: anchor.productionPrice,
        shipping_price: anchor.shippingPrice,
        currency: anchor.currency,
        source: anchor.source,
        confidence: anchor.confidence,
        raw_text: anchor.rawText,
      }),
      headers: { Prefer: "return=minimal" },
    });
  }

  await supabaseRequest("offer_size_options", {
    method: "POST",
    body: JSON.stringify(result.options.map((option) => ({
      anchor_set_id: anchorSetId,
      offer_id: result.offerId,
      offer_item_id: result.offerItemId,
      size_label: option.sizeLabel,
      width_cm: option.widthCm,
      height_cm: option.heightCm,
      long_side_cm: option.longSideCm,
      area_cm2: option.areaCm2,
      production_price_estimated: option.productionPriceEstimated,
      shipping_price_estimated: option.shippingPriceEstimated,
      supplier_total_estimated: option.supplierTotalEstimated,
      customer_factor: option.customerFactor,
      customer_unit_price_net: option.customerUnitPriceNet,
      currency: option.currency,
      customer_currency: option.customerCurrency,
      model_key: option.modelKey,
      model_version: option.modelVersion,
      confidence: option.confidence,
      review_status: option.reviewStatus,
      review_reason: option.reviewReason,
      issues: option.issues,
      is_default: option.isDefault,
      sort_order: option.sortOrder,
      metadata: option.metadata,
    }))),
    headers: { Prefer: "return=minimal" },
  });

  return { anchorSetId, optionCount: result.options.length };
}

function optionFromRow(row: OfferSizeLadderOptionRow): OfferSizeLadderOption {
  return {
    sizeLabel: row.size_label,
    widthCm: numberFromRow(row.width_cm),
    heightCm: numberFromRow(row.height_cm),
    longSideCm: numberFromRow(row.long_side_cm),
    areaCm2: numberFromRow(row.area_cm2),
    productionPriceEstimated: numberFromRow(row.production_price_estimated),
    shippingPriceEstimated: numberFromRow(row.shipping_price_estimated),
    supplierTotalEstimated: numberFromRow(row.supplier_total_estimated),
    customerFactor: numberFromRow(row.customer_factor, OFFER_SIZE_LADDER_CUSTOMER_FACTOR),
    customerUnitPriceNet: numberFromRow(row.customer_unit_price_net),
    currency: row.currency || "USD",
    customerCurrency: "EUR",
    modelKey: row.model_key || OFFER_SIZE_LADDER_MODEL_KEY,
    modelVersion: row.model_version || OFFER_SIZE_LADDER_MODEL_VERSION,
    confidence: numberFromRow(row.confidence),
    reviewStatus: row.review_status,
    reviewReason: row.review_reason,
    issues: stringArrayFromRow(row.issues),
    isDefault: row.is_default,
    sortOrder: Number(row.sort_order || 0),
    metadata: row.metadata || {},
  };
}

export async function listOfferSizeLadderDrafts(input: OfferSizeLadderDraftLookupInput): Promise<OfferSizeLadderDraft[]> {
  const trelloCardId = input.trelloCardId ? normalizeTrelloCardIdentifier(input.trelloCardId) : null;
  const offerId = trimNullable(input.offerId);
  const offerItemId = trimNullable(input.offerItemId);
  const limit = Math.min(Math.max(Number(input.limit || 5) || 5, 1), 20);

  if (!trelloCardId && !offerId) {
    throw new QuoteValidationError("Offer ID oder Trello Card ID fehlt.");
  }

  const query: Record<string, string | number | boolean | null> = {
    select: "id,set_key,trello_card_id,trello_card_url,offer_id,offer_item_id,design_id,product_model,pricing_basis,customer_factor,status,confidence,issues,warnings,metadata,created_by,created_at,updated_at",
    order: "updated_at.desc",
    limit,
    status: "neq.superseded",
  };
  if (trelloCardId) query.trello_card_id = `eq.${trelloCardId}`;
  if (offerId) query.offer_id = `eq.${offerId}`;
  if (offerItemId) query.offer_item_id = `eq.${offerItemId}`;

  const sets = await supabaseRequest<OfferSizeLadderAnchorSetRow[]>("offer_size_quote_anchor_sets", undefined, query);
  if (!sets.length) return [];

  const setIds = sets.map((set) => set.id).filter(Boolean);
  const optionRows = await supabaseRequest<OfferSizeLadderOptionRow[]>("offer_size_options", undefined, {
    select: "id,anchor_set_id,offer_id,offer_item_id,size_label,width_cm,height_cm,long_side_cm,area_cm2,production_price_estimated,shipping_price_estimated,supplier_total_estimated,customer_factor,customer_unit_price_net,currency,customer_currency,model_key,model_version,confidence,review_status,review_reason,issues,is_default,sort_order,metadata",
    anchor_set_id: `in.(${setIds.join(",")})`,
    order: "sort_order.asc",
  });

  const optionsBySet = new Map<string, OfferSizeLadderOption[]>();
  for (const row of optionRows) {
    const current = optionsBySet.get(row.anchor_set_id) || [];
    current.push(optionFromRow(row));
    optionsBySet.set(row.anchor_set_id, current);
  }

  return sets.map((set) => {
    const options = optionsBySet.get(set.id) || [];
    return {
      anchorSetId: set.id,
      setKey: String(set.set_key || ""),
      trelloCardId: String(set.trello_card_id || ""),
      trelloCardUrl: set.trello_card_url || null,
      offerId: set.offer_id || null,
      offerItemId: set.offer_item_id || null,
      designId: set.design_id || null,
      productModel: set.product_model || "unknown",
      pricingBasis: set.pricing_basis === "legacy_supplier_2_3" || set.pricing_basis === "manual"
        ? set.pricing_basis
        : "new_supplier_direct_2_6",
      customerFactor: numberFromRow(set.customer_factor, OFFER_SIZE_LADDER_CUSTOMER_FACTOR),
      status: set.status || "draft",
      confidence: numberFromRow(set.confidence),
      issues: stringArrayFromRow(set.issues),
      warnings: stringArrayFromRow(set.warnings),
      options,
      createdBy: set.created_by || null,
      createdAt: set.created_at || null,
      updatedAt: set.updated_at || null,
    };
  });
}

export async function generateOfferSizeLadder(input: OfferSizeLadderGenerateInput): Promise<OfferSizeLadderResult> {
  const trelloCardId = normalizeTrelloCardIdentifier(input.trelloCardId);
  if (!trelloCardId) throw new QuoteValidationError("Trello Card ID fehlt.");

  const allAnchors = normalizeAnchorList(input.anchors);
  const anchors = anchorsByRole(allAnchors);
  const sortedByArea = [...allAnchors].sort((a, b) => a.areaCm2 - b.areaCm2);
  const sourceText = [input.sourceText, ...allAnchors.map((anchor) => anchor.rawText)].filter(Boolean).join("\n");
  const productModel = input.productModel || detectOfferSizeLadderProductModel(sourceText);
  const stepCm = requiredPositiveNumber("Schrittweite", input.stepCm || 10);
  const maxLongSideCm = requiredPositiveNumber("Maximale Laengsseite", input.maxLongSideCm || 250);
  const customerFactor = requiredPositiveNumber("Customer Faktor", input.customerFactor || OFFER_SIZE_LADDER_CUSTOMER_FACTOR);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (Math.abs(customerFactor - OFFER_SIZE_LADDER_CUSTOMER_FACTOR) > 0.001) {
    warnings.push("customer_factor_differs_from_current_2_3_policy");
  }
  if (allAnchors.length === 1) {
    warnings.push("single_supplier_anchor_pricing_curve_low_confidence");
  }
  if (anchors.max_250.longSideCm < maxLongSideCm - 15) {
    warnings.push("largest_supplier_anchor_below_250cm_extrapolated");
  } else if (anchors.max_250.longSideCm > maxLongSideCm + 15) {
    warnings.push("largest_supplier_anchor_above_250cm");
  }
  if (new Set(allAnchors.map((anchor) => anchor.currency)).size > 1) warnings.push("anchor_currencies_differ");
  if (productModel === "uv_print" || productModel === "outdoor") warnings.push(`${productModel}_requires_manual_review`);
  if (["three_d", "full_glow", "acryl_light_box", "unsupported"].includes(productModel)) issues.push(`${productModel}_not_supported_for_neonflex_ladder`);
  if (productModel === "unknown") warnings.push("product_model_unknown");

  for (let index = 0; index < allAnchors.length - 1; index += 1) {
    addAnchorConsistencyIssue({ issues, warnings, lower: allAnchors[index]!, upper: allAnchors[index + 1]! });
  }

  const baseConfidence = (() => {
    let score = productModel === "neonflex" ? 0.88 : productModel === "unknown" ? 0.62 : 0.52;
    const anchorConfidenceValues = allAnchors.map((anchor) => anchor.confidence).filter((value): value is number => Number.isFinite(value));
    if (anchorConfidenceValues.length) {
      score = Math.min(score, anchorConfidenceValues.reduce((sum, value) => sum + value, 0) / anchorConfidenceValues.length);
    }
    if (allAnchors.length === 1) score -= 0.22;
    score -= warnings.length * 0.05;
    score -= issues.length * 0.2;
    return roundConfidence(score);
  })();
  const setStatus: OfferSizeLadderSetStatus = issues.length ? "blocked" : warnings.length ? "needs_review" : "draft";

  const largestSupplierAnchorLongSide = anchors.max_250.longSideCm;
  const longSides = ladderLongSides(anchors.minimum.longSideCm, maxLongSideCm, stepCm, allAnchors.map((anchor) => anchor.longSideCm));
  const options = longSides.map<OfferSizeLadderOption>((longSideCm, index) => {
    const exactAnchor = allAnchors.find((anchor) => Math.abs(anchor.longSideCm - longSideCm) < 0.5);
    const dimensions = exactAnchor || optionDimensionsForLongSide(anchors.minimum, longSideCm);
    const widthCm = roundDimension(dimensions.widthCm);
    const heightCm = roundDimension(dimensions.heightCm);
    const areaCm2 = round2(widthCm * heightCm);
    const production = exactAnchor?.productionPrice ?? interpolatePrice(areaCm2, sortedByArea, "productionPrice");
    const shipping = exactAnchor?.shippingPrice ?? interpolatePrice(areaCm2, sortedByArea, "shippingPrice");
    const supplierTotal = round2(production + shipping);
    const optionIssues = [...issues];
    const optionWarnings = [...warnings];
    if (longSideCm > 200) optionWarnings.push("long_side_over_200cm_requires_review");
    if (longSideCm > largestSupplierAnchorLongSide + 0.5) optionWarnings.push("extrapolated_beyond_largest_supplier_anchor");
    if (allAnchors.length === 1 && !exactAnchor) optionWarnings.push("single_anchor_estimated_size");
    const reviewStatus: OfferSizeLadderReviewStatus = optionIssues.length
      ? "blocked"
      : optionWarnings.length
        ? "needs_review"
        : "auto_ok";
    const confidence = roundConfidence(baseConfidence - (longSideCm > 200 ? 0.12 : 0));
    return {
      sizeLabel: defaultSizeLabel(widthCm, heightCm),
      widthCm,
      heightCm,
      longSideCm,
      areaCm2,
      productionPriceEstimated: production,
      shippingPriceEstimated: shipping,
      supplierTotalEstimated: supplierTotal,
      customerFactor,
      customerUnitPriceNet: roundDownToFive(supplierTotal * customerFactor),
      currency: exactAnchor?.currency || anchors.minimum.currency,
      customerCurrency: "EUR",
      modelKey: OFFER_SIZE_LADDER_MODEL_KEY,
      modelVersion: OFFER_SIZE_LADDER_MODEL_VERSION,
      confidence,
      reviewStatus,
      reviewReason: optionIssues[0] || optionWarnings[0] || null,
      issues: optionIssues.length ? optionIssues : optionWarnings,
      isDefault: Math.abs(longSideCm - anchors.minimum.longSideCm) < 0.5,
      sortOrder: index,
      metadata: {
        exact_anchor_role: exactAnchor?.role || null,
        supplier_anchor_count: allAnchors.length,
        single_anchor_estimate: allAnchors.length === 1 && !exactAnchor,
        extrapolated_beyond_largest_anchor: longSideCm > largestSupplierAnchorLongSide + 0.5,
        pricing_basis: "new_supplier_direct_2_6",
      },
    };
  });

  const result: OfferSizeLadderResult = {
    setKey: stableSetKey({ trelloCardId, offerId: input.offerId, offerItemId: input.offerItemId, anchors: allAnchors }),
    trelloCardId,
    trelloCardUrl: trimNullable(input.trelloCardUrl),
    offerId: trimNullable(input.offerId),
    offerItemId: trimNullable(input.offerItemId),
    designId: trimNullable(input.designId),
    productModel,
    pricingBasis: "new_supplier_direct_2_6",
    customerFactor,
    status: setStatus,
    confidence: baseConfidence,
    issues,
    warnings,
    anchors,
    anchorList: allAnchors,
    options,
    persisted: null,
  };

  if (input.persist) {
    result.persisted = await persistOfferSizeLadder(input, result);
  }

  return result;
}

export async function generateOfferSizeLadderFromTrello(input: OfferSizeLadderTrelloGenerateInput): Promise<OfferSizeLadderResult> {
  const trelloCardId = normalizeTrelloCardIdentifier(input.trelloCard);
  if (!trelloCardId) throw new QuoteValidationError("Trello Card ID fehlt.");

  const card = await getTrelloCard(trelloCardId);
  const canonicalTrelloCardId = card.id || trelloCardId;
  const extraction = extractOfferSizeLadderAnchorsFromTrelloFields(card.customFields || {});
  const customerFactor = getFactorOverride(card.customFields || {}) ?? input.customerFactor;
  if (extraction.anchors.length < 1) {
    throw new QuoteValidationError(
      "Mindestens ein Trello-Anker konnte nicht vollständig gelesen werden.",
      extraction.warnings,
      422,
    );
  }

  const sourceText = [
    card.name,
    card.desc,
    input.sourceText,
    extraction.sourceText,
    extraction.warnings.length ? `Warnings: ${extraction.warnings.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const generateInput = {
    ...input,
    persist: false,
    trelloCardId: canonicalTrelloCardId,
    trelloCardUrl: String(input.trelloCard || "").includes("trello.com/c/")
      ? String(input.trelloCard)
      : `https://trello.com/c/${trelloCardId}`,
    productModel: input.productModel || detectOfferSizeLadderProductModel(sourceText),
    sourceText,
    customerFactor,
    anchors: extraction.anchors,
  };
  const generated = await generateOfferSizeLadder(generateInput);
  const result = applyOfferSizeLadderOptionOverrides(generated, input.optionOverrides);

  if (input.persist) {
    result.persisted = await persistOfferSizeLadder(generateInput, result);
    try {
      result.persisted.trelloProjection = await projectOfferSizeLadderToTrello(card, result);
      if (!result.persisted.trelloProjection.written && !result.warnings.includes(result.persisted.trelloProjection.error || "")) {
        result.warnings = [...result.warnings, result.persisted.trelloProjection.error || "trello_offer_items_json_projection_skipped"];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trello offer_items_json Projektion fehlgeschlagen.";
      result.persisted.trelloProjection = {
        written: false,
        fieldName: "offer_items_json",
        optionCount: result.options.filter((option) => option.reviewStatus !== "blocked").length,
        error: message,
      };
      result.warnings = [...result.warnings, "trello_offer_items_json_projection_failed"];
    }
  }

  return result;
}

async function resolveOfferForSizeLadder(input: OfferSizeLadderOfferApplyInput, sizeLadder: OfferSizeLadderResult) {
  const offerId = trimNullable(input.offerId);
  if (offerId) {
    return {
      offer: await getOfferById(offerId),
      offerId,
      trelloCardId: sizeLadder.trelloCardId,
    };
  }

  const lookupIds = Array.from(new Set([
    sizeLadder.trelloCardId,
    normalizeTrelloCardIdentifier(input.trelloCard),
    normalizeTrelloCardIdentifier(input.trelloCardId),
    normalizeTrelloCardIdentifier(input.trelloCardUrl),
  ].filter((value): value is string => Boolean(value))));

  for (const trelloCardId of lookupIds) {
    try {
      return {
        offer: await getOfferByTrelloCardId(trelloCardId),
        offerId: null,
        trelloCardId,
      };
    } catch (error) {
      if (!(error instanceof OpsOfferApiError) || error.status !== 404) throw error;
    }
  }

  for (const lookupId of lookupIds) {
    const card = await getTrelloCard(lookupId).catch(() => null);
    if (!card?.id || lookupIds.includes(card.id)) continue;
    try {
      return {
        offer: await getOfferByTrelloCardId(card.id),
        offerId: null,
        trelloCardId: card.id,
      };
    } catch (fallbackError) {
      if (!(fallbackError instanceof OpsOfferApiError) || fallbackError.status !== 404) throw fallbackError;
    }
  }

  throw new QuoteValidationError(
    "Kein Angebot zu dieser Trello-Karte gefunden. Falls das Angebot schon existiert, bitte Trello neu laden oder die interne Offer-ID eintragen.",
    [],
    404,
  );
}

export function buildOfferSizeLadderOfferPatch(input: {
  offer: OpsOfferSnapshot;
  sizeLadder: OfferSizeLadderResult;
  offerItemId?: string | null;
  operatorName?: string | null;
  revisionReason?: string | null;
}) {
  const { offer, sizeLadder } = input;
  if (sizeLadder.status === "blocked") {
    throw new QuoteValidationError(
      "Diese Größenleiter ist blockiert und darf nicht ins Angebot übernommen werden.",
      sizeLadder.issues,
      409,
    );
  }
  if (!offer.lock.editable || offer.lock.lockLevel === "hard") {
    throw new QuoteValidationError(offer.lock.lockReason || "Dieses Angebot ist gesperrt und kann nicht aktualisiert werden.", [], 409);
  }

  const targetItem = resolveOfferTargetItem(offer, input.offerItemId || sizeLadder.offerItemId);
  const candidateOptions = sizeLadder.options.filter((option) => option.reviewStatus !== "blocked");
  if (!candidateOptions.length) throw new QuoteValidationError("Keine freigegebenen Größenoptionen vorhanden.", [], 409);
  if (candidateOptions.length > OFFER_SIZE_LADDER_MAX_OPTIONS) {
    throw new QuoteValidationError(
      `Zu viele Größenoptionen für ein Angebot. Erlaubt sind maximal ${OFFER_SIZE_LADDER_MAX_OPTIONS}.`,
      [],
      409,
    );
  }

  const defaultOption = candidateOptions.find((option) => option.isDefault) || candidateOptions[0]!;
  const existingVariants = sameDesignSizeVariantItems(offer, targetItem);
  const existingBySize = new Map(
    existingVariants
      .map((item) => [sizeLabelFromOfferItem(item), item] as const)
      .filter((entry): entry is [string, OpsOfferItem] => Boolean(entry[0])),
  );
  const usedExistingIds = new Set<string>();
  const newItemPrefix = `new-item-size-ladder-${sizeLadder.trelloCardId}-${createHash("sha1").update(sizeLadder.setKey).digest("hex").slice(0, 8)}`;
  const targetTitle = sanitizeSizeLadderOfferTitle(targetItem.title);
  const targetDescription = sanitizeSizeLadderOfferDescription(targetItem.description);

  const desiredVariants = candidateOptions.map((option, index) => {
    const sizeLabel = option.sizeLabel || `${formatCmValue(option.widthCm)} x ${formatCmValue(option.heightCm)}cm`;
    const existingByExactSize = existingBySize.get(sizeLabel) || null;
    const fallbackExisting = existingVariants.find((item) => !usedExistingIds.has(item.id)) || null;
    const baseItem = existingByExactSize || fallbackExisting || targetItem;
    if (existingByExactSize || fallbackExisting) usedExistingIds.add(baseItem.id);
    const itemId = existingByExactSize || fallbackExisting ? baseItem.id : `${newItemPrefix}-${index}`;
    return {
      ...offerItemPatch(baseItem),
      id: itemId,
      section: targetItem.section || baseItem.section || "LED-Leuchtschild",
      title: targetTitle,
      description: upsertSizeLine(targetDescription, sizeLabel),
      quantity: 1,
      unitPriceNet: option.customerUnitPriceNet,
      listPriceNet: null,
      discountLabel: null,
      selectable: true,
      selectedByDefault: option.sizeLabel === defaultOption.sizeLabel,
      quantityEditable: true,
      minQuantity: 1,
      maxQuantity: targetItem.maxQuantity,
    };
  });

  const existingVariantIds = new Set(existingVariants.map((item) => item.id));
  const targetIndex = offer.items.findIndex((item) => item.id === targetItem.id);
  const before = offer.items.slice(0, Math.max(targetIndex, 0)).filter((item) => !existingVariantIds.has(item.id));
  const after = offer.items.slice(Math.max(targetIndex, 0) + 1).filter((item) => !existingVariantIds.has(item.id));
  const nextItems = [...before, ...desiredVariants, ...after].map((item, index) => ({
    ...item,
    sortOrder: index,
  }));
  if (nextItems.length > OFFER_SIZE_LADDER_MAX_OFFER_ITEMS) {
    throw new QuoteValidationError(
      `Das Angebot hat nach der Größenleiter ${nextItems.length} Positionen, erlaubt sind maximal ${OFFER_SIZE_LADDER_MAX_OFFER_ITEMS}.`,
      [
        `${candidateOptions.length} Größenoptionen`,
        `${before.length + after.length} andere Angebotspositionen bleiben erhalten`,
        `${existingVariants.length} alte Größenvarianten werden ersetzt`,
      ],
      409,
    );
  }

  const actor = trimNullable(input.operatorName);
  if (!actor || ["ops", "ops_session", "local_bypass"].includes(actor.toLowerCase())) {
    throw new QuoteValidationError("Reviewer-Name fehlt. Bitte deinen Namen im Feld Reviewer eintragen.", [], 422);
  }

  const patch: OpsOfferPatchInput = {
    expectedUpdatedAt: offer.updatedAt,
    actor,
    reason: "offer_size_ladder_apply",
    revisionReason: offer.lock.requiresRevisionReason
      ? trimNullable(input.revisionReason) || "Größenleiter aus Schildpreis-Kalkulator übernommen."
      : undefined,
    items: nextItems,
  };

  return {
    patch,
    targetItem,
    defaultOption,
    appliedOptions: candidateOptions,
    skippedBlockedOptions: sizeLadder.options.length - candidateOptions.length,
  };
}

export async function applyOfferSizeLadderToOffer(input: OfferSizeLadderOfferApplyInput): Promise<OfferSizeLadderOfferApplyResult> {
  const directAnchors = Array.isArray(input.anchors) ? input.anchors : [];
  const hasDirectAnchors = new Set(directAnchors.map((anchor) => anchor.role)).size >= 3;
  const generatedSizeLadder = hasDirectAnchors
    ? await generateOfferSizeLadder({
        trelloCardId: input.trelloCardId || input.trelloCard,
        trelloCardUrl: input.trelloCardUrl || (String(input.trelloCard || "").startsWith("http") ? input.trelloCard : null),
        offerId: input.offerId,
        offerItemId: input.offerItemId,
        designId: input.designId,
        productModel: input.productModel,
        sourceText: input.sourceText,
        stepCm: input.stepCm,
        maxLongSideCm: input.maxLongSideCm,
        customerFactor: input.customerFactor,
        createdBy: input.createdBy,
        persist: false,
        anchors: directAnchors,
      })
    : await generateOfferSizeLadderFromTrello({
        ...input,
        persist: false,
      });
  const sizeLadder = applyOfferSizeLadderOptionOverrides(generatedSizeLadder, input.optionOverrides);
  const resolvedOffer = await resolveOfferForSizeLadder(input, sizeLadder);
  const sizeLadderForOffer = {
    ...sizeLadder,
    trelloCardId: resolvedOffer.trelloCardId || sizeLadder.trelloCardId,
    offerId: resolvedOffer.offerId || sizeLadder.offerId,
    offerItemId: trimNullable(input.offerItemId) || sizeLadder.offerItemId,
  };
  const { patch, targetItem, defaultOption, appliedOptions, skippedBlockedOptions } = buildOfferSizeLadderOfferPatch({
    offer: resolvedOffer.offer,
    sizeLadder: sizeLadderForOffer,
    offerItemId: input.offerItemId,
    operatorName: input.createdBy,
    revisionReason: input.revisionReason,
  });
  const patchResult = resolvedOffer.offerId
    ? await patchOfferById(resolvedOffer.offerId, patch, input.dryRun === true)
    : await patchOfferByTrelloCardId(resolvedOffer.trelloCardId, patch, input.dryRun === true);

  return {
    dryRun: patchResult.dryRun === true,
    offer: patchResult.offer,
    diff: patchResult.diff,
    sizeLadder: sizeLadderForOffer,
    applied: {
      targetItemId: targetItem.id,
      targetItemTitle: targetItem.title,
      optionCount: appliedOptions.length,
      defaultSizeLabel: defaultOption.sizeLabel,
      defaultUnitPriceNet: defaultOption.customerUnitPriceNet,
      skippedBlockedOptions,
    },
  };
}
