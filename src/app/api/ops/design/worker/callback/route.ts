import { NextRequest, NextResponse } from "next/server";
import { applyDesignWorkerCallback } from "@/lib/ops/design";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function workerAuthorized(request: NextRequest) {
  const expected = process.env.DESIGN_WORKER_API_KEY;
  if (!expected) return false;
  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${expected}`;
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }

  console.error("ops design worker callback route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      jobId?: string;
      idempotencyKey?: string;
      status?: "generated" | "failed";
      asset?: {
        assetKey?: string | null;
        storageBucket?: string | null;
        storagePath?: string | null;
        publicUrl?: string | null;
        mimeType?: string | null;
        width?: number | null;
        height?: number | null;
        name?: string | null;
        trelloAttachmentId?: string | null;
      } | null;
      errorMessage?: string | null;
      workerRunId?: string | null;
    };
    if (body.status !== "generated" && body.status !== "failed") {
      throw new QuoteValidationError("status muss generated oder failed sein.");
    }
    const job = await applyDesignWorkerCallback({
      jobId: String(body.jobId || ""),
      idempotencyKey: String(body.idempotencyKey || ""),
      status: body.status,
      asset: body.asset || null,
      errorMessage: body.errorMessage || null,
      workerRunId: body.workerRunId || null,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return failureResponse(error);
  }
}
