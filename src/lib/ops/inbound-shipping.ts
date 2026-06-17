import { createOpsInternalTask, findOpsInternalTaskBySourceRef, listOpsInternalTasks, type OpsInternalTaskActor } from "@/lib/ops/internal-tasks";
import { attachmentName, selectMockupAttachments } from "@/lib/quotes/mockups";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { getTrelloCardVisuals } from "@/lib/quotes/trello";
import type { TrelloAttachment } from "@/lib/quotes/types";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const INBOUND_STATUS_VALUES = [
  "tracking_created",
  "carrier_not_found",
  "label_created",
  "tendered",
  "in_transit",
  "clearance_in_progress",
  "clearance_action_required",
  "out_for_delivery",
  "delivered",
  "exception",
  "stale",
  "closed",
] as const;

export type InboundStatus = (typeof INBOUND_STATUS_VALUES)[number];
export type InboundCarrier = "dhl" | "fedex" | "other" | "unknown";
export type InboundRiskLevel = "low" | "normal" | "watch" | "high" | "urgent" | "closed";
export type InboundIncidentSeverity = "watch" | "high" | "urgent";
export type InboundIncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type InboundIncidentType =
  | "clearance_action_required"
  | "clearance_watch"
  | "out_for_delivery"
  | "not_tendered"
  | "stale_no_movement"
  | "carrier_exception"
  | "carrier_not_found"
  | "tracking_error";

