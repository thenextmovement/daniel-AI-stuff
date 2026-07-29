import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  CONTROL_TOWER_MOCKUP_CANARY_CONFIRMATION,
  ensureControlTowerMockupCanary,
} from "@/lib/ops/design";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
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
  console.error("ops design canary route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) {
    return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  }
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      idempotencyKey?: string | null;
      confirmation?: string | null;
      operatorName?: string | null;
    };
    if (String(body.confirmation || "") !== CONTROL_TOWER_MOCKUP_CANARY_CONFIRMATION) {
      throw new QuoteValidationError("Canary-Bestaetigung fehlt.", [], 400);
    }
    const provision = await ensureControlTowerMockupCanary({
      idempotencyKey: String(body.idempotencyKey || ""),
      confirmation: String(body.confirmation || ""),
      operatorName: body.operatorName || null,
    });
    return NextResponse.json({ ok: true, ...provision });
  } catch (error) {
    return failureResponse(error);
  }
}
