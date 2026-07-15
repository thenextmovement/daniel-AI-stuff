import { NextRequest, NextResponse } from "next/server";
import { cancelDesignBatch, getDesignBatch } from "@/lib/ops/design-batches";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof QuoteValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  if (error instanceof SupabaseRestError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error("ops design batch route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

async function authorized(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const authFailure = await authorized(request);
  if (authFailure) return authFailure;
  try {
    const { batchId } = await params;
    return NextResponse.json({ ok: true, batch: await getDesignBatch(batchId) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const authFailure = await authorized(request);
  if (authFailure) return authFailure;
  try {
    const { batchId } = await params;
    return NextResponse.json({ ok: true, batch: await cancelDesignBatch(batchId) });
  } catch (error) {
    return failure(error);
  }
}
