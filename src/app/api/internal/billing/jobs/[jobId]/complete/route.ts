import { NextRequest, NextResponse } from "next/server";
import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";
import { completeBillingJob } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  if (!isBillingWorkerAuthorized(request.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ ok: false, error: "invalid_job_id" }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const leaseToken = typeof body?.leaseToken === "string" ? body.leaseToken : "";
  const success = body?.success === true;
  const result = body?.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as Record<string, unknown> : {};
  const error = typeof body?.error === "string" ? body.error.slice(0, 2000) : null;
  if (!leaseToken || (!success && !error)) return NextResponse.json({ ok: false, error: "invalid_completion" }, { status: 422 });
  try {
    const completed = await completeBillingJob({ jobId, leaseToken, success, result, error });
    return NextResponse.json({ ok: true, completed });
  } catch (completionError) {
    const message = completionError instanceof Error ? completionError.message : "billing_job_complete_failed";
    const leaseError = message.includes("BILLING_JOB_LEASE_INVALID");
    console.error("billing job completion failed", { jobId, message });
    return NextResponse.json({ ok: false, error: leaseError ? message : "billing_job_complete_failed" }, { status: leaseError ? 409 : 500 });
  }
}
