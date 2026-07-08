import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildNeonflexAnchoredSizeLadder,
  getNeonflexAnchoredShippingBucket,
  NEONFLEX_ANCHORED_SCALING_MODEL,
  predictNeonflexAnchoredSupplierPrice,
  type NeonflexAnchoredScalingPrediction,
} from "@/lib/quote-learning/neonflex-anchored-scaling";
import {
  NEONFLEX_INTERNAL_REVIEW_MAX_LONG_SIDE_CM,
  NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM,
  requiresNeonflexCustomerSizeRequest,
} from "@/lib/quote-learning/neonflex-size-policy";
import {
  getOfferByTrelloCardId,
  patchOfferByTrelloCardId,
  type OpsOfferItem,
  type OpsOfferPatchInput,
  type OpsOfferPatchResult,
  type OpsOfferSnapshot,
} from "@/lib/ops/offers";
import { SUPPLIER_PRICE_TO_OFFER_FACTOR } from "@/lib/ops/supplier-price-review-constants";
import { roundDownToFive } from "@/lib/quotes/pricing";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { downloadTrelloAttachment, getTrelloCard, getTrelloList, getTrelloListCards } from "@/lib/quotes/trello";
import { QuoteValidationError } from "@/lib/quotes/validation";
import type { UpdateActor } from "@/lib/ops/customer-records";

const SUPPLIER_PRICE_REVIEW_WORKFLOW_NAME = "customer_records_console";
const SUPPLIER_PRICE_REVIEW_ACTION = "supplier_price_prediction_reviewed";
const SUPPLIER_QUOTE_ANCHOR_REVIEW_ACTION = "supplier_quote_training_item_anchor_reviewed";
const SUPPLIER_QUOTE_TRELLO_IMPORT_ACTION = "supplier_quote_trello_training_candidates_imported";
const SUPPLIER_QUOTE_TRELLO_IMPORT_PARSER_VERSION = "trello_ocr_anchor_v1";
const execFileAsync = promisify(execFile);

export type SupplierPricePredictionDecisionStatus =
  | "shadow"
  | "needs_supplier_check"
  | "approved_for_quote"
  | "rejected"
  | "superseded";

export type SupplierPricePredictionReviewDecision = "approve" | "reject" | "supplier_check" | "supersede";
export type SupplierQuoteTrainingItemAnchorReviewDecision = "approve" | "reject" | "supplier_check";

export function isSupplierPricePredictionAutomationAction(action: string | null | undefined) {
  return action === "create_from_training_item";
}

export type SupplierPricePredictionReviewItem = {
  id: string;
  predictionKey: string | null;
  sourceCode: string | null;
  sourceLabel: string | null;
  requestId: string | null;
  trelloCardId: string | null;
  designId: string | null;
  modelVersionId: string;
  modelKey: string | null;
  modelVersion: string | null;
  modelStatus: string | null;
  anchorTrainingItemId: string | null;
  anchorWidthCm: number | null;
  anchorHeightCm: number | null;
  anchorProductionPrice: number | null;
  anchorShippingPrice: number | null;
  widthCm: number;
  heightCm: number;
  maxSideCm: number;
  predictedProductionPrice: number;
  predictedShippingPrice: number;
  predictedTotalSupplierCost: number;
  currency: string;
  confidence: number | null;
  featureValues: Record<string, unknown>;
  decisionStatus: SupplierPricePredictionDecisionStatus;
  customerAutoQuoteEligible: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string | null;
};

export type SupplierQuoteTrainingItemAnchorReviewItem = {
  id: string;
  designId: string | null;
  sourceKey: string | null;
  requestId: string | null;
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  trelloCardName: string | null;
  trelloBoardName: string | null;
  trelloListName: string | null;
  attachmentName: string | null;
  designLabel: string | null;
  detectedModelFamily: string | null;
  designReviewStatus: string | null;
  sizeLabel: string | null;
  widthCm: number;
  heightCm: number;
  maxSideCm: number;
  productionPrice: number;
  shippingPrice: number;
  totalSupplierCost: number;
  currency: string;
  productModelFamily: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  excludedFromNeonflexTraining: boolean;
  confidence: number | null;
  validationIssues: unknown[];
  sourceText: string | null;
  createdAt: string | null;
};

export type SupplierPricePredictionDraft = {
  predictionKey: string;
  modelVersionId: string;
  requestId?: string | null;
  trelloCardId?: string | null;
  designId?: string | null;
  sourceCode?: string | null;
  sourceLabel?: string | null;
  anchorTrainingItemId?: string | null;
  anchorWidthCm?: number | null;
  anchorHeightCm?: number | null;
  anchorProductionPrice?: number | null;
  anchorShippingPrice?: number | null;
  widthCm: number;
  heightCm: number;
  predictedProductionPrice: number;
  predictedShippingPrice: number;
  currency?: string | null;
  confidence?: number | null;
  featureValues?: Record<string, unknown>;
  decisionStatus?: SupplierPricePredictionDecisionStatus;
  customerAutoQuoteEligible?: boolean;
};

export type BuildAnchoredPredictionDraftsInput = {
  modelVersionId?: string | null;
  requestId?: string | null;
  trelloCardId?: string | null;
  designId?: string | null;
  sourceCode?: string | null;
  sourceLabel?: string | null;
  anchorTrainingItemId?: string | null;
  baseWidthCm: number;
  baseHeightCm: number;
  baseProductionPriceUsd: number;
  baseShippingPriceUsd: number;
  stepCm?: number;
  maxLongSideCm?: number;
  currency?: string | null;
  featureValues?: Record<string, unknown>;
};

export type BuildTrainingItemPredictionDraftsInput = {
  trainingItemId: string;
  modelVersionId?: string | null;
  requestId?: string | null;
  trelloCardId?: string | null;
  sourceCode?: string | null;
  sourceLabel?: string | null;
  stepCm?: number;
  maxLongSideCm?: number;
  currency?: string | null;
  featureValues?: Record<string, unknown>;
};

export type SupplierPriceTrelloEstimateConfidenceLevel = "high" | "medium" | "low" | "blocked";

export type SupplierPriceTrelloEstimateItem = {
  requestedInput: string;
  widthCm: number;
  heightCm: number;
  maxSideCm: number;
  predictedProductionPrice: number;
  predictedShippingPrice: number;
  predictedTotalSupplierCost: number;
  currency: string;
  confidence: number;
  confidenceLevel: SupplierPriceTrelloEstimateConfidenceLevel;
  customerAutoQuoteEligible: boolean;
  needsSupplierCheck: boolean;
  reviewReason: string | null;
  modelKey: string;
  modelVersion: string;
  shippingBucket: string;
  shippingStrategy: string;
  shippingTrainingRows: number;
};

export type SupplierPriceTrelloEstimateAnchor = {
  widthCm: number;
  heightCm: number;
  maxSideCm: number;
  productionPrice: number;
  shippingPrice: number;
  totalSupplierCost: number;
  currency: string;
  source: "ocr_multi_anchor" | "custom_fields" | "ocr_image" | "mixed" | "estimated_split";
  confidence: number;
};

export type SupplierPriceTrelloEstimateResult = {
  card: {
    id: string;
    name: string | null;
    shortUrl: string | null;
  };
  anchor: {
    widthCm: number;
    heightCm: number;
    productionPrice: number;
    shippingPrice: number;
    totalSupplierCost: number;
    currency: string;
    source: "ocr_image" | "custom_fields" | "mixed" | "estimated_split";
    attachmentName: string | null;
    modelFamily: "neonflex" | "unsupported" | "unknown";
    confidence: number;
  };
  supplierAnchors?: SupplierPriceTrelloEstimateAnchor[];
  estimates: SupplierPriceTrelloEstimateItem[];
  warnings: string[];
  evidence: {
    sizeText: string | null;
    productionText: string | null;
    shippingText: string | null;
    totalText: string | null;
    ocrAvailable: boolean;
    ocrTextPreview: string | null;
  };
};

export type SupplierPriceOfferApplyPlausibilityStatus = "ok" | "warning" | "blocked";

export type SupplierPriceOfferApplyPlausibility = {
  status: SupplierPriceOfferApplyPlausibilityStatus;
  areaRatio: number;
  supplierPriceRatio: number;
  issues: string[];
};

export type SupplierPriceOfferApplyResult = {
  dryRun: boolean;
  offer: OpsOfferSnapshot;
  diff?: OpsOfferPatchResult["diff"];
  estimate: SupplierPriceTrelloEstimateResult;
  applied: {
    itemId: string;
    itemTitle: string;
    requestedInput: string;
    widthCm: number;
    heightCm: number;
    supplierTotalCost: number;
    offerUnitPriceNet: number;
    factor: number;
    plausibility: SupplierPriceOfferApplyPlausibility;
  };
};

export type SupplierQuoteTrelloImportSkippedReason =
  | "no_image_attachment"
  | "ocr_unavailable"
  | "missing_size"
  | "missing_split_prices"
  | "already_reviewed"
  | "title_filter"
  | "invalid_card";

export type SupplierQuoteTrelloImportSkippedItem = {
  cardId: string | null;
  cardName: string | null;
  attachmentId: string | null;
  attachmentName: string | null;
  reason: SupplierQuoteTrelloImportSkippedReason;
  detail?: string | null;
};

export type SupplierQuoteTrelloImportErrorItem = {
  cardInput: string;
  message: string;
};

export type SupplierQuoteTrelloImportResult = {
  scannedCards: number;
  scannedAttachments: number;
  imported: number;
  updated: number;
  skipped: SupplierQuoteTrelloImportSkippedItem[];
  errors: SupplierQuoteTrelloImportErrorItem[];
  anchorItems: SupplierQuoteTrainingItemAnchorReviewItem[];
};

type SupplierPricePredictionRow = {
  id: string;
  prediction_key?: string | null;
  source_code?: string | null;
  source_label?: string | null;
  request_id?: string | null;
  trello_card_id?: string | null;
  design_id?: string | null;
  model_version_id: string;
  anchor_training_item_id?: string | null;
  anchor_width_cm?: string | number | null;
  anchor_height_cm?: string | number | null;
  anchor_production_price?: string | number | null;
  anchor_shipping_price?: string | number | null;
  width_cm: string | number;
  height_cm: string | number;
  predicted_production_price: string | number;
  predicted_shipping_price: string | number;
  predicted_total_supplier_cost?: string | number | null;
  currency?: string | null;
  confidence?: string | number | null;
  feature_values?: Record<string, unknown> | null;
  decision_status: SupplierPricePredictionDecisionStatus;
  customer_auto_quote_eligible?: boolean | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at?: string | null;
};

type SupplierPriceModelVersionRow = {
  id: string;
  model_key?: string | null;
  version_label?: string | null;
  status?: string | null;
};

