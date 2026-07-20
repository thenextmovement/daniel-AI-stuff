import { NextRequest, NextResponse } from "next/server";
import { isArrivalPrintWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson, validatePrinterKey, validatePrintWorkerId } from "@/lib/ops/arrival-labels/printing";
import { claimArrivalPrintJob, loadActiveProductConfig } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isArrivalPrintWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const body = await readBoundedJson<{ workerId?: string; printerKey?: string }>(request);
    const workerId = validatePrintWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-print-worker") !== workerId) throw new PrintInputError("Print-Worker-ID stimmt nicht ueberein.");
    const printerKey = validatePrinterKey(String(body.printerKey || ""));
    const productConfig = await loadActiveProductConfig();
    if (!productConfig?.printerKey || productConfig.printerKey !== printerKey) throw new PrintInputError("Drucker ist nicht freigegeben.");
    const job = await claimArrivalPrintJob({ workerId, printerKey });
    if (!job) return new NextResponse(null, { status: 204, headers: NO_STORE });
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        printerKey: job.printer_key,
        sha256: job.document_sha256,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        documentPath: `/api/internal/arrival-labels/print-jobs/${job.id}/document`,
      },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival print claim failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "claim_failed", message: invalid ? error.message : "Druckauftrag konnte nicht reserviert werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
