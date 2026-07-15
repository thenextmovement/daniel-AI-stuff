import { NextRequest, NextResponse } from "next/server";
import { createDesignBatch } from "@/lib/ops/design-batches";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof QuoteValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  if (error instanceof SupabaseRestError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error("ops design batch create failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as {
      idempotencyKey?: string;
      query?: string;
      actionType?: "light_color" | "product_change";
      actionValue?: string;
      attachmentIds?: string[];
      replaceTrello?: boolean;
      operatorName?: string | null;
    };
    const batch = await createDesignBatch({
      idempotencyKey: String(body.idempotencyKey || ""),
      query: String(body.query || ""),
      actionType: body.actionType as "light_color" | "product_change",
      actionValue: String(body.actionValue || ""),
      attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [],
      replaceTrello: Boolean(body.replaceTrello),
      operatorName: body.operatorName || null,
    });
    return NextResponse.json({ ok: true, batch }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