type SupplierQuoteTrainingItemAnchorRow = {
  id: string;
  design_id?: string | null;
  row_index?: number | null;
  variant_index?: number | null;
  size_label?: string | null;
  width_cm?: string | number | null;
  height_cm?: string | number | null;
  max_side_cm?: string | number | null;
  production_price?: string | number | null;
  shipping_price?: string | number | null;
  total_supplier_cost?: string | number | null;
  currency?: string | null;
  product_model_family?: string | null;
  excluded_from_neonflex_training?: boolean | null;
  exclusion_reason?: string | null;
  excluded_reason?: string | null;
  source_text?: string | null;
  confidence?: string | number | null;
  validation_status?: string | null;
  validation_issues?: unknown[] | null;
  review_status?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

type SupplierQuoteDesignAnchorRow = {
  id: string;
  image_source_id?: string | null;
  design_index?: number | null;
  design_label?: string | null;
  detected_model_family?: string | null;
  review_status?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

type SupplierQuoteImageSourceAnchorRow = {
  id: string;
  source_key?: string | null;
  trello_card_id?: string | null;
  trello_attachment_id?: string | null;
  trello_attachment_name?: string | null;
  request_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  checksum_sha256?: string | null;
  mime_type?: string | null;
  import_status?: string | null;
  raw_metadata?: Record<string, unknown> | null;
};

function trimNullable(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function numericValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(name: string, value: unknown) {
  const parsed = numericValue(value);
  if (parsed === null) throw new QuoteValidationError(`${name} fehlt oder ist ungueltig.`);
  return parsed;
}

function requiredPositiveNumber(name: string, value: unknown) {
  const parsed = requiredNumber(name, value);
  if (parsed <= 0) throw new QuoteValidationError(`${name} muss groesser als 0 sein.`);
  return parsed;
}

function correctedPositiveNumber(name: string, value: unknown, fallback: unknown) {
  if (value === null || value === undefined || value === "") return requiredPositiveNumber(name, fallback);
  return requiredPositiveNumber(name, value);
}

function formatCmValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function defaultSizeLabel(widthCm: number, heightCm: number) {
  return `${formatCmValue(widthCm)}x${formatCmValue(heightCm)}cm`;
}

function parseTrelloCardIdentifier(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const urlMatch = normalized.match(/trello\.com\/c\/([^/?#\s]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const prefixed = normalized.match(/^trello:([^/\s]+)$/i);
  if (prefixed?.[1]) return prefixed[1];
  if (/^[A-Za-z0-9]{6,32}$/.test(normalized)) return normalized;
  return null;
}

function normalizeNumericText(value: string) {
  return value.replace(",", ".").trim();
}

function parseSupplierQuoteNumber(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(normalizeNumericText(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNumericTokens(value: string) {
  return Array.from(value.matchAll(/\d+(?:[.,]\d+)?/g))
    .map((match) => Number(normalizeNumericText(match[0])))
    .filter((number) => Number.isFinite(number) && number > 0);
}

function parseSizeText(value: string | null | undefined) {
  const normalized = String(value || "").replace(",", ".").trim();
  if (!normalized) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:x|\*|×|\/)\s*(\d+(?:\.\d+)?)\s*(?:cm)?/i);
  if (!match) return null;
  const widthCm = Number(match[1]);
  const heightCm = Number(match[2]);
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) return null;
  return { widthCm, heightCm, raw: match[0] };
}

function parseLongSideList(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return [];
  const explicit = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:cm)?\s*(?:[|/]\s*)/gi)).map((match) => Number(match[1]));
  const trailing = normalized.match(/(?:[|/]\s*)(\d+(?:\.\d+)?)\s*cm\b/i);
  const slashList = trailing ? [...explicit, Number(trailing[1])] : [];
  if (slashList.length >= 2 && slashList.every((number) => Number.isFinite(number) && number > 0)) return slashList;

  return Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*cm\b/gi))
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
}

function parseTargetSizes(input: string, anchor: { widthCm: number; heightCm: number }) {
  const normalized = String(input || "").trim();
  if (!normalized) throw new QuoteValidationError("Zielgroesse fehlt.");

  const chunks = normalized
    .split(/[,\n;]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const sourceChunks = chunks.length ? chunks : [normalized];
  const widthDominant = anchor.widthCm >= anchor.heightCm;
  const ratio = anchor.widthCm / anchor.heightCm;

  return sourceChunks.map((chunk) => {
    const size = parseSizeText(chunk);
    if (size) {
      return {
        requestedInput: chunk,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
      };
    }

    const compact = chunk.replace(/\s+/g, "");
    const fourDigit = compact.match(/^(\d{2})(\d{2})$/);
    if (fourDigit) {
      return {
        requestedInput: chunk,
        widthCm: Number(fourDigit[1]),
        heightCm: Number(fourDigit[2]),
      };
    }

    const twoNumbers = chunk.match(/^(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*(?:cm)?$/i);
    if (twoNumbers) {
      return {
        requestedInput: chunk,
        widthCm: Number(normalizeNumericText(twoNumbers[1])),
        heightCm: Number(normalizeNumericText(twoNumbers[2])),
      };
    }

    const single = chunk.match(/(\d+(?:[.,]\d+)?)\s*(?:cm)?/i);
    if (!single) throw new QuoteValidationError(`Zielgroesse "${chunk}" konnte nicht gelesen werden.`);
    const longOrWidth = Number(normalizeNumericText(single[1]));
    if (!Number.isFinite(longOrWidth) || longOrWidth <= 0) {
      throw new QuoteValidationError(`Zielgroesse "${chunk}" ist ungueltig.`);
    }

    return {
      requestedInput: chunk,
      widthCm: widthDominant ? longOrWidth : longOrWidth * ratio,
      heightCm: widthDominant ? longOrWidth / ratio : longOrWidth,
    };
  }).map((target) => ({
    requestedInput: target.requestedInput,
    widthCm: Math.round(target.widthCm * 10) / 10,
    heightCm: Math.round(target.heightCm * 10) / 10,
  }));
}

function targetSizeKey(target: { widthCm: number; heightCm: number }) {
  return `${Math.round(target.widthCm * 10) / 10}x${Math.round(target.heightCm * 10) / 10}`;
}

function automaticTargetSizeInputs(anchor: { widthCm: number; heightCm: number }, stepCm = 10, maxLongSideCm = 250) {
  const anchorLongSide = Math.max(anchor.widthCm, anchor.heightCm);
  const values = new Set<number>([Math.round(anchorLongSide * 10) / 10]);
  const firstStep = Math.ceil(anchorLongSide / stepCm) * stepCm;
  for (let value = firstStep; value <= maxLongSideCm + 0.001; value += stepCm) {
    if (value >= anchorLongSide - 0.001) values.add(Math.round(value * 10) / 10);
  }
  return Array.from(values)
    .sort((left, right) => left - right)
    .map((value) => `${formatCmValue(value)}cm`);
}

export function buildSupplierEstimateTargetSizes(
  input: string | null | undefined,
  anchor: { widthCm: number; heightCm: number },
) {
  const explicitTargets = String(input || "").trim() ? parseTargetSizes(String(input), anchor) : [];
  const automaticTargets = parseTargetSizes(automaticTargetSizeInputs(anchor).join(","), anchor);
  const targets = [...explicitTargets, ...automaticTargets];
  const bySize = new Map<string, (typeof targets)[number]>();
  for (const target of targets) {
    bySize.set(targetSizeKey(target), target);
  }
  return Array.from(bySize.values()).sort((left, right) => {
    const leftMax = Math.max(left.widthCm, left.heightCm);
    const rightMax = Math.max(right.widthCm, right.heightCm);
    return leftMax - rightMax || left.widthCm - right.widthCm || left.heightCm - right.heightCm;
  });
}

function dimensionsForLongSide(anchor: { widthCm: number; heightCm: number }, longSideCm: number) {
  const ratio = anchor.widthCm / anchor.heightCm;
  const widthDominant = anchor.widthCm >= anchor.heightCm;
  return {
    widthCm: Math.round((widthDominant ? longSideCm : longSideCm * ratio) * 10) / 10,
    heightCm: Math.round((widthDominant ? longSideCm / ratio : longSideCm) * 10) / 10,
  };
}

function normalizeSupplierAnchors(anchors: SupplierPriceTrelloEstimateAnchor[]) {
  const bySize = new Map<string, SupplierPriceTrelloEstimateAnchor>();
  for (const anchor of anchors) {
    if (anchor.productionPrice <= 0 || anchor.shippingPrice <= 0) continue;
    bySize.set(targetSizeKey(anchor), {
      ...anchor,
      maxSideCm: Math.max(anchor.widthCm, anchor.heightCm),
      totalSupplierCost: Math.round((anchor.productionPrice + anchor.shippingPrice) * 100) / 100,
    });
  }
  return Array.from(bySize.values()).sort((left, right) => left.maxSideCm - right.maxSideCm);
}

export function extractSupplierQuoteMultiAnchors(
  text: string,
  baseSize: { widthCm: number; heightCm: number } | null,
  currency = "USD",
): SupplierPriceTrelloEstimateAnchor[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const anchors: SupplierPriceTrelloEstimateAnchor[] = [];

  for (const line of lines) {
    const listedLongSides = parseLongSideList(line);
    if (listedLongSides.length >= 2) continue;
    const explicitSize = parseSizeText(line);
    const longSides = explicitSize ? [Math.max(explicitSize.widthCm, explicitSize.heightCm)] : listedLongSides;
    if (!longSides.length) continue;
    const numbers = parseNumericTokens(line);
    const priceNumbers = numbers.filter((number) => !longSides.some((side) => Math.abs(side - number) < 0.001));
    if (longSides.length === 1 && priceNumbers.length >= 2) {
      const dimensions = explicitSize || (baseSize ? dimensionsForLongSide(baseSize, longSides[0]) : null);
      if (!dimensions) continue;
      anchors.push({
        widthCm: dimensions.widthCm,
        heightCm: dimensions.heightCm,
        maxSideCm: Math.max(dimensions.widthCm, dimensions.heightCm),
        productionPrice: priceNumbers[0],
        shippingPrice: priceNumbers[1],
        totalSupplierCost: priceNumbers[0] + priceNumbers[1],
        currency,
        source: "ocr_multi_anchor",
        confidence: 0.72,
      });
    }
  }

  const sizeLine = lines.find((line) => /size|groesse|größe|cm/i.test(line) && parseLongSideList(line).length >= 2);
  const productionLine = lines.find((line) => /production|prod\.?|price|preis/i.test(line) && !/shipping|total/i.test(line));
  const shippingLine = lines.find((line) => /shipping|ship\.?|versand|fracht/i.test(line));
  if (sizeLine && productionLine && shippingLine && baseSize) {
    const longSides = parseLongSideList(sizeLine);
    const productionValues = parseNumericTokens(productionLine).slice(-longSides.length);
    const shippingValues = parseNumericTokens(shippingLine).slice(-longSides.length);
    if (longSides.length >= 2 && productionValues.length === longSides.length && shippingValues.length === longSides.length) {
      longSides.forEach((longSideCm, index) => {
        const dimensions = dimensionsForLongSide(baseSize, longSideCm);
        anchors.push({
          widthCm: dimensions.widthCm,
          heightCm: dimensions.heightCm,
          maxSideCm: Math.max(dimensions.widthCm, dimensions.heightCm),
          productionPrice: productionValues[index],
          shippingPrice: shippingValues[index],
          totalSupplierCost: productionValues[index] + shippingValues[index],
          currency,
          source: "ocr_multi_anchor",
          confidence: 0.82,
        });
      });
    }
  }

  return normalizeSupplierAnchors(anchors);
}

function interpolateMoneyByArea(targetArea: number, lowerArea: number, lowerValue: number, upperArea: number, upperValue: number) {
  if (Math.abs(upperArea - lowerArea) < 0.001) return Math.round(lowerValue * 100) / 100;
  const t = Math.max(0, Math.min(1, (targetArea - lowerArea) / (upperArea - lowerArea)));
  return Math.round((lowerValue + t * (upperValue - lowerValue)) * 100) / 100;
}

function interpolateMoneyByT(lowerValue: number, upperValue: number, t: number) {
  const bounded = Math.max(0, Math.min(1, t));
  return Math.round((lowerValue + bounded * (upperValue - lowerValue)) * 100) / 100;
}

function productionTrainingT(targetArea: number, lowerArea: number, upperArea: number) {
  const exponent = NEONFLEX_ANCHORED_SCALING_MODEL.production.area_exponent;
  if (Math.abs(upperArea - lowerArea) < 0.001) return 0;
  const lowerPowered = lowerArea ** exponent;
  const upperPowered = upperArea ** exponent;
  const targetPowered = targetArea ** exponent;
  if (Math.abs(upperPowered - lowerPowered) < 0.001) return (targetArea - lowerArea) / (upperArea - lowerArea);
  return (targetPowered - lowerPowered) / (upperPowered - lowerPowered);
}

function shippingTrainingT(params: {
  lower: SupplierPriceTrelloEstimateAnchor;
  upper: SupplierPriceTrelloEstimateAnchor;
  target: { widthCm: number; heightCm: number };
}) {
  const linearAreaT = (() => {
    const lowerArea = params.lower.widthCm * params.lower.heightCm;
    const upperArea = params.upper.widthCm * params.upper.heightCm;
    const targetArea = params.target.widthCm * params.target.heightCm;
    return Math.abs(upperArea - lowerArea) < 0.001 ? 0 : (targetArea - lowerArea) / (upperArea - lowerArea);
  })();
  try {
    const targetPrediction = predictNeonflexAnchoredSupplierPrice({
      base_width_cm: params.lower.widthCm,
      base_height_cm: params.lower.heightCm,
      base_production_price_usd: params.lower.productionPrice,
      base_shipping_price_usd: params.lower.shippingPrice,
      target_width_cm: params.target.widthCm,
      target_height_cm: params.target.heightCm,
    });
    const upperPrediction = predictNeonflexAnchoredSupplierPrice({
      base_width_cm: params.lower.widthCm,
      base_height_cm: params.lower.heightCm,
      base_production_price_usd: params.lower.productionPrice,
      base_shipping_price_usd: params.lower.shippingPrice,
      target_width_cm: params.upper.widthCm,
      target_height_cm: params.upper.heightCm,
    });
    const targetDelta = targetPrediction.predicted_shipping_price_usd - params.lower.shippingPrice;
    const upperDelta = upperPrediction.predicted_shipping_price_usd - params.lower.shippingPrice;
    if (Math.abs(upperDelta) < 0.001) return linearAreaT;
    return targetDelta / upperDelta;
  } catch {
    return linearAreaT;
  }
}

function supplierAnchorBreakpointReason(lower: SupplierPriceTrelloEstimateAnchor, target: { widthCm: number; heightCm: number }, upper: SupplierPriceTrelloEstimateAnchor) {
  const lowerBucket = getNeonflexAnchoredShippingBucket(lower.maxSideCm);
  const targetBucket = getNeonflexAnchoredShippingBucket(Math.max(target.widthCm, target.heightCm));
  const upperBucket = getNeonflexAnchoredShippingBucket(upper.maxSideCm);
  if (lowerBucket !== upperBucket && targetBucket !== lowerBucket) {
    return `shipping_bucket_transition_${lowerBucket}_to_${targetBucket}`;
  }
  return null;
}

function markMarginalPriceBreaks(estimates: SupplierPriceTrelloEstimateItem[]) {
  return estimates.map((item, index) => {
    if (index < 2) return item;
    const previous = estimates[index - 1];
    const beforePrevious = estimates[index - 2];
    const previousDelta = previous.predictedTotalSupplierCost - beforePrevious.predictedTotalSupplierCost;
    const currentDelta = item.predictedTotalSupplierCost - previous.predictedTotalSupplierCost;
    if (previousDelta > 0 && currentDelta > Math.max(previousDelta * 1.6, previousDelta + 35)) {
      return {
        ...item,
        reviewReason: item.reviewReason || "marginal_price_jump_detected",
        shippingBucket: item.shippingBucket.includes("price_break") ? item.shippingBucket : `${item.shippingBucket}_price_break`,
      };
    }
    return item;
  });
}

export function estimateSupplierPriceFromAnchors(params: {
  target: { requestedInput: string; widthCm: number; heightCm: number };
  anchors: SupplierPriceTrelloEstimateAnchor[];
  modelFamily: "neonflex" | "unsupported" | "unknown";
}) {
  const sorted = normalizeSupplierAnchors(params.anchors);
  if (sorted.length < 2) return null;
  const targetArea = params.target.widthCm * params.target.heightCm;
  const exact = sorted.find((anchor) => Math.abs(anchor.maxSideCm - Math.max(params.target.widthCm, params.target.heightCm)) < 0.5);
  if (exact) {
    const score = params.modelFamily === "unsupported" ? 0 : Math.min(0.92, exact.confidence);
    return {
      production: exact.productionPrice,
      shipping: exact.shippingPrice,
      confidence: score,
      reviewReason: params.modelFamily === "unsupported" ? "unsupported_model_family" : null,
      shippingBucket: "supplier_anchor",
      shippingStrategy: "exact_supplier_anchor",
      shippingTrainingRows: sorted.length,
    };
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    const lowerArea = lower.widthCm * lower.heightCm;
    const upperArea = upper.widthCm * upper.heightCm;
    if (targetArea >= lowerArea && targetArea <= upperArea) {
      const breakpointReason = supplierAnchorBreakpointReason(lower, params.target, upper);
      const score = params.modelFamily === "unsupported"
        ? 0
        : Math.max(0.55, Math.min(0.86, lower.confidence, upper.confidence) - (breakpointReason ? 0.08 : 0));
      const productionT = productionTrainingT(targetArea, lowerArea, upperArea);
      const shippingT = shippingTrainingT({ lower, upper, target: params.target });
      return {
        production: interpolateMoneyByT(lower.productionPrice, upper.productionPrice, productionT),
        shipping: interpolateMoneyByT(lower.shippingPrice, upper.shippingPrice, shippingT),
        confidence: score,
        reviewReason: params.modelFamily === "unsupported" ? "unsupported_model_family" : breakpointReason,
        shippingBucket: breakpointReason ? "supplier_anchor_bucket_transition" : "supplier_anchor_piecewise",
        shippingStrategy: "training_informed_supplier_anchor_interpolation",
        shippingTrainingRows: sorted.length,
      };
    }
  }

  return null;
}

function quoteTextMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function supplierQuoteImageAttachment(card: Awaited<ReturnType<typeof getTrelloCard>>) {
  const attachments = card.attachments || [];
  return (
    attachments.find((attachment) => String(attachment.name || attachment.fileName || "").toLowerCase() === "image.png") ||
    attachments.find((attachment) => /image/i.test(String(attachment.name || attachment.fileName || "")) && /png|jpe?g|webp/i.test(String(attachment.mimeType || attachment.name || attachment.fileName || ""))) ||
    attachments.find((attachment) => /png|jpe?g|webp/i.test(String(attachment.mimeType || attachment.name || attachment.fileName || ""))) ||
    null
  );
}

function supplierQuoteImageAttachments(card: Awaited<ReturnType<typeof getTrelloCard>>) {
  const attachments = card.attachments || [];
  const rank = (attachment: (typeof attachments)[number]) => {
    const name = String(attachment.name || attachment.fileName || "").toLowerCase();
    if (name === "image.png") return 0;
    if (/^image[_-]?\d*cm?/.test(name)) return 1;
    if (/image/.test(name)) return 2;
    if (/png|jpe?g|webp/i.test(String(attachment.mimeType || name))) return 3;
    return 99;
  };
  return attachments
    .filter((attachment) => rank(attachment) < 99)
    .sort((left, right) => rank(left) - rank(right))
    .slice(0, 5);
}

async function ocrImageBufferText(params: {
  cardId: string;
  attachmentId?: string | null;
  attachmentName?: string | null;
  body: ArrayBuffer | Buffer;
}) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "neontrip-price-ocr-"));
  const extension = path.extname(String(params.attachmentName || "image.png")) || ".png";
  const imagePath = path.join(tempDir, `source${extension}`);
  try {
    const body = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
    await writeFile(imagePath, body);
    const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "--psm", "6"], {
      timeout: 12_000,
      maxBuffer: 256_000,
    });
    return String(stdout || "").trim() || null;
  } catch (error) {
    console.warn("supplier price trello estimate OCR skipped", {
      cardId: params.cardId,
      attachmentId: params.attachmentId,
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ocrTrelloAttachmentText(cardId: string, attachment: NonNullable<ReturnType<typeof supplierQuoteImageAttachment>>) {
  const download = await downloadTrelloAttachment(attachment);
  if (!String(download.contentType || "").toLowerCase().startsWith("image/")) return null;
  return ocrImageBufferText({
    cardId,
    attachmentId: attachment.id,
    attachmentName: attachment.name || attachment.fileName || "image.png",
    body: download.body,
  });
}

function detectSupplierModelFamily(text: string) {
  if (/\b(3d|3-d|3\s*d|full\s*glow|non\s*-?\s*lit|channel\s*letter)\b/i.test(text)) return "unsupported" as const;
  if (/neon\s*flex|neonflex|led\s+logo|wandschild/i.test(text)) return "neonflex" as const;
  return "unknown" as const;
}

function confidenceLevel(score: number): SupplierPriceTrelloEstimateConfidenceLevel {
  if (score <= 0) return "blocked";
  if (score >= 0.78) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function estimateConfidence(params: {
  anchorConfidence: number;
  prediction: NeonflexAnchoredScalingPrediction;
  modelFamily: "neonflex" | "unsupported" | "unknown";
}) {
  if (params.modelFamily === "unsupported") return 0;
  let score = params.anchorConfidence;
  if (params.modelFamily === "unknown") score -= 0.15;
  if (params.prediction.shipping_requires_review) score -= 0.2;
  if (params.prediction.shipping_used_global_fallback) score -= 0.15;
  if (params.prediction.target_width_cm < params.prediction.base_width_cm || params.prediction.target_height_cm < params.prediction.base_height_cm) score -= 0.1;
  if (Math.max(params.prediction.target_width_cm, params.prediction.target_height_cm) > 200) score -= 0.25;
  return Math.max(0.1, Math.min(0.95, Math.round(score * 100) / 100));
}

function readCustomFieldValue(card: Awaited<ReturnType<typeof getTrelloCard>>, names: string[]) {
  const normalized = new Map(
    Object.entries(card.customFields || {}).map(([key, value]) => [key.trim().toLowerCase(), String(value || "").trim()]),
  );
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value) return value;
  }
  return null;
}

function extractSupplierQuoteEvidence(text: string) {
  const sizeText = quoteTextMatch(text, [
    /(\d+(?:[.,]\d+)?)\s*(?:x|\*|×)\s*(\d+(?:[.,]\d+)?)\s*cm/i,
  ]);
  const sizeMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:x|\*|×)\s*(\d+(?:[.,]\d+)?)\s*cm/i);
  const productionText = quoteTextMatch(text, [
    /production\s+price\s*:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
    /\bprice\s*:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
  ]);
  const shippingText = quoteTextMatch(text, [
    /shipping\s+cost\s*:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
    /\bshipping\s*:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
  ]);
  const totalText = quoteTextMatch(text, [
    /total\s+(?:price\s*)?:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
    /\btotal\s*:?\s*(?:us\$|\$)?\s*(\d+(?:[.,]\d+)?)/i,
  ]);
  return {
    size: sizeMatch ? {
      widthCm: Number(normalizeNumericText(sizeMatch[1])),
      heightCm: Number(normalizeNumericText(sizeMatch[2])),
      raw: sizeMatch[0],
    } : null,
    sizeText: sizeMatch?.[0] || sizeText,
    productionText,
    shippingText,
    totalText,
    productionPrice: parseSupplierQuoteNumber(productionText),
    shippingPrice: parseSupplierQuoteNumber(shippingText),
    totalPrice: parseSupplierQuoteNumber(totalText),
  };
}

