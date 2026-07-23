import { NextRequest, NextResponse } from "next/server";
import { isArrivalBrowserWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { validateBrowserPurchaseJobId, validateBrowserWorkerId, type BrowserPurchaseResult } from "@/lib/ops/arrival-labels/browser-purchase";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { blockArrivalBrowserPurchaseForExistingLabel, updateArrivalBrowserPurchase } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ jobId: string }> };
const RESULTS = new Set<BrowserPurchaseResult>(["validated", "dispatching", "retryable_error", "uncertain", "existing_label"]);
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Params) {
  if (!isArrivalBrowserWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const { jobId: rawJobId } = await params;
    const jobId = validateBrowserPurchaseJobId(rawJobId);
    const body = await readBoundedJson<{
      workerId?: string;
      result?: BrowserPurchaseResult;
      error?: string;
      existingDpdTracking?: string;
      evidence?: { found?: boolean; labelCount?: number; trackingNumbers?: string[] };
    }>(request);
    const workerId = validateBrowserWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-browser-worker") !== workerId) throw new PrintInputError("Browser-Worker-ID stimmt nicht ueberein.");
    if (!RESULTS.has(body.result as BrowserPurchaseResult)) throw new PrintInputError("Browser-Ergebnis ist ungueltig.");
    const existingDpdTracking = String(body.existingDpdTracking || "");
    if (existingDpdTracking && !/^\d{11,20}$/.test(existingDpdTracking)) throw new PrintInputError("Vorhandene DPD-Sendungsnummer ist ungueltig.");
    const trackingNumbers = Array.isArray(body.evidence?.trackingNumbers) ? body.evidence.trackingNumbers.map(String) : [];
    if (trackingNumbers.length > 10 || trackingNumbers.some((entry) => !/^\d{11,20}$/.test(entry))) {
      throw new PrintInputError("EasyDPD-History-Evidenz ist ungueltig.");
    }
    const evidence = body.result === "existing_label" ? {
      found: body.evidence?.found === true,
      labelCount: Number.isInteger(body.evidence?.labelCount) ? Math.max(0, Math.min(20, Number(body.evidence?.labelCount))) : 0,
      trackingNumbers,
    } : null;
    if (body.result === "existing_label" && evidence?.found !== true) throw new PrintInputError("Vorhandenes EasyDPD-Label ist nicht belegt.");
    const job = body.result === "existing_label"
      ? await blockArrivalBrowserPurchaseForExistingLabel({
        jobId,
        workerId,
        existingDpdTracking: existingDpdTracking || null,
        evidence,
        error: String(body.error || "").slice(0, 500) || null,
      })
      : await updateArrivalBrowserPurchase({
        jobId,
        workerId,
        result: body.result as Exclude<BrowserPurchaseResult, "existing_label">,
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
