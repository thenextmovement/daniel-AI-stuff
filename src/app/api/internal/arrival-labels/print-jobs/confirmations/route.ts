import { NextRequest, NextResponse } from "next/server";
import { isArrivalPrintWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson, validatePrinterKey, validatePrintWorkerId } from "@/lib/ops/arrival-labels/printing";
import { loadActiveProductConfig, loadArrivalPrintConfirmationCandidates } from "@/lib/ops/arrival-labels/repository";

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
    const approvedPrinters = new Set([productConfig?.printerKey, productConfig?.deliveryNotePrinterKey].filter(Boolean));
    if (!approvedPrinters.has(printerKey)) throw new PrintInputError("Drucker ist nicht freigegeben.");
    const jobs = await loadArrivalPrintConfirmationCandidates({ workerId, printerKey });
    return NextResponse.json({
      ok: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        documentKind: job.document_kind,
        printerKey: job.printer_key,
        cupsJobId: job.cups_job_id,
      })),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival print confirmation list failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "confirmation_list_failed", message: invalid ? error.message : "Offene CUPS-Bestaetigungen konnten nicht geladen werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
