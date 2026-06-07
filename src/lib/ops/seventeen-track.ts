import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";

const API_BASE_URL = "https://api.17track.net/track/v2.2";
const MAX_WEBHOOK_BYTES = 1_000_000;
const REGISTER_BATCH_SIZE = 40;
const DEFAULT_17TRACK_CARRIER_IDS = {
  dhl: 7041,
  fedex: 100003,
} as const;

type RegistrationClaimRow = {
  shipment_id: string;
  registration_id: string;
  carrier: "dhl" | "fedex" | "other" | "unknown";
  tracking_number: string;
  trello_card_name: string | null;
  trello_card_url: string | null;
  attempts: number;
};

export type SeventeenTrackTrackingClaimRow = {
  shipment_id: string;
  shipment_key: string;
  carrier: "dhl" | "fedex" | "other" | "unknown";
  tracking_number: string;
  provider_carrier_id: number | null;
  provider_tag: string | null;
  trello_card_id: string | null;
  trello_card_name: string | null;
  trello_card_url: string | null;
  status: string;
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
  if (value === null || value === undefined || typeof value === "object" || typeof value === "function") return null;
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

function errorText(value: unknown): string | null {
  if (!isObject(value)) return cleanText(value);
  return firstText(
    value.message,
    value.detail,
    value.reason,
    value.description,
    value.code === null || value.code === undefined ? null : `17TRACK code ${value.code}`,
  );
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

function collectProviderItems(input: unknown) {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number) {
    if (depth > 5 || !value || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    if (firstText(value.number, value.tracking_number, value.trackingNumber, getPath(value, ["tracking", "number"]))) {
      items.push(value);
    }
    for (const key of ["data", "accepted", "rejected", "trackings", "items", "list"]) {
      visit(value[key], depth + 1);
    }
  }
  visit(input, 0);
  return items;
}

export function buildInboundCarrierPayloadFrom17Track(input: unknown): InboundCarrierPayload | null {
  const item = collectProviderItems(input)[0] || normalizeProviderItem(input);
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
  const accepted = asArray(envelope.data?.accepted).filter(isObject);
  const rejected = asArray(envelope.data?.rejected).filter(isObject);
  const totalResultItems = accepted.length + rejected.length;
  const acceptedItem = match17TrackRegistrationItem(accepted, claim) || (totalResultItems === 1 ? accepted[0] : undefined);
  const rejectedItem = match17TrackRegistrationItem(rejected, claim) || (totalResultItems === 1 ? rejected[0] : undefined);
  const resultItem = acceptedItem || rejectedItem;
  const providerCarrierId = Number(resultItem?.carrier ?? default17TrackCarrierId(claim.carrier));
  const error = firstText(
    errorText(rejectedItem?.message),
    errorText(rejectedItem?.error),
    errorText(rejectedItem?.err),
    errorText(rejectedItem?.reason),
    envelope.code && envelope.code !== 0 ? `17TRACK code ${envelope.code}` : null,
    acceptedItem ? null : "17TRACK Registrierung wurde nicht akzeptiert.",
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

function match17TrackRegistrationItem(items: Array<Record<string, unknown>>, claim: RegistrationClaimRow) {
  return items.find((item) => {
    const number = firstText(item.number, item.tracking_number, item.trackingNumber);
    const tag = firstText(item.tag);
    return number === claim.tracking_number || tag === claim.shipment_id;
  });
}

export function default17TrackCarrierId(carrier: RegistrationClaimRow["carrier"]) {
  return carrier === "dhl" || carrier === "fedex" ? DEFAULT_17TRACK_CARRIER_IDS[carrier] : null;
}

export function build17TrackRegistrationItem(claim: RegistrationClaimRow) {
  return {
    number: claim.tracking_number,
    carrier: default17TrackCarrierId(claim.carrier),
    tag: claim.shipment_id,
    note: claim.trello_card_name || undefined,
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

export function build17TrackSyncCarrierPayload(snapshot: unknown, claim: SeventeenTrackTrackingClaimRow) {
  const payload = buildInboundCarrierPayloadFrom17Track(snapshot);
  if (!payload) return null;
  return {
    ...payload,
    carrier: claim.carrier,
    trackingNumber: claim.tracking_number,
    shipmentId: payload.shipmentId || claim.shipment_id,
  };
}

function failedRegistrationPayload(claim: RegistrationClaimRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    p_payload: {
      shipmentId: claim.shipment_id,
      carrier: claim.carrier,
      trackingNumber: claim.tracking_number,
      status: "failed",
      providerCarrierId: default17TrackCarrierId(claim.carrier),
      error: message,
      rawResponse: { error: message },
    },
  };
}

async function recordFailed17TrackRegistration(claim: RegistrationClaimRow, error: unknown) {
  return supabaseRpc("inbound_record_17track_registration", failedRegistrationPayload(claim, error));
}

async function resolveAccepted17TrackIncidents(shipmentId: string) {
  try {
    await supabaseRequest("inbound_incidents", {
      method: "PATCH",
      body: JSON.stringify({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: "return=minimal" },
    }, {
      shipment_id: `eq.${shipmentId}`,
      status: "eq.open",
      incident_type: "eq.tracking_error",
      title: "ilike.*17TRACK*",
    });
  } catch (error) {
    console.error("17track incident auto-resolution failed", { shipmentId, error });
  }
}

async function record17TrackRegistrationPayload(payload: ReturnType<typeof parse17TrackRegistrationResult>) {
  const result = await supabaseRpc("inbound_record_17track_registration", { p_payload: payload });
  if (payload.status === "accepted") await resolveAccepted17TrackIncidents(payload.shipmentId);
  return result;
}

async function register17TrackShipmentBatch(claims: RegistrationClaimRow[]) {
  try {
    const response = await call17Track("/register", claims.map(build17TrackRegistrationItem));
    return Promise.all(claims.map((claim) => {
      const payload = parse17TrackRegistrationResult(response, claim);
      return record17TrackRegistrationPayload(payload);
    }));
  } catch (error) {
    return Promise.all(claims.map((claim) => recordFailed17TrackRegistration(claim, error)));
  }
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function register17TrackShipments(claims: RegistrationClaimRow[]) {
  const results = [];
  const chunks = chunkArray(claims, REGISTER_BATCH_SIZE);
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) await delay(450);
    results.push(...await register17TrackShipmentBatch(chunk));
  }
  return results;
}

export async function claimAndRegister17TrackShipments(limit = 20) {
  const claims = await supabaseRpc<RegistrationClaimRow[]>("inbound_claim_due_17track_registrations", { p_limit: limit });
  const results = await register17TrackShipments(claims || []);
  return { claimed: claims?.length || 0, results };
}

async function sync17TrackShipment(claim: SeventeenTrackTrackingClaimRow) {
  try {
    const snapshot = await fetch17TrackInfo(claim.tracking_number, claim.provider_carrier_id || default17TrackCarrierId(claim.carrier));
    const payload = build17TrackSyncCarrierPayload(snapshot, claim);
    if (!payload?.events.length) {
      return {
        shipmentId: claim.shipment_id,
        trackingNumber: claim.tracking_number,
        status: "no_events",
        eventCount: 0,
      };
    }
    const result = await record17TrackInboundPayload(payload);
    await resolveAccepted17TrackIncidents(claim.shipment_id);
    return {
      shipmentId: claim.shipment_id,
      trackingNumber: claim.tracking_number,
      status: "recorded",
      eventCount: payload.events.length,
      result,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const result = await record17TrackTrackingError({
      shipmentId: claim.shipment_id,
      carrier: claim.carrier,
      trackingNumber: claim.tracking_number,
      detail,
      rawResponse: { error: detail },
    });
    return {
      shipmentId: claim.shipment_id,
      trackingNumber: claim.tracking_number,
      status: "error",
      error: detail,
      result,
    };
  }
}

export async function claimAndSync17TrackShipments(limit = 20) {
  const claims = await supabaseRpc<SeventeenTrackTrackingClaimRow[]>("inbound_claim_due_17track_tracking_shipments", { p_limit: limit });
  const results = [];
  for (const [index, claim] of (claims || []).entries()) {
    if (index > 0) await delay(450);
    results.push(await sync17TrackShipment(claim));
  }
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
