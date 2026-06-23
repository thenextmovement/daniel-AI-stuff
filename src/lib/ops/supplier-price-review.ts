import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildNeonflexAnchoredSizeLadder,
  NEONFLEX_ANCHORED_SCALING_MODEL,
  predictNeonflexAnchoredSupplierPrice,
  type NeonflexAnchoredScalingPrediction,
} from "@/lib/quote-learning/neonflex-anchored-scaling";
import {
  NEONFLEX_INTERNAL_REVIEW_MAX_LONG_SIDE_CM,
  NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM,
  requiresNeonflexCustomerSizeRequest,
} from "@/lib/quote-learning/neonflex-size-policy";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { downloadTrelloAttachment, getTrelloCard } from "@/lib/quotes/trello";
import { QuoteValidationError } from "@/lib/quotes/validation";
import type { UpdateActor } from "@/lib/ops/customer-records";

const SUPPLIER_PRICE_REVIEW_WORKFLOW_NAME = "customer_records_console";
const SUPPLIER_PRICE_REVIEW_ACTION = "supplier_price_prediction_reviewed";
const SUPPLIER_QUOTE_ANCHOR_REVIEW_ACTION = "supplier_quote_training_item_anchor_reviewed";
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

async function ocrTrelloAttachmentText(cardId: string, attachment: NonNullable<ReturnType<typeof supplierQuoteImageAttachment>>) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "neontrip-price-ocr-"));
  const extension = path.extname(String(attachment.name || attachment.fileName || "image.png")) || ".png";
  const imagePath = path.join(tempDir, `source${extension}`);
  try {
    const download = await downloadTrelloAttachment(attachment);
    if (!String(download.contentType || "").toLowerCase().startsWith("image/")) return null;
    await writeFile(imagePath, Buffer.from(download.body));
    const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "--psm", "6"], {
      timeout: 12_000,
      maxBuffer: 256_000,
    });
    return String(stdout || "").trim() || null;
  } catch (error) {
    console.warn("supplier price trello estimate OCR skipped", {
      cardId,
      attachmentId: attachment.id,
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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

  const targets = parseTargetSizes(input.targetSizes, anchorSize);
  if (targets.some((target) => target.widthCm * target.heightCm < anchorSize.widthCm * anchorSize.heightCm)) {
    warnings.push("Mindestens eine Zielgroesse ist kleiner als der erkannte Anker. Das ist nur eine grobe Downscale-Extrapolation und sollte vom Supplier geprueft werden.");
  }
  const estimates = targets.map<SupplierPriceTrelloEstimateItem>((target) => {
    const targetArea = target.widthCm * target.heightCm;
    const anchorArea = anchorSize.widthCm * anchorSize.heightCm;
    if (targetArea < anchorArea) {
      const areaRatio = targetArea / anchorArea;
      const production = Math.round(productionPrice * areaRatio ** NEONFLEX_ANCHORED_SCALING_MODEL.production.area_exponent);
      const shipping = Math.round(Math.max(20, shippingPrice * Math.sqrt(areaRatio)));
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
            : "target_smaller_than_anchor_downscale_extrapolation",
        modelKey: NEONFLEX_ANCHORED_SCALING_MODEL.model_key,
        modelVersion: NEONFLEX_ANCHORED_SCALING_MODEL.version,
        shippingBucket: "below_anchor",
        shippingStrategy: "downscale_extrapolation",
        shippingTrainingRows: 0,
      };
    }

    const prediction = predictNeonflexAnchoredSupplierPrice({
      base_width_cm: anchorSize.widthCm,
      base_height_cm: anchorSize.heightCm,
      base_production_price_usd: productionPrice,
      base_shipping_price_usd: shippingPrice,
      target_width_cm: target.widthCm,
      target_height_cm: target.heightCm,
    });
    const customerAutoQuoteEligible = !requiresNeonflexCustomerSizeRequest({
      width_cm: prediction.target_width_cm,
      height_cm: prediction.target_height_cm,
    });
    const score = modelFamily === "unsupported" ? 0 : estimateConfidence({ anchorConfidence, prediction, modelFamily });
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
      needsSupplierCheck: modelFamily === "unsupported" || !customerAutoQuoteEligible || prediction.shipping_requires_review || score < 0.55,
      reviewReason:
        modelFamily === "unsupported"
          ? "unsupported_model_family"
          : !customerAutoQuoteEligible
            ? "target_size_requires_supplier_request"
            : prediction.review_reason,
      modelKey: prediction.model_key,
      modelVersion: prediction.model_version,
      shippingBucket: prediction.shipping_bucket,
      shippingStrategy: prediction.shipping_strategy,
      shippingTrainingRows: prediction.shipping_training_rows,
    };
  });

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
