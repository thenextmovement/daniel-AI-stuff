import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { listUndeliverableOfferCases, reviewUndeliverableCase, type UndeliverableStatus } from "@/lib/ops/undeliverable-offers";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function access(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return { ok: false as const, status: 503, error: "ops_not_configured" };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return { ok: false as const, status: 401, error: "unauthorized" };
  return { ok: true as const, actor: (await resolveOpsRequestActor(host, request.headers)) || "ops-session" };
}
function failure(error: unknown) {
  if (error instanceof SupabaseRestError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error("undeliverable offer route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}
export async function GET(request: NextRequest) {
  const auth = await access(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  try {
    const rawStatus = request.nextUrl.searchParams.get("status") || "all";
    const allowed = new Set(["all", "detected", "needs_research", "manual_review", "approved", "processing", "sent", "failed", "unknown", "dismissed"]);
    const status = (allowed.has(rawStatus) ? rawStatus : "all") as UndeliverableStatus | "all";
    const items = await listUndeliverableOfferCases({ status, limit: Number(request.nextUrl.searchParams.get("limit") || 100) });
    return NextResponse.json({ ok: true, items });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const auth = await access(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as { caseId?: string; decision?: string; note?: string; operatorName?: string; idempotencyKey?: string } | null;
  const note = body?.note?.trim() || "";
  const operatorName = body?.operatorName?.trim() || "";
  if (!body || !UUID.test(body.caseId || "") || !["approve", "dismiss"].includes(body.decision || "") || !UUID.test(body.idempotencyKey || "") || note.length < 8 || note.length > 2000 || operatorName.length < 2 || operatorName.length > 160) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  try {
    const result = await reviewUndeliverableCase({ caseId: body.caseId!, decision: body.decision as "approve" | "dismiss", note, actor: `${auth.actor}:${operatorName}`.slice(0, 200), idempotencyKey: body.idempotencyKey! });
    return NextResponse.json({ ok: true, result });
  } catch (error) { return failure(error); }
}