export async function estimateSupplierPricesFromTrello(input: {
  trelloCard: string;
  targetSizes: string;
  currency?: string | null;
}): Promise<SupplierPriceTrelloEstimateResult> {
  const cardIdentifier = parseTrelloCardIdentifier(input.trelloCard);
  if (!cardIdentifier) throw new QuoteValidationError("Trello-Link oder Trello-Karten-ID ist ungueltig.");

  const card = await getTrelloCard(cardIdentifier);
  const warnings: string[] = [];
  const currency = trimNullable(input.currency) || "USD";
  const customSizeText = readCustomFieldValue(card, ["Size_1", "Größe 1", "Groesse 1", "Size"]);
  const customTotalText = readCustomFieldValue(card, ["Price_1", "Preis 1", "Price"]);
  const customSize = parseSizeText(customSizeText);
  const customTotal = parseSupplierQuoteNumber(customTotalText || undefined);

  let ocrText: string | null = null;
  let ocrAttachmentName: string | null = null;
  let ocrEvidence = extractSupplierQuoteEvidence("");
  let bestOcrScore = -1;
  for (const attachment of supplierQuoteImageAttachments(card)) {
    const text = await ocrTrelloAttachmentText(card.id, attachment);
    if (!text) continue;
    const evidence = extractSupplierQuoteEvidence(text);
    const hasSplitPrices = evidence.productionPrice !== null && evidence.shippingPrice !== null;
    const sizeMatchesCustom =
      !customSize ||
      (Boolean(evidence.size) && Math.abs((evidence.size?.widthCm || 0) - customSize.widthCm) <= 1 && Math.abs((evidence.size?.heightCm || 0) - customSize.heightCm) <= 1);
    const totalMatchesCustom =
      !customTotal ||
      (evidence.totalPrice !== null && Math.abs(evidence.totalPrice - customTotal) <= Math.max(3, customTotal * 0.03));
    const score =
      (hasSplitPrices ? 20 : 0) +
      (sizeMatchesCustom ? 10 : 0) +
      (totalMatchesCustom ? 10 : 0) +
      (/^image[_-]?\d*cm?/i.test(String(attachment.name || attachment.fileName || "")) ? 2 : 0) +
      (String(attachment.name || attachment.fileName || "").toLowerCase() === "image.png" ? 1 : 0);
    if (score > bestOcrScore) {
      ocrText = text;
      ocrAttachmentName = String(attachment.name || attachment.fileName || "image");
      ocrEvidence = evidence;
      bestOcrScore = score;
    }
    if (hasSplitPrices && sizeMatchesCustom && totalMatchesCustom) break;
  }

  const allText = [card.name, customSizeText, customTotalText, ocrText].filter(Boolean).join("\n");
  const modelFamily = detectSupplierModelFamily(allText);
  if (modelFamily === "unsupported") {
    warnings.push("Die Karte sieht nach 3D, Full Glow oder einem anderen Nicht-Neonflex-Modell aus. Neonflex-Schätzung wurde blockiert.");
  } else if (modelFamily === "unknown") {
    warnings.push("Modellfamilie konnte nicht sicher als Neonflex erkannt werden.");
  }

  const anchorSize = customSize || ocrEvidence.size;
  if (!anchorSize) throw new QuoteValidationError("Keine Anker-Groesse gefunden. Erwartet z.B. Size_1 oder 80x63cm im Image.");

  let productionPrice = ocrEvidence.productionPrice;
  let shippingPrice = ocrEvidence.shippingPrice;
  let totalSupplierCost = ocrEvidence.totalPrice || customTotal || null;
  let source: SupplierPriceTrelloEstimateResult["anchor"]["source"] = "ocr_image";
  let anchorConfidence = 0.86;

  if ((productionPrice === null || shippingPrice === null) && customTotal) {
    source = "estimated_split";
    productionPrice = Math.round(customTotal * 0.45);
    shippingPrice = Math.max(1, customTotal - productionPrice);
    totalSupplierCost = customTotal;
    anchorConfidence = 0.42;
    warnings.push("Production/Shipping konnten nicht getrennt gelesen werden. Split wurde aus Gesamtpreis grob geschaetzt.");
  } else if (customSize && ocrEvidence.productionPrice !== null && ocrEvidence.shippingPrice !== null) {
    source = ocrEvidence.size ? "ocr_image" : "mixed";
    anchorConfidence = ocrEvidence.size ? 0.88 : 0.78;
  }

  if (productionPrice === null || shippingPrice === null) {
    throw new QuoteValidationError("Production Price und Shipping cost konnten nicht aus Trello/Image gelesen werden.");
  }
  totalSupplierCost = totalSupplierCost || productionPrice + shippingPrice;
  const supplierAnchors = normalizeSupplierAnchors([
    {
      widthCm: anchorSize.widthCm,
      heightCm: anchorSize.heightCm,
      maxSideCm: Math.max(anchorSize.widthCm, anchorSize.heightCm),
      productionPrice,
      shippingPrice,
      totalSupplierCost,
      currency,
      source,
      confidence: anchorConfidence,
    },
    ...extractSupplierQuoteMultiAnchors([card.name, ocrText].filter(Boolean).join("\n"), anchorSize, currency),
  ]);

  const targets = buildSupplierEstimateTargetSizes(input.targetSizes, anchorSize);
  if (targets.some((target) => target.widthCm * target.heightCm < anchorSize.widthCm * anchorSize.heightCm)) {
    warnings.push("Mindestens eine Zielgroesse ist kleiner als der erkannte Anker. Das ist nur eine grobe Downscale-Extrapolation und sollte vom Supplier geprueft werden.");
  }
  if (supplierAnchors.length >= 2) {
    warnings.push(`${supplierAnchors.length} Supplier-Anker erkannt. Preise innerhalb dieser Anker werden abschnittsweise interpoliert.`);
  }
  const estimates = markMarginalPriceBreaks(targets.map<SupplierPriceTrelloEstimateItem>((target) => {
    const anchorEstimate = estimateSupplierPriceFromAnchors({
      target,
      anchors: supplierAnchors,
      modelFamily,
    });
    if (anchorEstimate) {
      const total = Math.round((anchorEstimate.production + anchorEstimate.shipping) * 100) / 100;
      const customerAutoQuoteEligible = !requiresNeonflexCustomerSizeRequest({
        width_cm: target.widthCm,
        height_cm: target.heightCm,
      });
      return {
        requestedInput: target.requestedInput,
        widthCm: target.widthCm,
        heightCm: target.heightCm,
        maxSideCm: Math.max(target.widthCm, target.heightCm),
        predictedProductionPrice: anchorEstimate.production,
        predictedShippingPrice: anchorEstimate.shipping,
        predictedTotalSupplierCost: total,
        currency,
        confidence: anchorEstimate.confidence,
        confidenceLevel: confidenceLevel(anchorEstimate.confidence),
        customerAutoQuoteEligible,
        needsSupplierCheck: modelFamily === "unsupported" || !customerAutoQuoteEligible || anchorEstimate.confidence < 0.55,
        reviewReason:
          modelFamily === "unsupported"
            ? "unsupported_model_family"
            : !customerAutoQuoteEligible
              ? "target_size_requires_supplier_request"
              : anchorEstimate.reviewReason,
        modelKey: NEONFLEX_ANCHORED_SCALING_MODEL.model_key,
        modelVersion: NEONFLEX_ANCHORED_SCALING_MODEL.version,
        shippingBucket: anchorEstimate.shippingBucket,
        shippingStrategy: anchorEstimate.shippingStrategy,
        shippingTrainingRows: anchorEstimate.shippingTrainingRows,
      };
    }

    const extrapolationAnchor = supplierAnchors.length >= 2
      ? [...supplierAnchors].sort((left, right) => {
        const targetArea = target.widthCm * target.heightCm;
        const leftArea = left.widthCm * left.heightCm;
        const rightArea = right.widthCm * right.heightCm;
        return Math.abs(targetArea - leftArea) - Math.abs(targetArea - rightArea);
      })[0]
      : null;
    const baseWidth = extrapolationAnchor?.widthCm || anchorSize.widthCm;
    const baseHeight = extrapolationAnchor?.heightCm || anchorSize.heightCm;
    const baseProductionPrice = extrapolationAnchor?.productionPrice || productionPrice;
    const baseShippingPrice = extrapolationAnchor?.shippingPrice || shippingPrice;
    const baseArea = baseWidth * baseHeight;
    const targetArea = target.widthCm * target.heightCm;
    if (targetArea < baseArea) {
      const areaRatio = targetArea / baseArea;
      const production = Math.round(baseProductionPrice * areaRatio ** NEONFLEX_ANCHORED_SCALING_MODEL.production.area_exponent);
      const shipping = Math.round(Math.max(20, baseShippingPrice * Math.sqrt(areaRatio)));
      const total = production + shipping;
      const score = modelFamily === "unsupported" ? 0 : 0.25;
      return {
        requestedInput: target.requestedInput,
        widthCm: target.widthCm,
        heightCm: target.heightCm,
        maxSideCm: Math.max(target.widthCm, target.heightCm),
        predictedProductionPrice: production,
        predictedShippingPrice: shipping,
        predictedTotalSupplierCost: total,
        currency,
        confidence: score,
        confidenceLevel: confidenceLevel(score),
        customerAutoQuoteEligible: true,
        needsSupplierCheck: true,
        reviewReason:
          modelFamily === "unsupported"
            ? "unsupported_model_family"
            : supplierAnchors.length >= 2
              ? "target_outside_supplier_anchor_range_extrapolation"
              : "target_smaller_than_anchor_downscale_extrapolation",
        modelKey: NEONFLEX_ANCHORED_SCALING_MODEL.model_key,
        modelVersion: NEONFLEX_ANCHORED_SCALING_MODEL.version,
        shippingBucket: "below_anchor",
        shippingStrategy: "downscale_extrapolation",
        shippingTrainingRows: 0,
      };
    }

    const prediction = predictNeonflexAnchoredSupplierPrice({
      base_width_cm: baseWidth,
      base_height_cm: baseHeight,
      base_production_price_usd: baseProductionPrice,
      base_shipping_price_usd: baseShippingPrice,
      target_width_cm: target.widthCm,
      target_height_cm: target.heightCm,
    });
    const customerAutoQuoteEligible = !requiresNeonflexCustomerSizeRequest({
      width_cm: prediction.target_width_cm,
      height_cm: prediction.target_height_cm,
    });
    const rawScore = modelFamily === "unsupported" ? 0 : estimateConfidence({ anchorConfidence, prediction, modelFamily });
    const outsideSupplierAnchorRange = Boolean(supplierAnchors.length >= 2 && extrapolationAnchor);
    const score = outsideSupplierAnchorRange ? Math.max(0.1, Math.min(0.48, rawScore - 0.25)) : rawScore;
    return {
      requestedInput: target.requestedInput,
      widthCm: prediction.target_width_cm,
      heightCm: prediction.target_height_cm,
      maxSideCm: Math.max(prediction.target_width_cm, prediction.target_height_cm),
      predictedProductionPrice: prediction.predicted_production_price_usd,
      predictedShippingPrice: prediction.predicted_shipping_price_usd,
      predictedTotalSupplierCost: prediction.predicted_total_supplier_cost_usd,
      currency,
      confidence: score,
      confidenceLevel: confidenceLevel(score),
      customerAutoQuoteEligible,
      needsSupplierCheck: modelFamily === "unsupported" || !customerAutoQuoteEligible || prediction.shipping_requires_review || score < 0.55 || outsideSupplierAnchorRange,
      reviewReason:
        modelFamily === "unsupported"
          ? "unsupported_model_family"
          : !customerAutoQuoteEligible
            ? "target_size_requires_supplier_request"
            : outsideSupplierAnchorRange
              ? "target_outside_supplier_anchor_range_extrapolation"
              : prediction.review_reason,
      modelKey: prediction.model_key,
      modelVersion: prediction.model_version,
      shippingBucket: prediction.shipping_bucket,
      shippingStrategy: prediction.shipping_strategy,
      shippingTrainingRows: prediction.shipping_training_rows,
    };
  }));

  return {
    card: {
      id: card.id,
      name: trimNullable(card.name),
      shortUrl: `https://trello.com/c/${cardIdentifier}`,
    },
    anchor: {
      widthCm: anchorSize.widthCm,
      heightCm: anchorSize.heightCm,
      productionPrice,
      shippingPrice,
      totalSupplierCost,
      currency,
      source,
      attachmentName: ocrAttachmentName,
      modelFamily,
      confidence: anchorConfidence,
    },
    supplierAnchors,
    estimates,
    warnings,
    evidence: {
      sizeText: customSizeText || ocrEvidence.sizeText,
      productionText: ocrEvidence.productionText,
      shippingText: ocrEvidence.shippingText,
      totalText: ocrEvidence.totalText || customTotalText,
      ocrAvailable: Boolean(ocrText),
      ocrTextPreview: ocrText ? ocrText.slice(0, 900) : null,
    },
  };
}

