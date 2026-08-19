import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  adjudicateRequestSegmentationGold,
  getRequestSegmentationReviewContext,
} from "@/lib/ops/request-segmentation-gold";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function hostFor(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = hostFor(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 }) };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function failure(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error("ops segment gold route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const authorization = await authorize(request);
  if (!authorization.ok) return authorization.response;
  try {
    const context = await getRequestSegmentationReviewContext(request.nextUrl.searchParams.get("requestId") || "");
    return NextResponse.json({ ok: true, context });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorize(request);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await request.json() as {
      requestId?: unknown;
      inputHash?: unknown;
      segment?: unknown;
      contextTags?: unknown;
      organizationScale?: unknown;
      operatorName?: unknown;
      reason?: unknown;
      evidenceUrls?: unknown;
    };
    if (body.contextTags != null && (!Array.isArray(body.contextTags) || body.contextTags.some((entry) => typeof entry !== "string"))) {
      throw new QuoteValidationError("Kontext-Tags haben ein ungueltiges Format.");
    }
    if (body.evidenceUrls != null && (!Array.isArray(body.evidenceUrls) || body.evidenceUrls.some((entry) => typeof entry !== "string"))) {
      throw new QuoteValidationError("Evidence-URLs haben ein ungueltiges Format.");
    }
    if (body.organizationScale != null && typeof body.organizationScale !== "string") {
      throw new QuoteValidationError("Organisationsgroesse hat ein ungueltiges Format.");
    }
    const result = await adjudicateRequestSegmentationGold({
      publicRequestId: typeof body.requestId === "string" ? body.requestId : "",
      inputHash: typeof body.inputHash === "string" ? body.inputHash : "",
      segment: typeof body.segment === "string" ? body.segment : "",
      contextTags: (body.contextTags || []) as string[],
      organizationScale: typeof body.organizationScale === "string" ? body.organizationScale : null,
      actor: typeof body.operatorName === "string" ? body.operatorName : "",
      reason: typeof body.reason === "string" ? body.reason : "",
      evidenceUrls: (body.evidenceUrls || []) as string[],
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}
