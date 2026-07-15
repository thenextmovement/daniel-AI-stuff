import { NextRequest, NextResponse } from "next/server";
import { processNextDesignBatchItem } from "@/lib/ops/design-batches";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function failure(error: unknown) {
  if (error instanceof QuoteValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  if (error instanceof SupabaseRestError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error("ops design batch process failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const { batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { operatorName?: string | null };
    const result = await processNextDesignBatchItem({ batchId, operatorName: body.operatorName || null });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}