function roundedRatio(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

export function calculateSupplierEstimateOfferUnitPrice(
  supplierTotalCost: number,
  factor = SUPPLIER_PRICE_TO_OFFER_FACTOR,
) {
  const total = requiredPositiveNumber("Supplier Total", supplierTotalCost);
  const multiplier = requiredPositiveNumber("Offer Faktor", factor);
  return roundDownToFive(total * multiplier);
}

export function checkSupplierEstimatePlausibility(params: {
  anchorWidthCm: number;
  anchorHeightCm: number;
  anchorSupplierTotalCost: number;
  targetWidthCm: number;
  targetHeightCm: number;
  targetSupplierTotalCost: number;
}): SupplierPriceOfferApplyPlausibility {
  const anchorArea = requiredPositiveNumber("Anker-Flaeche", params.anchorWidthCm * params.anchorHeightCm);
  const targetArea = requiredPositiveNumber("Ziel-Flaeche", params.targetWidthCm * params.targetHeightCm);
  const anchorTotal = requiredPositiveNumber("Anker Supplier Total", params.anchorSupplierTotalCost);
  const targetTotal = requiredPositiveNumber("Ziel Supplier Total", params.targetSupplierTotalCost);
  const areaRatio = targetArea / anchorArea;
  const supplierPriceRatio = targetTotal / anchorTotal;
  const issues: string[] = [];
  let status: SupplierPriceOfferApplyPlausibilityStatus = "ok";
  const bothDimensionsLarger =
    params.targetWidthCm >= params.anchorWidthCm * 1.02 &&
    params.targetHeightCm >= params.anchorHeightCm * 1.02;
  const bothDimensionsSmaller =
    params.targetWidthCm <= params.anchorWidthCm * 0.98 &&
    params.targetHeightCm <= params.anchorHeightCm * 0.98;

  if (bothDimensionsLarger && supplierPriceRatio < 0.98) {
    issues.push("larger_sign_cheaper_than_anchor");
    status = "blocked";
  }
  if (bothDimensionsSmaller && supplierPriceRatio > 1.05) {
    issues.push("smaller_sign_more_expensive_than_anchor");
    status = "blocked";
  }
  if (areaRatio >= 1.75 && supplierPriceRatio < 1.2) {
    issues.push("large_area_increase_has_too_small_price_increase");
    status = "blocked";
  } else if (areaRatio >= 1.35 && supplierPriceRatio < 1.08 && status !== "blocked") {
    issues.push("area_increase_price_increase_low");
    status = "warning";
  }
  if (areaRatio <= 0.55 && supplierPriceRatio > 0.85) {
    issues.push("large_area_decrease_has_too_small_price_decrease");
    status = "blocked";
  } else if (areaRatio <= 0.75 && supplierPriceRatio > 0.96 && status !== "blocked") {
    issues.push("area_decrease_price_decrease_low");
    status = "warning";
  }

  return {
    status,
    areaRatio: roundedRatio(areaRatio),
    supplierPriceRatio: roundedRatio(supplierPriceRatio),
    issues,
  };
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
  return /\b(led|neon|leucht|schild|logo|wandschild)\b/i.test(haystack);
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
    throw new QuoteValidationError(
      "Mehrere moegliche Schildpositionen im Angebot gefunden. Bitte zuerst die Zielposition auswaehlen.",
      candidates.map((item) => `${item.id}: ${item.title}`),
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
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    lines.unshift(nextLine);
  }
  return lines.join("\n");
}

export async function applySupplierTrelloEstimateToOffer(input: {
  trelloCard: string;
  targetSize: string;
  itemId?: string | null;
  dryRun?: boolean;
  revisionReason?: string | null;
  operatorName?: string | null;
  currency?: string | null;
}): Promise<SupplierPriceOfferApplyResult> {
  const estimate = await estimateSupplierPricesFromTrello({
    trelloCard: input.trelloCard,
    targetSizes: input.targetSize,
    currency: input.currency,
  });
  if (estimate.estimates.length !== 1) {
    throw new QuoteValidationError("Bitte genau eine Zielgroesse ins Angebot uebernehmen.");
  }
  const target = estimate.estimates[0];
  if (target.confidenceLevel === "blocked") {
    throw new QuoteValidationError("Diese Schildpreisschaetzung ist blockiert und darf nicht ins Angebot uebernommen werden.");
  }
  const plausibility = checkSupplierEstimatePlausibility({
    anchorWidthCm: estimate.anchor.widthCm,
    anchorHeightCm: estimate.anchor.heightCm,
    anchorSupplierTotalCost: estimate.anchor.totalSupplierCost,
    targetWidthCm: target.widthCm,
    targetHeightCm: target.heightCm,
    targetSupplierTotalCost: target.predictedTotalSupplierCost,
  });
  if (plausibility.status === "blocked") {
    throw new QuoteValidationError(
      "Preis/Groesse wirkt unplausibel im Vergleich zur Originalquote. Bitte Supplier pruefen.",
      plausibility.issues,
      409,
    );
  }

  const offer = await getOfferByTrelloCardId(estimate.card.id);
  if (!offer.lock.editable || offer.lock.lockLevel === "hard") {
    throw new QuoteValidationError(offer.lock.lockReason || "Dieses Angebot ist gesperrt und kann nicht aktualisiert werden.", [], 409);
  }

  const targetItem = resolveOfferTargetItem(offer, input.itemId);
  const offerUnitPriceNet = calculateSupplierEstimateOfferUnitPrice(target.predictedTotalSupplierCost);
  const sizeLabel = `${formatCmValue(target.widthCm)} x ${formatCmValue(target.heightCm)}cm`;
  const patchItems = offer.items.map((item) => {
    if (item.id !== targetItem.id) return offerItemPatch(item);
    return {
      ...offerItemPatch(item),
      description: upsertSizeLine(item.description, sizeLabel),
      unitPriceNet: offerUnitPriceNet,
      listPriceNet: null,
      discountLabel: null,
      selectable: true,
      selectedByDefault: true,
    };
  });
  const patch: OpsOfferPatchInput = {
    expectedUpdatedAt: offer.updatedAt,
    actor: trimNullable(input.operatorName) || "Ops",
    reason: "schildpreis_kalkulator_apply",
    revisionReason: offer.lock.requiresRevisionReason
      ? trimNullable(input.revisionReason) || "Preis aus Schildpreis-Kalkulator uebernommen."
      : undefined,
    items: patchItems,
  };
  const result = await patchOfferByTrelloCardId(estimate.card.id, patch, input.dryRun === true);

  return {
    dryRun: result.dryRun === true,
    offer: result.offer,
    diff: result.diff,
    estimate,
    applied: {
      itemId: targetItem.id,
      itemTitle: targetItem.title,
      requestedInput: target.requestedInput,
      widthCm: target.widthCm,
      heightCm: target.heightCm,
      supplierTotalCost: target.predictedTotalSupplierCost,
      offerUnitPriceNet,
      factor: SUPPLIER_PRICE_TO_OFFER_FACTOR,
      plausibility,
    },
  };
}

function attachmentName(attachment: { name?: string | null; fileName?: string | null }) {
  return String(attachment.name || attachment.fileName || "image").trim() || "image";
}

function sourceKeyForTrelloAttachment(input: {
  cardId: string;
  attachmentId: string;
  checksumSha256: string;
}) {
  return `trello:${input.cardId}:${input.attachmentId}:${input.checksumSha256.slice(0, 16)}`;
}

function parseTrelloImportCardInputs(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function titleMatchesImportFilter(title: string | null | undefined, filter: string | null | undefined) {
  const terms = String(filter || "")
    .split(/[,;]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (!terms.length) return true;
  const normalized = String(title || "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function importAnchorConfidence(params: {
  modelFamily: "neonflex" | "unsupported" | "unknown";
  evidence: ReturnType<typeof extractSupplierQuoteEvidence>;
  hasCustomSize: boolean;
}) {
  if (params.modelFamily === "unsupported") return 0.12;
  let score = params.modelFamily === "neonflex" ? 0.84 : 0.68;
  if (params.evidence.size) score += 0.06;
  if (params.hasCustomSize) score += 0.04;
  if (params.evidence.totalPrice !== null) score += 0.03;
  return Math.max(0.1, Math.min(0.94, Math.round(score * 100) / 100));
}

function importValidationIssues(params: {
  modelFamily: "neonflex" | "unsupported" | "unknown";
  source: "ocr_image" | "custom_fields" | "mixed";
  evidence: ReturnType<typeof extractSupplierQuoteEvidence>;
}) {
  const issues: string[] = [];
  if (params.modelFamily === "unsupported") issues.push("unsupported_model_family");
  if (params.modelFamily === "unknown") issues.push("model_family_unknown_neonflex_candidate");
  if (params.source !== "ocr_image") issues.push("size_from_custom_field");
  if (params.evidence.totalPrice !== null) {
    const splitTotal = (params.evidence.productionPrice || 0) + (params.evidence.shippingPrice || 0);
    if (Math.abs(splitTotal - params.evidence.totalPrice) > Math.max(3, params.evidence.totalPrice * 0.04)) {
      issues.push("split_total_differs_from_total");
    }
  }
  return issues;
}

async function upsertSupplierQuoteImageSource(input: {
  sourceKey: string;
  card: Awaited<ReturnType<typeof getTrelloCard>>;
  attachment: NonNullable<ReturnType<typeof supplierQuoteImageAttachment>>;
  checksumSha256: string;
  mimeType: string;
  rawMetadata: Record<string, unknown>;
}) {
  const existingRows = await supabaseRequest<SupplierQuoteImageSourceAnchorRow[]>("supplier_quote_image_sources", undefined, {
    select:
      "id,source_key,trello_card_id,trello_attachment_id,trello_attachment_name,request_id,storage_bucket,storage_path,checksum_sha256,mime_type,import_status,raw_metadata",
    source_key: `eq.${input.sourceKey}`,
    limit: 1,
  });
  if (existingRows[0]) return { row: existingRows[0], created: false };

  const rows = await supabaseRequest<SupplierQuoteImageSourceAnchorRow[]>(
    "supplier_quote_image_sources",
    {
      method: "POST",
      body: JSON.stringify({
        source_key: input.sourceKey,
        trello_card_id: input.card.id,
        trello_attachment_id: input.attachment.id,
        trello_attachment_name: attachmentName(input.attachment),
        request_id: null,
        storage_bucket: null,
        storage_path: null,
        checksum_sha256: input.checksumSha256,
        mime_type: input.mimeType,
        import_status: "imported",
        raw_metadata: input.rawMetadata,
      }),
      headers: { Prefer: "return=representation" },
    },
  );
  if (!rows[0]) throw new QuoteValidationError("Supplier Image Source konnte nicht gespeichert werden.");
  return { row: rows[0], created: true };
}

async function upsertSupplierQuoteDesign(input: {
  imageSourceId: string;
  designLabel: string | null;
  detectedModelFamily: "neonflex" | "unsupported" | "unknown";
  confidence: number;
}) {
  const existingRows = await supabaseRequest<SupplierQuoteDesignAnchorRow[]>("supplier_quote_designs", undefined, {
    select: "id,image_source_id,design_index,design_label,detected_model_family,review_status,reviewed_by,reviewed_at",
    image_source_id: `eq.${input.imageSourceId}`,
    design_index: "eq.0",
    limit: 1,
  });
  const patch = {
    design_label: input.designLabel || "Design 1",
    detected_model_family: input.detectedModelFamily,
    confidence: input.confidence,
    review_status: input.detectedModelFamily === "unsupported" ? "rejected" : "unreviewed",
  };
  if (existingRows[0]) {
    const existing = existingRows[0];
    if (existing.review_status === "approved" || existing.review_status === "rejected") {
      return { row: existing, created: false, lockedByReview: true };
    }
    const rows = await supabaseRequest<SupplierQuoteDesignAnchorRow[]>(
      "supplier_quote_designs",
      {
        method: "PATCH",
        body: JSON.stringify(patch),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${existing.id}` },
    );
    return { row: rows[0] || existing, created: false, lockedByReview: false };
  }

  const rows = await supabaseRequest<SupplierQuoteDesignAnchorRow[]>(
    "supplier_quote_designs",
    {
      method: "POST",
      body: JSON.stringify({
        image_source_id: input.imageSourceId,
        extraction_run_id: null,
        design_index: 0,
        ...patch,
      }),
      headers: { Prefer: "return=representation" },
    },
  );
  if (!rows[0]) throw new QuoteValidationError("Supplier Design konnte nicht gespeichert werden.");
  return { row: rows[0], created: true, lockedByReview: false };
}

async function upsertSupplierQuoteTrainingItem(input: {
  designId: string;
  sizeLabel: string;
  widthCm: number;
  heightCm: number;
  productionPrice: number;
  shippingPrice: number;
  totalSupplierCost: number;
  currency: string;
  productModelFamily: "neonflex_candidate";
  excludedFromNeonflexTraining: boolean;
  exclusionReason: string | null;
  sourceText: string;
  confidence: number;
  validationStatus: "usable" | "rejected";
  validationIssues: string[];
  reviewStatus: "unreviewed" | "rejected";
}) {
  const existingRows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>("supplier_quote_training_items", undefined, {
    select:
      "id,design_id,row_index,variant_index,size_label,width_cm,height_cm,max_side_cm,production_price,shipping_price,total_supplier_cost,currency,product_model_family,excluded_from_neonflex_training,exclusion_reason,excluded_reason,source_text,confidence,validation_status,validation_issues,review_status,reviewed_by,reviewed_at,created_at",
    design_id: `eq.${input.designId}`,
    row_index: "eq.0",
    variant_index: "eq.0",
    limit: 1,
  });
  const existing = existingRows[0] || null;
  if (existing?.review_status === "approved" || existing?.review_status === "rejected") {
    return { row: existing, created: false, updated: false, lockedByReview: true };
  }

  const payload = {
    design_id: input.designId,
    extraction_run_id: null,
    row_index: 0,
    variant_index: 0,
    size_label: input.sizeLabel,
    width_cm: input.widthCm,
    height_cm: input.heightCm,
    area_cm2: Math.round(input.widthCm * input.heightCm * 100) / 100,
    max_side_cm: Math.max(input.widthCm, input.heightCm),
    production_price: input.productionPrice,
    shipping_price: input.shippingPrice,
    total_supplier_cost: input.totalSupplierCost,
    currency: input.currency,
    product_model_family: input.productModelFamily,
    excluded_from_neonflex_training: input.excludedFromNeonflexTraining,
    exclusion_reason: input.exclusionReason,
    excluded_reason: input.exclusionReason,
    source_text: input.sourceText.slice(0, 8000),
    confidence: input.confidence,
    validation_status: input.validationStatus,
    validation_issues: input.validationIssues,
    review_status: input.reviewStatus,
  };

  if (existing) {
    const rows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>(
      "supplier_quote_training_items",
      {
        method: "PATCH",
        body: JSON.stringify(payload),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${existing.id}` },
    );
    return { row: rows[0] || existing, created: false, updated: true, lockedByReview: false };
  }

  const rows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>(
    "supplier_quote_training_items",
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Prefer: "return=representation" },
    },
  );
  if (!rows[0]) throw new QuoteValidationError("Supplier Training Item konnte nicht gespeichert werden.");
  return { row: rows[0], created: true, updated: false, lockedByReview: false };
}

async function importSupplierQuoteAttachment(input: {
  card: Awaited<ReturnType<typeof getTrelloCard>>;
  attachment: NonNullable<ReturnType<typeof supplierQuoteImageAttachment>>;
  currency: string;
  listName?: string | null;
}) {
  const download = await downloadTrelloAttachment(input.attachment);
  if (!String(download.contentType || "").toLowerCase().startsWith("image/")) {
    return { skipped: "ocr_unavailable" as const, detail: "Attachment ist kein Bild." };
  }

  const body = Buffer.from(download.body);
  const checksumSha256 = createHash("sha256").update(body).digest("hex");
  const ocrText = await ocrImageBufferText({
    cardId: input.card.id,
    attachmentId: input.attachment.id,
    attachmentName: attachmentName(input.attachment),
    body,
  });
  if (!ocrText) return { skipped: "ocr_unavailable" as const, detail: "Tesseract lieferte keinen Text." };

  const customSizeText = readCustomFieldValue(input.card, ["Size_1", "Größe 1", "Groesse 1", "Size"]);
  const customSize = parseSizeText(customSizeText);
  const evidence = extractSupplierQuoteEvidence(ocrText);
  const anchorSize = evidence.size || customSize;
  if (!anchorSize) return { skipped: "missing_size" as const, detail: "Keine Größe erkannt." };
  if (evidence.productionPrice === null || evidence.shippingPrice === null) {
    return { skipped: "missing_split_prices" as const, detail: "Production/Shipping nicht separat erkannt." };
  }

  const allText = [input.card.name, customSizeText, ocrText].filter(Boolean).join("\n");
  const modelFamily = detectSupplierModelFamily(allText);
  const source = evidence.size ? "ocr_image" : customSize ? "custom_fields" : "mixed";
  const confidence = importAnchorConfidence({ modelFamily, evidence, hasCustomSize: Boolean(customSize) });
  const validationIssues = importValidationIssues({ modelFamily, source, evidence });
  const excluded = modelFamily === "unsupported";
  const totalSupplierCost = evidence.totalPrice || evidence.productionPrice + evidence.shippingPrice;
  const sourceKey = sourceKeyForTrelloAttachment({
    cardId: input.card.id,
    attachmentId: input.attachment.id,
    checksumSha256,
  });
  const rawMetadata = {
    trello_card_url: `https://trello.com/c/${input.card.id}`,
    trello_card_name: input.card.name || null,
    trello_board_id: input.card.idBoard || null,
    trello_list_id: input.card.idList || null,
    trello_list_name: input.listName || null,
    parser_version: SUPPLIER_QUOTE_TRELLO_IMPORT_PARSER_VERSION,
    source: "ops_trello_training_import",
    evidence: {
      size_text: evidence.sizeText,
      production_text: evidence.productionText,
      shipping_text: evidence.shippingText,
      total_text: evidence.totalText,
      size_source: source,
    },
  };

  const image = await upsertSupplierQuoteImageSource({
    sourceKey,
    card: input.card,
    attachment: input.attachment,
    checksumSha256,
    mimeType: download.contentType || input.attachment.mimeType || "image/unknown",
    rawMetadata,
  });
  const design = await upsertSupplierQuoteDesign({
    imageSourceId: image.row.id,
    designLabel: input.card.name || "Design 1",
    detectedModelFamily: modelFamily,
    confidence,
  });
  if (design.lockedByReview) {
    return { skipped: "already_reviewed" as const, detail: "Design wurde bereits reviewed." };
  }

  const item = await upsertSupplierQuoteTrainingItem({
    designId: design.row.id,
    sizeLabel: defaultSizeLabel(anchorSize.widthCm, anchorSize.heightCm),
    widthCm: anchorSize.widthCm,
    heightCm: anchorSize.heightCm,
    productionPrice: evidence.productionPrice,
    shippingPrice: evidence.shippingPrice,
    totalSupplierCost,
    currency: input.currency,
    productModelFamily: "neonflex_candidate",
    excludedFromNeonflexTraining: excluded,
    exclusionReason: excluded ? "unsupported_model_family_from_trello_import" : null,
    sourceText: ocrText,
    confidence,
    validationStatus: excluded ? "rejected" : "usable",
    validationIssues,
    reviewStatus: excluded ? "rejected" : "unreviewed",
  });
  if (item.lockedByReview) {
    return { skipped: "already_reviewed" as const, detail: "Training Item wurde bereits reviewed." };
  }

  return {
    item: item.row,
    imported: image.created || design.created || item.created,
    updated: item.updated || (!item.created && !item.lockedByReview),
  };
}

export async function importSupplierQuoteTrainingCandidatesFromTrello(input: {
  trelloCards?: string | string[] | null;
  listId?: string | null;
  limit?: number | string | null;
  titleFilter?: string | null;
  currency?: string | null;
}, actor?: UpdateActor | null): Promise<SupplierQuoteTrelloImportResult> {
  const currency = trimNullable(input.currency) || "USD";
  const limitValue = Number(input.limit || 25);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(Math.floor(limitValue), 100) : 25;
  const explicitCards = parseTrelloImportCardInputs(input.trelloCards);
  const listId = trimNullable(input.listId);
  const skipped: SupplierQuoteTrelloImportSkippedItem[] = [];
  const errors: SupplierQuoteTrelloImportErrorItem[] = [];
  let listName: string | null = null;

  let cardInputs = explicitCards;
  if (!cardInputs.length && listId) {
    const [list, cards] = await Promise.all([getTrelloList(listId), getTrelloListCards(listId)]);
    listName = trimNullable(list.name);
    cardInputs = cards
      .filter((card) => {
        const matches = titleMatchesImportFilter(card.name, input.titleFilter);
        if (!matches) {
          skipped.push({
            cardId: card.id,
            cardName: trimNullable(card.name),
            attachmentId: null,
            attachmentName: null,
            reason: "title_filter",
          });
        }
        return matches;
      })
      .slice(0, limit)
      .map((card) => card.id);
  }
  cardInputs = cardInputs.slice(0, limit);
  if (!cardInputs.length) {
    throw new QuoteValidationError("Keine Trello-Karten fuer den Import gefunden.");
  }

  let scannedCards = 0;
  let scannedAttachments = 0;
  let imported = 0;
  let updated = 0;
  const changedTrainingItems: SupplierQuoteTrainingItemAnchorRow[] = [];

  for (const cardInput of cardInputs) {
    const cardIdentifier = parseTrelloCardIdentifier(cardInput);
    if (!cardIdentifier) {
      skipped.push({
        cardId: null,
        cardName: null,
        attachmentId: null,
        attachmentName: null,
        reason: "invalid_card",
        detail: cardInput,
      });
      continue;
    }

    try {
      const card = await getTrelloCard(cardIdentifier);
      scannedCards += 1;
      if (!titleMatchesImportFilter(card.name, input.titleFilter)) {
        skipped.push({
          cardId: card.id,
          cardName: trimNullable(card.name),
          attachmentId: null,
          attachmentName: null,
          reason: "title_filter",
        });
        continue;
      }

      const attachments = supplierQuoteImageAttachments(card);
      if (!attachments.length) {
        skipped.push({
          cardId: card.id,
          cardName: trimNullable(card.name),
          attachmentId: null,
          attachmentName: null,
          reason: "no_image_attachment",
        });
        continue;
      }

      for (const attachment of attachments) {
        scannedAttachments += 1;
        const result = await importSupplierQuoteAttachment({ card, attachment, currency, listName });
        if ("skipped" in result && result.skipped) {
          skipped.push({
            cardId: card.id,
            cardName: trimNullable(card.name),
            attachmentId: trimNullable(attachment.id),
            attachmentName: attachmentName(attachment),
            reason: result.skipped,
            detail: result.detail,
          });
          continue;
        }
        if (result.imported) imported += 1;
        if (result.updated) updated += 1;
        changedTrainingItems.push(result.item);
      }
    } catch (error) {
      errors.push({
        cardInput,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  const anchorItems = await hydrateTrainingItemAnchorReviewRows(changedTrainingItems);

  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: listId ? `trello-list:${listId}` : `trello-import:${createHash("sha256").update(cardInputs.join("|")).digest("hex").slice(0, 16)}`,
      workflow_name: SUPPLIER_PRICE_REVIEW_WORKFLOW_NAME,
      action: SUPPLIER_QUOTE_TRELLO_IMPORT_ACTION,
      status: errors.length ? "partial_success" : "success",
      metadata: {
        list_id: listId,
        list_name: listName,
        title_filter: trimNullable(input.titleFilter),
        requested_cards: cardInputs.length,
        scanned_cards: scannedCards,
        scanned_attachments: scannedAttachments,
        imported,
        updated,
        skipped_count: skipped.length,
        errors_count: errors.length,
        parser_version: SUPPLIER_QUOTE_TRELLO_IMPORT_PARSER_VERSION,
        actor_label: actorLabel(actor),
        actor: actor || null,
      },
    }),
    headers: { Prefer: "return=minimal" },
  });

  return {
    scannedCards,
    scannedAttachments,
    imported,
    updated,
    skipped,
    errors,
    anchorItems,
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actorLabel(actor?: UpdateActor | null) {
  return trimNullable(actor?.operatorName) || trimNullable(actor?.mode) || "ops";
}

function predictionKey(input: {
  modelVersionId: string;
  requestId?: string | null;
  trelloCardId?: string | null;
  designId?: string | null;
  sourceCode?: string | null;
  widthCm: number;
  heightCm: number;
}) {
  const raw = [
    input.modelVersionId,
    input.requestId || "",
    input.trelloCardId || "",
    input.designId || "",
    input.sourceCode || "",
    input.widthCm.toFixed(1),
    input.heightCm.toFixed(1),
  ].join("|");
  return `price_pred_${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

function mapPredictionRow(
  row: SupplierPricePredictionRow,
  modelVersionsById: Map<string, SupplierPriceModelVersionRow> = new Map(),
): SupplierPricePredictionReviewItem {
  const widthCm = requiredNumber("width_cm", row.width_cm);
  const heightCm = requiredNumber("height_cm", row.height_cm);
  const production = requiredNumber("predicted_production_price", row.predicted_production_price);
  const shipping = requiredNumber("predicted_shipping_price", row.predicted_shipping_price);
  const total = numericValue(row.predicted_total_supplier_cost) ?? production + shipping;
  const model = modelVersionsById.get(row.model_version_id) || null;

  return {
    id: row.id,
    predictionKey: trimNullable(row.prediction_key),
    sourceCode: trimNullable(row.source_code),
    sourceLabel: trimNullable(row.source_label),
    requestId: trimNullable(row.request_id),
    trelloCardId: trimNullable(row.trello_card_id),
    designId: trimNullable(row.design_id),
    modelVersionId: row.model_version_id,
    modelKey: trimNullable(model?.model_key),
    modelVersion: trimNullable(model?.version_label),
    modelStatus: trimNullable(model?.status),
    anchorTrainingItemId: trimNullable(row.anchor_training_item_id),
    anchorWidthCm: numericValue(row.anchor_width_cm),
    anchorHeightCm: numericValue(row.anchor_height_cm),
    anchorProductionPrice: numericValue(row.anchor_production_price),
    anchorShippingPrice: numericValue(row.anchor_shipping_price),
    widthCm,
    heightCm,
    maxSideCm: Math.max(widthCm, heightCm),
    predictedProductionPrice: production,
    predictedShippingPrice: shipping,
    predictedTotalSupplierCost: total,
    currency: trimNullable(row.currency) || "USD",
    confidence: numericValue(row.confidence),
    featureValues: row.feature_values || {},
    decisionStatus: row.decision_status,
    customerAutoQuoteEligible: row.customer_auto_quote_eligible !== false,
    reviewedBy: trimNullable(row.reviewed_by),
    reviewedAt: trimNullable(row.reviewed_at),
    reviewNote: trimNullable(row.review_note),
    createdAt: trimNullable(row.created_at),
  };
}

function mapTrainingItemAnchorReviewRow(input: {
  item: SupplierQuoteTrainingItemAnchorRow;
  design?: SupplierQuoteDesignAnchorRow | null;
  image?: SupplierQuoteImageSourceAnchorRow | null;
}): SupplierQuoteTrainingItemAnchorReviewItem {
  const metadata = input.image?.raw_metadata || null;
  const widthCm = requiredNumber("width_cm", input.item.width_cm);
  const heightCm = requiredNumber("height_cm", input.item.height_cm);
  const productionPrice = requiredNumber("production_price", input.item.production_price);
  const shippingPrice = requiredNumber("shipping_price", input.item.shipping_price);
  const totalSupplierCost = numericValue(input.item.total_supplier_cost) ?? productionPrice + shippingPrice;

  return {
    id: input.item.id,
    designId: trimNullable(input.item.design_id),
    sourceKey: trimNullable(input.image?.source_key),
    requestId: trimNullable(input.image?.request_id),
    trelloCardId: trimNullable(input.image?.trello_card_id),
    trelloCardUrl: metadataString(metadata, "trello_card_url"),
    trelloCardName: metadataString(metadata, "trello_card_name"),
    trelloBoardName: metadataString(metadata, "trello_board_name"),
    trelloListName: metadataString(metadata, "trello_list_name"),
    attachmentName: trimNullable(input.image?.trello_attachment_name),
    designLabel: trimNullable(input.design?.design_label),
    detectedModelFamily: trimNullable(input.design?.detected_model_family),
    designReviewStatus: trimNullable(input.design?.review_status),
    sizeLabel: trimNullable(input.item.size_label),
    widthCm,
    heightCm,
    maxSideCm: numericValue(input.item.max_side_cm) ?? Math.max(widthCm, heightCm),
    productionPrice,
    shippingPrice,
    totalSupplierCost,
    currency: trimNullable(input.item.currency) || "USD",
    productModelFamily: trimNullable(input.item.product_model_family),
    validationStatus: trimNullable(input.item.validation_status),
    reviewStatus: trimNullable(input.item.review_status),
    excludedFromNeonflexTraining: input.item.excluded_from_neonflex_training === true,
    confidence: numericValue(input.item.confidence),
    validationIssues: Array.isArray(input.item.validation_issues) ? input.item.validation_issues : [],
    sourceText: trimNullable(input.item.source_text),
    createdAt: trimNullable(input.item.created_at),
  };
}

async function hydrateTrainingItemAnchorReviewRows(items: SupplierQuoteTrainingItemAnchorRow[]) {
  if (!items.length) return [];
  const designIds = [...new Set(items.map((item) => trimNullable(item.design_id)).filter(Boolean))] as string[];
  const designs = designIds.length
    ? await supabaseRequest<SupplierQuoteDesignAnchorRow[]>("supplier_quote_designs", undefined, {
        select: "id,image_source_id,design_index,design_label,detected_model_family,review_status,reviewed_by,reviewed_at",
        id: `in.(${designIds.join(",")})`,
      })
    : [];
  const designsById = new Map(designs.map((design) => [design.id, design]));
  const imageIds = [...new Set(designs.map((design) => trimNullable(design.image_source_id)).filter(Boolean))] as string[];
  const images = imageIds.length
    ? await supabaseRequest<SupplierQuoteImageSourceAnchorRow[]>("supplier_quote_image_sources", undefined, {
        select:
          "id,source_key,trello_card_id,trello_attachment_id,trello_attachment_name,request_id,storage_bucket,storage_path,raw_metadata",
        id: `in.(${imageIds.join(",")})`,
      })
    : [];
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return items.map((item) => {
    const design = item.design_id ? designsById.get(item.design_id) || null : null;
    const image = design?.image_source_id ? imagesById.get(design.image_source_id) || null : null;
    return mapTrainingItemAnchorReviewRow({ item, design, image });
  });
}

async function loadModelVersions(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, SupplierPriceModelVersionRow>();
  const rows = await supabaseRequest<SupplierPriceModelVersionRow[]>("supplier_price_model_versions", undefined, {
    select: "id,model_key,version_label,status",
    id: `in.(${uniqueIds.join(",")})`,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listSupplierQuoteTrainingItemAnchorReviews(options: {
  status?: "pending" | "reviewed" | "all";
  limit?: number;
} = {}) {
  const query: Record<string, string | number | boolean> = {
    select:
      "id,design_id,row_index,variant_index,size_label,width_cm,height_cm,max_side_cm,production_price,shipping_price,total_supplier_cost,currency,product_model_family,excluded_from_neonflex_training,exclusion_reason,excluded_reason,source_text,confidence,validation_status,validation_issues,review_status,reviewed_by,reviewed_at,created_at",
    product_model_family: "eq.neonflex_candidate",
    validation_status: "eq.usable",
    order: "created_at.desc",
    limit: options.limit || 50,
  };

  if (options.status === "reviewed") {
    query.review_status = "in.(approved,rejected)";
  } else if (options.status !== "all") {
    query.review_status = "in.(unreviewed,needs_supplier_check)";
    query.excluded_from_neonflex_training = "eq.false";
  }

  const rows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>(
    "supplier_quote_training_items",
    undefined,
    query,
  );
  return hydrateTrainingItemAnchorReviewRows(rows);
}

async function loadSupplierQuoteTrainingItemAnchorReviewContext(trainingItemId: string) {
  const id = trimNullable(trainingItemId);
  if (!id) throw new QuoteValidationError("Training-Item-ID fehlt.");

  const rows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>("supplier_quote_training_items", undefined, {
    select:
      "id,design_id,row_index,variant_index,size_label,width_cm,height_cm,max_side_cm,production_price,shipping_price,total_supplier_cost,currency,product_model_family,excluded_from_neonflex_training,exclusion_reason,excluded_reason,source_text,confidence,validation_status,validation_issues,review_status,reviewed_by,reviewed_at,created_at",
    id: `eq.${id}`,
    limit: 1,
  });
  const item = rows[0];
  if (!item) throw new QuoteValidationError("Training-Item wurde nicht gefunden.", [], 404);

  const designRows = item.design_id
    ? await supabaseRequest<SupplierQuoteDesignAnchorRow[]>("supplier_quote_designs", undefined, {
        select: "id,image_source_id,design_index,design_label,detected_model_family,review_status,reviewed_by,reviewed_at",
        id: `eq.${item.design_id}`,
        limit: 1,
      })
    : [];
  const design = designRows[0] || null;
  const imageRows = design?.image_source_id
    ? await supabaseRequest<SupplierQuoteImageSourceAnchorRow[]>("supplier_quote_image_sources", undefined, {
        select:
          "id,source_key,trello_card_id,trello_attachment_id,trello_attachment_name,request_id,storage_bucket,storage_path,raw_metadata",
        id: `eq.${design.image_source_id}`,
        limit: 1,
      })
    : [];
  const image = imageRows[0] || null;

  return {
    item,
    design,
    image,
    reviewItem: mapTrainingItemAnchorReviewRow({ item, design, image }),
  };
}

function assertReviewableNeonflexTrainingItem(item: SupplierQuoteTrainingItemAnchorRow) {
  if (item.product_model_family !== "neonflex_candidate") {
    throw new QuoteValidationError("Training-Item ist kein Neonflex-Kandidat.");
  }
  if (item.validation_status !== "usable") {
    throw new QuoteValidationError("Training-Item ist nicht als usable validiert.");
  }
}

export async function reviewSupplierQuoteTrainingItemAnchor(input: {
  trainingItemId: string;
  decision: SupplierQuoteTrainingItemAnchorReviewDecision;
  note?: string | null;
  corrections?: {
    sizeLabel?: string | null;
    widthCm?: number | string | null;
    heightCm?: number | string | null;
    productionPrice?: number | string | null;
    shippingPrice?: number | string | null;
  } | null;
  stepCm?: number;
  maxLongSideCm?: number;
}, actor?: UpdateActor | null) {
  const context = await loadSupplierQuoteTrainingItemAnchorReviewContext(input.trainingItemId);
  assertReviewableNeonflexTrainingItem(context.item);

  const reviewer = actorLabel(actor);
  const reviewedAt = new Date().toISOString();
  const note = trimNullable(input.note);
  const decisionStatus =
    input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_supplier_check";
  const itemPatch: Record<string, unknown> = {
    review_status: decisionStatus,
    reviewed_by: reviewer,
    reviewed_at: reviewedAt,
  };
  const designPatch: Record<string, unknown> = {
    review_status: decisionStatus,
    reviewed_by: reviewer,
    reviewed_at: reviewedAt,
  };

  if (input.decision === "approve") {
    if (context.item.excluded_from_neonflex_training) {
      throw new QuoteValidationError("Ausgeschlossene Training-Items duerfen nicht freigegeben werden.");
    }

    const widthCm = correctedPositiveNumber("Breite", input.corrections?.widthCm, context.item.width_cm);
    const heightCm = correctedPositiveNumber("Hoehe", input.corrections?.heightCm, context.item.height_cm);
    const productionPrice = correctedPositiveNumber(
      "Production Preis",
      input.corrections?.productionPrice,
      context.item.production_price,
    );
    const shippingPrice = correctedPositiveNumber(
      "Shipping Preis",
      input.corrections?.shippingPrice,
      context.item.shipping_price,
    );

    itemPatch.size_label = trimNullable(input.corrections?.sizeLabel) || defaultSizeLabel(widthCm, heightCm);
    itemPatch.width_cm = widthCm;
    itemPatch.height_cm = heightCm;
    itemPatch.production_price = productionPrice;
    itemPatch.shipping_price = shippingPrice;
    itemPatch.excluded_from_neonflex_training = false;
    itemPatch.exclusion_reason = null;
    itemPatch.excluded_reason = null;
  } else if (input.decision === "reject") {
    itemPatch.excluded_from_neonflex_training = true;
    itemPatch.exclusion_reason = note || "ops_anchor_review_rejected";
    itemPatch.excluded_reason = note || "ops_anchor_review_rejected";
  }

  const updatedRows = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>(
    "supplier_quote_training_items",
    {
      method: "PATCH",
      body: JSON.stringify(itemPatch),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${context.item.id}` },
  );
  const updatedItem = updatedRows[0];
  if (!updatedItem) throw new QuoteValidationError("Training-Item wurde nicht aktualisiert.", [], 404);

  if (context.design?.id) {
    await supabaseRequest("supplier_quote_designs", {
      method: "PATCH",
      body: JSON.stringify(designPatch),
      headers: { Prefer: "return=minimal" },
    }, {
      id: `eq.${context.design.id}`,
    });
  }

  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: context.image?.request_id || `supplier-quote-training-item:${context.item.id}`,
      workflow_name: SUPPLIER_PRICE_REVIEW_WORKFLOW_NAME,
      action: SUPPLIER_QUOTE_ANCHOR_REVIEW_ACTION,
      status: "success",
      metadata: {
        request_id: context.image?.request_id || null,
        supplier_quote_training_item_id: context.item.id,
        supplier_quote_design_id: context.design?.id || null,
        source_key: context.image?.source_key || null,
        trello_card_id: context.image?.trello_card_id || null,
        decision_status: decisionStatus,
        review_note: note,
        corrections: input.corrections || null,
        actor_label: reviewer,
        actor: actor || null,
      },
    }),
    headers: { Prefer: "return=minimal" },
  });

  const refreshed = await loadSupplierQuoteTrainingItemAnchorReviewContext(context.item.id);
  const createdPredictionItems =
    input.decision === "approve"
      ? await upsertSupplierPricePredictionReviewDrafts(
          await buildSupplierPricePredictionReviewDraftsFromTrainingItem({
            trainingItemId: context.item.id,
            stepCm: input.stepCm,
            maxLongSideCm: input.maxLongSideCm ?? NEONFLEX_INTERNAL_REVIEW_MAX_LONG_SIDE_CM,
            featureValues: {
              created_from: "ops_training_item_anchor_review",
              anchor_reviewed_by: reviewer,
            },
          }),
        )
      : [];

  return {
    item: refreshed.reviewItem,
    createdPredictionItems,
  };
}

