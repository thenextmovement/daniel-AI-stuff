import { NextRequest, NextResponse } from "next/server";
import { getBillingPortal, submitBillingPortalChange } from "@/lib/ops/billing/repository";
import { sanitizePortalChangeBody } from "@/lib/ops/billing/portal-change";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" };

function validToken(token: string) {
  return /^[A-Za-z0-9_-]{40,100}$/.test(token);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const portal = await getBillingPortal(token).catch(() => null);
  if (!portal) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ ok: true, ...portal }, { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const portal = await getBillingPortal(token).catch(() => null);
  if (!portal) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  if (portal.readOnly) return NextResponse.json({ ok: false, error: "invoice_already_created" }, { status: 409, headers: NO_STORE });
  const body = await request.json().catch(() => null);
  let sanitized: ReturnType<typeof sanitizePortalChangeBody>;
  try {
    sanitized = sanitizePortalChangeBody(body);
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_portal_change";
    return NextResponse.json({ ok: false, error: code }, { status: code === "no_allowed_changes" ? 422 : 400, headers: NO_STORE });
  }
  try {
    const result = await submitBillingPortalChange({
      token,
      changes: sanitized.changes,
      requesterEmail: sanitized.requesterEmail,
      idempotencyKey: request.headers.get("idempotency-key") || request.headers.get("x-request-id") || undefined,
    });
    return NextResponse.json({ ok: true, changeRequest: result }, { status: 202, headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "portal_change_failed";
    const status = message.includes("READ_ONLY") ? 409 : message.includes("NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ ok: false, error: status === 500 ? "portal_change_failed" : message }, { status, headers: NO_STORE });
  }
}
