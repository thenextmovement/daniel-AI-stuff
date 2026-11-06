import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { requestBillingOpsInvoice } from "@/lib/ops/billing/repository";
import { parseBillingInvoiceRequest } from "@/lib/ops/billing/invoice-request";

import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const actor = await resolveOpsRequestActor(host, request.headers);
  if (!actor) return NextResponse.json({ ok: false, error: "personal_login_required" }, { status: 403 });
  const { caseId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) return NextResponse.json({ ok: false, error: "invalid_case_id" }, { status: 400 });
  const parsed = parseBillingInvoiceRequest(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ ok: false, error: "invalid_invoice_request" }, { status: 422 });
  try {
    const result = await requestBillingOpsInvoice({ ...parsed, caseId,
      // Preserve the authenticated transport identity; the gateway binds the delegated actor.
      actor: `${actor} / delegated:${parsed.actor}`,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof SupabaseRestError && typeof error.details === "string"
      ? error.details : error instanceof Error ? error.message : "";
    const code = message.match(/\bBILLING_(?:CASE_NOT_FOUND|ACTOR_REQUIRED|IDEMPOTENCY_REQUIRED|PORTAL_READ_ONLY|VAT_REVIEW_REQUIRED|INVOICE_[A-Z_]+)\b/)?.[0];
    return NextResponse.json({ ok: false, error: code || "billing_invoice_request_failed" }, { status: code ? 409 : 500 });
  }
}