async function resolveSupplierPriceModelVersionId(modelVersionId?: string | null) {
  const explicit = trimNullable(modelVersionId);
  if (explicit) return explicit;

  const rows = await supabaseRequest<SupplierPriceModelVersionRow[]>("supplier_price_model_versions", undefined, {
    select: "id,model_key,version_label,status",
    model_key: `eq.${NEONFLEX_ANCHORED_SCALING_MODEL.model_key}`,
    version_label: `eq.${NEONFLEX_ANCHORED_SCALING_MODEL.version}`,
    status: "in.(shadow,active)",
    limit: 1,
  });
  const model = rows[0];
  if (!model) {
    throw new QuoteValidationError(
      `Shadow-Modell ${NEONFLEX_ANCHORED_SCALING_MODEL.model_key} ${NEONFLEX_ANCHORED_SCALING_MODEL.version} wurde nicht in Supabase gefunden.`,
    );
  }
  return model.id;
}

function assertApprovedNeonflexAnchor(item: SupplierQuoteTrainingItemAnchorRow, design: SupplierQuoteDesignAnchorRow | null) {
  if (item.product_model_family !== "neonflex_candidate") {
    throw new QuoteValidationError("Training-Item ist kein Neonflex-Kandidat.");
  }
  if (item.excluded_from_neonflex_training) {
    throw new QuoteValidationError("Training-Item ist von Neonflex-Training ausgeschlossen.");
  }
  if (item.validation_status !== "usable") {
    throw new QuoteValidationError("Training-Item ist nicht als usable validiert.");
  }
  if (item.review_status !== "approved") {
    throw new QuoteValidationError("Training-Item ist noch nicht human-approved.");
  }
  if (design && design.review_status && design.review_status !== "approved") {
    throw new QuoteValidationError("Design ist noch nicht human-approved.");
  }
}

