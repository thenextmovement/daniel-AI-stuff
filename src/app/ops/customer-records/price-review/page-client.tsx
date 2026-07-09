"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Check, CircleAlert, ExternalLink, RefreshCw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { SUPPLIER_PRICE_TO_OFFER_FACTOR } from "@/lib/ops/supplier-price-review-constants";
import type {
  SupplierPriceOfferApplyResult,
  SupplierPricePredictionReviewDecision,
  SupplierPricePredictionReviewItem,
  SupplierPriceTrelloEstimateItem,
  SupplierPriceTrelloEstimateResult,
  SupplierQuoteTrelloImportResult,
  SupplierQuoteTrainingItemAnchorReviewDecision,
  SupplierQuoteTrainingItemAnchorReviewItem,
} from "@/lib/ops/supplier-price-review";
import { OpsPageHeader } from "../../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass } from "../../ops-design";

const OFFER_SIZE_LADDER_CUSTOMER_FACTOR_CLIENT = 2.3;

type ReviewResponse = {
  ok: boolean;
  items?: SupplierPricePredictionReviewItem[];
  anchorItems?: SupplierQuoteTrainingItemAnchorReviewItem[];
  item?: SupplierPricePredictionReviewItem;
  createdPredictionItems?: SupplierPricePredictionReviewItem[];
  estimate?: SupplierPriceTrelloEstimateResult;
  applyResult?: SupplierPriceOfferApplyResult;
  sizeLadder?: OfferSizeLadderResultView;
  sizeLadderDrafts?: OfferSizeLadderResultView[];
  sizeLadderOfferApply?: OfferSizeLadderOfferApplyView;
  importResult?: SupplierQuoteTrelloImportResult;
  error?: string;
  issues?: unknown[];
  details?: unknown;
};

type ReviewFilter = "pending" | "reviewed" | "all";
type AnchorCorrectionDraft = {
  sizeLabel?: string;
  widthCm?: string;
  heightCm?: string;
  productionPrice?: string;
  shippingPrice?: string;
};
type SizeLadderAnchorRole = "minimum" | "requested" | "max_250";
type SizeLadderAnchorDraft = {
  widthCm: string;
  heightCm: string;
  productionPrice: string;
  shippingPrice: string;
};
type OfferSizeLadderOptionView = {
  sizeLabel: string;
  widthCm: number;
  heightCm: number;
  longSideCm: number;
  productionPriceEstimated: number;
  shippingPriceEstimated: number;
  supplierTotalEstimated: number;
  customerFactor: number;
  customerUnitPriceNet: number;
  currency: string;
  confidence: number;
  reviewStatus: "auto_ok" | "needs_review" | "blocked";
  reviewReason: string | null;
  isDefault: boolean;
};
type OfferSizeLadderResultView = {
  status: "draft" | "needs_review" | "approved" | "blocked" | "applied" | "superseded";
  trelloCardId: string;
  offerId: string | null;
  offerItemId: string | null;
  productModel: string;
  confidence: number;
  issues: string[];
  warnings: string[];
  customerFactor: number;
  anchors?: Record<SizeLadderAnchorRole, {
    widthCm: number;
    heightCm: number;
    productionPrice: number;
    shippingPrice: number;
  }>;
  options: OfferSizeLadderOptionView[];
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
type OfferSizeLadderOfferApplyView = {
  dryRun: boolean;
  offer: {
    offerId: string;
    offerNumber: string | null;
    documentReference: string;
    publicUrl: string;
    updatedAt: string;
  };
  diff?: {
    changedKeys: string[];
  };
  sizeLadder: OfferSizeLadderResultView;
  applied: {
    targetItemId: string;
    targetItemTitle: string;
    optionCount: number;
    defaultSizeLabel: string;
    defaultUnitPriceNet: number;
    skippedBlockedOptions: number;
  };
};
type OfferItemCandidateView = {
  id: string;
  title: string;
  detail: string;
};

function formatIssueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return formatIssueText(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatIssueText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred =
      record.message ||
      record.error ||
      record.code ||
      record.details ||
      record.hint ||
      record.reason ||
      record.text;
    if (preferred) return formatIssueText(preferred);
    try {
      return JSON.stringify(record);
    } catch {
      return "Unlesbarer Fehler";
    }
  }
  return String(value);
}

function formatIssueList(values: unknown[]) {
  return values.map(formatIssueText).filter(Boolean).join(", ");
}

function formatApiError(payload: ReviewResponse | null) {
  if (!payload) return "Anfrage fehlgeschlagen.";
  const issueText = payload.issues?.length ? formatIssueList(payload.issues) : "";
  const detailText = payload.details ? formatIssueText(payload.details) : "";
  const base = formatIssueText(payload.error) || "Anfrage fehlgeschlagen.";
  if (issueText) return `${base}: ${issueText}`;
  if (detailText) return `${base}: ${detailText}`;
  return base;
}

