import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { createOpsInternalTask, listOpsInternalTasks, summarizeOpsInternalTasks, type OpsInternalTaskInput } from "@/lib/ops/internal-tasks";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }
  console.error("ops tasks route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function assertOpsAccess(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured(), host };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized(), host };
  }
  return { ok: true as const, host };
}

export async function GET(request: NextRequest) {
  const access = await assertOpsAccess(request);
  if (!access.ok) return access.response;

  try {
    const params = request.nextUrl.searchParams;
    const tasks = await listOpsInternalTasks({
      includeDone: params.get("includeDone") === "1",
      assigneeLabel: params.get("assignee") || null,
      requestId: params.get("requestId") || null,
      limit: Number(params.get("limit") || 80),
    });
    return NextResponse.json({ ok: true, tasks, summary: summarizeOpsInternalTasks(tasks) });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await assertOpsAccess(request);
  if (!access.ok) return access.response;

  try {
    const body = (await request.json()) as OpsInternalTaskInput & { operatorName?: string | null };
    const task = await createOpsInternalTask(body, { operatorName: body.operatorName || null });
    const tasks = await listOpsInternalTasks({ limit: 80 });
    return NextResponse.json({ ok: true, task, tasks, summary: summarizeOpsInternalTasks(tasks) });
  } catch (error) {
    return failureResponse(error);
  }
}
