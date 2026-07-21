import { NextRequest, NextResponse } from "next/server";
import { isArrivalBrowserWorkerAuthorized } from "@/lib/ops/arrival-labels/auth";
import { validateBrowserWorkerId } from "@/lib/ops/arrival-labels/browser-purchase";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { claimArrivalBrowserPurchase } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isArrivalBrowserWorkerAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const body = await readBoundedJson<{ workerId?: string; mode?: string }>(request);
    const workerId = validateBrowserWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-browser-worker") !== workerId) throw new PrintInputError("Browser-Worker-ID stimmt nicht ueberein.");
    if (!['dry_run', 'live'].includes(String(body.mode))) throw new PrintInputError("Browser-Worker-Modus ist ungueltig.");
    if (body.mode === "dry_run") return new NextResponse(null, { status: 204, headers: NO_STORE });

    const job = await claimArrivalBrowserPurchase({ workerId });
    if (!job) return new NextResponse(null, { status: 204, headers: NO_STORE });
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        orderName: job.shopify_order_name,
        orderUrl: job.order_url,
        productLabel: job.easydpd_product_label,
        labelFormat: job.label_format,
        packageWeightGrams: job.package_weight_grams,
        maximumPurchaseCents: job.maximum_purchase_cents,
        incomingDhlTrackingNumber: job.incoming_dhl_tracking_number,
        incomingDhlLastSix: job.incoming_dhl_last_six,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        artifactPath: `/api/internal/arrival-labels/browser-purchases/${job.id}/artifact`,
        resultPath: `/api/internal/arrival-labels/browser-purchases/${job.id}/result`,
      },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival browser purchase claim failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json(
      { ok: false, error: invalid ? "invalid_request" : "claim_failed", message: invalid ? error.message : "Browser-Auftrag konnte nicht reserviert werden." },
      { status: invalid ? 400 : 500, headers: NO_STORE },
    );
  }
}
