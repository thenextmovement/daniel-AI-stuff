import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { prepareQuoteImageVariantDraft, type QuoteImageVariantType } from "@/lib/ops/design";
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

  console.error("ops design quote image variants route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const body = (await request.json()) as {
      quoteId?: string | null;
      quoteImageId?: string | null;
      quoteItemId?: string | null;
      variantType?: QuoteImageVariantType | null;
      variantValue?: string | null;
      sourceImageUrl?: string | null;
      sourceImageLabel?: string | null;
      operatorName?: string | null;
      idempotencyKey?: string | null;
    };

    const result = await prepareQuoteImageVariantDraft({
      quoteId: String(body.quoteId || ""),
      quoteImageId: String(body.quoteImageId || ""),
      quoteItemId: body.quoteItemId || null,
      variantType: body.variantType || "light_color",
      variantValue: String(body.variantValue || ""),
      sourceImageUrl: body.sourceImageUrl || null,
      sourceImageLabel: body.sourceImageLabel || null,
      operatorName: body.operatorName || null,
      idempotencyKey: body.idempotencyKey || null,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}
