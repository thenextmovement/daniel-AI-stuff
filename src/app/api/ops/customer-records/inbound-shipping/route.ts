import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  createInboundIncidentTask,
  listInboundBoard,
  markInboundShipmentOutForDelivery,
  updateInboundIncidentStatus,
  type InboundCarrier,
} from "@/lib/ops/inbound-shipping";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const INBOUND_SCOPE_VALUES = ["moving", "active", "problems", "label_created", "all"] as const;
const INBOUND_CARRIER_FILTER_VALUES = ["all", "dhl", "fedex", "other", "unknown"] as const;
const OPS_JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Cf-Access-Jwt-Assertion",
};

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: OPS_JSON_HEADERS });
}

function unauthorized() {
  return jsonResponse({ ok: false, error: "unauthorized" }, 401);
}

function notConfigured() {
  return jsonResponse({ ok: false, error: "ops_not_configured" }, 503);
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return jsonResponse({ ok: false, error: error.message, issues: error.issues }, error.status);
  }
  if (error instanceof SupabaseRestError) {
    console.error("ops customer-records inbound-shipping supabase request failed", { status: error.status, details: error.details });
    return jsonResponse({ ok: false, error: error.message }, error.status);
  }
  console.error("ops customer-records inbound-shipping route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, 500);
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function parseScopeFilter(value: string | null) {
  const scope = value || "active";
  if (!INBOUND_SCOPE_VALUES.includes(scope as (typeof INBOUND_SCOPE_VALUES)[number])) {
    throw new QuoteValidationError("Ungueltiger Wareneingang-Filter.", [`scope=${scope} ist nicht unterstuetzt.`], 400);
  }
  return scope as (typeof INBOUND_SCOPE_VALUES)[number];
}

function parseCarrierFilter(value: string | null) {
  const carrier = value || "all";
  if (!INBOUND_CARRIER_FILTER_VALUES.includes(carrier as (typeof INBOUND_CARRIER_FILTER_VALUES)[number])) {
    throw new QuoteValidationError("Ungueltiger Carrier-Filter.", [`carrier=${carrier} ist nicht unterstuetzt.`], 400);
  }
  return carrier as InboundCarrier | "all";
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
    const carrier = parseCarrierFilter(request.nextUrl.searchParams.get("carrier"));
    const scope = parseScopeFilter(request.nextUrl.searchParams.get("scope"));
    const requestId = request.nextUrl.searchParams.get("requestId");
    const board = await listInboundBoard({ carrier, scope, requestId });
    return jsonResponse({ ok: true, board });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "create_task" | "acknowledge" | "resolve" | "ignore" | "mark_out_for_delivery";
        incidentId?: string;
        shipmentId?: string;
        operatorName?: string | null;
        scope?: string | null;
        carrier?: string | null;
        requestId?: string | null;
      }
    | null;

  const actor = await getActor(request, body?.operatorName || null);
  if (!actor) return unauthorized();

  try {
    const boardFilter = {
      scope: parseScopeFilter(body?.scope || null),
      carrier: parseCarrierFilter(body?.carrier || null),
      requestId: body?.requestId || null,
    };
    if (body?.action === "create_task") {
      const result = await createInboundIncidentTask(String(body.incidentId || ""), actor);
      const board = await listInboundBoard(boardFilter);
      console.info("inbound shipping incident action completed", { action: body.action, incidentId: body.incidentId || null, taskId: result.taskId, created: result.created, mode: actor.mode });
      return jsonResponse({ ok: true, action: body.action, result, board });
    }
    if (body?.action === "acknowledge") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "acknowledged");
      const board = await listInboundBoard(boardFilter);
      console.info("inbound shipping incident action completed", { action: body.action, incidentId: incident.id, mode: actor.mode });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "resolve") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "resolved");
      const board = await listInboundBoard(boardFilter);
      console.info("inbound shipping incident action completed", { action: body.action, incidentId: incident.id, mode: actor.mode });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "ignore") {
      const incident = await updateInboundIncidentStatus(String(body.incidentId || ""), "ignored");
      const board = await listInboundBoard(boardFilter);
      console.info("inbound shipping incident action completed", { action: body.action, incidentId: incident.id, mode: actor.mode });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "mark_out_for_delivery") {
      const result = await markInboundShipmentOutForDelivery(String(body.shipmentId || ""), actor);
      const board = await listInboundBoard(boardFilter);
      console.info("inbound shipping shipment action completed", { action: body.action, shipmentId: body.shipmentId || null, mode: actor.mode });
      return jsonResponse({ ok: true, action: body.action, result, board });
    }
    return jsonResponse({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    return failureResponse(error);
  }
}
