import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  applySupplierTrelloEstimateToOffer,
  buildSupplierPricePredictionReviewDraftsFromAnchor,
  buildSupplierPricePredictionReviewDraftsFromTrainingItem,
  estimateSupplierPricesFromTrello,
  importSupplierQuoteTrainingCandidatesFromTrello,
  isSupplierPricePredictionAutomationAction,
  listSupplierQuoteTrainingItemAnchorReviews,
  listSupplierPricePredictionReviews,
  reviewSupplierQuoteTrainingItemAnchor,
  reviewSupplierPricePrediction,
  upsertSupplierPricePredictionReviewDrafts,
  type SupplierPricePredictionReviewDecision,
  type SupplierQuoteTrainingItemAnchorReviewDecision,
} from "@/lib/ops/supplier-price-review";
import type { UpdateActor } from "@/lib/ops/customer-records";
import {
  applyOfferSizeLadderToOffer,
  generateOfferSizeLadder,
  generateOfferSizeLadderFromTrello,
  ensureManualReleaseSizeLadder,
  listOfferSizeLadderDrafts,
  prepareQuoteReadySizeLadderPreflight,
  type OfferSizeLadderAnchorInput,
  type OfferSizeLadderProductModel,
} from "@/lib/ops/offer-size-ladder";
import { OpsOfferApiError } from "@/lib/ops/offers";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function forbidden() {
  return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  if (error instanceof OpsOfferApiError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }

  console.error("ops price-predictions route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function digest(value: string) {
  return createHash("sha256").update(`neontrip:supplier-price-review-agent:${value}`).digest("hex");
}

function tokenMatches(candidate: string, expected: string) {
  const left = Buffer.from(digest(candidate));
  const right = Buffer.from(digest(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function getAutomationToken(request: NextRequest, bodyToken?: string | null) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return String(bodyToken || request.headers.get("x-supplier-price-review-agent-token") || bearer || "").trim();
}

function hasSupplierPriceReviewAutomationAccess(request: NextRequest, bodyToken?: string | null) {
  const expected = String(process.env.SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN || "").trim();
  const candidate = getAutomationToken(request, bodyToken);
  return Boolean(expected && candidate && tokenMatches(candidate, expected));
}

function hasQuoteReadySizeLadderAutomationAccess(request: NextRequest, bodyToken?: string | null, action?: string | null) {
  if (!isQuoteReadySizeLadderAutomationAction(action)) return false;
  const candidate = getAutomationToken(request, bodyToken);
  if (!candidate) return false;
  return [
    process.env.SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN,
    process.env.OPS_INTERNAL_API_KEY,
    process.env.QUOTE_INTERNAL_API_TOKEN,
    process.env.SUPPLIER_SALES_AGENT_API_TOKEN,
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY,
    process.env.QUOTE_READY_SIZE_LADDER_AGENT_API_TOKEN,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .some((expected) => tokenMatches(candidate, expected));
}

function trimNullable(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

async function getActor(request: NextRequest, operatorName?: string | null): Promise<UpdateActor | null> {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return null;
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return null;
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
    userAgent: request.headers.get("user-agent"),
    operatorName: operatorName || null,
  };
}

function getAutomationActor(request: NextRequest, operatorName?: string | null): UpdateActor {
  return {
    host: getOpsHost(request),
    mode: "automation",
    userAgent: request.headers.get("user-agent"),
    operatorName: operatorName || "Supplier Price Review Agent",
  };
}

function isPricePredictionRouteAutomationAction(action: string | null | undefined) {
  return isSupplierPricePredictionAutomationAction(action) || isQuoteReadySizeLadderAutomationAction(action);
}

function isQuoteReadySizeLadderAutomationAction(action: string | null | undefined) {
  return action === "prepare_quote_ready_size_ladder" || action === "ensure_manual_release_size_ladder";
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const status = request.nextUrl.searchParams.get("status");
    const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
    const items = await listSupplierPricePredictionReviews({
      status: status === "all" || status === "reviewed" ? status : "pending",
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 250) : 100,
    });
    const anchorItems = await listSupplierQuoteTrainingItemAnchorReviews({
      status: status === "all" || status === "reviewed" ? status : "pending",
      limit: 100,
    });
    return NextResponse.json({ ok: true, items, anchorItems });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?:
          | "review"
          | "create_from_anchor"
          | "create_from_training_item"
          | "review_training_item_anchor"
          | "estimate_from_trello"
          | "apply_trello_estimate_to_offer"
          | "generate_offer_size_ladder"
          | "generate_offer_size_ladder_from_trello"
          | "prepare_quote_ready_size_ladder"
          | "ensure_manual_release_size_ladder"
          | "apply_offer_size_ladder_to_offer"
          | "list_offer_size_ladder_drafts"
          | "import_trello_training_candidates";
        predictionId?: string;
        decision?: SupplierPricePredictionReviewDecision;
        anchorDecision?: SupplierQuoteTrainingItemAnchorReviewDecision;
        note?: string | null;
        operatorName?: string | null;
        agentToken?: string | null;
        trainingItemAnchor?: {
          trainingItemId?: string;
          decision?: SupplierQuoteTrainingItemAnchorReviewDecision;
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
        };
        trainingItem?: {
          trainingItemId?: string;
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
        anchor?: {
          modelVersionId?: string;
          requestId?: string | null;
          trelloCardId?: string | null;
          designId?: string | null;
          sourceCode?: string | null;
          sourceLabel?: string | null;
          anchorTrainingItemId?: string | null;
          baseWidthCm?: number;
          baseHeightCm?: number;
          baseProductionPriceUsd?: number;
          baseShippingPriceUsd?: number;
          stepCm?: number;
          maxLongSideCm?: number;
          currency?: string | null;
          featureValues?: Record<string, unknown>;
        };
        estimate?: {
          trelloCard?: string | null;
          targetSizes?: string | null;
          currency?: string | null;
        };
        offerApply?: {
          trelloCard?: string | null;
          targetSize?: string | null;
          itemId?: string | null;
          dryRun?: boolean;
          revisionReason?: string | null;
          currency?: string | null;
        };
        sizeLadder?: {
          trelloCardId?: string | null;
          trelloCardUrl?: string | null;
          offerId?: string | null;
          offerItemId?: string | null;
          designId?: string | null;
          productModel?: string | null;
          sourceText?: string | null;
          stepCm?: number | string | null;
          maxLongSideCm?: number | string | null;
          customerFactor?: number | string | null;
          persist?: boolean;
          anchors?: Array<{
            role?: string | null;
            widthCm?: number | string | null;
            heightCm?: number | string | null;
            productionPrice?: number | string | null;
            shippingPrice?: number | string | null;
            currency?: string | null;
            source?: "trello_ocr" | "manual" | "supplier_form" | "custom_fields";
            confidence?: number | string | null;
            rawText?: string | null;
          }>;
        };
        sizeLadderFromTrello?: {
          trelloCard?: string | null;
          offerId?: string | null;
          offerItemId?: string | null;
          designId?: string | null;
          productModel?: string | null;
          sourceText?: string | null;
          stepCm?: number | string | null;
          maxLongSideCm?: number | string | null;
          customerFactor?: number | string | null;
          persist?: boolean;
          optionOverrides?: Array<{
            optionKey?: string | null;
            sizeLabel?: string | null;
            widthCm?: number | string | null;
            heightCm?: number | string | null;
            longSideCm?: number | string | null;
            customerUnitPriceNet?: number | string | null;
          }>;
        };
        quoteReadySizeLadder?: {
          trelloCard?: string | null;
          offerId?: string | null;
          offerItemId?: string | null;
          designId?: string | null;
          productModel?: string | null;
          sourceText?: string | null;
          stepCm?: number | string | null;
          maxLongSideCm?: number | string | null;
          customerFactor?: number | string | null;
          persist?: boolean;
          projectToTrello?: boolean;
          commentToTrello?: boolean;
        };
        sizeLadderOfferApply?: {
          trelloCard?: string | null;
          trelloCardId?: string | null;
          trelloCardUrl?: string | null;
          offerId?: string | null;
          offerItemId?: string | null;
          designId?: string | null;
          productModel?: string | null;
          sourceText?: string | null;
          stepCm?: number | string | null;
          maxLongSideCm?: number | string | null;
          customerFactor?: number | string | null;
          dryRun?: boolean;
          revisionReason?: string | null;
          anchors?: Array<{
            role?: string | null;
            widthCm?: number | string | null;
            heightCm?: number | string | null;
            productionPrice?: number | string | null;
            shippingPrice?: number | string | null;
            currency?: string | null;
            source?: "trello_ocr" | "manual" | "supplier_form" | "custom_fields";
            confidence?: number | string | null;
            rawText?: string | null;
          }>;
          optionOverrides?: Array<{
            optionKey?: string | null;
            sizeLabel?: string | null;
            widthCm?: number | string | null;
            heightCm?: number | string | null;
            longSideCm?: number | string | null;
            customerUnitPriceNet?: number | string | null;
          }>;
        };
        sizeLadderLookup?: {
          trelloCardId?: string | null;
          offerId?: string | null;
          offerItemId?: string | null;
          limit?: number | string | null;
        };
        trelloImport?: {
          trelloCards?: string | string[] | null;
          listId?: string | null;
          limit?: number | string | null;
          titleFilter?: string | null;
          currency?: string | null;
        };
      }
    | null;

  const host = getOpsHost(request);
  const opsActor = await getActor(request, body?.operatorName || null);
  const automationAllowed =
    hasSupplierPriceReviewAutomationAccess(request, body?.agentToken || null) ||
    hasQuoteReadySizeLadderAutomationAccess(request, body?.agentToken || null, body?.action);
  if (!opsActor && !automationAllowed && !isOpsPortalConfigured(host)) return notConfigured();
  if (!opsActor && automationAllowed && !isPricePredictionRouteAutomationAction(body?.action)) return forbidden();

  const actor =
    opsActor ||
    (automationAllowed && isPricePredictionRouteAutomationAction(body?.action)
      ? getAutomationActor(request, body?.operatorName || null)
      : null);
  if (!actor) {
    return unauthorized();
  }

  try {
    if (body?.action === "review") {
      const item = await reviewSupplierPricePrediction({
        predictionId: String(body.predictionId || ""),
        decision: body.decision || "supplier_check",
        note: body.note,
      }, actor);
      const items = await listSupplierPricePredictionReviews({ status: "pending", limit: 100 });
      const anchorItems = await listSupplierQuoteTrainingItemAnchorReviews({ status: "pending", limit: 100 });
      return NextResponse.json({ ok: true, item, items, anchorItems });
    }

    if (body?.action === "review_training_item_anchor") {
      const input = body.trainingItemAnchor || {};
      const result = await reviewSupplierQuoteTrainingItemAnchor({
        trainingItemId: String(input.trainingItemId || ""),
        decision: input.decision || body.anchorDecision || "supplier_check",
        note: input.note ?? body.note,
        corrections: input.corrections,
        stepCm: input.stepCm,
        maxLongSideCm: input.maxLongSideCm,
      }, actor);
      const items = await listSupplierPricePredictionReviews({ status: "pending", limit: 100 });
      const anchorItems = await listSupplierQuoteTrainingItemAnchorReviews({ status: "pending", limit: 100 });
      return NextResponse.json({
        ok: true,
        item: result.item,
        createdPredictionItems: result.createdPredictionItems,
        items,
        anchorItems,
      });
    }

    if (body?.action === "create_from_anchor") {
      const anchor = body.anchor || {};
      const drafts = buildSupplierPricePredictionReviewDraftsFromAnchor({
        modelVersionId: String(anchor.modelVersionId || ""),
        requestId: trimNullable(anchor.requestId),
        trelloCardId: trimNullable(anchor.trelloCardId),
        designId: trimNullable(anchor.designId),
        sourceCode: trimNullable(anchor.sourceCode),
        sourceLabel: trimNullable(anchor.sourceLabel),
        anchorTrainingItemId: trimNullable(anchor.anchorTrainingItemId),
        baseWidthCm: Number(anchor.baseWidthCm),
        baseHeightCm: Number(anchor.baseHeightCm),
        baseProductionPriceUsd: Number(anchor.baseProductionPriceUsd),
        baseShippingPriceUsd: Number(anchor.baseShippingPriceUsd),
        stepCm: anchor.stepCm,
        maxLongSideCm: anchor.maxLongSideCm,
        currency: anchor.currency,
        featureValues: {
          ...(anchor.featureValues || {}),
          created_by: actor.operatorName || actor.mode,
          created_from: "ops_price_prediction_anchor",
        },
      });
      const items = await upsertSupplierPricePredictionReviewDrafts(drafts);
      return NextResponse.json({ ok: true, items });
    }

    if (body?.action === "estimate_from_trello") {
      const estimate = await estimateSupplierPricesFromTrello({
        trelloCard: String(body.estimate?.trelloCard || ""),
        targetSizes: String(body.estimate?.targetSizes || ""),
        currency: trimNullable(body.estimate?.currency),
      });
      return NextResponse.json({ ok: true, estimate });
    }

    if (body?.action === "apply_trello_estimate_to_offer") {
      if (!opsActor) return forbidden();
      const applyResult = await applySupplierTrelloEstimateToOffer({
        trelloCard: String(body.offerApply?.trelloCard || ""),
        targetSize: String(body.offerApply?.targetSize || ""),
        itemId: trimNullable(body.offerApply?.itemId),
        dryRun: body.offerApply?.dryRun === true,
        revisionReason: trimNullable(body.offerApply?.revisionReason),
        operatorName: actor.operatorName || actor.mode,
        currency: trimNullable(body.offerApply?.currency),
      });
      return NextResponse.json({ ok: true, applyResult });
    }

    if (body?.action === "generate_offer_size_ladder") {
      if (!opsActor) return forbidden();
      const input = body.sizeLadder || {};
      const anchors = (input.anchors || []).map((anchor) => ({
        role: anchor.role,
        widthCm: Number(anchor.widthCm),
        heightCm: Number(anchor.heightCm),
        productionPrice: Number(anchor.productionPrice),
        shippingPrice: Number(anchor.shippingPrice),
        currency: trimNullable(anchor.currency),
        source: anchor.source || "manual",
        confidence: anchor.confidence === null || anchor.confidence === undefined ? null : Number(anchor.confidence),
        rawText: trimNullable(anchor.rawText),
      })) as OfferSizeLadderAnchorInput[];
      const sizeLadder = await generateOfferSizeLadder({
        trelloCardId: String(input.trelloCardId || ""),
        trelloCardUrl: trimNullable(input.trelloCardUrl),
        offerId: trimNullable(input.offerId),
        offerItemId: trimNullable(input.offerItemId),
        designId: trimNullable(input.designId),
        productModel: trimNullable(input.productModel) as OfferSizeLadderProductModel | null,
        sourceText: trimNullable(input.sourceText),
        stepCm: input.stepCm === null || input.stepCm === undefined ? undefined : Number(input.stepCm),
        maxLongSideCm: input.maxLongSideCm === null || input.maxLongSideCm === undefined ? undefined : Number(input.maxLongSideCm),
        customerFactor: input.customerFactor === null || input.customerFactor === undefined ? undefined : Number(input.customerFactor),
        createdBy: actor.operatorName || actor.mode,
        persist: input.persist === true,
        anchors,
      });
      return NextResponse.json({ ok: true, sizeLadder });
    }

    if (body?.action === "generate_offer_size_ladder_from_trello") {
      if (!opsActor) return forbidden();
      const input = body.sizeLadderFromTrello || {};
      const sizeLadder = await generateOfferSizeLadderFromTrello({
        trelloCard: String(input.trelloCard || ""),
        offerId: trimNullable(input.offerId),
        offerItemId: trimNullable(input.offerItemId),
        designId: trimNullable(input.designId),
        productModel: trimNullable(input.productModel) as OfferSizeLadderProductModel | null,
        sourceText: trimNullable(input.sourceText),
        stepCm: input.stepCm === null || input.stepCm === undefined ? undefined : Number(input.stepCm),
        maxLongSideCm: input.maxLongSideCm === null || input.maxLongSideCm === undefined ? undefined : Number(input.maxLongSideCm),
        customerFactor: input.customerFactor === null || input.customerFactor === undefined ? undefined : Number(input.customerFactor),
        optionOverrides: input.optionOverrides || [],
        createdBy: actor.operatorName || actor.mode,
        persist: input.persist === true,
      });
      return NextResponse.json({ ok: true, sizeLadder });
    }

    if (body?.action === "prepare_quote_ready_size_ladder") {
      const input = body.quoteReadySizeLadder || {};
      const quoteReadySizeLadder = await prepareQuoteReadySizeLadderPreflight({
        trelloCard: String(input.trelloCard || ""),
        offerId: trimNullable(input.offerId),
        offerItemId: trimNullable(input.offerItemId),
        designId: trimNullable(input.designId),
        productModel: trimNullable(input.productModel) as OfferSizeLadderProductModel | null,
        sourceText: trimNullable(input.sourceText),
        stepCm: input.stepCm === null || input.stepCm === undefined ? undefined : Number(input.stepCm),
        maxLongSideCm: input.maxLongSideCm === null || input.maxLongSideCm === undefined ? undefined : Number(input.maxLongSideCm),
        customerFactor: input.customerFactor === null || input.customerFactor === undefined ? undefined : Number(input.customerFactor),
        createdBy: actor.operatorName || actor.mode,
        persist: input.persist !== false,
        projectToTrello: input.projectToTrello !== false,
        commentToTrello: input.commentToTrello === true,
      });
      return NextResponse.json({ ok: true, quoteReadySizeLadder });
    }

    if (body?.action === "ensure_manual_release_size_ladder") {
      const input = body.quoteReadySizeLadder || {};
      const manualReleaseSizeLadder = await ensureManualReleaseSizeLadder({
        trelloCard: String(input.trelloCard || ""),
        offerId: trimNullable(input.offerId),
        offerItemId: trimNullable(input.offerItemId),
        designId: trimNullable(input.designId),
        productModel: trimNullable(input.productModel) as OfferSizeLadderProductModel | null,
        sourceText: trimNullable(input.sourceText),
        stepCm: input.stepCm === null || input.stepCm === undefined ? undefined : Number(input.stepCm),
        maxLongSideCm: input.maxLongSideCm === null || input.maxLongSideCm === undefined ? undefined : Number(input.maxLongSideCm),
        customerFactor: input.customerFactor === null || input.customerFactor === undefined ? undefined : Number(input.customerFactor),
        createdBy: actor.operatorName || actor.mode,
        persist: input.persist !== false,
        projectToTrello: input.projectToTrello !== false,
        commentToTrello: false,
      });
      return NextResponse.json({ ok: true, manualReleaseSizeLadder });
    }

    if (body?.action === "apply_offer_size_ladder_to_offer") {
      if (!opsActor) return forbidden();
      const input = body.sizeLadderOfferApply || {};
      const sizeLadderOfferApply = await applyOfferSizeLadderToOffer({
        trelloCard: String(input.trelloCard || ""),
        trelloCardId: trimNullable(input.trelloCardId),
        trelloCardUrl: trimNullable(input.trelloCardUrl),
        offerId: trimNullable(input.offerId),
        offerItemId: trimNullable(input.offerItemId),
        designId: trimNullable(input.designId),
        productModel: trimNullable(input.productModel) as OfferSizeLadderProductModel | null,
        sourceText: trimNullable(input.sourceText),
        stepCm: input.stepCm === null || input.stepCm === undefined ? undefined : Number(input.stepCm),
        maxLongSideCm: input.maxLongSideCm === null || input.maxLongSideCm === undefined ? undefined : Number(input.maxLongSideCm),
        customerFactor: input.customerFactor === null || input.customerFactor === undefined ? undefined : Number(input.customerFactor),
        dryRun: input.dryRun === true,
        revisionReason: trimNullable(input.revisionReason),
        anchors: (input.anchors || []).map((anchor) => ({
          role: anchor.role,
          widthCm: Number(anchor.widthCm),
          heightCm: Number(anchor.heightCm),
          productionPrice: Number(anchor.productionPrice),
          shippingPrice: Number(anchor.shippingPrice),
          currency: trimNullable(anchor.currency),
          source: anchor.source || "manual",
          confidence: anchor.confidence === null || anchor.confidence === undefined ? null : Number(anchor.confidence),
          rawText: trimNullable(anchor.rawText),
        })) as OfferSizeLadderAnchorInput[],
        optionOverrides: input.optionOverrides || [],
        createdBy: actor.operatorName || actor.mode,
        persist: false,
      });
      return NextResponse.json({ ok: true, sizeLadderOfferApply });
    }

    if (body?.action === "list_offer_size_ladder_drafts") {
      if (!opsActor) return forbidden();
      const lookup = body.sizeLadderLookup || {};
      const sizeLadderDrafts = await listOfferSizeLadderDrafts({
        trelloCardId: trimNullable(lookup.trelloCardId),
        offerId: trimNullable(lookup.offerId),
        offerItemId: trimNullable(lookup.offerItemId),
        limit: lookup.limit,
      });
      return NextResponse.json({ ok: true, sizeLadderDrafts });
    }

    if (body?.action === "import_trello_training_candidates") {
      if (!opsActor) return forbidden();
      const importResult = await importSupplierQuoteTrainingCandidatesFromTrello({
        trelloCards: body.trelloImport?.trelloCards,
        listId: trimNullable(body.trelloImport?.listId),
        limit: body.trelloImport?.limit,
        titleFilter: trimNullable(body.trelloImport?.titleFilter),
        currency: trimNullable(body.trelloImport?.currency),
      }, actor);
      const items = await listSupplierPricePredictionReviews({ status: "pending", limit: 100 });
      const anchorItems = await listSupplierQuoteTrainingItemAnchorReviews({ status: "pending", limit: 100 });
      return NextResponse.json({ ok: true, importResult, items, anchorItems });
    }

    if (body?.action === "create_from_training_item") {
      const input = body.trainingItem || {};
      const drafts = await buildSupplierPricePredictionReviewDraftsFromTrainingItem({
        trainingItemId: String(input.trainingItemId || ""),
        modelVersionId: trimNullable(input.modelVersionId),
        requestId: trimNullable(input.requestId),
        trelloCardId: trimNullable(input.trelloCardId),
        sourceCode: trimNullable(input.sourceCode),
        sourceLabel: trimNullable(input.sourceLabel),
        stepCm: input.stepCm,
        maxLongSideCm: input.maxLongSideCm,
        currency: input.currency,
        featureValues: {
          ...(input.featureValues || {}),
          created_by: actor.operatorName || actor.mode,
          created_from: "ops_price_prediction_training_item",
        },
      });
      const items = await upsertSupplierPricePredictionReviewDrafts(drafts);
      return NextResponse.json({ ok: true, items });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