type InboundShipmentRow = {
  id: string;
  shipment_key: string;
  source: string;
  trello_card_id: string | null;
  trello_card_name: string | null;
  trello_card_url: string | null;
  trello_list_id: string | null;
  trello_list_name: string | null;
  carrier: InboundCarrier;
  tracking_number: string;
  tracking_raw: string | null;
  status: InboundStatus;
  status_reason: string | null;
  risk_level: InboundRiskLevel;
  first_seen_at: string | null;
  tracking_first_seen_at: string | null;
  tendered_at: string | null;
  last_event_at: string | null;
  last_movement_at: string | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  delivered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type InboundTrackingEventRow = {
  id: string;
  shipment_id: string;
  carrier: InboundCarrier;
  tracking_number: string;
  carrier_event_id: string | null;
  event_key: string;
  carrier_status_code: string | null;
  carrier_status_text: string | null;
  event_time: string;
  event_location: string | null;
  normalized_status: InboundStatus;
  mapping_version: string;
  created_at: string | null;
};

type InboundIncidentRow = {
  id: string;
  shipment_id: string;
  incident_key: string;
  incident_type: InboundIncidentType;
  severity: InboundIncidentSeverity;
  status: InboundIncidentStatus;
  title: string;
  description: string | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  rule_version: string;
  source_event_id: string | null;
  active_task_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type InboundRequestRow = {
  id: string;
  request_id: string;
  trello_card_id: string | null;
  updated_at: string | null;
};

type InboundCrmQuoteRow = {
  id: string;
  request_id: string | null;
  quote_number: string | null;
  status: string | null;
  created_at: string | null;
};

type InboundCrmQuoteVersionRow = {
  id: string;
  quote_id: string | null;
  label: string | null;
  created_at: string | null;
};

type InboundCrmQuoteVersionImageRow = {
  id: string;
  version_id: string | null;
  item_index: number | null;
  image_index: number | null;
  original_url: string | null;
  copied_url: string | null;
  versioned_url: string | null;
  created_at: string | null;
};

export type InboundShipment = {
  id: string;
  shipmentKey: string;
  source: string;
  trelloCardId: string | null;
  trelloCardName: string | null;
  trelloCardUrl: string | null;
  trelloListId: string | null;
  trelloListName: string | null;
  carrier: InboundCarrier;
  trackingNumber: string;
  trackingRaw: string | null;
  status: InboundStatus;
  statusReason: string | null;
  riskLevel: InboundRiskLevel;
  firstSeenAt: string | null;
  trackingFirstSeenAt: string | null;
  tenderedAt: string | null;
  lastEventAt: string | null;
  lastMovementAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type InboundTrackingEvent = {
  id: string;
  shipmentId: string;
  carrier: InboundCarrier;
  trackingNumber: string;
  carrierEventId: string | null;
  eventKey: string;
  carrierStatusCode: string | null;
  carrierStatusText: string | null;
  eventTime: string;
  eventLocation: string | null;
  normalizedStatus: InboundStatus;
  mappingVersion: string;
  createdAt: string | null;
};

export type InboundIncident = {
  id: string;
  shipmentId: string;
  incidentKey: string;
  incidentType: InboundIncidentType;
  severity: InboundIncidentSeverity;
  status: InboundIncidentStatus;
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

export type InboundShipmentVisual = {
  source: "quote_image" | "trello_reference" | "trello_mockup";
  sourceLabel: string;
  url: string;
  label: string;
  cardUrl: string | null;
};

export type InboundBoardItem = {
  shipment: InboundShipment;
  incidents: InboundIncident[];
  latestEvent: InboundTrackingEvent | null;
  visual: InboundShipmentVisual | null;
};

export type InboundBoard = {
  items: InboundBoardItem[];
  counts: {
    actionRequired: number;
    labelCreated: number;
    acceptedByCarrier: number;
    inTransit: number;
    clearance: number;
    outForDelivery: number;
    exception: number;
    stale: number;
    delivered: number;
    withOpenTask: number;
  };
};

type InboundUpdateActor = OpsInternalTaskActor & {
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

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => trimNullable(value)).filter(Boolean) as string[]));
}

function isLikelyImageAttachment(attachment: TrelloAttachment) {
  const name = attachmentName(attachment);
  return /\.(png|jpe?g|webp|avif)$/i.test(name) || Boolean(attachment.mimeType && /^image\//i.test(attachment.mimeType));
}

export function selectInboundTrelloVisualAttachment(attachments: TrelloAttachment[]) {
  const sortedImages = attachments
    .filter(isLikelyImageAttachment)
    .sort((left, right) => attachmentName(left).localeCompare(attachmentName(right), "de", { numeric: true }));
  return (
    sortedImages.find((attachment) => /^image\.png$/i.test(attachmentName(attachment))) ||
    sortedImages.find((attachment) => /^image[_-]?\d*\.(png|jpe?g|webp|avif)$/i.test(attachmentName(attachment))) ||
    selectMockupAttachments(attachments)[0] ||
    sortedImages[0] ||
    null
  );
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function normalizeInboundCarrier(value: string | null | undefined): InboundCarrier {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "unknown";
  if (text.includes("dhl")) return "dhl";
  if (/fed\s*ex|fedex|\bfx\b/.test(text)) return "fedex";
  return "other";
}

export function parseInboundTrackingValue(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const carrier = normalizeInboundCarrier(raw);
  const trackingNumber = raw
    .replace(/^(dhl\s*(express)?|fed\s*ex|fedex|fx)\s*[:#-]?\s*/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  return {
    valid: Boolean(raw && trackingNumber.length >= 6),
    carrier,
    trackingNumber: trackingNumber || null,
    raw: raw || null,
  };
}

export function normalizeInboundCarrierStatus(input: {
  carrier?: string | null;
  statusCode?: string | null;
  statusText?: string | null;
}): InboundStatus {
  const code = String(input.statusCode || "").trim().toUpperCase();
  const text = `${input.carrier || ""} ${input.statusCode || ""} ${input.statusText || ""}`.toLowerCase();
  if (!code && !text.trim()) return "carrier_not_found";
  if (code === "DL" || /delivered|zugestellt|delivery complete/.test(text)) return "delivered";
  if (code === "OD" || /out for delivery|outfordelivery|out with courier|with courier|on vehicle for delivery|in zustellung|wird zugestellt/.test(text)) return "out_for_delivery";
  if (code === "CD" || /clearance delay|additional information required|customs.*required|clearance.*required|zoll.*information|zoll.*erforder/.test(text)) {
    return "clearance_action_required";
  }
  if (code === "CP" || /\bclearance event\b/.test(text)) {
    return "clearance_in_progress";
  }
  if (["DE", "DD", "SE"].includes(code) || /exception|expired|delay|delayed|on hold|shipment is on hold|problem|failed/.test(text)) return "exception";
  if (code === "OC" || /shipment information sent|shipment information received|pre[-\s]*advice|inforeceived|info received|label created|label generated|sendungsdaten|daten.*uebermittelt|daten.*übermittelt/.test(text)) return "label_created";
  if (["PU", "IP"].includes(code) || /picked up|in fedex possession|accepted|received by carrier|shipment picked up|abgeholt|uebernommen|übernommen/.test(text)) {
    return "tendered";
  }
  if (["IT", "DP", "AF", "AR", "TR", "CC", "PM"].includes(code) || /in transit|on the way|arrived|departed|facility|hub|sort|transport|unterwegs|processed/.test(text)) {
    return "in_transit";
  }
  if (/not found|no tracking|unknown shipment|keine sendung|nicht gefunden/.test(text)) return "carrier_not_found";
  return "carrier_not_found";
}

function riskRank(value: InboundIncidentSeverity) {
  if (value === "urgent") return 0;
  if (value === "high") return 1;
  return 2;
}

function mapShipment(row: InboundShipmentRow): InboundShipment {
  return {
    id: row.id,
    shipmentKey: row.shipment_key,
    source: row.source,
    trelloCardId: row.trello_card_id,
    trelloCardName: row.trello_card_name,
    trelloCardUrl: row.trello_card_url,
    trelloListId: row.trello_list_id,
    trelloListName: row.trello_list_name,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    trackingRaw: row.tracking_raw,
    status: row.status,
    statusReason: row.status_reason,
    riskLevel: row.risk_level,
    firstSeenAt: row.first_seen_at,
    trackingFirstSeenAt: row.tracking_first_seen_at,
    tenderedAt: row.tendered_at,
    lastEventAt: row.last_event_at,
    lastMovementAt: row.last_movement_at,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: InboundTrackingEventRow): InboundTrackingEvent {
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

function mapIncident(row: InboundIncidentRow): InboundIncident {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
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

function isActiveInboundIncident(incident: InboundIncident) {
  return incident.status === "open" || incident.status === "acknowledged";
}

export function buildInboundBoardFromRows(
  shipmentRows: InboundShipmentRow[],
  incidentRows: InboundIncidentRow[],
  eventRows: InboundTrackingEventRow[],
): InboundBoard {
  const incidentsByShipment = new Map<string, InboundIncident[]>();
  for (const row of incidentRows) {
    const incident = mapIncident(row);
    const list = incidentsByShipment.get(incident.shipmentId) || [];
    list.push(incident);
    incidentsByShipment.set(incident.shipmentId, list);
  }

  const latestEventByShipment = new Map<string, InboundTrackingEvent>();
  for (const row of eventRows) {
    const event = mapEvent(row);
    const existing = latestEventByShipment.get(event.shipmentId);
    if (!existing || new Date(event.eventTime).getTime() > new Date(existing.eventTime).getTime()) {
      latestEventByShipment.set(event.shipmentId, event);
    }
  }

  const items = shipmentRows.map((row) => {
    const shipment = mapShipment(row);
    const incidents = (incidentsByShipment.get(shipment.id) || [])
      .filter(isActiveInboundIncident)
      .sort((left, right) => riskRank(left.severity) - riskRank(right.severity));
    return { shipment, incidents, latestEvent: latestEventByShipment.get(shipment.id) || null, visual: null };
  });

  items.sort((left, right) => {
    const leftRank = left.incidents.length ? Math.min(...left.incidents.map((incident) => riskRank(incident.severity))) : left.shipment.riskLevel === "urgent" ? 0 : left.shipment.riskLevel === "high" ? 1 : 3;
    const rightRank = right.incidents.length ? Math.min(...right.incidents.map((incident) => riskRank(incident.severity))) : right.shipment.riskLevel === "urgent" ? 0 : right.shipment.riskLevel === "high" ? 1 : 3;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return new Date(right.shipment.updatedAt || 0).getTime() - new Date(left.shipment.updatedAt || 0).getTime();
  });

  return {
    items,
    counts: {
      actionRequired: items.filter((item) => item.incidents.some((incident) => incident.status === "open" && incident.severity !== "watch")).length,
      labelCreated: items.filter((item) => item.shipment.status === "tracking_created" || item.shipment.status === "label_created").length,
      acceptedByCarrier: items.filter((item) => item.shipment.status === "tendered").length,
      inTransit: items.filter((item) => ["in_transit", "clearance_in_progress", "clearance_action_required", "out_for_delivery"].includes(item.shipment.status)).length,
      clearance: items.filter((item) => item.shipment.status.startsWith("clearance") || item.incidents.some((incident) => incident.incidentType === "clearance_action_required")).length,
      outForDelivery: items.filter((item) => item.shipment.status === "out_for_delivery").length,
      exception: items.filter((item) => item.shipment.status === "exception" || item.shipment.status === "carrier_not_found").length,
      stale: items.filter((item) => item.incidents.some((incident) => incident.incidentType === "not_tendered" || incident.incidentType === "stale_no_movement")).length,
      delivered: items.filter((item) => item.shipment.status === "delivered").length,
      withOpenTask: items.filter((item) => item.incidents.some((incident) => Boolean(incident.activeTaskId))).length,
    },
  };
}

function crmQuoteImageUrl(image: InboundCrmQuoteVersionImageRow) {
  return trimNullable(image.versioned_url) || trimNullable(image.copied_url) || trimNullable(image.original_url);
}

async function fetchQuoteVisualsByTrelloCardId(cardIds: string[]) {
  const visualsByCardId = new Map<string, InboundShipmentVisual>();
  if (!cardIds.length) return visualsByCardId;

  const requests = await supabaseRequest<InboundRequestRow[]>("master_requests", undefined, {
    select: "id,request_id,trello_card_id,updated_at",
    trello_card_id: `in.(${cardIds.map(encodeFilterValue).join(",")})`,
    order: "updated_at.desc",
    limit: Math.min(Math.max(cardIds.length * 2, 10), 120),
  });
  const cardIdByRequestId = new Map<string, string>();
  for (const request of requests) {
    const requestId = trimNullable(request.id);
    const cardId = trimNullable(request.trello_card_id);
    if (requestId && cardId && !cardIdByRequestId.has(requestId)) cardIdByRequestId.set(requestId, cardId);
  }
  const requestIds = Array.from(cardIdByRequestId.keys());
  if (!requestIds.length) return visualsByCardId;

  const quotes = await supabaseRequest<InboundCrmQuoteRow[]>("crm_quotes", undefined, {
    select: "id,request_id,quote_number,status,created_at",
    request_id: `in.(${requestIds.map(encodeFilterValue).join(",")})`,
    order: "created_at.desc",
    limit: Math.min(Math.max(requestIds.length * 4, 10), 160),
  });
  const quoteIds = uniqueValues(quotes.map((quote) => quote.id));
  if (!quoteIds.length) return visualsByCardId;

  const versions = await supabaseRequest<InboundCrmQuoteVersionRow[]>("crm_quote_versions", undefined, {
    select: "id,quote_id,label,created_at",
    quote_id: `in.(${quoteIds.map(encodeFilterValue).join(",")})`,
    order: "created_at.desc",
    limit: Math.min(Math.max(quoteIds.length * 3, 10), 200),
  });
  const versionIds = uniqueValues(versions.map((version) => version.id));
  if (!versionIds.length) return visualsByCardId;

  const images = await supabaseRequest<InboundCrmQuoteVersionImageRow[]>("crm_quote_version_images", undefined, {
    select: "id,version_id,item_index,image_index,original_url,copied_url,versioned_url,created_at",
    version_id: `in.(${versionIds.map(encodeFilterValue).join(",")})`,
    order: "created_at.desc",
    limit: Math.min(Math.max(versionIds.length * 4, 10), 300),
  });
  const versionsByQuoteId = new Map<string, InboundCrmQuoteVersionRow[]>();
  for (const version of versions) {
    if (!version.quote_id) continue;
    const list = versionsByQuoteId.get(version.quote_id) || [];
    list.push(version);
    versionsByQuoteId.set(version.quote_id, list);
  }
  const imagesByVersionId = new Map<string, InboundCrmQuoteVersionImageRow[]>();
  for (const image of images) {
    if (!image.version_id || !crmQuoteImageUrl(image)) continue;
    const list = imagesByVersionId.get(image.version_id) || [];
    list.push(image);
    imagesByVersionId.set(image.version_id, list);
  }

  for (const quote of quotes) {
    const requestId = trimNullable(quote.request_id);
    const cardId = requestId ? cardIdByRequestId.get(requestId) : null;
    if (!cardId || visualsByCardId.has(cardId)) continue;
    const quoteVersions = (versionsByQuoteId.get(quote.id) || []).sort(
      (left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
    );
    let selectedImage: InboundCrmQuoteVersionImageRow | null = null;
    for (const version of quoteVersions) {
      const versionImages = (imagesByVersionId.get(version.id) || []).sort((left, right) => {
        const leftItem = Number(left.item_index ?? 0);
        const rightItem = Number(right.item_index ?? 0);
        if (leftItem !== rightItem) return leftItem - rightItem;
        return Number(left.image_index ?? 0) - Number(right.image_index ?? 0);
      });
      selectedImage = versionImages[0] || null;
      if (selectedImage) break;
    }
    const url = selectedImage ? crmQuoteImageUrl(selectedImage) : null;
    if (!selectedImage || !url) continue;
    visualsByCardId.set(cardId, {
      source: "quote_image",
      sourceLabel: "Angebotsbild",
      url,
      label: trimNullable(quote.quote_number) || "Angebotsbild",
      cardUrl: null,
    });
  }

  return visualsByCardId;
}

async function fetchTrelloVisual(item: InboundBoardItem): Promise<InboundShipmentVisual | null> {
  const cardId = trimNullable(item.shipment.trelloCardId);
  if (!cardId) return null;

  try {
    const card = await getTrelloCardVisuals(cardId);
    const attachment = selectInboundTrelloVisualAttachment(card.attachments || []);
    if (!attachment) return null;
    const proxyCardId = trimNullable(card.id) || cardId;
    const attachmentId = trimNullable(attachment.id);
    if (!proxyCardId || !attachmentId) return null;
    const params = new URLSearchParams({ cardId: proxyCardId, attachmentId });
    const name = attachmentName(attachment) || "Trello Bild";
    const isMockup = selectMockupAttachments([attachment]).length > 0;
    return {
      source: isMockup ? "trello_mockup" : "trello_reference",
      sourceLabel: isMockup ? "Trello Mockup" : "Trello Bild",
      url: `/api/ops/customer-records/trello-attachments?${params.toString()}`,
      label: name,
      cardUrl: trimNullable(card.url) || item.shipment.trelloCardUrl,
    };
  } catch (error) {
    console.warn("inbound shipping trello visual unavailable", { shipmentId: item.shipment.id, cardId, error });
    return null;
  }
}

async function enrichInboundBoardWithVisuals(board: InboundBoard): Promise<InboundBoard> {
  const cardIds = uniqueValues(board.items.map((item) => item.shipment.trelloCardId));
  if (!cardIds.length) return board;

  let quoteVisualsByCardId = new Map<string, InboundShipmentVisual>();
  try {
    quoteVisualsByCardId = await fetchQuoteVisualsByTrelloCardId(cardIds);
  } catch (error) {
    console.warn("inbound shipping quote visuals unavailable", { error });
  }

  const itemsWithQuoteVisuals = board.items.map((item) => {
    const cardId = trimNullable(item.shipment.trelloCardId);
    return cardId && quoteVisualsByCardId.has(cardId) ? { ...item, visual: quoteVisualsByCardId.get(cardId) || null } : item;
  });
  const trelloCandidates = itemsWithQuoteVisuals.filter((item) => !item.visual && item.shipment.trelloCardId);
  const trelloVisualPairs = await mapWithConcurrency(trelloCandidates, 5, async (item) => ({
    shipmentId: item.shipment.id,
    visual: await fetchTrelloVisual(item),
  }));
  const trelloVisualsByShipmentId = new Map(trelloVisualPairs.filter((entry) => entry.visual).map((entry) => [entry.shipmentId, entry.visual as InboundShipmentVisual]));

  return {
    ...board,
    items: itemsWithQuoteVisuals.map((item) =>
      item.visual || !trelloVisualsByShipmentId.has(item.shipment.id)
        ? item
        : { ...item, visual: trelloVisualsByShipmentId.get(item.shipment.id) || null },
    ),
  };
}

export async function listInboundBoard(options?: {
  carrier?: InboundCarrier | "all" | null;
  scope?: "moving" | "active" | "problems" | "label_created" | "all";
  requestId?: string | null;
  limit?: number;
}): Promise<InboundBoard> {
  const requestId = trimNullable(options?.requestId);
  let requestCardIds: string[] = [];
  if (requestId) {
    requestCardIds = await resolveInboundTrelloCardIdsForRequestId(requestId);
    if (!requestCardIds.length) return buildInboundBoardFromRows([], [], []);
  }

  const query: Record<string, string | number | boolean | null> = {
    select: "*",
    order: "updated_at.desc",
    limit: Math.min(Math.max(options?.limit || 250, 1), 500),
  };
  if (requestCardIds.length) query.trello_card_id = `in.(${requestCardIds.map(encodeFilterValue).join(",")})`;
  if (options?.carrier && options.carrier !== "all") query.carrier = `eq.${options.carrier}`;
  if (options?.scope === "moving") query.status = "in.(tendered,in_transit,clearance_in_progress,clearance_action_required,out_for_delivery)";
  else if (options?.scope === "label_created") query.status = "in.(tracking_created,label_created)";
  else if (options?.scope !== "all") query.status = "not.in.(delivered,closed)";

  const shipmentRows = await supabaseRequest<InboundShipmentRow[]>("inbound_shipments", undefined, query);
  if (!shipmentRows.length) return buildInboundBoardFromRows([], [], []);

  const shipmentIds = shipmentRows.map((row) => row.id);
  const idFilter = `in.(${shipmentIds.map(encodeFilterValue).join(",")})`;
  const [incidentRows, eventRows] = await Promise.all([
    supabaseRequest<InboundIncidentRow[]>("inbound_incidents", undefined, {
      select: "*",
      shipment_id: idFilter,
      ...(options?.scope === "problems" ? { status: "in.(open,acknowledged)" } : {}),
      order: "last_detected_at.desc",
      limit: 1000,
    }),
    supabaseRequest<InboundTrackingEventRow[]>("inbound_tracking_events", undefined, {
      select: "*",
      shipment_id: idFilter,
      order: "event_time.desc",
      limit: 1000,
    }),
  ]);

  const board = await enrichInboundBoardWithVisuals(buildInboundBoardFromRows(shipmentRows, incidentRows, eventRows));
  if (options?.scope === "problems") {
    return {
      ...board,
      items: board.items.filter((item) => item.incidents.length > 0),
    };
  }
  return board;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveInboundTrelloCardIdsForRequestId(requestId: string) {
  const queries: Array<Record<string, string | number | boolean | null>> = [
    {
      select: "id,request_id,trello_card_id,updated_at",
      request_id: `eq.${requestId}`,
      order: "updated_at.desc",
      limit: 10,
    },
  ];
  if (isUuid(requestId)) {
    queries.push({
      select: "id,request_id,trello_card_id,updated_at",
      id: `eq.${requestId}`,
      order: "updated_at.desc",
      limit: 10,
    });
  }

  const rows = (await Promise.all(queries.map((query) => supabaseRequest<InboundRequestRow[]>("master_requests", undefined, query)))).flat();
  return uniqueValues(rows.map((row) => row.trello_card_id));
}

async function getIncidentWithShipment(incidentId: string) {
  const normalized = trimNullable(incidentId);
  if (!normalized) throw new QuoteValidationError("Bitte eine Inbound-Incident-ID angeben.");
  const incidents = await supabaseRequest<InboundIncidentRow[]>("inbound_incidents", undefined, {
    select: "*",
    id: `eq.${normalized}`,
    limit: 1,
  });
  const incident = incidents[0];
  if (!incident) throw new QuoteValidationError("Inbound-Incident wurde nicht gefunden.", [], 404);
  const shipments = await supabaseRequest<InboundShipmentRow[]>("inbound_shipments", undefined, {
    select: "*",
    id: `eq.${incident.shipment_id}`,
    limit: 1,
  });
  const shipment = shipments[0];
  if (!shipment) throw new QuoteValidationError("Inbound-Sendung zum Incident wurde nicht gefunden.", [], 404);
  return { incident, shipment };
}

async function patchIncident(incidentId: string, patch: Partial<InboundIncidentRow>) {
  const rows = await supabaseRequest<InboundIncidentRow[]>(
    "inbound_incidents",
    {
      method: "PATCH",
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${incidentId}` },
  );
  return mapIncident(rows[0]);
}

export async function updateInboundIncidentStatus(
  incidentId: string,
  status: Extract<InboundIncidentStatus, "acknowledged" | "resolved" | "ignored">,
) {
  const { incident } = await getIncidentWithShipment(incidentId);
  const now = new Date().toISOString();
  return patchIncident(incident.id, {
    status,
    resolved_at: status === "resolved" || status === "ignored" ? now : incident.resolved_at,
  });
}

export async function createInboundIncidentTask(incidentId: string, actor?: InboundUpdateActor | null) {
  const { incident, shipment } = await getIncidentWithShipment(incidentId);
  if (incident.active_task_id) {
    return { incident: mapIncident(incident), taskId: incident.active_task_id, created: false };
  }

  const sourceRef = `inbound_shipping_incident:${incident.id}`;
  let existing = await findOpsInternalTaskBySourceRef(sourceRef, { includeDone: true });
  if (!existing) {
    const existingTasks = await listOpsInternalTasks({ includeDone: true, limit: 150 });
    existing = existingTasks.find((task) => task.description?.includes(`Inbound Shipping Incident: ${incident.id}`)) || null;
  }
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
        shipment.trello_card_name ? `Trello: ${shipment.trello_card_name}` : null,
        shipment.trello_card_url ? `Trello URL: ${shipment.trello_card_url}` : null,
        `Inbound Shipping Incident: ${incident.id}`,
      ].filter(Boolean).join("\n"),
      category: "problem",
      priority: incident.severity === "urgent" ? "urgent" : incident.severity === "high" ? "high" : "normal",
      sourceApp: "inbound_shipping_agent",
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
  return { incident: mapIncident({ ...incident, active_task_id: task.id }), taskId: task.id, created: true };
}