async function loadTrainingItemAnchor(trainingItemId: string) {
  const id = trimNullable(trainingItemId);
  if (!id) throw new QuoteValidationError("Training-Item-ID fehlt.");

  const items = await supabaseRequest<SupplierQuoteTrainingItemAnchorRow[]>("supplier_quote_training_items", undefined, {
    select:
      "id,design_id,row_index,variant_index,size_label,width_cm,height_cm,production_price,shipping_price,currency,product_model_family,excluded_from_neonflex_training,validation_status,review_status",
    id: `eq.${id}`,
    limit: 1,
  });
  const item = items[0];
  if (!item) throw new QuoteValidationError("Training-Item wurde nicht gefunden.", [], 404);

  const designRows = item.design_id
    ? await supabaseRequest<SupplierQuoteDesignAnchorRow[]>("supplier_quote_designs", undefined, {
        select: "id,image_source_id,design_index,design_label,detected_model_family,review_status",
        id: `eq.${item.design_id}`,
        limit: 1,
      })
    : [];
  const design = designRows[0] || null;
  const imageRows = design?.image_source_id
    ? await supabaseRequest<SupplierQuoteImageSourceAnchorRow[]>("supplier_quote_image_sources", undefined, {
        select: "id,source_key,trello_card_id,request_id",
        id: `eq.${design.image_source_id}`,
        limit: 1,
      })
    : [];
  const image = imageRows[0] || null;

  assertApprovedNeonflexAnchor(item, design);

  return {
    item,
    design,
    image,
    widthCm: requiredNumber("width_cm", item.width_cm),
    heightCm: requiredNumber("height_cm", item.height_cm),
    productionPrice: requiredNumber("production_price", item.production_price),
    shippingPrice: requiredNumber("shipping_price", item.shipping_price),
  };
}

