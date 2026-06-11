import { createOpsInternalTask, listOpsInternalTasks, type OpsInternalTaskActor } from "@/lib/ops/internal-tasks";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const SHIPPING_STATUS_VALUES = [
  "created",
  "tracking_missing",
  "label_created",
  "carrier_not_found",
  "in_transit",
  "out_for_delivery",
  "pickup_available",
  "delivery_failed",
  "delivered",
  "returning",
  "returned",
  "lost_or_stale",
  "closed",
] as const;

export type ShippingStatus = (typeof SHIPPING_STATUS_VALUES)[number];
export type ShippingCarrier = "dpd" | "dhl" | "other" | "unknown";
export type ShippingRiskLevel = "low" | "normal" | "watch" | "high" | "urgent" | "closed";
export type ShippingIncidentSeverity = "watch" | "high" | "urgent";
export type ShippingIncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type ShippingIncidentType =
  | "tracking_missing"
  | "label_created_no_scan"
  | "carrier_not_found"
  | "stale_in_transit"
  | "delivery_failed"
  | "pickup_available"
  | "return_to_sender"
  | "returned"
  | "lost_or_stale";

export const SHIPPING_RULE_VERSION = "shipping_rules_v1_20260605";
export const SHIPPING_MAPPING_VERSION = "carrier_status_mapping_v2_20260605";
export const SHIPPING_LOOKBACK_DAYS = 60;

