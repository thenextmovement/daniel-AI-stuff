import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseRpc } from "@/lib/quotes/supabase-rest";

const API_BASE_URL = "https://api.17track.net/track/v2.2";
const MAX_WEBHOOK_BYTES = 1_000_000;

type RegistrationClaimRow = {
  shipment_id: string;
  registration_id: string;
  carrier: "dhl" | "fedex" | "other" | "unknown";
  tracking_number: string;
  trello_card_name: string | null;
  trello_card_url: string | null;
  attempts: number;
};

type SeventeenTrackEnvelope = {
  code?: number;
  data?: {
    accepted?: unknown[];
    rejected?: unknown[];
  };
};

type InboundCarrierPayload = {
  carrier: string;
  trackingNumber: string;
  shipmentId: string | null;
  events: Array<{
    carrierEventId: string | null;
    statusCode: string | null;
    statusText: string | null;
    eventTime: string;
    eventLocation: string | null;
    rawEvent: unknown;
  }>;
  rawResponse: unknown;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function eventTimeOf(event: Record<string, unknown>) {
  const raw = firstText(
    event.time_iso,
    event.time_utc,
    event.event_time,
    event.eventTime,
    event.datetime,
    event.date,
    event.time,
    event.timestamp,
    event.created_at,
  );
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function eventLocationOf(event: Record<string, unknown>) {
  const location = event.location;
  if (typeof location === "string") return cleanText(location);
  if (isObject(location)) {
    return [
      location.city,
      location.state,
      location.province,
      location.country,
      location.country_code,
      location.zip,
    ].map(cleanText).filter(Boolean).join(", ") || null;
  }
  return firstText(event.event_location, event.eventLocation, event.place, event.address);
}

function looksLikeEvent(value: unknown) {
  if (!isObject(value)) return false;
  return Boolean(
    firstText(value.description, value.status_text, value.statusText, value.message, value.content, value.detail, value.status) &&
    firstText(value.time_iso, value.time_utc, value.event_time, value.eventTime, value.datetime, value.date, value.time, value.timestamp),
  );
}

function collectEventArrays(root: unknown) {
  const arrays: unknown[][] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number) {
    if (depth > 6 || !value || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.some(looksLikeEvent)) arrays.push(value);
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (isObject(value)) {
      for (const entry of Object.values(value)) visit(entry, depth + 1);
    }
  }
  visit(root, 0);
  return arrays;
}

function statusCodeOf(item: Record<string, unknown>, event?: Record<string, unknown>) {
  return firstText(
    event?.status_code,
    event?.statusCode,
    event?.checkpoint_status,
    event?.event_status,
    event?.status,
    getPath(item, ["track_info", "latest_status", "status"]),
    getPath(item, ["track_info", "latest_status", "sub_status"]),
    item.status,
    item.sub_status,
  );
}

function statusTextOf(item: Record<string, unknown>, event?: Record<string, unknown>) {
  return firstText(
    event?.description,
    event?.status_text,
    event?.statusText,
    event?.message,
    event?.content,
    event?.detail,
    event?.status,
    getPath(item, ["track_info", "latest_event", "description"]),
    getPath(item, ["track_info", "latest_event", "status"]),
    getPath(item, ["track_info", "latest_status", "sub_status"]),
    getPath(item, ["track_info", "latest_status", "status"]),
  );
}

function shipmentIdFromTag(value: unknown) {
  const tag = cleanText(value);
  return tag && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tag) ? tag : null;
}

function normalizeProviderItem(input: unknown) {
  if (isObject(input) && isObject(input.data)) return input.data;
  return input;
}

export function buildInboundCarrierPayloadFrom17Track(input: unknown): InboundCarrierPayload | null {
  const item = normalizeProviderItem(input);
  if (!isObject(item)) return null;

  const number = firstText(item.number, item.tracking_number, item.trackingNumber, getPath(item, ["tracking", "number"]));
  if (!number) return null;

  const shipmentId = shipmentIdFromTag(item.tag);
  const eventArrays = collectEventArrays(item);
  const events = eventArrays.flatMap((array) => array.filter(looksLikeEvent) as Record<string, unknown>[]).map((event) => ({
    carrierEventId: firstText(event.id, event.event_id, event.eventId, event.status_code, event.status, event.description),
    statusCode: statusCodeOf(item, event),
    statusText: statusTextOf(item, event),
    eventTime: eventTimeOf(event),
    eventLocation: eventLocationOf(event),
    rawEvent: event,
  }));

  if (!events.length) {
    const statusText = statusTextOf(item);
    if (statusText) {
      events.push({
        carrierEventId: firstText(getPath(item, ["track_info", "latest_status", "sub_status"]), getPath(item, ["track_info", "latest_status", "status"]), "latest"),
        statusCode: statusCodeOf(item),
        statusText,
        eventTime: new Date().toISOString(),
        eventLocation: null,
        rawEvent: item,
      });
    }
  }

  return {
    carrier: "17track",
    trackingNumber: number,
    shipmentId,
    events,
    rawResponse: input,
  };
}

