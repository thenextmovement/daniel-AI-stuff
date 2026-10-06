import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getSalesCallFeedbackContext, recordSalesCallResult } from "@/lib/ops/customer-call-module";
import { FEEDBACK_PRESETS, validFeedbackDate, type FeedbackPreset } from "@/lib/ops/sales-call-feedback-contract";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
async function authorize(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return json({ ok: false, error: "ops_not_configured" }, 503);
  if (!isOpsPortalBypassed(host) && !await hasOpsSession(host, request.headers)) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}
function failure(error: unknown) {
  if (error instanceof QuoteValidationError) return json({ ok: false, error: error.message }, error.status);
  // A failed response does not prove that a write failed. Never invite a blind retry.
  return json({ ok: false, error: "Stand nicht sicher bestätigt. Bitte Vorgang neu laden und letztes Ergebnis prüfen." }, 503);
}
function requestId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new QuoteValidationError("Ungültige Vorgangs-ID.");
  return value;
}
export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const context = await getSalesCallFeedbackContext(requestId(request.nextUrl.searchParams.get("requestId")));
    return json({ ok: true, context });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const preset = body.preset as FeedbackPreset;
    if (!FEEDBACK_PRESETS.includes(preset)) throw new QuoteValidationError("Ergebnis auswählen.");
    if (!/^[a-f0-9]{64}$/.test(String(body.version || ""))) throw new QuoteValidationError("Aktuellen Vorgang zuerst laden.");
    if (typeof body.notes !== "string" || body.notes.trim().length < 3 || body.notes.length > 2000) throw new QuoteValidationError("Bitte eine kurze Gesprächsnotiz ergänzen.");
    if (typeof body.operatorName !== "string" || body.operatorName.trim().length < 2 || body.operatorName.length > 100) throw new QuoteValidationError("Bitte deinen Namen angeben.");
    if (["callback", "needs-time", "not-reached"].includes(preset) && !validFeedbackDate(body.callbackDate)) throw new QuoteValidationError("Gültigen Termin ab heute auswählen.");
    if (body.expectedLatestResultId !== null && (typeof body.expectedLatestResultId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.expectedLatestResultId))) throw new QuoteValidationError("Letztes Ergebnis fehlt.");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const result = await recordSalesCallResult({
      requestId: requestId(body.requestId), preset, notes: body.notes.trim(),
      callbackDate: body.callbackDate || null, expectedLatestResultId: body.expectedLatestResultId,
      postReminderDecision: preset === "not-reached" ? "manual_followup" : preset === "called-done" ? "finished" : null,
    }, {
      host, mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
      operatorName: body.operatorName.trim(), userAgent: request.headers.get("user-agent"),
    }, { feedbackVersion: body.version });
    return json({ ok: true, result: result.result, syncPending: "syncPending" in result ? result.syncPending : [] });
  } catch (error) { return failure(error); }
}
