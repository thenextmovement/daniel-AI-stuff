import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  createShippingIncidentTask,
  evaluateShippingShipment,
  listShippingBoard,
  recordShippingTrackingEvent,
  updateShippingIncidentStatus,
  upsertShippingShipment,
  type CarrierEventInput,
  type ShippingCarrier,
  type ShippingShipmentInput,
} from "@/lib/ops/shipping";
import {
  claimPendingShippingNotifications,
  enqueueShippingNotifications,
  markShippingNotificationFailed,
  markShippingNotificationSent,
} from "@/lib/ops/shipping-notifications";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const SHIPPING_SCOPE_VALUES = ["moving", "active", "problems", "label_created", "all"] as const;
const SHIPPING_CARRIER_FILTER_VALUES = ["all", "dpd", "dhl"] as const;
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
    console.error("ops customer-records shipping supabase request failed", { status: error.status, details: error.details });
    return jsonResponse({ ok: false, error: error.message }, error.status);
  }
  console.error("ops customer-records shipping route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, 500);
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function digest(value: string) {
  return createHash("sha256").update(`neontrip:shipping-agent:${value}`).digest("hex");
}

function tokenMatches(candidate: string, expected: string) {
  const left = Buffer.from(digest(candidate));
  const right = Buffer.from(digest(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function getAutomationToken(request: NextRequest, bodyToken?: string | null) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return String(bodyToken || request.headers.get("x-shipping-agent-token") || bearer || "").trim();
}

function parseScopeFilter(value: string | null) {
  const scope = value || "active";
  if (!SHIPPING_SCOPE_VALUES.includes(scope as (typeof SHIPPING_SCOPE_VALUES)[number])) {
    throw new QuoteValidationError("Ungueltiger Versand-Filter.", [`scope=${scope} ist nicht unterstuetzt.`], 400);
  }
  return scope as (typeof SHIPPING_SCOPE_VALUES)[number];
}

function parseCarrierFilter(value: string | null) {
  const carrier = value || "all";
  if (!SHIPPING_CARRIER_FILTER_VALUES.includes(carrier as (typeof SHIPPING_CARRIER_FILTER_VALUES)[number])) {
    throw new QuoteValidationError("Ungueltiger Carrier-Filter.", [`carrier=${carrier} ist nicht unterstuetzt.`], 400);
  }
  return carrier as ShippingCarrier | "all";
}

function hasShippingAutomationAccess(request: NextRequest, bodyToken?: string | null) {
  const expected = String(process.env.SHIPPING_AGENT_API_TOKEN || process.env.QUOTE_INTERNAL_API_TOKEN || "").trim();
  const candidate = getAutomationToken(request, bodyToken);
  return Boolean(expected && candidate && tokenMatches(candidate, expected));
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

async function getActorOrAutomation(request: NextRequest, operatorName?: string | null, agentToken?: string | null) {
  const actor = await getActor(request, operatorName);
  if (actor) return actor;
  if (hasShippingAutomationAccess(request, agentToken)) {
    return {
      host: getOpsHost(request),
      mode: "ops_session" as const,
      userAgent: request.headers.get("user-agent"),
      operatorName: operatorName || "Shipping Agent",
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const requestId = request.nextUrl.searchParams.get("requestId");
    const carrier = parseCarrierFilter(request.nextUrl.searchParams.get("carrier"));
    const scope = parseScopeFilter(request.nextUrl.searchParams.get("scope"));
    const board = await listShippingBoard({ requestId, carrier, scope });
    return jsonResponse({ ok: true, board });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?:
          | "upsert_shipment"
          | "record_event"
          | "evaluate_shipment"
          | "create_task"
          | "acknowledge"
          | "resolve"
          | "ignore"
          | "enqueue_notifications"
          | "claim_notifications"
          | "mark_notification_sent"
          | "mark_notification_failed";
        shipment?: ShippingShipmentInput;
        event?: CarrierEventInput;
        shipmentId?: string;
        incidentId?: string;
        notificationId?: string;
        providerMessageId?: string | null;
        notificationError?: string | null;
        limit?: number | null;
        metadata?: Record<string, unknown>;
        operatorName?: string | null;
        agentToken?: string | null;
      }
    | null;

  const actor = await getActorOrAutomation(request, body?.operatorName || null, body?.agentToken || null);
  if (!actor) return unauthorized();

  try {
    if (body?.action === "upsert_shipment") {
      const shipment = await upsertShippingShipment(body.shipment || {});
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, shipment, board });
    }
    if (body?.action === "record_event") {
      const result = await recordShippingTrackingEvent(body.event || {
        carrier: "",
        trackingNumber: "",
        eventTime: "",
      });
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, result, board });
    }
    if (body?.action === "evaluate_shipment") {
      const incidents = await evaluateShippingShipment(String(body.shipmentId || ""));
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, incidents, board });
    }
    if (body?.action === "create_task") {
      const result = await createShippingIncidentTask(String(body.incidentId || ""), actor);
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, result, board });
    }
    if (body?.action === "acknowledge") {
      const incident = await updateShippingIncidentStatus(String(body.incidentId || ""), "acknowledged", actor);
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "resolve") {
      const incident = await updateShippingIncidentStatus(String(body.incidentId || ""), "resolved", actor);
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "ignore") {
      const incident = await updateShippingIncidentStatus(String(body.incidentId || ""), "ignored", actor);
      const board = await listShippingBoard({ scope: "problems" });
      return jsonResponse({ ok: true, action: body.action, incident, board });
    }
    if (body?.action === "enqueue_notifications") {
      const notifications = await enqueueShippingNotifications();
      return jsonResponse({ ok: true, action: body.action, notifications });
    }
    if (body?.action === "claim_notifications") {
      await enqueueShippingNotifications();
      const notifications = await claimPendingShippingNotifications(Number(body.limit || 20));
      return jsonResponse({ ok: true, action: body.action, notifications });
    }
    if (body?.action === "mark_notification_sent") {
      const notification = await markShippingNotificationSent({
        notificationId: String(body.notificationId || ""),
        providerMessageId: body.providerMessageId || null,
        metadata: body.metadata || {},
      });
      return jsonResponse({ ok: true, action: body.action, notification });
    }
    if (body?.action === "mark_notification_failed") {
      const notification = await markShippingNotificationFailed({
        notificationId: String(body.notificationId || ""),
        error: body.notificationError || "unknown",
        metadata: body.metadata || {},
      });
      return jsonResponse({ ok: true, action: body.action, notification });
    }
    return jsonResponse({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    return failureResponse(error);
  }
}
