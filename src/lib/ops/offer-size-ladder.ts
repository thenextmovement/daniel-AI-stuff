import { createHash } from "node:crypto";
import { getTrelloCard } from "@/lib/quotes/trello";
import type { CustomFieldMap } from "@/lib/quotes/types";
import { roundDownToFive } from "@/lib/quotes/pricing";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const OFFER_SIZE_LADDER_CUSTOMER_FACTOR = 2.6;
export const OFFER_SIZE_LADDER_MODEL_KEY = "anchored_offer_size_ladder";
export const OFFER_SIZE_LADDER_MODEL_VERSION = "anchored_offer_size_ladder_v1";

export type OfferSizeLadderAnchorRole = "minimum" | "requested" | "max_250";
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
  anchors: Record<OfferSizeLadderAnchorRole, OfferSizeLadderAnchor>;
  options: OfferSizeLadderOption[];
  persisted?: {
    anchorSetId: string;
    optionCount: number;
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

export type OfferSizeLadderDraft = Omit<OfferSizeLadderResult, "anchors" | "persisted" | "pricingBasis"> & {
  anchorSetId: string;
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
};

export type OfferSizeLadderTrelloAnchorExtraction = {
  anchors: OfferSizeLadderAnchorInput[];
  sourceText: string;
  warnings: string[];
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

function customFieldEntries(customFields: CustomFieldMap) {
  return Object.entries(customFields || {})
    .map(([key, value]) => ({
      key,
      normalizedKey: normalizeFieldName(key),
      value: String(value || "").trim(),
    }))
    .filter((entry) => entry.value);
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

const ROLE_ALIASES: Record<OfferSizeLadderAnchorRole, { index: number; names: string[] }> = {
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

function roleFieldNames(role: OfferSizeLadderAnchorRole, kind: "size" | "production" | "shipping" | "total") {
  const { index, names } = ROLE_ALIASES[role];
  const suffixNames = (() => {
    if (kind === "size") return [`Size_${index}`, `Size ${index}`, `Größe ${index}`, `Groesse ${index}`, `Mass ${index}`, `Maß ${index}`];
    if (kind === "production") return [`Production_${index}`, `Production ${index}`, `Production Price_${index}`, `Production Price ${index}`, `Prod_${index}`, `Prod ${index}`];
    if (kind === "shipping") return [`Shipping_${index}`, `Shipping ${index}`, `Shipping Cost_${index}`, `Shipping Cost ${index}`, `Ship_${index}`, `Ship ${index}`];
    return [`Price_${index}`, `Price ${index}`, `Preis ${index}`, `Total_${index}`, `Total ${index}`, `Supplier Total ${index}`];
  })();
  const roleNames = names.flatMap((name) => {
    if (kind === "size") return [`${name} size`, `${name} groesse`, `${name} größe`, `${name} mass`, `${name} maß`];
    if (kind === "production") return [`${name} production`, `${name} production price`, `${name} prod`];
    if (kind === "shipping") return [`${name} shipping`, `${name} shipping cost`, `${name} ship`];
    return [`${name} price`, `${name} preis`, `${name} total`, `${name} supplier total`];
  });
  return [...suffixNames, ...roleNames];
}

function combinedRoleFieldValues(customFields: CustomFieldMap, role: OfferSizeLadderAnchorRole) {
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

export function extractOfferSizeLadderAnchorsFromTrelloFields(customFields: CustomFieldMap): OfferSizeLadderTrelloAnchorExtraction {
  const anchors: OfferSizeLadderAnchorInput[] = [];
  const warnings: string[] = [];
  const sourceText = customFieldEntries(customFields).map((entry) => `${entry.key}: ${entry.value}`).join("\n");

  for (const role of ["minimum", "requested", "max_250"] as const) {
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

  if (anchors.length !== 3) {
    const present = new Set(anchors.map((anchor) => anchor.role));
    for (const role of ["minimum", "requested", "max_250"] as const) {
      if (!present.has(role)) warnings.push(`${role}_custom_field_anchor_missing`);
    }
  }

  return { anchors, sourceText, warnings };
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
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function defaultSizeLabel(widthCm: number, heightCm: number) {
  const width = Number.isInteger(widthCm) ? String(widthCm) : widthCm.toFixed(1);
  const height = Number.isInteger(heightCm) ? String(heightCm) : heightCm.toFixed(1);
  return `${width} x ${height}cm`;
}

export function detectOfferSizeLadderProductModel(text: string): OfferSizeLadderProductModel {
  const normalized = text.toLowerCase();
  if (/full\s*glow|vollflaechig|vollflächig/.test(normalized)) return "full_glow";
  if (/\b3d\b|3[\s-]*d|profilbuchstaben|channel\s*letter|buchstaben/.test(normalized)) return "three_d";
  if (/acryl[\s-]*light[\s-]*box|acrylbox|light[\s-]*box|leuchtkasten/.test(normalized)) return "acryl_light_box";
  if (/uv[\s-]*print|uvdruck|uv[\s-]*druck|print\s+on\s+acrylic/.test(normalized)) return "uv_print";
  if (/outdoor|aussen|außen|wasserdicht|wetterfest|ip65|ip67/.test(normalized)) return "outdoor";
  if (/non\s*-?\s*lit|ohne\s+neon|kein\s+neon/.test(normalized)) return "unsupported";
  if (/neon\s*flex|neonflex|led\s+logo|wandschild|led[\s-]*neon/.test(normalized)) return "neonflex";
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

function anchorsByRole(inputs: OfferSizeLadderAnchorInput[]) {
  const result = new Map<OfferSizeLadderAnchorRole, OfferSizeLadderAnchor>();
  for (const input of inputs) {
    if (!["minimum", "requested", "max_250"].includes(input.role)) {
      throw new QuoteValidationError("Unbekannte Anchor-Rolle.");
    }
    if (result.has(input.role)) throw new QuoteValidationError(`Anchor ${input.role} wurde mehrfach angegeben.`);
    result.set(input.role, normalizeAnchor(input));
  }
  for (const role of ["minimum", "requested", "max_250"] as const) {
    if (!result.has(role)) throw new QuoteValidationError(`Anchor ${role} fehlt.`);
  }
  return {
    minimum: result.get("minimum")!,
    requested: result.get("requested")!,
    max_250: result.get("max_250")!,
  };
}

function interpolateByArea(
  targetArea: number,
  lowerArea: number,
  lowerValue: number,
  upperArea: number,
  upperValue: number,
  mode: "log" | "linear",
) {
  if (Math.abs(upperArea - lowerArea) < 0.001) return round2(lowerValue);
  const bounded = Math.max(Math.min(targetArea, upperArea), lowerArea);
  const t = (bounded - lowerArea) / (upperArea - lowerArea);
  if (mode === "log" && lowerValue > 0 && upperValue > 0 && lowerArea > 0 && upperArea > 0) {
    const logT = (Math.log(bounded) - Math.log(lowerArea)) / (Math.log(upperArea) - Math.log(lowerArea));
    return round2(Math.exp(Math.log(lowerValue) + logT * (Math.log(upperValue) - Math.log(lowerValue))));
  }
  return round2(lowerValue + t * (upperValue - lowerValue));
}

function interpolatePrice(targetArea: number, sortedAnchors: OfferSizeLadderAnchor[], field: "productionPrice" | "shippingPrice") {
  const exact = sortedAnchors.find((anchor) => Math.abs(anchor.areaCm2 - targetArea) < 1);
  if (exact) return exact[field];

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
    params.issues.push(`${params.upper.role}_larger_but_cheaper_than_${params.lower.role}`);
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

function ladderLongSides(minLongSide: number, requestedLongSide: number, maxLongSide: number, stepCm: number) {
  const values = new Set<number>([roundDimension(minLongSide), roundDimension(requestedLongSide), roundDimension(maxLongSide)]);
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

  for (const anchor of Object.values(result.anchors)) {
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

  const anchors = anchorsByRole(input.anchors);
  const allAnchors = [anchors.minimum, anchors.requested, anchors.max_250];
  const sortedByArea = [...allAnchors].sort((a, b) => a.areaCm2 - b.areaCm2);
  const sourceText = [input.sourceText, ...allAnchors.map((anchor) => anchor.rawText)].filter(Boolean).join("\n");
  const productModel = input.productModel || detectOfferSizeLadderProductModel(sourceText);
  const stepCm = requiredPositiveNumber("Schrittweite", input.stepCm || 10);
  const maxLongSideCm = requiredPositiveNumber("Maximale Laengsseite", input.maxLongSideCm || 250);
  const customerFactor = requiredPositiveNumber("Customer Faktor", input.customerFactor || OFFER_SIZE_LADDER_CUSTOMER_FACTOR);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (Math.abs(customerFactor - OFFER_SIZE_LADDER_CUSTOMER_FACTOR) > 0.001) {
    warnings.push("customer_factor_differs_from_current_2_6_policy");
  }
  if (anchors.minimum.longSideCm > anchors.requested.longSideCm + 0.5) issues.push("minimum_anchor_larger_than_requested_anchor");
  if (anchors.requested.longSideCm > anchors.max_250.longSideCm + 0.5) issues.push("requested_anchor_larger_than_max_anchor");
  if (anchors.max_250.longSideCm < maxLongSideCm - 15 || anchors.max_250.longSideCm > maxLongSideCm + 15) {
    issues.push("max_anchor_not_close_to_250cm");
  }
  if (new Set(allAnchors.map((anchor) => anchor.currency)).size > 1) warnings.push("anchor_currencies_differ");
  if (productModel === "uv_print" || productModel === "outdoor") warnings.push(`${productModel}_requires_manual_review`);
  if (["three_d", "full_glow", "acryl_light_box", "unsupported"].includes(productModel)) issues.push(`${productModel}_not_supported_for_neonflex_ladder`);
  if (productModel === "unknown") warnings.push("product_model_unknown");

  addAnchorConsistencyIssue({ issues, warnings, lower: anchors.minimum, upper: anchors.requested });
  addAnchorConsistencyIssue({ issues, warnings, lower: anchors.requested, upper: anchors.max_250 });
  addAnchorConsistencyIssue({ issues, warnings, lower: anchors.minimum, upper: anchors.max_250 });

  const baseConfidence = (() => {
    let score = productModel === "neonflex" ? 0.88 : productModel === "unknown" ? 0.62 : 0.52;
    const anchorConfidenceValues = allAnchors.map((anchor) => anchor.confidence).filter((value): value is number => Number.isFinite(value));
    if (anchorConfidenceValues.length) {
      score = Math.min(score, anchorConfidenceValues.reduce((sum, value) => sum + value, 0) / anchorConfidenceValues.length);
    }
    score -= warnings.length * 0.05;
    score -= issues.length * 0.2;
    return roundConfidence(score);
  })();
  const setStatus: OfferSizeLadderSetStatus = issues.length ? "blocked" : warnings.length ? "needs_review" : "draft";

  const longSides = ladderLongSides(anchors.minimum.longSideCm, anchors.requested.longSideCm, maxLongSideCm, stepCm);
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
  const extraction = extractOfferSizeLadderAnchorsFromTrelloFields(card.customFields || {});
  if (extraction.anchors.length !== 3) {
    throw new QuoteValidationError(
      "Die drei Trello-Anker konnten nicht vollständig gelesen werden.",
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

  return generateOfferSizeLadder({
    ...input,
    trelloCardId,
    trelloCardUrl: String(input.trelloCard || "").includes("trello.com/c/")
      ? String(input.trelloCard)
      : `https://trello.com/c/${trelloCardId}`,
    productModel: input.productModel || detectOfferSizeLadderProductModel(sourceText),
    sourceText,
    anchors: extraction.anchors,
  });
}
