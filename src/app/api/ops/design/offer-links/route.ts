import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { linkDesignAssetToOffer } from "@/lib/ops/design";
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

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }

  if (error instanceof OpsOfferApiError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues, code: error.code }, { status: error.status });
  }

  console.error("ops design offer link route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      assetId?: string;
      offerId?: string;
      offerImageId?: string | null;
      offerItemId?: string | null;
      lightColorLabel?: string | null;
      productChangeLabel?: string | null;
      reviewedUnitPriceNet?: number | null;
      priceReviewConfirmed?: boolean | null;
      expectedUpdatedAt?: string | null;
      operatorName?: string | null;
      dryRun?: boolean | null;
    };
    const result = await linkDesignAssetToOffer({
      assetId: String(body.assetId || ""),
      offerId: String(body.offerId || ""),
      offerImageId: body.offerImageId || null,
      offerItemId: body.offerItemId || null,
      lightColorLabel: body.lightColorLabel || null,
      productChangeLabel: body.productChangeLabel || null,
      reviewedUnitPriceNet: body.reviewedUnitPriceNet ?? null,
      priceReviewConfirmed: Boolean(body.priceReviewConfirmed),
      expectedUpdatedAt: body.expectedUpdatedAt || null,
      operatorName: body.operatorName || null,
      dryRun: Boolean(body.dryRun),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}
