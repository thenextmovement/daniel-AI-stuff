import { NextRequest, NextResponse } from "next/server";
import { requestBillingPortalInvoice } from "@/lib/ops/billing/repository";
import { INVOICE_CONSENT_VERSION } from "@/lib/ops/billing/portal-invoice";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" };
const CONFLICTS = new Set([
  "BILLING_PORTAL_READ_ONLY", "BILLING_INVOICE_STALE", "BILLING_INVOICE_NOT_READY",
  "BILLING_VAT_REVIEW_REQUIRED", "BILLING_INVOICE_CHANGES_PENDING",
  "BILLING_INVOICE_JOBS_PENDING", "BILLING_INVOICE_PROFORMA_NOT_READY",
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !["confirmed", "consentVersion", "revision", "updatedAt"].includes(key))
    || body.confirmed !== true || body.consentVersion !== INVOICE_CONSENT_VERSION
    || !Number.isInteger(body.revision) || body.revision < 0
    || typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) {
    return NextResponse.json({ ok: false, error: "BILLING_INVOICE_CONSENT_REQUIRED" }, { status: 422, headers: NO_STORE });
  }
  try {
    const result = await requestBillingPortalInvoice({ token, ...body });
    return NextResponse.json({ ok: true, ...result }, { status: 202, headers: NO_STORE });
  } catch (error) {
    let code = "";
    if (error instanceof SupabaseRestError) {
      try {
        const details = typeof error.details === "string" ? JSON.parse(error.details) : error.details;
        code = String(details?.message || "");
      } catch { /* Never expose raw provider responses. */ }
    }
    const status = code === "BILLING_PORTAL_NOT_FOUND" ? 404
      : CONFLICTS.has(code) ? 409
      : ["BILLING_INVOICE_CONSENT_REQUIRED", "BILLING_INVOICE_DATA_INVALID"].includes(code) ? 422 : 503;
    return NextResponse.json({ ok: false, error: status === 503 ? "invoice_request_unavailable" : code }, { status, headers: NO_STORE });
  }
}
