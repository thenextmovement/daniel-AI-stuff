import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  createInboundIncidentTask,
  listInboundBoard,
  updateInboundIncidentStatus,
  type InboundCarrier,
} from "@/lib/ops/inbound-shipping";
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
  console.error("ops customer-records inbound-shipping route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function getActor(request: NextRequest, operatorName?: string | null) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return null;
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return null;
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" as const : "ops_session" as const,
    userAgent: request.headers.get("user-agent"),
    operatorName: operatorName || null,
  };
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const carrier = (request.nextUrl.searchParams.get("carrier") || "all") as InboundCarrier | "all";
    const scope = (request.nextUrl.searchParams.get("scope") || "problems") as "active" | "problems" | "all";
    const board = await listInboundBoard({ carrier, scope });
    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "create_task" | "acknowledge" | "resolve" | "ignore";
        incidentId?: string;
        operatorName?: string | null;
      }
    | null;

  const actor = await getActor(request, body?.operatorName || null);
  if (!actor) return unauthorized();

  try {
    if (body?.action === "create_task") {
      const result = await createInboundIncidentTask(String(body.incidentId || ""), actor);
      const board = await listInboundBoard({ scope: "problems" });
      return NextResponse.json({ ok: true, action: body.action, result, board });
    }
    if (body?.action === "acknowledge") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "acknowledged");
      const board = await listInboundBoard({ scope: "problems" });
      return NextResponse.json({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "resolve") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "resolved");
      const board = await listInboundBoard({ scope: "problems" });
      return NextResponse.json({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "ignore") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "ignored");
      const board = await listInboundBoard({ scope: "problems" });
      return NextResponse.json({ ok: true, action: body.action, incident, board });
    }
    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