export function parse17TrackRegistrationResult(response: unknown, claim: RegistrationClaimRow) {
  const envelope = isObject(response) ? response as SeventeenTrackEnvelope : {};
  const accepted = asArray(envelope.data?.accepted);
  const rejected = asArray(envelope.data?.rejected);
  const acceptedItem = accepted.find(isObject) as Record<string, unknown> | undefined;
  const rejectedItem = rejected.find(isObject) as Record<string, unknown> | undefined;
  const providerCarrierId = Number(acceptedItem?.carrier ?? rejectedItem?.carrier);
  const error = firstText(
    rejectedItem?.message,
    rejectedItem?.error,
    rejectedItem?.err,
    rejectedItem?.reason,
    envelope.code && envelope.code !== 0 ? `17TRACK code ${envelope.code}` : null,
  );

  return {
    shipmentId: claim.shipment_id,
    carrier: claim.carrier,
    trackingNumber: claim.tracking_number,
    status: acceptedItem ? "accepted" : "rejected",
    providerCarrierId: Number.isFinite(providerCarrierId) ? providerCarrierId : null,
    error,
    rawResponse: response,
  };
}

function configured17TrackToken() {
  return cleanText(process.env.SEVENTEEN_TRACK_API_TOKEN || process.env.TRACK17_API_TOKEN || process.env.INBOUND_17TRACK_API_TOKEN);
}

export function configured17TrackWebhookToken() {
  return cleanText(process.env.SEVENTEEN_TRACK_WEBHOOK_TOKEN || process.env.INBOUND_17TRACK_WEBHOOK_TOKEN);
}

function configuredInternalKeys() {
  return [
    process.env.OPS_INTERNAL_API_KEY,
    process.env.QUOTE_INTERNAL_API_TOKEN,
    process.env.INTERNAL_API_KEY,
  ].filter((value): value is string => Boolean(value && value.length >= 24));
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

export function isInternalRequestAuthorized(headers: Headers) {
  const authorization = headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const received = bearer || headers.get("x-neontrip-internal-key") || "";
  const keys = configuredInternalKeys();
  return Boolean(keys.length && received && keys.some((key) => safeEqual(received, key)));
}

export function is17TrackWebhookAuthorized(headers: Headers, url: URL) {
  const expected = configured17TrackWebhookToken();
  const received = cleanText(url.searchParams.get("token") || headers.get("x-neontrip-webhook-token"));
  return Boolean(expected && received && safeEqual(received, expected));
}

async function call17Track(path: string, body: unknown) {
  const token = configured17TrackToken();
  if (!token) throw new Error("17TRACK API Token fehlt.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "17token": token,
      "Content-Type": "application/json",
      "User-Agent": "NEONTRIP-Inbound-Shipping/1.0",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`17TRACK ${path} failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return payload;
}

export async function fetch17TrackInfo(number: string, carrier?: number | null) {
  return call17Track("/gettrackinfo", [{ number, carrier: carrier || 0 }]);
}

async function register17TrackShipment(claim: RegistrationClaimRow) {
  try {
    const response = await call17Track("/register", [{
      number: claim.tracking_number,
      carrier: null,
      tag: claim.shipment_id,
      note: claim.trello_card_name || undefined,
    }]);
    const payload = parse17TrackRegistrationResult(response, claim);
    return supabaseRpc("inbound_record_17track_registration", { p_payload: payload });
  } catch (error) {
    return supabaseRpc("inbound_record_17track_registration", {
      p_payload: {
        shipmentId: claim.shipment_id,
        carrier: claim.carrier,
        trackingNumber: claim.tracking_number,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        rawResponse: { error: error instanceof Error ? error.message : String(error) },
      },
    });
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function claimAndRegister17TrackShipments(limit = 20) {
  const claims = await supabaseRpc<RegistrationClaimRow[]>("inbound_claim_due_17track_registrations", { p_limit: limit });
  const results = await mapWithConcurrency(claims || [], 2, register17TrackShipment);
  return { claimed: claims?.length || 0, results };
}

export async function readBoundedWebhookBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_WEBHOOK_BYTES) {
    throw new Error("webhook_payload_too_large");
  }
  return text;
}

export async function record17TrackInboundPayload(payload: InboundCarrierPayload) {
  return supabaseRpc("inbound_record_carrier_response", { p_payload: payload });
}

export async function record17TrackTrackingError(input: {
  shipmentId?: string | null;
  carrier?: string | null;
  trackingNumber: string;
  detail: string;
  rawResponse?: unknown;
}) {
  return supabaseRpc("inbound_record_tracking_error", {
    p_payload: {
      shipmentId: input.shipmentId || undefined,
      carrier: input.carrier || "17track",
      trackingNumber: input.trackingNumber,
      trackingError: {
        provider: "17track",
        title: "17TRACK tracking fetch failed",
        detail: input.detail,
        node: "17TRACK webhook",
      },
      rawResponse: input.rawResponse || {},
    },
  });
}
