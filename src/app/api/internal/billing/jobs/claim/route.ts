import { NextRequest, NextResponse } from "next/server";
import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";
import { claimBillingJob } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isBillingWorkerAuthorized(request.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const worker = typeof body.worker === "string" ? body.worker.trim().slice(0, 120) : "";
  const leaseSeconds = Math.min(Math.max(Number(body.leaseSeconds || 120), 30), 600);
  const allowed = new Set(["CREATE_PROFORMA", "CREATE_INVOICE", "CREATE_CREDIT", "CREATE_CANCELLATION", "VOID_PROFORMA", "PROJECT_PAYMENT_SHOPIFY", "PROJECT_PAYMENT_EASYBILL", "SEND_CUSTOMER_DOCUMENT", "VERIFY_VAT", "RECONCILE"]);
  const jobTypes = Array.isArray(body.jobTypes) ? [...new Set(body.jobTypes.map(String).filter((value) => allowed.has(value)))].slice(0, 9) : [];
  if (worker.length < 3 || !jobTypes.length) return NextResponse.json({ ok: false, error: "worker_and_job_types_required" }, { status: 422 });
  try {
    const claimed = await claimBillingJob(worker, jobTypes, leaseSeconds);
    return NextResponse.json({ ok: true, claimed });
  } catch (error) {
    console.error("billing job claim failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "billing_job_claim_failed" }, { status: 500 });
  }
}
