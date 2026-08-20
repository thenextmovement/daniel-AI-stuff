import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import {
  adjudicateRequestSegmentationGold,
  combineRequestSegmentationGoldActor,
  getRequestSegmentationBlindReviewContext,
  toRequestSegmentationBlindReviewPayload,
} from "@/lib/ops/request-segmentation-gold";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function hostFor(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function privateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

async function authorize(request: NextRequest) {
  const host = hostFor(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: privateNoStore(NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 })) };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: privateNoStore(NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })) };
  }
  return {
    ok: true as const,
    actor: (await resolveOpsRequestActor(host, request.headers)) || "ops-session",
  };
}

function failure(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return privateNoStore(NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status }));
  }
  if (error instanceof SupabaseRestError) {
    return privateNoStore(NextResponse.json({ ok: false, error: error.message }, { status: error.status }));
  }
  console.error("ops segment gold route failed", error);
  return privateNoStore(NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 }));
}

export async function GET(request: NextRequest) {
  const authorization = await authorize(request);
  if (!authorization.ok) return authorization.response;
  try {
    const context = await getRequestSegmentationBlindReviewContext(request.nextUrl.searchParams.get("requestId") || "");
    return privateNoStore(NextResponse.json({
      ok: true,
      context: toRequestSegmentationBlindReviewPayload(context),
    }));
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
    const operatorName = typeof body.operatorName === "string" ? body.operatorName.trim() : "";
    if (operatorName.length < 3 || operatorName.length > 160) {
      throw new QuoteValidationError(
        "Bearbeiter fuer die Gold-Adjudication muss 3 bis 160 Zeichen lang sein.",
        ["Es wurde kein Gold geschrieben."],
        422,
      );
    }
    const result = await adjudicateRequestSegmentationGold({
      publicRequestId: typeof body.requestId === "string" ? body.requestId : "",
      inputHash: typeof body.inputHash === "string" ? body.inputHash : "",
      segment: typeof body.segment === "string" ? body.segment : "",
      contextTags: (body.contextTags || []) as string[],
      organizationScale: typeof body.organizationScale === "string" ? body.organizationScale : null,
      actor: combineRequestSegmentationGoldActor(authorization.actor, operatorName),
      reason: typeof body.reason === "string" ? body.reason : "",
      evidenceUrls: (body.evidenceUrls || []) as string[],
    });
    return privateNoStore(NextResponse.json({ ok: true, result }));
  } catch (error) {
    return failure(error);
  }
}
