import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  completeCustomerInternalTask,
  createCustomerInternalTask,
  listCustomerInternalTasks,
  reopenCustomerInternalTask,
  updateCustomerInternalTask,
  type CustomerInternalTaskInput,
  type CustomerInternalTaskUpdateInput,
  type UpdateActor,
} from "@/lib/ops/customer-records";
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
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("ops customer-records tasks route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function trimNullable(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

async function getActor(request: NextRequest, operatorName?: string | null): Promise<UpdateActor | null> {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return null;
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return null;
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
    userAgent: request.headers.get("user-agent"),
    operatorName: operatorName || null,
  };
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const requestId = request.nextUrl.searchParams.get("requestId");
    const assigneeName = request.nextUrl.searchParams.get("assigneeName");
    const includeDone = request.nextUrl.searchParams.get("includeDone") === "true";
    const board = await listCustomerInternalTasks({ requestId, assigneeName, includeDone });
    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "create" | "update" | "complete" | "reopen";
        task?: CustomerInternalTaskInput;
        update?: CustomerInternalTaskUpdateInput;
        taskId?: string;
        clientActionId?: string | null;
        note?: string | null;
        operatorName?: string | null;
      }
    | null;
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  const actor = await getActor(request, body?.operatorName || null);
  if (!actor) return unauthorized();

  try {
    if (body?.action === "create") {
      const clientActionId =
        trimNullable(body.clientActionId) ||
        trimNullable(request.headers.get("x-client-action-id")) ||
        trimNullable(body.task?.clientActionId);
      const task = await createCustomerInternalTask(
        {
          ...(body.task || { title: "" }),
          clientActionId,
        },
        actor,
      );
      const board = await listCustomerInternalTasks({ includeDone: false });
      return NextResponse.json({ ok: true, action: body.action, task, board });
    }

    if (body?.action === "update") {
      const task = await updateCustomerInternalTask(body.update || { taskId: "" }, actor);
      const board = await listCustomerInternalTasks({ includeDone: false });
      return NextResponse.json({ ok: true, action: body.action, task, board });
    }

    if (body?.action === "complete") {
      const task = await completeCustomerInternalTask(String(body.taskId || ""), body.note, actor);
      const board = await listCustomerInternalTasks({ includeDone: false });
      return NextResponse.json({ ok: true, action: body.action, task, board });
    }

    if (body?.action === "reopen") {
      const task = await reopenCustomerInternalTask(String(body.taskId || ""), body.note, actor);
      const board = await listCustomerInternalTasks({ includeDone: false });
      return NextResponse.json({ ok: true, action: body.action, task, board });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
