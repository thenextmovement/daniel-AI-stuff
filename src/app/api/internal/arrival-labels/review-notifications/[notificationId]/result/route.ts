import { NextRequest, NextResponse } from "next/server";
import { isArrivalLabelsRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { validateReviewWorkerId } from "@/lib/ops/arrival-labels/review-notifications";
import { updateArrivalReviewNotification } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ notificationId: string }> };
type ReviewResult = "dispatching" | "sent" | "retryable_error" | "uncertain";
const RESULTS = new Set<ReviewResult>(["dispatching", "sent", "retryable_error", "uncertain"]);
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Params) {
  if (!isArrivalLabelsRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const { notificationId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
      return NextResponse.json({ ok: false, error: "invalid_notification_id" }, { status: 400, headers: NO_STORE });
    }
    const body = await readBoundedJson<{ workerId?: string; result?: ReviewResult; dispatchReceiptId?: string; error?: string }>(request);
    const allowed = new Set(["workerId", "result", "dispatchReceiptId", "error"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new PrintInputError("Request enthaelt unbekannte Felder.");
    const workerId = validateReviewWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-review-worker") !== workerId) throw new PrintInputError("Pruefmail-Worker-ID stimmt nicht ueberein.");
    if (!RESULTS.has(body.result as ReviewResult)) throw new PrintInputError("Ungueltiger Pruefmail-Status.");
    const dispatchReceiptId = String(body.dispatchReceiptId || "").trim();
    if (dispatchReceiptId && (dispatchReceiptId.length > 500 || /[\u0000-\u001f\u007f]/.test(dispatchReceiptId))) {
      throw new PrintInputError("Ungueltiger Dispatch-Beleg.");
    }
    const notification = await updateArrivalReviewNotification({
      notificationId,
      workerId,
      result: body.result as ReviewResult,
      dispatchReceiptId: dispatchReceiptId || null,
      error: String(body.error || "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 500) || null,
    });
    return NextResponse.json({ ok: true, status: notification.status }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival review notification result failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json({
      ok: false,
      error: invalid ? "invalid_request" : "result_failed",
      message: invalid ? error.message : "Pruefmail-Status konnte nicht gespeichert werden.",
    }, { status: invalid ? 400 : 500, headers: NO_STORE });
  }
}
