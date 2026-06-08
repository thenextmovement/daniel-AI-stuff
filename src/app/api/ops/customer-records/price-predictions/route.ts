import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  buildSupplierPricePredictionReviewDraftsFromAnchor,
  buildSupplierPricePredictionReviewDraftsFromTrainingItem,
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
        action?: "review" | "create_from_anchor" | "create_from_training_item" | "review_training_item_anchor";
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
      }
    | null;

  const host = getOpsHost(request);
  const opsActor = await getActor(request, body?.operatorName || null);
  const automationAllowed = hasSupplierPriceReviewAutomationAccess(request, body?.agentToken || null);
  if (!opsActor && !automationAllowed && !isOpsPortalConfigured(host)) return notConfigured();
  if (!opsActor && automationAllowed && !isSupplierPricePredictionAutomationAction(body?.action)) return forbidden();

  const actor =
    opsActor ||
    (automationAllowed && isSupplierPricePredictionAutomationAction(body?.action)
      ? getAutomationActor(request, body?.operatorName || null)
      : null);
  if (!actor) return unauthorized();

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
