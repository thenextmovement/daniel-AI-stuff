import { NextRequest, NextResponse } from "next/server";
import { isArrivalPrintWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, validatePrintWorkerId } from "@/lib/ops/arrival-labels/printing";
import { downloadPrivateArrivalArtifact, loadClaimedPrintArtifact } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ jobId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: Params) {
  if (!isArrivalPrintWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const { jobId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ ok: false, error: "invalid_job_id" }, { status: 400, headers: NO_STORE });
    }
    const workerId = validatePrintWorkerId(String(request.headers.get("x-neontrip-print-worker") || ""));
    const claimed = await loadClaimedPrintArtifact({ jobId, workerId });
    if (!claimed) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
    const bytes = await downloadPrivateArrivalArtifact(claimed.artifact);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Arrival-Document-Sha256": claimed.artifact.sha256,
      },
    });
  } catch (error) {
    console.error("arrival print document failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "document_failed", message: invalid ? error.message : "Druckdokument konnte nicht geladen werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
