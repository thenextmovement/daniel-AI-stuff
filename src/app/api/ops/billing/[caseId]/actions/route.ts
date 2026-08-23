import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { applyBillingOpsAction, decideBillingChangeRequest, saveBillingChangeDraft, type BillingOpsAction } from "@/lib/ops/billing/repository";
import { sanitizePortalChangeBody } from "@/lib/ops/billing/portal-change";

export const dynamic = "force-dynamic";

const BILLING_ACTIONS = new Set<BillingOpsAction>(["SET_PAYMENT_METHOD", "CONFIRM_VAT", "APPLY_CHANGE_REQUEST", "REJECT_CHANGE_REQUEST", "SAVE_CHANGE_REQUEST_DRAFT", "CREATE_PROFORMA", "MARK_PAID", "MARK_DELIVERED", "CREATE_INVOICE"]);

function parseActionBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const action = String(input.action || "") as BillingOpsAction;
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : {};
  if (!BILLING_ACTIONS.has(action) || idempotencyKey.length < 8 || idempotencyKey.length > 200) return null;
  return { action, payload, idempotencyKey };
}

async function billingActor(request: NextRequest, host?: string | null) {
  return resolveOpsRequestActor(host, request.headers);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { caseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return NextResponse.json({ ok: false, error: "invalid_case_id" }, { status: 400 });
  const parsed = parseActionBody(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 422 });
  const actor = await billingActor(request, host);
  if (!actor) return NextResponse.json({ ok: false, error: "personal_login_required" }, { status: 403 });
  try {
    const changeRequestId = typeof parsed.payload.changeRequestId === "string" ? parsed.payload.changeRequestId : "";
    if (["SAVE_CHANGE_REQUEST_DRAFT", "APPLY_CHANGE_REQUEST", "REJECT_CHANGE_REQUEST"].includes(parsed.action) && !/^[0-9a-f-]{36}$/i.test(changeRequestId)) {
      return NextResponse.json({ ok: false, error: "invalid_change_request_id" }, { status: 422 });
    }
    let result: Record<string, unknown>;
    if (parsed.action === "SAVE_CHANGE_REQUEST_DRAFT") {
      const changes = sanitizePortalChangeBody(parsed.payload.changes).changes;
      result = await saveBillingChangeDraft({ caseId, changeRequestId, changes, actor, idempotencyKey: parsed.idempotencyKey });
    } else if (parsed.action === "APPLY_CHANGE_REQUEST" || parsed.action === "REJECT_CHANGE_REQUEST") {
      const approvedChanges = parsed.action === "APPLY_CHANGE_REQUEST" && parsed.payload.approvedChanges
        ? sanitizePortalChangeBody(parsed.payload.approvedChanges).changes
        : undefined;
      result = await decideBillingChangeRequest({
        caseId,
        changeRequestId,
        decision: parsed.action === "APPLY_CHANGE_REQUEST" ? "APPLY" : "REJECT",
        approvedChanges,
        note: typeof parsed.payload.note === "string" ? parsed.payload.note : "",
        actor,
        idempotencyKey: parsed.idempotencyKey,
      });
    } else {
      result = await applyBillingOpsAction({ caseId, action: parsed.action, payload: parsed.payload, actor, idempotencyKey: parsed.idempotencyKey });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_action_failed";
    const expected = /BILLING_(CASE|VAT|TAX|CHANGE|TERMS|PAYMENT|ACTION|ACTOR|IDEMPOTENCY)/.test(message);
    console.error("billing action failed", { caseId, action: parsed.action, actor, message });
    return NextResponse.json({ ok: false, error: expected ? message : "billing_action_failed" }, { status: expected ? 409 : 500 });
  }
}