export function buildSupplierPricePredictionReviewDraftsFromAnchor(
  input: BuildAnchoredPredictionDraftsInput,
): SupplierPricePredictionDraft[] {
  const modelVersionId = trimNullable(input.modelVersionId);
  if (!modelVersionId) throw new QuoteValidationError("Model-Version-ID fehlt.");

  const sourceCode = trimNullable(input.sourceCode);
  const sourceLabel = trimNullable(input.sourceLabel);
  const currency = trimNullable(input.currency) || "USD";
  const ladder = buildNeonflexAnchoredSizeLadder({
    base_width_cm: input.baseWidthCm,
    base_height_cm: input.baseHeightCm,
    base_production_price_usd: input.baseProductionPriceUsd,
    base_shipping_price_usd: input.baseShippingPriceUsd,
    step_cm: input.stepCm,
    max_long_side_cm: input.maxLongSideCm ?? NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM,
  });

  return ladder.map((prediction) => {
    const customerAutoQuoteEligible = !requiresNeonflexCustomerSizeRequest({
      width_cm: prediction.target_width_cm,
      height_cm: prediction.target_height_cm,
    });
    const decisionStatus: SupplierPricePredictionDecisionStatus =
      customerAutoQuoteEligible && !prediction.shipping_requires_review ? "shadow" : "needs_supplier_check";

    return {
      predictionKey: predictionKey({
        modelVersionId,
        requestId: input.requestId,
        trelloCardId: input.trelloCardId,
        designId: input.designId,
        sourceCode,
        widthCm: prediction.target_width_cm,
        heightCm: prediction.target_height_cm,
      }),
      modelVersionId,
      requestId: trimNullable(input.requestId),
      trelloCardId: trimNullable(input.trelloCardId),
      designId: trimNullable(input.designId),
      sourceCode,
      sourceLabel,
      anchorTrainingItemId: trimNullable(input.anchorTrainingItemId),
      anchorWidthCm: prediction.base_width_cm,
      anchorHeightCm: prediction.base_height_cm,
      anchorProductionPrice: input.baseProductionPriceUsd,
      anchorShippingPrice: input.baseShippingPriceUsd,
      widthCm: prediction.target_width_cm,
      heightCm: prediction.target_height_cm,
      predictedProductionPrice: prediction.predicted_production_price_usd,
      predictedShippingPrice: prediction.predicted_shipping_price_usd,
      currency,
      confidence: null,
      decisionStatus,
      customerAutoQuoteEligible,
      featureValues: {
        ...(input.featureValues || {}),
        source_code: sourceCode,
        source_label: sourceLabel,
        model_key: NEONFLEX_ANCHORED_SCALING_MODEL.model_key,
        model_version: NEONFLEX_ANCHORED_SCALING_MODEL.version,
        target_max_side_cm: Math.max(prediction.target_width_cm, prediction.target_height_cm),
        customer_auto_quote_max_long_side_cm: NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM,
        shipping_bucket: prediction.shipping_bucket,
        shipping_strategy: prediction.shipping_strategy,
        shipping_requires_review: prediction.shipping_requires_review,
        review_reason: prediction.review_reason,
      },
    };
  });
}

