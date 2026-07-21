import { NextRequest, NextResponse } from "next/server";
import { isArrivalBrowserWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { validateBrowserPurchaseJobId, validateBrowserWorkerId, type BrowserPurchaseResult } from "@/lib/ops/arrival-labels/browser-purchase";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { updateArrivalBrowserPurchase } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ jobId: string }> };
const RESULTS = new Set<BrowserPurchaseResult>(["validated", "dispatching", "retryable_error", "uncertain"]);
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Params) {
  if (!isArrivalBrowserWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const { jobId: rawJobId } = await params;
    const jobId = validateBrowserPurchaseJobId(rawJobId);
    const body = await readBoundedJson<{ workerId?: string; result?: BrowserPurchaseResult; error?: string }>(request);
    const workerId = validateBrowserWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-browser-worker") !== workerId) throw new PrintInputError("Browser-Worker-ID stimmt nicht ueberein.");
    if (!RESULTS.has(body.result as BrowserPurchaseResult)) throw new PrintInputError("Browser-Ergebnis ist ungueltig.");
    const job = await updateArrivalBrowserPurchase({
      jobId,
      workerId,
      result: body.result as BrowserPurchaseResult,
      error: String(body.error || "").slice(0, 500) || null,
    });
    return NextResponse.json({ ok: true, status: job.status }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival browser purchase result failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "result_failed", message: invalid ? error.message : "Browser-Ergebnis konnte nicht gespeichert werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
