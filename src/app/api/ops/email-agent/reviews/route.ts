import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import {
  listEmailAgentReviewCases,
  reviewEmailAgentFeedback,
  type EmailAgentLearningStatus,
  type EmailAgentReviewFilter,
  type EmailAgentReviewPriority,
} from "@/lib/ops/email-agent-review";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";

function getHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function hasAccess(request: NextRequest) {
  const host = getHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, status: 503, error: "ops_not_configured" };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  return { ok: true as const, actor: (await resolveOpsRequestActor(host, request.headers)) || "ops-session" };
}

function failure(error: unknown) {
  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }
  console.error("email agent review route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function reviewFilter(value: string | null): EmailAgentReviewFilter {
  if (["all", "pending", "approved", "rejected", "ignored", "awaiting_send"].includes(value || "")) {
    return value as EmailAgentReviewFilter;
  }
  return "pending";
}

function reviewPriority(value: string | null): EmailAgentReviewPriority | "all" {
  if (["low", "normal", "high"].includes(value || "")) return value as EmailAgentReviewPriority;
  return "all";
}

export async function GET(request: NextRequest) {
  const access = await hasAccess(request);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  try {
    const items = await listEmailAgentReviewCases({
      status: reviewFilter(request.nextUrl.searchParams.get("status")),
      priority: reviewPriority(request.nextUrl.searchParams.get("priority")),
      limit: Number(request.nextUrl.searchParams.get("limit") || 100),
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await hasAccess(request);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  const body = (await request.json().catch(() => null)) as {
    feedbackId?: number;
    decision?: EmailAgentLearningStatus;
    note?: string | null;
    operatorName?: string | null;
    idempotencyKey?: string | null;
  } | null;
  const note = body?.note?.trim() || "";
  const operatorName = body?.operatorName?.trim() || "";
  const idempotencyKey = body?.idempotencyKey?.trim() || "";
  if (
    !body
    || !Number.isInteger(body.feedbackId)
    || !["approved", "rejected", "ignored"].includes(body.decision || "")
    || note.length < 8
    || note.length > 2000
    || operatorName.length < 2
    || operatorName.length > 160
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
  ) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await reviewEmailAgentFeedback({
      feedbackId: body.feedbackId!,
      decision: body.decision as Exclude<EmailAgentLearningStatus, "pending">,
      note,
      reviewer: `${access.actor}:${operatorName}`.slice(0, 200),
      idempotencyKey,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}
