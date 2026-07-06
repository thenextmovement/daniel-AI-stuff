import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { applyDesignRemovalPlan } from "@/lib/ops/design";
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

  console.error("ops design removal apply route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const { planId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      confirmText?: string | null;
      operatorName?: string | null;
    };
    const result = await applyDesignRemovalPlan({
      removalPlanId: planId,
      confirmText: String(body.confirmText || ""),
      operatorName: body.operatorName || null,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failureResponse(error);
  }
}