type ShippingShipmentRow = {
  id: string;
  shipment_key: string;
  source: string;
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  shopify_fulfillment_id: string | null;
  request_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  carrier: ShippingCarrier;
  tracking_number: string | null;
  tracking_url: string | null;
  destination_country: string | null;
  status: ShippingStatus;
  status_reason: string | null;
  risk_level: ShippingRiskLevel;
  shipped_at: string | null;
  delivered_at: string | null;
  last_event_at: string | null;
  last_carrier_sync_at: string | null;
  next_check_at: string | null;
  raw_shopify: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

type ShippingTrackingEventRow = {
  id: string;
  shipment_id: string;
  carrier: ShippingCarrier;
  tracking_number: string;
  carrier_event_id: string | null;
  event_key: string;
  carrier_status_code: string | null;
  carrier_status_text: string | null;
  event_time: string;
  event_location: string | null;
  normalized_status: ShippingStatus;
  mapping_version: string;
  raw_event: Record<string, unknown>;
  created_at: string | null;
};

type ShippingIncidentRow = {
  id: string;
  shipment_id: string;
  request_id: string | null;
  incident_key: string;
  incident_type: ShippingIncidentType;
  severity: ShippingIncidentSeverity;
  status: ShippingIncidentStatus;
  title: string;
  description: string | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  rule_version: string;
  source_event_id: string | null;
  active_task_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

export type ShippingShipment = {
  id: string;
  shipmentKey: string;
  source: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyFulfillmentId: string | null;
  requestId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  carrier: ShippingCarrier;
  trackingNumber: string | null;
  trackingUrl: string | null;
  destinationCountry: string | null;
  status: ShippingStatus;
  statusReason: string | null;
  riskLevel: ShippingRiskLevel;
  shippedAt: string | null;
  deliveredAt: string | null;
  lastEventAt: string | null;
  lastCarrierSyncAt: string | null;
  nextCheckAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ShippingTrackingEvent = {
  id: string;
  shipmentId: string;
  carrier: ShippingCarrier;
  trackingNumber: string;
  carrierEventId: string | null;
  eventKey: string;
  carrierStatusCode: string | null;
  carrierStatusText: string | null;
  eventTime: string;
  eventLocation: string | null;
  normalizedStatus: ShippingStatus;
  mappingVersion: string;
  createdAt: string | null;
};

export type ShippingIncident = {
  id: string;
  shipmentId: string;
  requestId: string | null;
  incidentKey: string;
  incidentType: ShippingIncidentType;
  severity: ShippingIncidentSeverity;
  status: ShippingIncidentStatus;
  title: string;
  description: string | null;
  firstDetectedAt: string | null;
  lastDetectedAt: string | null;
  resolvedAt: string | null;
  ruleVersion: string;
  sourceEventId: string | null;
  activeTaskId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ShippingBoardItem = {
  shipment: ShippingShipment;
  incidents: ShippingIncident[];
  latestEvent: ShippingTrackingEvent | null;
};

export type ShippingBoard = {
  items: ShippingBoardItem[];
  counts: {
    actionRequired: number;
    watch: number;
    labelCreated: number;
    inTransit: number;
    delivered: number;
    returning: number;
    stale: number;
    withOpenTask: number;
  };
};

export type CarrierEventInput = {
  carrier: string | null | undefined;
  trackingNumber: string | null | undefined;
  carrierEventId?: string | null;
  statusCode?: string | null;
  statusText?: string | null;
  eventTime: string;
  eventLocation?: string | null;
  rawEvent?: Record<string, unknown>;
};

export type ShippingShipmentInput = {
  shipmentKey?: string | null;
  source?: string | null;
  shopifyOrderId?: string | number | null;
  shopifyOrderNumber?: string | number | null;
  shopifyFulfillmentId?: string | number | null;
  requestId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  destinationCountry?: string | null;
  status?: ShippingStatus | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  rawShopify?: Record<string, unknown>;
};

type IncidentCandidate = {
  incidentType: ShippingIncidentType;
  severity: ShippingIncidentSeverity;
  title: string;
  description: string;
  sourceEventId?: string | null;
  metadata?: Record<string, unknown>;
};

type ShippingUpdateActor = OpsInternalTaskActor & {
  host?: string | null;
  mode?: "local_bypass" | "ops_session";
  userAgent?: string | null;
};

function trimNullable(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function encodeFilterValue(value: string) {
  return encodeURIComponent(value);
}

function parseTime(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function shippingReferenceTime(shipment: Pick<ShippingShipment, "shippedAt" | "lastEventAt" | "createdAt" | "updatedAt">) {
  return parseTime(shipment.shippedAt) || parseTime(shipment.lastEventAt) || parseTime(shipment.createdAt) || parseTime(shipment.updatedAt);
}

export function isShipmentWithinShippingLookback(
  shipment: Pick<ShippingShipment, "shippedAt" | "lastEventAt" | "createdAt" | "updatedAt">,
  now = new Date(),
) {
  const referenceTime = shippingReferenceTime(shipment);
  if (!referenceTime) return true;
  return now.getTime() - referenceTime <= SHIPPING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

export function isInternalShippingProblemIncident(incident: Pick<ShippingIncident, "incidentType" | "status">) {
  return ["delivery_failed", "return_to_sender", "returned"].includes(incident.incidentType)
    && (incident.status === "open" || incident.status === "acknowledged");
}

function businessDaysBetween(from: string | null | undefined, to: Date) {
  const fromTime = parseTime(from);
  if (!fromTime) return null;
  const start = new Date(fromTime);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let days = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

export function normalizeShippingCarrier(value: string | null | undefined): ShippingCarrier {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "unknown";
  if (text.includes("dpd")) return "dpd";
  if (text.includes("dhl") || text.includes("deutsche post")) return "dhl";
  return "other";
}

export function normalizeCarrierStatus(input: {
  carrier?: string | null;
  statusCode?: string | null;
  statusText?: string | null;
}): ShippingStatus {
  const text = `${input.carrier || ""} ${input.statusCode || ""} ${input.statusText || ""}`.toLowerCase();
  if (!text.trim()) return "carrier_not_found";

  if (/attempted[_\s-]*delivery/.test(text)) return "delivery_failed";
  if (/ready[_\s-]*for[_\s-]*pickup/.test(text)) return "pickup_available";
  if (/out[_\s-]*for[_\s-]*delivery/.test(text)) return "out_for_delivery";
  if (/carrier[_\s-]*picked[_\s-]*up|picked\s*up|accepted|received\s+by\s+carrier|in[_\s-]*transit/.test(text)) return "in_transit";
  if (/label[_\s-]*(printed|purchased|created|generated)|confirmed|pre[-\s]*advice|shipment information received/.test(text)) return "label_created";
  if (/\bfailure\b/.test(text)) return "delivery_failed";
  if (/not\s*found|unknown shipment|keine sendung|nicht gefunden|no tracking/.test(text)) return "carrier_not_found";
  if (/failed|nicht zugestellt|zustellung fehlgeschlagen|empfaenger nicht|empfänger nicht|annahme verweigert|address problem|adressproblem/.test(text)) return "delivery_failed";
  if (/returned|retoure abgeschlossen|ruecksendung zugestellt|rücksendung zugestellt|returned to sender/.test(text)) return "returned";
  if (/return to sender|returning|retoure|ruecksendung|rücksendung|zurueck an absender|zurück an absender/.test(text)) return "returning";
  if (/delivered|zugestellt|erfolgreich zugestellt/.test(text)) return "delivered";
  if (/pickup|paketshop|parcelshop|filiale|packstation|abhol/.test(text)) return "pickup_available";
  if (/out for delivery|in zustellung|zustellung heute|wird heute zugestellt/.test(text)) return "out_for_delivery";
  if (/label|announced|angekuendigt|angekündigt|daten.*uebermittelt|daten.*übermittelt|sendungsdaten|pre[-\s]*advice|shipment information received/.test(text)) return "label_created";
  if (/delay|delayed|verspaetet|verspätet|transit|unterwegs|sort|depot|hub|transport|scan|processed|verarbeitet/.test(text)) return "in_transit";
  return "carrier_not_found";
}

export function buildCarrierEventKey(input: CarrierEventInput) {
  const carrier = normalizeShippingCarrier(input.carrier);
  const tracking = trimNullable(input.trackingNumber);
  if (!tracking) throw new QuoteValidationError("Trackingnummer fehlt.");
  const eventId = trimNullable(input.carrierEventId);
  const statusCode = trimNullable(input.statusCode);
  const statusText = trimNullable(input.statusText);
  const eventTime = new Date(input.eventTime);
  if (!Number.isFinite(eventTime.getTime())) throw new QuoteValidationError("Carrier-Event hat keinen gültigen Zeitstempel.");
  return [
    carrier,
    tracking.toLowerCase(),
    eventId || statusCode || "status",
    eventTime.toISOString(),
    (statusText || "").toLowerCase().slice(0, 80),
  ].join(":");
}

function shipmentKeyFromInput(input: ShippingShipmentInput, carrier: ShippingCarrier, trackingNumber: string | null) {
  const explicit = trimNullable(input.shipmentKey);
  if (explicit) return explicit;
  const fulfillmentId = trimNullable(input.shopifyFulfillmentId);
  if (fulfillmentId) return `shopify:fulfillment:${fulfillmentId}`;
  const orderId = trimNullable(input.shopifyOrderId);
  if (orderId && trackingNumber) return `shopify:order:${orderId}:${carrier}:${trackingNumber}`;
  if (trackingNumber) return `carrier:${carrier}:${trackingNumber}`;
  if (orderId) return `shopify:order:${orderId}:tracking-missing`;
  throw new QuoteValidationError("Sendung braucht shipmentKey, Fulfillment-ID, Order-ID oder Trackingnummer.");
}

function validateIsoDate(value: string | null | undefined, label: string) {
  const normalized = trimNullable(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new QuoteValidationError(`${label} ist kein gültiger Zeitstempel.`);
  return parsed.toISOString();
}

function riskLevelForStatus(status: ShippingStatus, candidates: IncidentCandidate[] = []): ShippingRiskLevel {
  if (status === "delivered" || status === "closed") return "closed";
  if (candidates.some((candidate) => candidate.severity === "urgent")) return "urgent";
  if (candidates.some((candidate) => candidate.severity === "high")) return "high";
  if (candidates.some((candidate) => candidate.severity === "watch")) return "watch";
  if (["delivery_failed", "returning", "returned", "lost_or_stale", "carrier_not_found"].includes(status)) return "high";
  if (["pickup_available", "label_created", "tracking_missing"].includes(status)) return "watch";
  return "normal";
}

function upsertPath(path: string, conflictColumn: string) {
  return `${path}?on_conflict=${encodeURIComponent(conflictColumn)}`;
}

function mapShipment(row: ShippingShipmentRow): ShippingShipment {
  return {
    id: row.id,
    shipmentKey: row.shipment_key,
    source: row.source,
    shopifyOrderId: row.shopify_order_id,
    shopifyOrderNumber: row.shopify_order_number,
    shopifyFulfillmentId: row.shopify_fulfillment_id,
    requestId: row.request_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    destinationCountry: row.destination_country,
    status: row.status,
    statusReason: row.status_reason,
    riskLevel: row.risk_level,
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    lastEventAt: row.last_event_at,
    lastCarrierSyncAt: row.last_carrier_sync_at,
    nextCheckAt: row.next_check_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: ShippingTrackingEventRow): ShippingTrackingEvent {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    carrierEventId: row.carrier_event_id,
    eventKey: row.event_key,
    carrierStatusCode: row.carrier_status_code,
    carrierStatusText: row.carrier_status_text,
    eventTime: row.event_time,
    eventLocation: row.event_location,
    normalizedStatus: row.normalized_status,
    mappingVersion: row.mapping_version,
    createdAt: row.created_at,
  };
}

function mapIncident(row: ShippingIncidentRow): ShippingIncident {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    requestId: row.request_id,
    incidentKey: row.incident_key,
    incidentType: row.incident_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    resolvedAt: row.resolved_at,
    ruleVersion: row.rule_version,
    sourceEventId: row.source_event_id,
    activeTaskId: row.active_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function severityRank(value: ShippingIncidentSeverity) {
  if (value === "urgent") return 0;
  if (value === "high") return 1;
  return 2;
}

function itemRank(item: ShippingBoardItem) {
  const openIncidents = item.incidents.filter((incident) => incident.status === "open" || incident.status === "acknowledged");
  if (openIncidents.length) return Math.min(...openIncidents.map((incident) => severityRank(incident.severity)));
  if (item.shipment.riskLevel === "urgent") return 0;
  if (item.shipment.riskLevel === "high") return 1;
  if (item.shipment.riskLevel === "watch") return 2;
  return 3;
}

export function buildShippingBoardFromRows(
  shipmentRows: ShippingShipmentRow[],
  incidentRows: ShippingIncidentRow[],
  eventRows: ShippingTrackingEventRow[],
): ShippingBoard {
  const incidentsByShipment = new Map<string, ShippingIncident[]>();
  for (const row of incidentRows) {
    const incident = mapIncident(row);
    const list = incidentsByShipment.get(incident.shipmentId) || [];
    list.push(incident);
    incidentsByShipment.set(incident.shipmentId, list);
  }

  const latestEventByShipment = new Map<string, ShippingTrackingEvent>();
  for (const row of eventRows) {
    const event = mapEvent(row);
    const existing = latestEventByShipment.get(event.shipmentId);
    if (!existing || new Date(event.eventTime).getTime() > new Date(existing.eventTime).getTime()) {
      latestEventByShipment.set(event.shipmentId, event);
    }
  }

  const items = shipmentRows.filter((row) => isShipmentWithinShippingLookback(mapShipment(row))).map((row) => {
    const shipment = mapShipment(row);
    return {
      shipment,
      incidents: (incidentsByShipment.get(shipment.id) || []).sort((left, right) => severityRank(left.severity) - severityRank(right.severity)),
      latestEvent: latestEventByShipment.get(shipment.id) || null,
    };
  });

  items.sort((left, right) => {
    const rankDiff = itemRank(left) - itemRank(right);
    if (rankDiff !== 0) return rankDiff;
    return new Date(right.shipment.updatedAt || 0).getTime() - new Date(left.shipment.updatedAt || 0).getTime();
  });

  return {
    items,
    counts: {
      actionRequired: items.filter((item) => item.incidents.some(isInternalShippingProblemIncident)).length,
      watch: items.filter((item) => item.shipment.riskLevel === "watch" || item.incidents.some((incident) => incident.severity === "watch")).length,
      labelCreated: items.filter((item) => item.shipment.status === "label_created").length,
      inTransit: items.filter((item) => ["in_transit", "out_for_delivery", "pickup_available"].includes(item.shipment.status)).length,
      delivered: items.filter((item) => item.shipment.status === "delivered").length,
      returning: items.filter((item) => ["returning", "returned"].includes(item.shipment.status)).length,
      stale: items.filter((item) => item.incidents.some((incident) => incident.incidentType === "stale_in_transit" || incident.incidentType === "label_created_no_scan")).length,
      withOpenTask: items.filter((item) => item.incidents.some((incident) => Boolean(incident.activeTaskId))).length,
    },
  };
}

export function deriveShippingIncidentCandidates(
  shipment: Pick<ShippingShipment, "id" | "status" | "carrier" | "trackingNumber" | "lastEventAt" | "shippedAt"> & Partial<Pick<ShippingShipment, "createdAt" | "updatedAt">>,
  latestEvent: Pick<ShippingTrackingEvent, "id" | "eventTime" | "carrierStatusText"> | null,
  now = new Date(),
): IncidentCandidate[] {
  const candidates: IncidentCandidate[] = [];
  if (!isShipmentWithinShippingLookback({
    shippedAt: shipment.shippedAt,
    lastEventAt: latestEvent?.eventTime || shipment.lastEventAt,
    createdAt: shipment.createdAt || null,
    updatedAt: shipment.updatedAt || null,
  }, now)) {
    return candidates;
  }

  const lastMovementAt = latestEvent?.eventTime || shipment.lastEventAt || shipment.shippedAt;
  const businessDaysIdle = businessDaysBetween(lastMovementAt, now);

  if (shipment.status === "tracking_missing") {
    candidates.push({
      incidentType: "tracking_missing",
      severity: "high",
      title: "Trackingnummer fehlt",
      description: "Die Sendung wurde in Shopify angelegt, hat aber noch keine belastbare Trackingnummer.",
    });
  }

  if (shipment.status === "carrier_not_found") {
    candidates.push({
      incidentType: "carrier_not_found",
      severity: "high",
      title: "Carrier kennt die Sendung nicht",
      description: "Die Trackingnummer wurde beim Versanddienstleister nicht gefunden. Trackingnummer und Carrier prüfen.",
    });
  }

  if (shipment.status === "label_created" && businessDaysIdle !== null && businessDaysIdle >= 2) {
    candidates.push({
      incidentType: "label_created_no_scan",
      severity: "high",
      title: "Label erstellt, aber kein Carrier-Scan",
      description: `Seit ${businessDaysIdle} Werktagen gibt es nach Label-Erstellung keine echte Paketbewegung.`,
      sourceEventId: latestEvent?.id || null,
      metadata: { business_days_idle: businessDaysIdle },
    });
  }

  if (["in_transit", "out_for_delivery"].includes(shipment.status) && businessDaysIdle !== null && businessDaysIdle >= 3) {
    candidates.push({
      incidentType: "stale_in_transit",
      severity: "high",
      title: "Sendung bewegt sich nicht",
      description: `Seit ${businessDaysIdle} Werktagen gibt es kein neues Tracking-Event.`,
      sourceEventId: latestEvent?.id || null,
      metadata: { business_days_idle: businessDaysIdle },
    });
  }

  if (shipment.status === "pickup_available") {
    candidates.push({
      incidentType: "pickup_available",
      severity: businessDaysIdle !== null && businessDaysIdle >= 3 ? "urgent" : "watch",
      title: "Paket liegt zur Abholung bereit",
      description: "Die Sendung liegt in Paketshop, Filiale oder Packstation. Kunde sollte rechtzeitig informiert werden.",
      sourceEventId: latestEvent?.id || null,
      metadata: { business_days_idle: businessDaysIdle },
    });
  }

  if (shipment.status === "delivery_failed") {
    candidates.push({
      incidentType: "delivery_failed",
      severity: "urgent",
      title: "Zustellung fehlgeschlagen",
      description: latestEvent?.carrierStatusText || "Der Versanddienstleister meldet eine fehlgeschlagene Zustellung.",
      sourceEventId: latestEvent?.id || null,
    });
  }

  if (shipment.status === "returning") {
    candidates.push({
      incidentType: "return_to_sender",
      severity: "urgent",
      title: "Sendung kommt zurück",
      description: "Der Carrier meldet eine Rücksendung an den Absender. Kunde und interne Klärung erforderlich.",
      sourceEventId: latestEvent?.id || null,
    });
  }

  if (shipment.status === "returned") {
    candidates.push({
      incidentType: "returned",
      severity: "high",
      title: "Sendung wurde zurückgesendet",
      description: "Die Sendung ist als Rückläufer markiert. Ursache und weiteres Vorgehen klären.",
      sourceEventId: latestEvent?.id || null,
    });
  }

  return candidates;
}

async function fetchShipmentById(shipmentId: string) {
  const rows = await supabaseRequest<ShippingShipmentRow[]>("shipping_shipments", undefined, {
    select: "*",
    id: `eq.${shipmentId}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function fetchLatestEventForShipment(shipmentId: string) {
  const rows = await supabaseRequest<ShippingTrackingEventRow[]>("shipping_tracking_events", undefined, {
    select: "*",
    shipment_id: `eq.${shipmentId}`,
    order: "event_time.desc",
    limit: 1,
  });
  return rows[0] || null;
}

async function patchShipment(shipmentId: string, patch: Partial<ShippingShipmentRow>) {
  const rows = await supabaseRequest<ShippingShipmentRow[]>(
    "shipping_shipments",
    {
      method: "PATCH",
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${shipmentId}` },
  );
  return rows[0] ? mapShipment(rows[0]) : null;
}

async function resolveOpenIncidentsForDeliveredShipment(shipmentId: string) {
  await supabaseRequest(
    "shipping_incidents",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: "return=minimal" },
    },
    {
      shipment_id: `eq.${shipmentId}`,
      status: "in.(open,acknowledged)",
    },
  );
}

export async function upsertShippingShipment(input: ShippingShipmentInput) {
  const carrier = normalizeShippingCarrier(input.carrier);
  const trackingNumber = trimNullable(input.trackingNumber);
  const shipmentKey = shipmentKeyFromInput(input, carrier, trackingNumber);
  const explicitStatus = input.status || null;
  const status: ShippingStatus = explicitStatus || (trackingNumber ? "label_created" : "tracking_missing");
  const shippedAt = validateIsoDate(input.shippedAt, "shippedAt");
  const deliveredAt = validateIsoDate(input.deliveredAt, "deliveredAt");

  const rows = await supabaseRequest<ShippingShipmentRow[]>(
    upsertPath("shipping_shipments", "shipment_key"),
    {
      method: "POST",
      body: JSON.stringify({
        shipment_key: shipmentKey,
        source: trimNullable(input.source) || "shopify",
        shopify_order_id: trimNullable(input.shopifyOrderId),
        shopify_order_number: trimNullable(input.shopifyOrderNumber),
        shopify_fulfillment_id: trimNullable(input.shopifyFulfillmentId),
        request_id: trimNullable(input.requestId),
        customer_name: trimNullable(input.customerName),
        customer_email: trimNullable(input.customerEmail)?.toLowerCase() || null,
        customer_phone: trimNullable(input.customerPhone),
        carrier,
        tracking_number: trackingNumber,
        tracking_url: trimNullable(input.trackingUrl),
        destination_country: trimNullable(input.destinationCountry),
        status,
        risk_level: riskLevelForStatus(status),
        shipped_at: shippedAt,
        delivered_at: deliveredAt,
        raw_shopify: input.rawShopify || {},
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    },
  );

  return mapShipment(rows[0]);
}

async function findOrCreateShipmentForCarrierEvent(input: CarrierEventInput) {
  const carrier = normalizeShippingCarrier(input.carrier);
  const trackingNumber = trimNullable(input.trackingNumber);
  if (!trackingNumber) throw new QuoteValidationError("Carrier-Event braucht eine Trackingnummer.");

  const existing = await supabaseRequest<ShippingShipmentRow[]>("shipping_shipments", undefined, {
    select: "*",
    carrier: `eq.${carrier}`,
    tracking_number: `eq.${trackingNumber}`,
    limit: 1,
  });
  if (existing[0]) return existing[0];

  const created = await upsertShippingShipment({
    shipmentKey: `carrier:${carrier}:${trackingNumber}`,
    source: "carrier_tracking",
    carrier,
    trackingNumber,
    status: "in_transit",
  });
  const row = await fetchShipmentById(created.id);
  if (!row) throw new QuoteValidationError("Sendung konnte nach Carrier-Event nicht geladen werden.");
  return row;
}

export async function recordShippingTrackingEvent(input: CarrierEventInput) {
  const shipment = await findOrCreateShipmentForCarrierEvent(input);
  const carrier = normalizeShippingCarrier(input.carrier);
  const trackingNumber = trimNullable(input.trackingNumber);
  if (!trackingNumber) throw new QuoteValidationError("Carrier-Event braucht eine Trackingnummer.");
  const eventTime = validateIsoDate(input.eventTime, "eventTime");
  if (!eventTime) throw new QuoteValidationError("Carrier-Event braucht eventTime.");
  const normalizedStatus = normalizeCarrierStatus({
    carrier,
    statusCode: input.statusCode,
    statusText: input.statusText,
  });
  const eventKey = buildCarrierEventKey(input);

  const eventRows = await supabaseRequest<ShippingTrackingEventRow[]>(
    upsertPath("shipping_tracking_events", "event_key"),
    {
      method: "POST",
      body: JSON.stringify({
        shipment_id: shipment.id,
        carrier,
        tracking_number: trackingNumber,
        carrier_event_id: trimNullable(input.carrierEventId),
        event_key: eventKey,
        carrier_status_code: trimNullable(input.statusCode),
        carrier_status_text: trimNullable(input.statusText),
        event_time: eventTime,
        event_location: trimNullable(input.eventLocation),
        normalized_status: normalizedStatus,
        mapping_version: SHIPPING_MAPPING_VERSION,
        raw_event: input.rawEvent || {},
      }),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    },
  );

  const currentLastEvent = parseTime(shipment.last_event_at);
  const nextEvent = parseTime(eventTime);
  if (!currentLastEvent || (nextEvent && nextEvent >= currentLastEvent)) {
    await patchShipment(shipment.id, {
      status: normalizedStatus,
      risk_level: riskLevelForStatus(normalizedStatus),
      last_event_at: eventTime,
      last_carrier_sync_at: new Date().toISOString(),
      delivered_at: normalizedStatus === "delivered" ? eventTime : shipment.delivered_at,
    });
  }

  const incidents = await evaluateShippingShipment(shipment.id);
  return {
    shipment: mapShipment((await fetchShipmentById(shipment.id)) || shipment),
    event: mapEvent(eventRows[0]),
    incidents,
  };
}

export async function evaluateShippingShipment(shipmentId: string) {
  const shipmentRow = await fetchShipmentById(shipmentId);
  if (!shipmentRow) throw new QuoteValidationError("Sendung wurde nicht gefunden.", [], 404);
  const eventRow = await fetchLatestEventForShipment(shipmentId);
  const shipment = mapShipment(shipmentRow);
  const latestEvent = eventRow ? mapEvent(eventRow) : null;
  const candidates = deriveShippingIncidentCandidates(shipment, latestEvent);
  const riskLevel = riskLevelForStatus(shipment.status, candidates);
  await patchShipment(shipment.id, { risk_level: riskLevel });

  if (shipment.status === "delivered" || shipment.status === "closed") {
    await resolveOpenIncidentsForDeliveredShipment(shipment.id);
    return [];
  }

  const rows: ShippingIncidentRow[] = [];
  for (const candidate of candidates) {
    const incidentKey = `${shipment.id}:${candidate.incidentType}`;
    const upserted = await supabaseRequest<ShippingIncidentRow[]>(
      upsertPath("shipping_incidents", "incident_key"),
      {
        method: "POST",
        body: JSON.stringify({
          shipment_id: shipment.id,
          request_id: shipment.requestId,
          incident_key: incidentKey,
          incident_type: candidate.incidentType,
          severity: candidate.severity,
          status: "open",
          title: candidate.title,
          description: candidate.description,
          last_detected_at: new Date().toISOString(),
          rule_version: SHIPPING_RULE_VERSION,
          source_event_id: candidate.sourceEventId || null,
          metadata: candidate.metadata || {},
          updated_at: new Date().toISOString(),
        }),
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      },
    );
    if (upserted[0]) rows.push(upserted[0]);
  }

  return rows.map(mapIncident);
}

export async function listShippingBoard(options?: {
  requestId?: string | null;
  carrier?: ShippingCarrier | "all" | null;
  scope?: "moving" | "active" | "problems" | "label_created" | "all";
  limit?: number;
}): Promise<ShippingBoard> {
  const query: Record<string, string | number | boolean | null> = {
    select: "*",
    order: "updated_at.desc",
    limit: Math.min(Math.max(options?.limit || 250, 1), 500),
  };
  const requestId = trimNullable(options?.requestId);
  if (requestId) query.request_id = `eq.${requestId}`;
  if (options?.carrier && options.carrier !== "all") query.carrier = `eq.${options.carrier}`;
  if (options?.scope === "moving") query.status = "in.(in_transit,out_for_delivery,pickup_available)";
  else if (options?.scope === "label_created") query.status = "eq.label_created";
  else if (options?.scope !== "all") query.status = "not.in.(delivered,returned,closed)";

  const shipmentRows = await supabaseRequest<ShippingShipmentRow[]>("shipping_shipments", undefined, query);
  if (!shipmentRows.length) {
    return buildShippingBoardFromRows([], [], []);
  }

  const shipmentIds = shipmentRows.map((row) => row.id);
  const idFilter = `in.(${shipmentIds.map(encodeFilterValue).join(",")})`;
  const [incidentRows, eventRows] = await Promise.all([
    supabaseRequest<ShippingIncidentRow[]>("shipping_incidents", undefined, {
      select: "*",
      shipment_id: idFilter,
      ...(options?.scope === "problems" ? { status: "in.(open,acknowledged)" } : {}),
      order: "last_detected_at.desc",
      limit: 1000,
    }),
    supabaseRequest<ShippingTrackingEventRow[]>("shipping_tracking_events", undefined, {
      select: "*",
      shipment_id: idFilter,
      order: "event_time.desc",
      limit: 1000,
    }),
  ]);

  const board = buildShippingBoardFromRows(shipmentRows, incidentRows, eventRows);
  if (options?.scope === "problems") {
    return {
      ...board,
      items: board.items.filter((item) => item.incidents.some(isInternalShippingProblemIncident)),
    };
  }
  return board;
}

async function insertShippingAudit(input: {
  shipmentId?: string | null;
  incidentId?: string | null;
  action: string;
  idempotencyKey: string;
  actor?: ShippingUpdateActor | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabaseRequest("shipping_audit_log", {
      method: "POST",
      body: JSON.stringify({
        shipment_id: input.shipmentId || null,
        incident_id: input.incidentId || null,
        action: input.action,
        idempotency_key: input.idempotencyKey,
        actor: input.actor || null,
        metadata: input.metadata || {},
      }),
      headers: { Prefer: "return=minimal" },
    });
  } catch {
    // Audit idempotency collisions must not create duplicate side effects.
  }
}

async function getIncidentWithShipment(incidentId: string) {
  const normalizedIncidentId = trimNullable(incidentId);
  if (!normalizedIncidentId) throw new QuoteValidationError("Bitte eine Incident-ID angeben.");
  const incidents = await supabaseRequest<ShippingIncidentRow[]>("shipping_incidents", undefined, {
    select: "*",
    id: `eq.${normalizedIncidentId}`,
    limit: 1,
  });
  const incident = incidents[0];
  if (!incident) throw new QuoteValidationError("Shipping-Incident wurde nicht gefunden.", [], 404);

  const shipments = await supabaseRequest<ShippingShipmentRow[]>("shipping_shipments", undefined, {
    select: "*",
    id: `eq.${incident.shipment_id}`,
    limit: 1,
  });
  const shipment = shipments[0];
  if (!shipment) throw new QuoteValidationError("Sendung zum Incident wurde nicht gefunden.", [], 404);
  return { incident, shipment };
}

async function patchIncident(incidentId: string, patch: Partial<ShippingIncidentRow>) {
  const rows = await supabaseRequest<ShippingIncidentRow[]>(
    "shipping_incidents",
    {
      method: "PATCH",
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${incidentId}` },
  );
  return mapIncident(rows[0]);
}

export async function updateShippingIncidentStatus(
  incidentId: string,
  status: Extract<ShippingIncidentStatus, "acknowledged" | "resolved" | "ignored">,
  actor?: ShippingUpdateActor | null,
) {
  const { incident, shipment } = await getIncidentWithShipment(incidentId);
  const now = new Date().toISOString();
  const updated = await patchIncident(incident.id, {
    status,
    resolved_at: status === "resolved" || status === "ignored" ? now : incident.resolved_at,
  });
  await insertShippingAudit({
    shipmentId: shipment.id,
    incidentId: incident.id,
    action: `incident_${status}`,
    idempotencyKey: `shipping:${incident.id}:${status}:${now}`,
    actor,
  });
  return updated;
}

export async function createShippingIncidentTask(incidentId: string, actor?: ShippingUpdateActor | null) {
  const { incident, shipment } = await getIncidentWithShipment(incidentId);
  if (incident.active_task_id) {
    return { incident: mapIncident(incident), taskId: incident.active_task_id, created: false };
  }

  const sourceRef = `shipping_incident:${incident.id}`;
  const existingTasks = await listOpsInternalTasks({ includeDone: false, requestId: incident.request_id || shipment.request_id });
  const existing = existingTasks.find((task) => task.sourceRef === sourceRef || task.description?.includes(`Shipping Incident: ${incident.id}`));
  if (existing) {
    await patchIncident(incident.id, { active_task_id: existing.id });
    return { incident: mapIncident({ ...incident, active_task_id: existing.id }), taskId: existing.id, created: false };
  }

  const task = await createOpsInternalTask(
    {
      title: incident.title,
      description: [
        incident.description,
        `Carrier: ${shipment.carrier.toUpperCase()}`,
        `Tracking: ${shipment.tracking_number}`,
        shipment.shopify_order_number ? `Shopify: ${shipment.shopify_order_number}` : null,
        `Shipping Incident: ${incident.id}`,
      ].filter(Boolean).join("\n"),
      category: "problem",
      priority: incident.severity === "urgent" ? "urgent" : incident.severity === "high" ? "high" : "normal",
      requestId: incident.request_id || shipment.request_id,
      sourceApp: "shipping_agent",
      sourceRef,
      metadata: {
        shipment_id: shipment.id,
        incident_id: incident.id,
        tracking_number: shipment.tracking_number,
        carrier: shipment.carrier,
      },
    },
    actor || undefined,
  );

  await patchIncident(incident.id, { active_task_id: task.id });
  await insertShippingAudit({
    shipmentId: shipment.id,
    incidentId: incident.id,
    action: "incident_task_created",
    idempotencyKey: `shipping:${incident.id}:task`,
    actor,
    metadata: { task_id: task.id },
  });
  return { incident: mapIncident({ ...incident, active_task_id: task.id }), taskId: task.id, created: true };
}