export async function buildSupplierPricePredictionReviewDraftsFromTrainingItem(
  input: BuildTrainingItemPredictionDraftsInput,
): Promise<SupplierPricePredictionDraft[]> {
  const modelVersionId = await resolveSupplierPriceModelVersionId(input.modelVersionId);
  const anchor = await loadTrainingItemAnchor(input.trainingItemId);
  const sourceCode =
    trimNullable(input.sourceCode) ||
    trimNullable(anchor.design?.design_label) ||
    (anchor.design?.design_index !== null && anchor.design?.design_index !== undefined
      ? `Design ${anchor.design.design_index}`
      : null);
  const sourceLabel =
    trimNullable(input.sourceLabel) ||
    trimNullable(anchor.item.size_label) ||
    trimNullable(anchor.image?.source_key);

  return buildSupplierPricePredictionReviewDraftsFromAnchor({
    modelVersionId,
    requestId: trimNullable(input.requestId) || trimNullable(anchor.image?.request_id),
    trelloCardId: trimNullable(input.trelloCardId) || trimNullable(anchor.image?.trello_card_id),
    designId: trimNullable(anchor.item.design_id),
    sourceCode,
    sourceLabel,
    anchorTrainingItemId: anchor.item.id,
    baseWidthCm: anchor.widthCm,
    baseHeightCm: anchor.heightCm,
    baseProductionPriceUsd: anchor.productionPrice,
    baseShippingPriceUsd: anchor.shippingPrice,
    stepCm: input.stepCm,
    maxLongSideCm: input.maxLongSideCm,
    currency: trimNullable(input.currency) || trimNullable(anchor.item.currency),
    featureValues: {
      ...(input.featureValues || {}),
      training_item_id: anchor.item.id,
      training_item_variant_index: anchor.item.variant_index ?? null,
      training_item_row_index: anchor.item.row_index ?? null,
      image_source_key: anchor.image?.source_key || null,
    },
  });
}

export async function upsertSupplierPricePredictionReviewDrafts(drafts: SupplierPricePredictionDraft[]) {
  if (!drafts.length) return [];
  const payload = drafts.map((draft) => ({
    prediction_key: draft.predictionKey,
    model_version_id: draft.modelVersionId,
    request_id: trimNullable(draft.requestId),
    trello_card_id: trimNullable(draft.trelloCardId),
    design_id: trimNullable(draft.designId),
    source_code: trimNullable(draft.sourceCode),
    source_label: trimNullable(draft.sourceLabel),
    anchor_training_item_id: trimNullable(draft.anchorTrainingItemId),
    anchor_width_cm: draft.anchorWidthCm ?? null,
    anchor_height_cm: draft.anchorHeightCm ?? null,
    anchor_production_price: draft.anchorProductionPrice ?? null,
    anchor_shipping_price: draft.anchorShippingPrice ?? null,
    width_cm: draft.widthCm,
    height_cm: draft.heightCm,
    predicted_production_price: draft.predictedProductionPrice,
    predicted_shipping_price: draft.predictedShippingPrice,
    currency: trimNullable(draft.currency) || "USD",
    confidence: draft.confidence ?? null,
    feature_values: draft.featureValues || {},
    decision_status: draft.decisionStatus || "shadow",
    customer_auto_quote_eligible: draft.customerAutoQuoteEligible !== false,
  }));
  const rows = await supabaseRequest<SupplierPricePredictionRow[]>(
    "supplier_price_predictions",
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    },
    { on_conflict: "prediction_key" },
  );
  const modelVersions = await loadModelVersions(rows.map((row) => row.model_version_id));
  return rows.map((row) => mapPredictionRow(row, modelVersions));
}

export async function listSupplierPricePredictionReviews(options: {
  status?: "pending" | "reviewed" | "all";
  limit?: number;
} = {}) {
  const query: Record<string, string | number> = {
    select:
      "id,prediction_key,source_code,source_label,request_id,trello_card_id,design_id,model_version_id,anchor_training_item_id,anchor_width_cm,anchor_height_cm,anchor_production_price,anchor_shipping_price,width_cm,height_cm,predicted_production_price,predicted_shipping_price,predicted_total_supplier_cost,currency,confidence,feature_values,decision_status,customer_auto_quote_eligible,reviewed_by,reviewed_at,review_note,created_at",
    order: "created_at.desc",
    limit: options.limit || 100,
  };

  if (options.status === "reviewed") {
    query.decision_status = "in.(approved_for_quote,rejected,superseded)";
  } else if (options.status !== "all") {
    query.decision_status = "in.(shadow,needs_supplier_check)";
  }

  const rows = await supabaseRequest<SupplierPricePredictionRow[]>("supplier_price_predictions", undefined, query);
  const modelVersions = await loadModelVersions(rows.map((row) => row.model_version_id));
  return rows.map((row) => mapPredictionRow(row, modelVersions));
}

export async function reviewSupplierPricePrediction(input: {
  predictionId: string;
  decision: SupplierPricePredictionReviewDecision;
  note?: string | null;
}, actor?: UpdateActor | null) {
  const predictionId = trimNullable(input.predictionId);
  if (!predictionId) throw new QuoteValidationError("Prediction-ID fehlt.");

  const decisionStatus: SupplierPricePredictionDecisionStatus =
    input.decision === "approve"
      ? "approved_for_quote"
      : input.decision === "reject"
        ? "rejected"
        : input.decision === "supersede"
          ? "superseded"
          : "needs_supplier_check";
  const reviewer = actorLabel(actor);
  const reviewedAt = new Date().toISOString();
  const existingRows = await supabaseRequest<SupplierPricePredictionRow[]>("supplier_price_predictions", undefined, {
    select:
      "id,prediction_key,source_code,source_label,request_id,trello_card_id,design_id,model_version_id,anchor_training_item_id,anchor_width_cm,anchor_height_cm,anchor_production_price,anchor_shipping_price,width_cm,height_cm,predicted_production_price,predicted_shipping_price,predicted_total_supplier_cost,currency,confidence,feature_values,decision_status,customer_auto_quote_eligible,reviewed_by,reviewed_at,review_note,created_at",
    id: `eq.${predictionId}`,
    limit: 1,
  });
  const existing = existingRows[0];
  if (!existing) throw new QuoteValidationError("Preisvorschlag wurde nicht gefunden.", [], 404);
  if (decisionStatus === "approved_for_quote" && existing.customer_auto_quote_eligible === false) {
    throw new QuoteValidationError("Vorschlaege ueber 200cm duerfen nicht als automatische Kundenpreise freigegeben werden.");
  }

  const rows = await supabaseRequest<SupplierPricePredictionRow[]>(
    "supplier_price_predictions",
    {
      method: "PATCH",
      body: JSON.stringify({
        decision_status: decisionStatus,
        reviewed_by: reviewer,
        reviewed_at: reviewedAt,
        review_note: trimNullable(input.note),
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${predictionId}` },
  );
  const row = rows[0];
  if (!row) throw new QuoteValidationError("Preisvorschlag wurde nicht gefunden.", [], 404);

  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: row.request_id || `supplier-price-prediction:${row.id}`,
      workflow_name: SUPPLIER_PRICE_REVIEW_WORKFLOW_NAME,
      action: SUPPLIER_PRICE_REVIEW_ACTION,
      status: "success",
      metadata: {
        request_id: row.request_id || null,
        supplier_price_prediction_id: row.id,
        prediction_key: row.prediction_key || null,
        source_code: row.source_code || null,
        decision_status: decisionStatus,
        review_note: trimNullable(input.note),
        actor_label: reviewer,
        actor: actor || null,
      },
    }),
    headers: { Prefer: "return=minimal" },
  });

  const modelVersions = await loadModelVersions([row.model_version_id]);
  return mapPredictionRow(row, modelVersions);
}
