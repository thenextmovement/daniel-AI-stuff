import { NextRequest, NextResponse } from "next/server";
import { isArrivalPrintWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson, validatePrintWorkerId } from "@/lib/ops/arrival-labels/printing";
import { confirmArrivalPrintCompletion } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ jobId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Params) {
  if (!isArrivalPrintWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const { jobId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ ok: false, error: "invalid_job_id" }, { status: 400, headers: NO_STORE });
    }
    const body = await readBoundedJson<{ workerId?: string; cupsJobId?: string }>(request);
    const workerId = validatePrintWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-print-worker") !== workerId) throw new PrintInputError("Print-Worker-ID stimmt nicht ueberein.");
    const cupsJobId = String(body.cupsJobId || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}-\d+$/.test(cupsJobId)) {
      return NextResponse.json({ ok: false, error: "invalid_cups_job_id" }, { status: 400, headers: NO_STORE });
    }
    const job = await confirmArrivalPrintCompletion({ jobId, workerId, cupsJobId });
    return NextResponse.json({ ok: true, status: job.status, cupsJobId: job.cups_job_id }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival print confirmation failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "confirmation_failed", message: invalid ? error.message : "CUPS-Druckabschluss konnte nicht bestaetigt werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