function parseOfferItemCandidates(payload: ReviewResponse | null): OfferItemCandidateView[] {
  const errorText = formatIssueText(payload?.error).toLowerCase();
  if (!errorText.includes("mehrere moegliche schildpositionen") && !errorText.includes("mehrere mögliche schildpositionen")) {
    return [];
  }
  return (payload?.issues || []).flatMap((issue) => {
    const text = formatIssueText(issue);
    const match = text.match(/^([^:\s]+):\s*(.+)$/);
    if (!match?.[1] || !match[2]) return [];
    const [title, ...details] = match[2].split(" · ").map((part) => part.trim()).filter(Boolean);
    return [{
      id: match[1],
      title: title || match[1],
      detail: details.join(" · "),
    }];
  });
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCm(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}cm`;
}

function roundDownToFiveClient(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / 5) * 5;
}

function sizeLadderOptionKey(option: OfferSizeLadderOptionView) {
  return `${option.longSideCm}:${option.widthCm}:${option.heightCm}:${option.sizeLabel}`;
}

function buildSizeLadderOptionPriceDrafts(result: OfferSizeLadderResultView) {
  return Object.fromEntries(
    result.options.map((option) => [
      sizeLadderOptionKey(option),
      Number.isFinite(option.customerUnitPriceNet) ? String(option.customerUnitPriceNet) : "",
    ]),
  );
}

function numberFromDraft(value: string) {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSizeLadderOfferDiffSummary(result: OfferSizeLadderOfferApplyView) {
  const changedCount = result.diff?.changedKeys?.length || 0;
  if (!changedCount) {
    return result.dryRun
      ? "Prüfung erfolgreich: Das Angebot ist bereits auf diesem Stand."
      : "Gespeichert: Das Angebot war bereits auf diesem Stand.";
  }
  const optionLabel = result.applied.optionCount === 1 ? "Größenoption" : "Größenoptionen";
  return result.dryRun
    ? `Prüfung erfolgreich: ${result.applied.optionCount} ${optionLabel} würden im Angebot aktualisiert.`
    : `Gespeichert: ${result.applied.optionCount} ${optionLabel} wurden ins Angebot übernommen.`;
}

function statusLabel(item: SupplierPricePredictionReviewItem) {
  switch (item.decisionStatus) {
    case "approved_for_quote":
      return "Freigegeben";
    case "rejected":
      return "Abgelehnt";
    case "needs_supplier_check":
      return "Supplier Check";
    case "superseded":
      return "Ersetzt";
    default:
      return "Review offen";
  }
}

function statusTone(item: SupplierPricePredictionReviewItem) {
  if (item.decisionStatus === "approved_for_quote") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (item.decisionStatus === "rejected") return "border-rose-200 bg-rose-50 text-rose-800";
  if (item.decisionStatus === "needs_supplier_check") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-black/10 bg-white text-black/60";
}

function sourceTitle(item: SupplierPricePredictionReviewItem) {
  return item.sourceCode || item.sourceLabel || item.requestId || item.trelloCardId || "Unbekannter Code";
}

function groupItems(items: SupplierPricePredictionReviewItem[]) {
  const groups = new Map<string, SupplierPricePredictionReviewItem[]>();
  for (const item of items) {
    const key = sourceTitle(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([key, entries]) => ({
    key,
    items: entries.sort((left, right) => left.maxSideCm - right.maxSideCm),
  }));
}

function reviewDecisionLabel(decision: SupplierPricePredictionReviewDecision | SupplierQuoteTrainingItemAnchorReviewDecision) {
  if (decision === "approve") return "freigeben";
  if (decision === "supplier_check") return "zum Supplier Check schicken";
  return "ablehnen";
}

function confirmReviewDecision(label: string, decision: SupplierPricePredictionReviewDecision | SupplierQuoteTrainingItemAnchorReviewDecision) {
  if (typeof window === "undefined") return true;
  return window.confirm(`"${label}" wirklich ${reviewDecisionLabel(decision)}?`);
}

function anchorStatusLabel(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  switch (item.reviewStatus) {
    case "approved":
      return "Anker freigegeben";
    case "rejected":
      return "Abgelehnt";
    case "needs_supplier_check":
      return "Supplier Check";
    default:
      return "Anker offen";
  }
}

function anchorStatusTone(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  if (item.reviewStatus === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (item.reviewStatus === "rejected") return "border-rose-200 bg-rose-50 text-rose-800";
  if (item.reviewStatus === "needs_supplier_check") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-black/10 bg-white text-black/60";
}

function anchorTitle(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  return item.trelloCardName || item.designLabel || item.sourceKey || item.trelloCardId || "Unbekannter Anker";
}

function confidenceTone(level: string) {
  if (level === "high") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  if (level === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-orange-200 bg-orange-50 text-orange-800";
}

function confidenceLabel(level: string) {
  if (level === "high") return "hoch";
  if (level === "medium") return "mittel";
  if (level === "blocked") return "blockiert";
  return "niedrig";
}

function estimateStrategyLabel(strategy: string) {
  switch (strategy) {
    case "exact_supplier_anchor":
      return "Supplier-Preis";
    case "training_informed_supplier_anchor_interpolation":
      return "Trainingskurve zwischen Ankern";
    case "piecewise_supplier_anchor_interpolation":
      return "Zwischen echten Preisen";
    case "downscale_extrapolation":
      return "Downscale grob";
    case "anchored_regression":
      return "Training ab Anker";
    default:
      return strategy.replaceAll("_", " ");
  }
}

function estimateBucketLabel(bucket: string) {
  if (bucket.includes("price_break")) return "10cm-Preissprung erkannt";
  switch (bucket) {
    case "supplier_anchor":
      return "exakter Anker";
    case "supplier_anchor_piecewise":
      return "zwischen Supplier-Ankern";
    case "supplier_anchor_bucket_transition":
      return "Preisrubrik-Wechsel";
    case "below_anchor":
      return "unter Anker";
    default:
      return bucket.replaceAll("_", " ");
  }
}

function estimateReviewReasonLabel(reason: string | null) {
  if (!reason) return null;
  if (reason.startsWith("shipping_bucket_transition")) return "Shipping-Rubrik gewechselt";
  switch (reason) {
    case "marginal_price_jump_detected":
      return "ungewöhnlicher Preissprung";
    case "target_size_requires_supplier_request":
      return "über Auto-Grenze";
    case "target_outside_supplier_anchor_range_extrapolation":
      return "außerhalb echter Anker";
    case "target_smaller_than_anchor_downscale_extrapolation":
      return "kleiner als Anker";
    case "unsupported_model_family":
      return "kein Neonflex";
    default:
      return reason.replaceAll("_", " ");
  }
}

function sizeLadderStatusTone(status: string) {
  if (status === "auto_ok" || status === "draft" || status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function estimateApplyKey(item: SupplierPriceTrelloEstimateItem) {
  return `${item.requestedInput}-${item.widthCm}-${item.heightCm}`;
}

function syncAnchorsFromSizeLadder(result: OfferSizeLadderResultView) {
  if (!result.anchors) return null;
  return (["minimum", "requested", "max_250"] as const).reduce((next, role) => {
    const anchor = result.anchors?.[role];
    next[role] = {
      widthCm: anchor?.widthCm === undefined ? "" : String(anchor.widthCm),
      heightCm: anchor?.heightCm === undefined ? "" : String(anchor.heightCm),
      productionPrice: anchor?.productionPrice === undefined ? "" : String(anchor.productionPrice),
      shippingPrice: anchor?.shippingPrice === undefined ? "" : String(anchor.shippingPrice),
    };
    return next;
  }, {} as Record<SizeLadderAnchorRole, SizeLadderAnchorDraft>);
}

function AnchorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.14em] text-black/40">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />
    </label>
  );
}

function TrelloEstimateResultCard({
  estimate,
  applyingKey,
  checkedApplyKey,
  applyResult,
  onApplyToOffer,
}: {
  estimate: SupplierPriceTrelloEstimateResult;
  applyingKey: string | null;
  checkedApplyKey: string | null;
  applyResult: SupplierPriceOfferApplyResult | null;
  onApplyToOffer: (item: SupplierPriceTrelloEstimateItem, dryRun: boolean) => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-black">{estimate.card.name || estimate.card.id}</div>
          <div className="mt-1 text-xs text-black/50">
            Anchor {formatCm(estimate.anchor.widthCm)} x {formatCm(estimate.anchor.heightCm)} · {estimate.estimates.length} Größen · Production {formatMoney(estimate.anchor.productionPrice, estimate.anchor.currency)} · Shipping {formatMoney(estimate.anchor.shippingPrice, estimate.anchor.currency)}
          </div>
          {estimate.supplierAnchors?.length ? (
            <div className="mt-1 text-xs text-black/45">
              {estimate.supplierAnchors.length} erkannte Supplier-Anker · {estimate.supplierAnchors.length >= 2 ? "Piecewise zwischen echten Preisen" : "Single-Anchor-Schätzung"}
            </div>
          ) : null}
        </div>
        {estimate.card.shortUrl ? (
          <a
            href={estimate.card.shortUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-black/55 transition hover:border-[#fa31a2] hover:text-black"
          >
            Trello
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {estimate.warnings.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {formatIssueList(estimate.warnings)}
        </div>
      ) : null}

      {applyResult ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Angebot {applyResult.dryRun ? "geprüft" : "gespeichert"}: {applyResult.applied.itemTitle} · Verkaufspreis {formatMoney(applyResult.applied.offerUnitPriceNet, "EUR")} netto · Faktor {applyResult.applied.factor.toFixed(1)}
          {applyResult.applied.plausibility.status === "warning" ? " · Plausibilität mit Warnung" : ""}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {estimate.estimates.map((item) => {
          const key = estimateApplyKey(item);
          const offerUnitPrice = roundDownToFiveClient(item.predictedTotalSupplierCost * SUPPLIER_PRICE_TO_OFFER_FACTOR);
          const checking = applyingKey === `${key}:dry`;
          const saving = applyingKey === `${key}:save`;
          const checked = checkedApplyKey === key;
          const reviewReasonLabel = estimateReviewReasonLabel(item.reviewReason);
          return (
          <div key={key} className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-black">
                  {formatCm(item.widthCm)} x {formatCm(item.heightCm)}
                </div>
                <div className="mt-1 text-xs text-black/45">
                  Eingabe: {item.requestedInput} · {item.shippingTrainingRows} Trainingspunkte
                </div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${confidenceTone(item.confidenceLevel)}`}>
                {confidenceLabel(item.confidenceLevel)} {Math.round(item.confidence * 100)}%
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Production</div>
                <div className="mt-1 font-medium text-black">{formatMoney(item.predictedProductionPrice, item.currency)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Shipping</div>
                <div className="mt-1 font-medium text-black">{formatMoney(item.predictedShippingPrice, item.currency)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Total</div>
                <div className="mt-1 font-semibold text-black">{formatMoney(item.predictedTotalSupplierCost, item.currency)}</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
              <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Angebot</div>
              <div className="mt-1 font-semibold text-black">
                {formatMoney(offerUnitPrice, "EUR")} netto
              </div>
              <div className="mt-1 text-xs text-black/45">
                Supplier Total x {SUPPLIER_PRICE_TO_OFFER_FACTOR.toFixed(1)}, abgerundet auf 5 EUR
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-2.5 py-1 ${item.needsSupplierCheck ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                {item.needsSupplierCheck ? "lieber Supplier pruefen" : "intern plausibel"}
              </span>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800">
                {estimateStrategyLabel(item.shippingStrategy)}
              </span>
              <span className={`rounded-full border px-2.5 py-1 ${item.shippingBucket.includes("price_break") || item.shippingBucket === "supplier_anchor_bucket_transition" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-black/10 bg-white text-black/55"}`}>
                {estimateBucketLabel(item.shippingBucket)}
              </span>
              {reviewReasonLabel ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                  Prüfen: {reviewReasonLabel}
                </span>
              ) : null}
              {!item.customerAutoQuoteEligible ? (
                <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-black/50">ueber 200cm</span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(applyingKey)}
                onClick={() => onApplyToOffer(item, true)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-medium text-black/65 transition hover:border-[#fa31a2] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {checking ? "Prüft..." : checked ? "Geprüft" : "Angebot prüfen"}
              </button>
              <button
                type="button"
                disabled={Boolean(applyingKey) || !checked}
                onClick={() => onApplyToOffer(item, false)}
                className="inline-flex items-center gap-2 rounded-full border border-black bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {saving ? "Speichert..." : "Ins Angebot"}
              </button>
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
}

function SizeLadderResultCard({
  result,
  priceDrafts,
  onPriceDraftChange,
  offerApplying,
  canSaveToOffer,
  targetCandidates = [],
  selectedOfferItemId,
  onSelectTargetCandidate,
  onApplyToOffer,
}: {
  result: OfferSizeLadderResultView;
  priceDrafts: Record<string, string>;
  onPriceDraftChange: (optionKey: string, value: string) => void;
  offerApplying?: "dry" | "save" | null;
  canSaveToOffer?: boolean;
  targetCandidates?: OfferItemCandidateView[];
  selectedOfferItemId?: string | null;
  onSelectTargetCandidate?: (candidate: OfferItemCandidateView) => void;
  onApplyToOffer?: (dryRun: boolean) => void;
}) {
  const defaultOption = result.options.find((option) => option.isDefault) || result.options[0] || null;
  const [selectedLongSide, setSelectedLongSide] = useState(defaultOption?.longSideCm ?? 0);
  const selectedOption =
    result.options.find((option) => option.longSideCm === selectedLongSide) || defaultOption;
  const selectedOptionDraft = selectedOption ? priceDrafts[sizeLadderOptionKey(selectedOption)] : "";
  const selectedOptionPrice = numberFromDraft(selectedOptionDraft || "") ?? selectedOption?.customerUnitPriceNet ?? 0;

  useEffect(() => {
    setSelectedLongSide(defaultOption?.longSideCm ?? 0);
  }, [defaultOption?.longSideCm]);

  return (
    <div className="mt-4 rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-black">3-Anchor Size Ladder</div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${sizeLadderStatusTone(result.status)}`}>
              {result.status} · {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <div className="mt-1 text-xs text-black/50">
            {result.productModel} · Faktor {result.customerFactor.toFixed(1)} · {result.options.length} Größenoptionen
          </div>
          <div className="mt-1 text-xs text-black/45">
            {result.offerId ? `Interne Vorschau fuer Angebot ${result.offerId}` : "Interne Vorschau ohne Offer-ID"} · Karte {result.trelloCardId}
          </div>
        </div>
        {result.persisted ? (
          <div className={`rounded-full border px-2.5 py-1 text-xs ${
            result.persisted.trelloProjection?.written === false
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}>
            {result.persisted.trelloProjection?.written === false
              ? "Draft gespeichert · Trello fehlt"
              : result.persisted.trelloProjection?.createdField
                ? "Draft + Trello-Feld gespeichert"
                : "Draft + Trello gespeichert"}
          </div>
        ) : null}
      </div>

      {result.issues.length || result.warnings.length ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${result.issues.length ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {formatIssueList([...result.issues, ...result.warnings])}
        </div>
      ) : null}

      {onApplyToOffer ? (
        <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-3">
          {targetCandidates.length ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">Zielposition wählen</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {targetCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onSelectTargetCandidate?.(candidate)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selectedOfferItemId === candidate.id
                        ? "border-[#fa31a2] bg-white text-black"
                        : "border-amber-200 bg-white/70 text-amber-950 hover:border-[#fa31a2] hover:text-black"
                    }`}
                  >
                    <span className="block font-semibold">{candidate.title}</span>
                    <span className="mt-0.5 block text-[10px] text-black/45">{candidate.detail || candidate.id}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-black">Diese Tabelle ins Angebot übernehmen</div>
              <div className="mt-1 text-xs text-black/45">
                Nutzt die sichtbaren Größen und manuell geänderten Angebotspreise. Das Angebot wird nicht automatisch versendet.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(offerApplying)}
                onClick={() => onApplyToOffer(true)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-medium text-black/70 transition hover:border-[#fa31a2] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {offerApplying === "dry" ? "Prüfe..." : "Angebot prüfen"}
              </button>
              <button
                type="button"
                disabled={Boolean(offerApplying) || !canSaveToOffer}
                onClick={() => onApplyToOffer(false)}
                className="inline-flex items-center gap-2 rounded-full border border-[#fa31a2] bg-[#fa31a2] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#d91f88] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {offerApplying === "save" ? "Speichere..." : canSaveToOffer ? "Ins Angebot speichern" : "Erst prüfen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedOption ? (
        <div className="mt-4 rounded-lg border border-[#fa31a2]/25 bg-[#fa31a2]/[0.04] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-[#fa31a2]">Interne Angebotsvorschau</div>
              <div className="mt-1 text-sm font-semibold text-black">Dropdown-Test ohne Kundenangebot zu ändern</div>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${sizeLadderStatusTone(selectedOption.reviewStatus)}`}>
              {selectedOption.reviewStatus} · {Math.round(selectedOption.confidence * 100)}%
            </span>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,260px)_1fr]">
            <label className="text-sm font-medium text-black">
              Größe im internen Dropdown
              <select
                value={selectedOption.longSideCm}
                onChange={(event) => setSelectedLongSide(Number(event.target.value))}
                className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              >
                {result.options.map((option) => (
                  <option key={`${option.longSideCm}-${option.sizeLabel}`} value={option.longSideCm}>
                    {option.sizeLabel} - {formatMoney(numberFromDraft(priceDrafts[sizeLadderOptionKey(option)] || "") ?? option.customerUnitPriceNet, "EUR")} netto
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Groesse</div>
                <div className="mt-1 font-semibold text-black">{selectedOption.sizeLabel}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Supplier</div>
                <div className="mt-1 font-semibold text-black">{formatMoney(selectedOption.supplierTotalEstimated, selectedOption.currency)}</div>
                <div className="mt-0.5 text-xs text-black/45">
                  Prod. {formatMoney(selectedOption.productionPriceEstimated, selectedOption.currency)} · Ship. {formatMoney(selectedOption.shippingPriceEstimated, selectedOption.currency)}
                </div>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Angebot netto</div>
                <div className="mt-1 font-semibold text-black">{formatMoney(selectedOptionPrice, "EUR")}</div>
                <div className="mt-0.5 text-xs text-black/45">Faktor {selectedOption.customerFactor.toFixed(1)}</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Sicherheit</div>
                <div className="mt-1 font-semibold text-black">{Math.round(selectedOption.confidence * 100)}%</div>
                <div className="mt-0.5 text-xs text-black/45">{selectedOption.reviewReason || "keine Warnung"}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-black/10 text-[10px] uppercase tracking-[0.14em] text-black/40">
            <tr>
              <th className="py-2 pr-3 font-medium">Größe</th>
              <th className="py-2 pr-3 font-medium">Prod.</th>
              <th className="py-2 pr-3 font-medium">Shipping</th>
              <th className="py-2 pr-3 font-medium">Supplier</th>
              <th className="py-2 pr-3 font-medium">Angebot netto</th>
              <th className="py-2 pr-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.options.map((option) => {
              const optionKey = sizeLadderOptionKey(option);
              const draftValue = priceDrafts[optionKey] ?? "";
              const draftNumber = numberFromDraft(draftValue);
              const hasManualChange = draftNumber !== null && Math.abs(draftNumber - option.customerUnitPriceNet) >= 0.01;
              return (
              <tr key={optionKey} className="border-b border-black/[0.06]">
                <td className="py-2 pr-3 font-medium text-black">
                  {option.sizeLabel}
                  {option.isDefault ? <span className="ml-2 text-[10px] text-[#fa31a2]">Default</span> : null}
                </td>
                <td className="py-2 pr-3 text-black/65">{formatMoney(option.productionPriceEstimated, option.currency)}</td>
                <td className="py-2 pr-3 text-black/65">{formatMoney(option.shippingPriceEstimated, option.currency)}</td>
                <td className="py-2 pr-3 text-black/65">{formatMoney(option.supplierTotalEstimated, option.currency)}</td>
                <td className="min-w-[150px] py-2 pr-3">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draftValue}
                    onChange={(event) => onPriceDraftChange(optionKey, event.target.value)}
                    className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-right text-xs font-semibold text-black outline-none transition focus:border-[#fa31a2]"
                    aria-label={`Angebot netto ${option.sizeLabel}`}
                  />
                  <div className="mt-1 text-[10px] text-black/40">
                    {hasManualChange ? `berechnet ${formatMoney(option.customerUnitPriceNet, "EUR")}` : "berechnet"}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${sizeLadderStatusTone(option.reviewStatus)}`}>
                    {option.reviewStatus}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SizeLadderOfferApplyCard({ result }: { result: OfferSizeLadderOfferApplyView }) {
  return (
    <div className="mt-4 rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-black">
            {result.dryRun ? "Angebotsänderung geprüft" : "Größenleiter ins Angebot gespeichert"}
          </div>
          <div className="mt-1 text-xs text-black/50">
            {result.offer.offerNumber || result.offer.documentReference || result.offer.offerId} · {result.applied.optionCount} Größen · Standard {result.applied.defaultSizeLabel} für {formatMoney(result.applied.defaultUnitPriceNet, "EUR")} netto
          </div>
          <div className="mt-1 text-xs text-black/45">
            Zielposition: {result.applied.targetItemTitle}
            {result.applied.skippedBlockedOptions ? ` · ${result.applied.skippedBlockedOptions} blockierte Option(en) ausgelassen` : ""}
          </div>
        </div>
        <a
          href={result.offer.publicUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-black/55 transition hover:border-[#fa31a2] hover:text-black"
        >
          Angebot öffnen
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        {formatSizeLadderOfferDiffSummary(result)}
      </div>
    </div>
  );
}

function TrelloImportResultCard({ result }: { result: SupplierQuoteTrelloImportResult }) {
  return (
    <div className="mt-4 rounded-lg border border-black/10 bg-white p-4">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Karten</div>
          <div className="mt-1 font-semibold text-black">{result.scannedCards}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Bilder</div>
          <div className="mt-1 font-semibold text-black">{result.scannedAttachments}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Neu</div>
          <div className="mt-1 font-semibold text-black">{result.imported}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-black/40">Aktualisiert</div>
          <div className="mt-1 font-semibold text-black">{result.updated}</div>
        </div>
      </div>

      {result.skipped.length || result.errors.length ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {result.skipped.length ? `${result.skipped.length} uebersprungen` : null}
          {result.skipped.length && result.errors.length ? " · " : null}
          {result.errors.length ? `${result.errors.length} Fehler` : null}
          {result.skipped.slice(0, 4).map((item) => (
            <div key={`${item.cardId || item.detail}-${item.attachmentId || item.reason}`} className="mt-1">
              {item.cardName || item.cardId || "Karte"}: {item.reason}
              {item.detail ? ` (${item.detail})` : ""}
            </div>
          ))}
          {result.errors.slice(0, 3).map((item) => (
            <div key={item.cardInput} className="mt-1">
              {item.cardInput}: {item.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AnchorReviewCard({
  item,
  note,
  corrections,
  running,
  onNoteChange,
  onCorrectionChange,
  onReview,
}: {
  item: SupplierQuoteTrainingItemAnchorReviewItem;
  note: string;
  corrections: AnchorCorrectionDraft;
  running: boolean;
  onNoteChange: (value: string) => void;
  onCorrectionChange: (key: keyof AnchorCorrectionDraft, value: string) => void;
  onReview: (decision: SupplierQuoteTrainingItemAnchorReviewDecision) => void;
}) {
  const overCustomerAutoLimit = item.maxSideCm > 200;
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-black">{anchorTitle(item)}</div>
          <div className="mt-1 text-xs text-black/50">
            {item.trelloBoardName || "Board unbekannt"} · {item.trelloListName || "Liste unbekannt"} · {item.attachmentName || "image"}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${anchorStatusTone(item)}`}>
          {anchorStatusLabel(item)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Erkannt</div>
          <div className="mt-1 font-medium text-black">
            {formatCm(item.widthCm)} x {formatCm(item.heightCm)}
          </div>
          <div className="mt-1 text-xs text-black/45">{item.sizeLabel || "ohne Label"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Production</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.productionPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Shipping</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.shippingPrice, item.currency)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-black/55">
          {item.detectedModelFamily || item.productModelFamily || "Modell offen"}
        </span>
        <span className={`rounded-full border px-2.5 py-1 ${overCustomerAutoLimit ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {overCustomerAutoLimit ? ">200cm nur Anfrage" : "bis 200cm Auto-Review"}
        </span>
        {item.trelloCardUrl ? (
          <a
            href={item.trelloCardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-black/55 transition hover:border-[#fa31a2] hover:text-black"
          >
            Trello
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <AnchorInput
          label="Size"
          value={corrections.sizeLabel ?? item.sizeLabel ?? ""}
          onChange={(value) => onCorrectionChange("sizeLabel", value)}
        />
        <AnchorInput
          label="Breite"
          value={corrections.widthCm ?? String(item.widthCm)}
          onChange={(value) => onCorrectionChange("widthCm", value)}
        />
        <AnchorInput
          label="Hoehe"
          value={corrections.heightCm ?? String(item.heightCm)}
          onChange={(value) => onCorrectionChange("heightCm", value)}
        />
        <AnchorInput
          label="Production"
          value={corrections.productionPrice ?? String(item.productionPrice)}
          onChange={(value) => onCorrectionChange("productionPrice", value)}
        />
        <AnchorInput
          label="Shipping"
          value={corrections.shippingPrice ?? String(item.shippingPrice)}
          onChange={(value) => onCorrectionChange("shippingPrice", value)}
        />
      </div>

      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Review-Notiz"
        rows={2}
        className="mt-4 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("approve")}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Anker freigeben
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("supplier_check")}
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Supplier Check
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("reject")}
          className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Ablehnen
        </button>
      </div>
    </div>
  );
}

function ReviewItemCard({
  item,
  note,
  running,
  onNoteChange,
  onReview,
}: {
  item: SupplierPricePredictionReviewItem;
  note: string;
  running: boolean;
  onNoteChange: (value: string) => void;
  onReview: (decision: SupplierPricePredictionReviewDecision) => void;
}) {
  const autoEligible = item.customerAutoQuoteEligible;
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-black">
            {formatCm(item.widthCm)} x {formatCm(item.heightCm)}
          </div>
          <div className="mt-1 text-xs text-black/50">
            Max {formatCm(item.maxSideCm)} · {item.modelKey || "Modell"} {item.modelVersion || ""}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${statusTone(item)}`}>
          {statusLabel(item)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Production</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.predictedProductionPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Shipping</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.predictedShippingPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Supplier Total</div>
          <div className="mt-1 font-semibold text-black">{formatMoney(item.predictedTotalSupplierCost, item.currency)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-black/55">
          Anchor {item.anchorWidthCm && item.anchorHeightCm ? `${formatCm(item.anchorWidthCm)} x ${formatCm(item.anchorHeightCm)}` : "unbekannt"}
        </span>
        <span className={`rounded-full border px-2.5 py-1 ${autoEligible ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {autoEligible ? "bis 200cm Auto-Review" : ">200cm Anfrage"}
        </span>
        {item.requestId ? (
          <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-black/50">
            {item.requestId}
          </span>
        ) : null}
      </div>

      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Review-Notiz"
        rows={2}
        className="mt-4 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {autoEligible ? (
          <button
            type="button"
            disabled={running}
            onClick={() => onReview("approve")}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Freigeben
          </button>
        ) : null}
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("supplier_check")}
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Supplier Check
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("reject")}
          className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Ablehnen
        </button>
      </div>
    </div>
  );
}

export function SupplierPriceReviewClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const sharedOperatorNameKey = "neontrip-ops-operator";
  const operatorNameKey = "neontrip-customer-records-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [items, setItems] = useState<SupplierPricePredictionReviewItem[]>([]);
  const [anchorItems, setAnchorItems] = useState<SupplierQuoteTrainingItemAnchorReviewItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [anchorCorrections, setAnchorCorrections] = useState<Record<string, AnchorCorrectionDraft>>({});
  const [estimateTrelloCard, setEstimateTrelloCard] = useState("");
  const [estimateTargetSizes, setEstimateTargetSizes] = useState("");
  const [estimateResult, setEstimateResult] = useState<SupplierPriceTrelloEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [offerApplyingKey, setOfferApplyingKey] = useState<string | null>(null);
  const [checkedOfferApplyKey, setCheckedOfferApplyKey] = useState<string | null>(null);
  const [offerApplyResult, setOfferApplyResult] = useState<SupplierPriceOfferApplyResult | null>(null);
  const [sizeLadderTrelloCardId, setSizeLadderTrelloCardId] = useState("");
  const [sizeLadderOfferId, setSizeLadderOfferId] = useState("");
  const [sizeLadderOfferItemId, setSizeLadderOfferItemId] = useState("");
  const [sizeLadderProductModel, setSizeLadderProductModel] = useState("neonflex");
  const [sizeLadderSourceText, setSizeLadderSourceText] = useState("");
  const [sizeLadderAnchors, setSizeLadderAnchors] = useState<Record<SizeLadderAnchorRole, SizeLadderAnchorDraft>>({
    minimum: { widthCm: "", heightCm: "", productionPrice: "", shippingPrice: "" },
    requested: { widthCm: "", heightCm: "", productionPrice: "", shippingPrice: "" },
    max_250: { widthCm: "", heightCm: "", productionPrice: "", shippingPrice: "" },
  });
  const [sizeLadderResult, setSizeLadderResult] = useState<OfferSizeLadderResultView | null>(null);
  const [sizeLadderOptionPriceDrafts, setSizeLadderOptionPriceDrafts] = useState<Record<string, string>>({});
  const [sizeLadderOfferApplyResult, setSizeLadderOfferApplyResult] = useState<OfferSizeLadderOfferApplyView | null>(null);
  const [sizeLadderTargetCandidates, setSizeLadderTargetCandidates] = useState<OfferItemCandidateView[]>([]);
  const [sizeLadderRunning, setSizeLadderRunning] = useState(false);
  const [sizeLadderOfferApplying, setSizeLadderOfferApplying] = useState<"dry" | "save" | null>(null);
  const [sizeLadderLoadingDraft, setSizeLadderLoadingDraft] = useState(false);
  const [importListId, setImportListId] = useState("");
  const [importCards, setImportCards] = useState("");
  const [importTitleFilter, setImportTitleFilter] = useState("");
  const [importLimit, setImportLimit] = useState("25");
  const [importResult, setImportResult] = useState<SupplierQuoteTrelloImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canLoad = !opsEnabled || hasSession || localMode;
  const canSaveSizeLadderToOffer = sizeLadderOfferApplyResult?.dryRun === true;
  const groups = useMemo(() => groupItems(items), [items]);

  const loadItems = useCallback(async (nextFilter: ReviewFilter = filter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/customer-records/price-predictions?status=${nextFilter}`);
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (response.status === 401) {
        setHasSession(false);
        setError("Zugang abgelaufen. Bitte erneut entsperren.");
        setItems([]);
        setAnchorItems([]);
        setLoading(false);
        return;
      }
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setItems([]);
        setAnchorItems([]);
        setLoading(false);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setLoading(false);
    } catch {
      setError("Preisvorschlaege konnten nicht geladen werden.");
      setItems([]);
      setAnchorItems([]);
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    try {
      setOperatorName(window.localStorage.getItem(sharedOperatorNameKey) || window.localStorage.getItem(operatorNameKey) || "");
    } catch {
      // ignore local storage
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(sharedOperatorNameKey, operatorName);
      window.localStorage.setItem(operatorNameKey, operatorName);
    } catch {
      // ignore local storage
    }
  }, [operatorName]);

  useEffect(() => {
    if (canLoad) void loadItems(filter);
  }, [canLoad, filter, loadItems]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
    if (!response.ok) {
      setError(formatApiError(payload));
      return;
    }
    setHasSession(true);
    setToken("");
    setMessage("Zugang aktiv.");
  }

  async function reviewItem(item: SupplierPricePredictionReviewItem, decision: SupplierPricePredictionReviewDecision) {
    if (!confirmReviewDecision(`${sourceTitle(item)} ${formatCm(item.widthCm)} x ${formatCm(item.heightCm)}`, decision)) return;
    setRunningId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          predictionId: item.id,
          decision,
          note: notes[item.id] || null,
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setRunningId(null);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setNotes((current) => ({ ...current, [item.id]: "" }));
      setMessage("Preisvorschlag aktualisiert.");
      setRunningId(null);
    } catch {
      setError("Preisvorschlag konnte nicht aktualisiert werden.");
      setRunningId(null);
    }
  }

  async function reviewAnchor(
    item: SupplierQuoteTrainingItemAnchorReviewItem,
    decision: SupplierQuoteTrainingItemAnchorReviewDecision,
  ) {
    if (!confirmReviewDecision(anchorTitle(item), decision)) return;
    setRunningId(`anchor:${item.id}`);
    setError(null);
    setMessage(null);
    try {
      const corrections = anchorCorrections[item.id] || {};
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_training_item_anchor",
          trainingItemAnchor: {
            trainingItemId: item.id,
            decision,
            note: notes[item.id] || null,
            corrections,
            stepCm: 20,
            maxLongSideCm: 300,
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setRunningId(null);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setNotes((current) => ({ ...current, [item.id]: "" }));
      setAnchorCorrections((current) => ({ ...current, [item.id]: {} }));
      const createdCount = payload.createdPredictionItems?.length || 0;
      setMessage(
        decision === "approve"
          ? `Anker freigegeben. ${createdCount} Preisvorschlaege erzeugt.`
          : "Anker aktualisiert.",
      );
      setRunningId(null);
    } catch {
      setError("Anker konnte nicht aktualisiert werden.");
      setRunningId(null);
    }
  }

  async function estimateFromTrello() {
    setEstimating(true);
    setError(null);
    setMessage(null);
    setEstimateResult(null);
    setCheckedOfferApplyKey(null);
    setOfferApplyResult(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "estimate_from_trello",
          estimate: {
            trelloCard: estimateTrelloCard,
            targetSizes: estimateTargetSizes,
            currency: "USD",
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        setError(formatApiError(payload));
        setEstimating(false);
        return;
      }
      setEstimateResult(payload.estimate);
      setMessage("Schätzung berechnet.");
      setEstimating(false);
    } catch {
      setError("Schätzung konnte nicht berechnet werden.");
      setEstimating(false);
    }
  }

  async function applyEstimateToOffer(item: SupplierPriceTrelloEstimateItem, dryRun: boolean) {
    const key = estimateApplyKey(item);
    setOfferApplyingKey(`${key}:${dryRun ? "dry" : "save"}`);
    setError(null);
    setMessage(null);
    if (dryRun) setOfferApplyResult(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply_trello_estimate_to_offer",
          offerApply: {
            trelloCard: estimateTrelloCard || estimateResult?.card.id || null,
            targetSize: item.requestedInput,
            dryRun,
            currency: "USD",
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.applyResult) {
        setError(formatApiError(payload));
        setOfferApplyingKey(null);
        return;
      }
      setOfferApplyResult(payload.applyResult);
      if (dryRun) {
        setCheckedOfferApplyKey(key);
        setMessage("Angebotsänderung geprüft. Du kannst sie jetzt ins Angebot speichern.");
      } else {
        setCheckedOfferApplyKey(null);
        setMessage("Preis wurde ins Angebot übernommen. Das Angebot wurde nicht automatisch versendet.");
      }
      setOfferApplyingKey(null);
    } catch {
      setError("Preis konnte nicht ins Angebot übernommen werden.");
      setOfferApplyingKey(null);
    }
  }

  function updateSizeLadderAnchor(role: SizeLadderAnchorRole, patch: Partial<SizeLadderAnchorDraft>) {
    setSizeLadderAnchors((current) => ({
      ...current,
      [role]: {
        ...current[role],
        ...patch,
      },
    }));
  }

  function updateSizeLadderResult(result: OfferSizeLadderResultView | null) {
    setSizeLadderResult(result);
    setSizeLadderOptionPriceDrafts(result ? buildSizeLadderOptionPriceDrafts(result) : {});
  }

  function updateSizeLadderOptionPriceDraft(optionKey: string, value: string) {
    setSizeLadderOptionPriceDrafts((current) => ({ ...current, [optionKey]: value }));
    setSizeLadderOfferApplyResult(null);
  }

  function sizeLadderOptionOverrides() {
    if (!sizeLadderResult) return [];
    return sizeLadderResult.options.flatMap((option) => {
      const optionKey = sizeLadderOptionKey(option);
      const value = numberFromDraft(sizeLadderOptionPriceDrafts[optionKey] || "");
      if (value === null) return [];
      return [{
        optionKey,
        sizeLabel: option.sizeLabel,
        widthCm: option.widthCm,
        heightCm: option.heightCm,
        longSideCm: option.longSideCm,
        customerUnitPriceNet: value,
      }];
    });
  }

  async function generateSizeLadder(persist: boolean) {
    setSizeLadderRunning(true);
    setError(null);
    setMessage(null);
    setSizeLadderOfferApplyResult(null);
    setSizeLadderTargetCandidates([]);
    if (!persist) updateSizeLadderResult(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_offer_size_ladder",
          sizeLadder: {
            trelloCardId: sizeLadderTrelloCardId,
            trelloCardUrl: sizeLadderTrelloCardId.startsWith("http") ? sizeLadderTrelloCardId : null,
            offerId: sizeLadderOfferId || null,
            offerItemId: sizeLadderOfferItemId || null,
            productModel: sizeLadderProductModel || null,
            sourceText: sizeLadderSourceText || null,
            stepCm: 10,
            maxLongSideCm: 250,
            customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR_CLIENT,
            persist,
            anchors: (["minimum", "requested", "max_250"] as const).map((role) => ({
              role,
              widthCm: sizeLadderAnchors[role].widthCm,
              heightCm: sizeLadderAnchors[role].heightCm,
              productionPrice: sizeLadderAnchors[role].productionPrice,
              shippingPrice: sizeLadderAnchors[role].shippingPrice,
              currency: "USD",
              source: "manual",
              confidence: 0.9,
            })),
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.sizeLadder) {
        setError(formatApiError(payload));
        setSizeLadderRunning(false);
        return;
      }
      updateSizeLadderResult(payload.sizeLadder);
      setMessage(persist ? "Size-Ladder Draft gespeichert." : "Size-Ladder berechnet.");
      setSizeLadderRunning(false);
    } catch {
      setError("Size-Ladder konnte nicht berechnet werden.");
      setSizeLadderRunning(false);
    }
  }

  async function generateSizeLadderFromTrello(persist: boolean) {
    setSizeLadderRunning(true);
    setError(null);
    setMessage(null);
    setSizeLadderOfferApplyResult(null);
    setSizeLadderTargetCandidates([]);
    if (!persist) updateSizeLadderResult(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_offer_size_ladder_from_trello",
          sizeLadderFromTrello: {
            trelloCard: sizeLadderTrelloCardId,
            offerId: sizeLadderOfferId || null,
            offerItemId: sizeLadderOfferItemId || null,
            productModel: sizeLadderProductModel || null,
            sourceText: sizeLadderSourceText || null,
            stepCm: 10,
            maxLongSideCm: 250,
            customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR_CLIENT,
            optionOverrides: persist ? sizeLadderOptionOverrides() : [],
            persist,
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.sizeLadder) {
        setError(formatApiError(payload));
        setSizeLadderRunning(false);
        return;
      }
      const syncedAnchors = syncAnchorsFromSizeLadder(payload.sizeLadder);
      if (syncedAnchors) setSizeLadderAnchors(syncedAnchors);
      setSizeLadderProductModel(payload.sizeLadder.productModel || sizeLadderProductModel);
      updateSizeLadderResult(payload.sizeLadder);
      const projection = payload.sizeLadder.persisted?.trelloProjection;
      setMessage(
        persist
          ? projection?.written === false
            ? `Draft gespeichert, aber Trello-Projektion fehlt: ${projection.error || "offer_items_json nicht geschrieben"}`
            : projection?.createdField
              ? "Trello-Anker geladen, Draft gespeichert, offer_items_json angelegt und fuer das Angebot vorbereitet."
              : "Trello-Anker geladen, Draft gespeichert und offer_items_json fuer das Angebot vorbereitet."
          : "Trello-Anker geladen und Size-Ladder berechnet.",
      );
      setSizeLadderRunning(false);
    } catch {
      setError("Trello-Anker konnten nicht geladen werden.");
      setSizeLadderRunning(false);
    }
  }

  function currentSizeLadderAnchorPayload() {
    return (["minimum", "requested", "max_250"] as const).map((role) => {
      const synced = sizeLadderResult?.anchors?.[role];
      return {
        role,
        widthCm: synced?.widthCm ?? sizeLadderAnchors[role].widthCm,
        heightCm: synced?.heightCm ?? sizeLadderAnchors[role].heightCm,
        productionPrice: synced?.productionPrice ?? sizeLadderAnchors[role].productionPrice,
        shippingPrice: synced?.shippingPrice ?? sizeLadderAnchors[role].shippingPrice,
        currency: "USD",
        source: synced ? "custom_fields" : "manual",
        confidence: synced ? 0.9 : 0.85,
      };
    });
  }

  async function applySizeLadderToOffer(dryRun: boolean, offerItemIdOverride?: string | null) {
    const reviewer = operatorName.trim();
    if (!reviewer) {
      setError("Bitte deinen Namen im Feld Reviewer eintragen, bevor du die Größenleiter am Angebot prüfst oder speicherst.");
      setMessage(null);
      setSizeLadderOfferApplyResult(null);
      return;
    }
    setSizeLadderOfferApplying(dryRun ? "dry" : "save");
    setError(null);
    setMessage(null);
    setSizeLadderTargetCandidates([]);
    if (dryRun) setSizeLadderOfferApplyResult(null);
    const targetOfferItemId = offerItemIdOverride || sizeLadderOfferItemId;
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply_offer_size_ladder_to_offer",
          sizeLadderOfferApply: {
            trelloCard: sizeLadderTrelloCardId,
            trelloCardId: sizeLadderResult?.trelloCardId || sizeLadderTrelloCardId,
            trelloCardUrl: sizeLadderTrelloCardId.startsWith("http") ? sizeLadderTrelloCardId : null,
            offerId: sizeLadderOfferId || null,
            offerItemId: targetOfferItemId || null,
            productModel: sizeLadderProductModel || null,
            sourceText: sizeLadderSourceText || null,
            stepCm: 10,
            maxLongSideCm: 250,
            customerFactor: OFFER_SIZE_LADDER_CUSTOMER_FACTOR_CLIENT,
            anchors: currentSizeLadderAnchorPayload(),
            optionOverrides: sizeLadderOptionOverrides(),
            dryRun,
          },
          operatorName: reviewer,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.sizeLadderOfferApply) {
        setSizeLadderTargetCandidates(parseOfferItemCandidates(payload));
        setError(formatApiError(payload));
        setSizeLadderOfferApplying(null);
        return;
      }
      const syncedAnchors = syncAnchorsFromSizeLadder(payload.sizeLadderOfferApply.sizeLadder);
      if (syncedAnchors) setSizeLadderAnchors(syncedAnchors);
      updateSizeLadderResult(payload.sizeLadderOfferApply.sizeLadder);
      setSizeLadderOfferApplyResult(payload.sizeLadderOfferApply);
      setSizeLadderTargetCandidates([]);
      setMessage(dryRun ? "Angebotsänderung geprüft. Du kannst sie jetzt speichern." : "Größenleiter wurde ins Angebot übernommen. Das Angebot wurde nicht automatisch versendet.");
      setSizeLadderOfferApplying(null);
    } catch {
      setError("Größenleiter konnte nicht ins Angebot übernommen werden.");
      setSizeLadderOfferApplying(null);
    }
  }

  async function loadSizeLadderDraft() {
    setSizeLadderLoadingDraft(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list_offer_size_ladder_drafts",
          sizeLadderLookup: {
            trelloCardId: sizeLadderTrelloCardId || null,
            offerId: sizeLadderOfferId || null,
            offerItemId: sizeLadderOfferItemId || null,
            limit: 1,
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.sizeLadderDrafts) {
        setError(formatApiError(payload));
        setSizeLadderLoadingDraft(false);
        return;
      }
      const draft = payload.sizeLadderDrafts[0] || null;
      if (!draft) {
        setError("Kein gespeicherter interner Draft für diese Offer-/Trello-Kombination gefunden.");
        setSizeLadderLoadingDraft(false);
        return;
      }
      updateSizeLadderResult(draft);
      setMessage("Interner Size-Ladder Draft geladen. Das Kundenangebot wurde nicht verändert.");
      setSizeLadderLoadingDraft(false);
    } catch {
      setError("Interner Size-Ladder Draft konnte nicht geladen werden.");
      setSizeLadderLoadingDraft(false);
    }
  }

  async function importFromTrello() {
    setImporting(true);
    setError(null);
    setMessage(null);
    setImportResult(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_trello_training_candidates",
          trelloImport: {
            listId: importListId || null,
            trelloCards: importCards || null,
            titleFilter: importTitleFilter || null,
            limit: importLimit || 25,
            currency: "USD",
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.importResult) {
        setError(formatApiError(payload));
        setImporting(false);
        return;
      }
      setImportResult(payload.importResult);
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setMessage(`${payload.importResult.imported} neue und ${payload.importResult.updated} aktualisierte Trainingsanker importiert.`);
      setImporting(false);
    } catch {
      setError("Trello-Import konnte nicht ausgeführt werden.");
      setImporting(false);
    }
  }

  return (
    <main className={`${opsPageShellClass} px-4 py-6 text-black md:px-6`}>
      <div className={`${opsPageContainerClass} flex flex-col gap-5`}>
        <OpsPageHeader active="priceReview" label="Schildgrößen & Preise" />

        <OpsPageIntro
          eyebrow="Customer Ops"
          title="Schildgrößen & Preise"
          description="Trello-Karte eintragen, Zielgröße setzen und eine interne Supplierpreis-Schätzung mit Confidence erhalten."
        >
          <a
            href="/ops/customer-records"
            className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 text-sm font-medium text-white/76 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            Customer Ops
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={() => void loadItems()}
            disabled={!canLoad || loading}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-medium text-stone-950 transition hover:bg-[#f7f2ea] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </button>
        </OpsPageIntro>

        {opsEnabled && !hasSession && !localMode ? (
          <section className="rounded-lg border border-black/10 bg-white p-5">
            <div className="text-sm font-semibold text-black">Ops-Zugang</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Ops Token"
                className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
              />
              <button
                type="button"
                onClick={() => void login()}
                className="rounded-full border border-black bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-black/85"
              >
                Entsperren
              </button>
            </div>
          </section>
        ) : null}

        {canLoad ? (
          <section className="rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fffafc_52%,#fbfdff_100%)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-black">
                  <Calculator className="h-4 w-4 text-[#fa31a2]" />
                  Trello-Preisschätzung
                </div>
                <div className="mt-1 text-sm text-black/55">
                  Liest den Supplier-Anker aus Trello und berechnet Zielgrößen als interne Einschätzung.
                </div>
              </div>
              <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/50">
                No Auto-Send
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_0.8fr_auto]">
              <input
                type="text"
                value={estimateTrelloCard}
                onChange={(event) => setEstimateTrelloCard(event.target.value)}
                placeholder="Trello-Link oder Karten-ID"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
              <input
                type="text"
                value={estimateTargetSizes}
                onChange={(event) => setEstimateTargetSizes(event.target.value)}
                placeholder="leer = alle Größen"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
              <button
                type="button"
                disabled={estimating || !estimateTrelloCard.trim()}
                onClick={() => void estimateFromTrello()}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Calculator className="h-4 w-4" />
                {estimating ? "Rechne..." : "Berechnen"}
              </button>
            </div>
            <div className="mt-2 text-xs text-black/45">
              Leer lassen für alle 10cm-Schritte vom erkannten Anker bis 250cm. Extra-Zielgrößen mit Komma trennen; <code>100</code> skaliert proportional, <code>50x75</code> setzt Breite und Höhe explizit.
            </div>
            {estimateResult ? (
              <TrelloEstimateResultCard
                estimate={estimateResult}
                applyingKey={offerApplyingKey}
                checkedApplyKey={checkedOfferApplyKey}
                applyResult={offerApplyResult}
                onApplyToOffer={(item, dryRun) => void applyEstimateToOffer(item, dryRun)}
              />
            ) : null}
          </section>
        ) : null}

        {canLoad ? (
          <section className="rounded-lg border border-black/10 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-black">
                  <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                  3-Anchor Größenleiter
                </div>
                <div className="mt-1 text-sm text-black/55">
                  Supplier-Preise für Minimum, Kundenwunsch und 250cm eintragen. Daraus entstehen 10cm-Größenoptionen mit Faktor 2,3.
                </div>
              </div>
              <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/50">
                Draft + Review
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_0.9fr_0.9fr_0.8fr_0.8fr]">
              <input
                type="text"
                value={sizeLadderTrelloCardId}
                onChange={(event) => setSizeLadderTrelloCardId(event.target.value)}
                placeholder="Trello Card ID oder Link"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
              <input
                type="text"
                value={sizeLadderOfferId}
                onChange={(event) => setSizeLadderOfferId(event.target.value)}
                placeholder="Offer ID optional"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
              <input
                type="text"
                value={sizeLadderOfferItemId}
                onChange={(event) => setSizeLadderOfferItemId(event.target.value)}
                placeholder="Offer Item ID optional"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
              <select
                value={sizeLadderProductModel}
                onChange={(event) => setSizeLadderProductModel(event.target.value)}
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              >
                <option value="neonflex">Neonflex</option>
                <option value="uv_print">UV-Print</option>
                <option value="outdoor">Outdoor</option>
                <option value="three_d">3D</option>
                <option value="full_glow">Full Glow</option>
                <option value="unknown">Unknown</option>
              </select>
              <input
                type="text"
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                placeholder="Reviewer"
                className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
              />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {([
                ["minimum", "Minimum"],
                ["requested", "Kundenwunsch"],
                ["max_250", "250cm"],
              ] as Array<[SizeLadderAnchorRole, string]>).map(([role, label]) => (
                <div key={role} className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-black/45">{label}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={sizeLadderAnchors[role].widthCm}
                      onChange={(event) => updateSizeLadderAnchor(role, { widthCm: event.target.value })}
                      placeholder="Breite cm"
                      className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                    />
                    <input
                      type="number"
                      value={sizeLadderAnchors[role].heightCm}
                      onChange={(event) => updateSizeLadderAnchor(role, { heightCm: event.target.value })}
                      placeholder="Höhe cm"
                      className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                    />
                    <input
                      type="number"
                      value={sizeLadderAnchors[role].productionPrice}
                      onChange={(event) => updateSizeLadderAnchor(role, { productionPrice: event.target.value })}
                      placeholder="Production USD"
                      className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                    />
                    <input
                      type="number"
                      value={sizeLadderAnchors[role].shippingPrice}
                      onChange={(event) => updateSizeLadderAnchor(role, { shippingPrice: event.target.value })}
                      placeholder="Shipping USD"
                      className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                    />
                  </div>
                </div>
              ))}
            </div>

            <textarea
              value={sizeLadderSourceText}
              onChange={(event) => setSizeLadderSourceText(event.target.value)}
              placeholder="Optional: Supplier-/Trello-Text für Modell-Erkennung, z.B. UV-Print, Full Glow, Outdoor"
              className="mt-3 min-h-20 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={sizeLadderRunning || !sizeLadderTrelloCardId.trim()}
                onClick={() => void generateSizeLadderFromTrello(false)}
                className="inline-flex items-center gap-2 rounded-full border border-[#fa31a2]/30 bg-[#fff2fa] px-4 py-2 text-sm font-medium text-[#9f1768] transition hover:border-[#fa31a2] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Calculator className="h-4 w-4" />
                {sizeLadderRunning ? "Lade..." : "Trello laden & Tabelle berechnen"}
              </button>
              <button
                type="button"
                disabled={sizeLadderRunning || !sizeLadderResult || !sizeLadderTrelloCardId.trim()}
                onClick={() => void generateSizeLadderFromTrello(true)}
                className="inline-flex items-center gap-2 rounded-full border border-[#fa31a2] bg-[#fa31a2] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d91f88] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                Tabelle als Draft speichern
              </button>
            </div>
            <details className="mt-3 rounded-lg border border-black/10 bg-white">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-black/60 transition hover:text-black">
                Weitere Aktionen
              </summary>
              <div className="flex flex-wrap gap-2 border-t border-black/10 p-3">
                <button
                  type="button"
                  disabled={sizeLadderLoadingDraft || (!sizeLadderTrelloCardId.trim() && !sizeLadderOfferId.trim())}
                  onClick={() => void loadSizeLadderDraft()}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-black/70 transition hover:border-[#fa31a2] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${sizeLadderLoadingDraft ? "animate-spin" : ""}`} />
                  {sizeLadderLoadingDraft ? "Lade..." : "Gespeicherten Draft laden"}
                </button>
                <button
                  type="button"
                  disabled={sizeLadderRunning || !sizeLadderTrelloCardId.trim()}
                  onClick={() => void generateSizeLadder(false)}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-black/70 transition hover:border-[#fa31a2] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Calculator className="h-4 w-4" />
                  {sizeLadderRunning ? "Rechne..." : "Manuell berechnen"}
                </button>
                <button
                  type="button"
                  disabled={sizeLadderRunning || !sizeLadderTrelloCardId.trim()}
                  onClick={() => void generateSizeLadder(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  Manuell als Draft speichern
                </button>
              </div>
            </details>
            <div className="mt-2 text-xs text-black/45">
              Angebotszuordnung über Trello-ID oder interne Offer-ID.
            </div>

            {sizeLadderOfferApplyResult ? <SizeLadderOfferApplyCard result={sizeLadderOfferApplyResult} /> : null}
            {sizeLadderResult ? (
              <SizeLadderResultCard
                result={sizeLadderResult}
                priceDrafts={sizeLadderOptionPriceDrafts}
                onPriceDraftChange={updateSizeLadderOptionPriceDraft}
                offerApplying={sizeLadderOfferApplying}
                canSaveToOffer={canSaveSizeLadderToOffer}
                targetCandidates={sizeLadderTargetCandidates}
                selectedOfferItemId={sizeLadderOfferItemId}
                onSelectTargetCandidate={(candidate) => {
                  setSizeLadderOfferItemId(candidate.id);
                  void applySizeLadderToOffer(true, candidate.id);
                }}
                onApplyToOffer={(dryRun) => void applySizeLadderToOffer(dryRun)}
              />
            ) : null}
          </section>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
        ) : null}

        {canLoad ? (
          <details className="group rounded-lg border border-black/10 bg-white/80">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 marker:hidden">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-black">
                  <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                  Modelltraining & Review
                </div>
                <div className="mt-1 text-sm text-black/55">
                  {loading ? "Lade interne Modellprüfungen..." : `${anchorItems.length} Anker · ${items.length} Preisvorschläge`}
                </div>
              </div>
              <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-black/55 transition group-open:bg-black group-open:text-white">
                Aufklappen
              </span>
            </summary>

            <div className="border-t border-black/10 p-5">
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Nur für Modellpflege: Hier werden erkannte Trainingsanker und Shadow-Preisvorschläge geprüft. Das ist nicht nötig, um eine einzelne Trello-Karte oben zu schätzen.
              </div>

              <div className="mb-4 rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fbfdff_54%,#fffafc_100%)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-black">
                      <UploadCloud className="h-4 w-4 text-[#fa31a2]" />
                      Trello-Training importieren
                    </div>
                    <div className="mt-1 text-sm text-black/55">
                      Liest Trello read-only, OCRt Bild-Anhänge und schreibt nur prüfbare Anker in die Review Queue.
                    </div>
                  </div>
                  <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/50">
                    Human Gate
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.7fr_0.35fr_auto]">
                  <input
                    type="text"
                    value={importListId}
                    onChange={(event) => setImportListId(event.target.value)}
                    placeholder="Trello Listen-ID"
                    className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
                  />
                  <input
                    type="text"
                    value={importTitleFilter}
                    onChange={(event) => setImportTitleFilter(event.target.value)}
                    placeholder="Titel-Filter, z.B. 200cm,220cm"
                    className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={importLimit}
                    onChange={(event) => setImportLimit(event.target.value)}
                    className="min-w-0 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
                    aria-label="Import Limit"
                  />
                  <button
                    type="button"
                    disabled={importing || (!importListId.trim() && !importCards.trim())}
                    onClick={() => void importFromTrello()}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {importing ? "Importiere..." : "Import"}
                  </button>
                </div>
                <textarea
                  value={importCards}
                  onChange={(event) => setImportCards(event.target.value)}
                  placeholder="Oder einzelne Trello-Links/Karten-IDs, eine pro Zeile"
                  rows={2}
                  className="mt-3 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
                />
                <div className="mt-2 text-xs text-black/45">
                  Importiert nur Zeilen mit erkannter Größe plus separatem Production- und Shipping-Preis. Sondermodelle werden gespeichert, aber fürs Neonflex-Training ausgeschlossen.
                </div>
                {importResult ? <TrelloImportResultCard result={importResult} /> : null}
              </div>

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-black">Review Queue</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(event) => setOperatorName(event.target.value)}
                    placeholder="Reviewer"
                    className="w-40 rounded-full border border-black/10 px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                  />
                  {(["pending", "reviewed", "all"] as const).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setFilter(entry)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        filter === entry
                          ? "border-black bg-black text-white"
                          : "border-black/10 bg-white text-black/60 hover:border-[#fa31a2] hover:text-black"
                      }`}
                    >
                      {entry === "pending" ? "Offen" : entry === "reviewed" ? "Reviewed" : "Alle"}
                    </button>
                  ))}
                </div>
              </div>

              <section className="grid gap-4">
                {!loading && anchorItems.length ? (
                  <div className="rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fffafc_50%,#fbfdff_100%)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-black">
                          <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                          Ankerprüfung
                        </div>
                        <div className="mt-1 text-sm text-black/55">
                          OCR-/Supplier-Zeilen erst korrigieren und freigeben, danach entstehen Shadow-Preisvorschläge.
                        </div>
                      </div>
                      <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-amber-800">
                        Human Gate
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {anchorItems.map((item) => (
                        <AnchorReviewCard
                          key={item.id}
                          item={item}
                          note={notes[item.id] || ""}
                          corrections={anchorCorrections[item.id] || {}}
                          running={runningId === `anchor:${item.id}`}
                          onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
                          onCorrectionChange={(key, value) =>
                            setAnchorCorrections((current) => ({
                              ...current,
                              [item.id]: {
                                ...(current[item.id] || {}),
                                [key]: value,
                              },
                            }))
                          }
                          onReview={(decision) => void reviewAnchor(item, decision)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {!loading && !groups.length ? (
                  <div className="rounded-lg border border-dashed border-black/10 bg-white/70 px-5 py-8 text-center text-sm text-black/50">
                    Keine Preisvorschläge in dieser Ansicht.
                  </div>
                ) : null}
                {groups.map((group) => (
                  <div key={group.key} className="rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fbfdff_52%,#fffdf9_100%)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-black">
                          <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                          {group.key}
                        </div>
                        <div className="mt-1 text-sm text-black/55">
                          {group.items.length} Größenvorschläge · kleinste erkannte Größe zuerst prüfen
                        </div>
                      </div>
                      <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/50">
                        Shadow
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {group.items.map((item) => (
                        <ReviewItemCard
                          key={item.id}
                          item={item}
                          note={notes[item.id] || ""}
                          running={runningId === item.id}
                          onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
                          onReview={(decision) => void reviewItem(item, decision)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </details>
        ) : null}
      </div>
    </main>
  );
}
