import { NextRequest, NextResponse } from "next/server";
import { listQueuedDesignJobsForWorker, markDesignJobGenerating } from "@/lib/ops/design";
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

  console.error("ops design worker jobs route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!workerAuthorized(request)) return unauthorized();

  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 5);
    const jobs = await listQueuedDesignJobsForWorker({ limit });
    return NextResponse.json({ ok: true, jobs });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      jobId?: string;
      workerRunId?: string | null;
    };
    const job = await markDesignJobGenerating({
      jobId: String(body.jobId || ""),
      workerRunId: body.workerRunId || null,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return failureResponse(error);
  }
}
