import { NextRequest, NextResponse } from "next/server";
import { isArrivalLabelsRequestAuthorized } from "@/lib/ops/arrival-labels/auth";
import { PrintInputError, readBoundedJson } from "@/lib/ops/arrival-labels/printing";
import { validateArrivalReviewNotification, validateReviewWorkerId } from "@/lib/ops/arrival-labels/review-notifications";
import { claimArrivalReviewNotification } from "@/lib/ops/arrival-labels/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isArrivalLabelsRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const body = await readBoundedJson<{ workerId?: string }>(request);
    if (Object.keys(body).some((key) => key !== "workerId")) throw new PrintInputError("Request enthaelt unbekannte Felder.");
    const workerId = validateReviewWorkerId(String(body.workerId || ""));
    if (request.headers.get("x-neontrip-review-worker") !== workerId) throw new PrintInputError("Pruefmail-Worker-ID stimmt nicht ueberein.");
    const notification = await claimArrivalReviewNotification({ workerId });
    if (!notification) return NextResponse.json({ ok: true, hasNotification: false, notification: null }, { headers: NO_STORE });
    validateArrivalReviewNotification({
      notificationKey: notification.notification_key,
      recipientEmail: notification.recipient_email as "info@neontrip.de",
      subject: notification.subject,
      bodyText: notification.body_text,
      shopifyOrderUrl: notification.shopify_order_url,
    });
    return NextResponse.json({
      ok: true,
      hasNotification: true,
      notification: {
        id: notification.id,
        to: notification.recipient_email,
        subject: notification.subject,
        bodyText: notification.body_text,
        attempts: notification.attempts,
        maxAttempts: notification.max_attempts,
      },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("arrival review notification claim failed", { name: error instanceof Error ? error.name : "unknown" });
    const invalid = error instanceof PrintInputError;
    return NextResponse.json({
      ok: false,
      error: invalid ? "invalid_request" : "claim_failed",
      message: invalid ? error.message : "Pruefmail konnte nicht reserviert werden.",
    }, { status: invalid ? 400 : 500, headers: NO_STORE });
  }
}
