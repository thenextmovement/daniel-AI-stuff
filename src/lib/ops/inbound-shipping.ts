import { createOpsInternalTask, findOpsInternalTaskBySourceRef, listOpsInternalTasks, type OpsInternalTaskActor } from "@/lib/ops/internal-tasks";
import { attachmentName, selectMockupAttachments } from "@/lib/quotes/mockups";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
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

type InboundMasterOrderRow = {
  id: string;
  request_id: string | null;
  shopify_order_id: string | number | null;
  shopify_order_number: string | null;
  created_at: string | null;
  shopify_created_at: string | null;
};

type InboundCrmSaleOrderRow = {
  id: string;
  request_id: string | null;
  shopify_order_id: string | number | null;
  shopify_order_number: string | number | null;
  shopify_order_name: string | null;
  created_at: string | null;
  shopify_created_at: string | null;
};

type InboundSupplierSaleOrderRow = {
  id: string;
  request_id: string | null;
  trello_card_id: string | null;
  shopify_order_id: string | number | null;
  shopify_order_name: string | null;
  shopify_order_url: string | null;
  offer_id?: string | null;
  offer_number?: string | null;
  document_reference?: string | null;
  idempotency_key?: string | null;
  customer_name?: string | null;
  customer_company?: string | null;
  customer_email?: string | null;
  offer_snapshot?: Record<string, unknown> | null;
  raw_shopify?: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type InboundSupplierSaleItemRow = {
  id: string;
  sale_id: string;
  title: string;
  quantity: number | string | null;
  raw_line_item: Record<string, unknown>;
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

export type InboundShopifyOrderLink = {
  orderId: string;
  orderNumber: string | null;
  url: string;
  source: "master_orders" | "crm_sales" | "supplier_sales" | "shopify_admin_search";
  matchedBy?:
    | "supplier_sales_offer_id"
    | "supplier_sales_idempotency_key"
    | "supplier_sales_offer_number"
    | "supplier_sales_trello_card"
    | "supplier_sales_request"
    | "master_orders_request"
    | "crm_sales_request"
    | "shopify_admin_search";
  matchLabel?: string | null;
};

export type InboundDeliveryNotePdf = {
  fileName: string;
  bytes: Uint8Array;
};

export type InboundBoardItem = {
  shipment: InboundShipment;
  incidents: InboundIncident[];
  latestEvent: InboundTrackingEvent | null;
  visual: InboundShipmentVisual | null;
  shopifyOrder: InboundShopifyOrderLink | null;
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Array<Record<string, unknown>> : [];
}

function recordString(record: Record<string, unknown>, keys: string[], maxLength = 500) {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, maxLength);
  }
  return null;
}

function numericText(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : trimNullable(value);
}

function pdfText(value: unknown) {
  const text = String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  let escaped = "";
  for (const char of text) {
    if (char === "\\") escaped += "\\\\";
    else if (char === "(") escaped += "\\(";
    else if (char === ")") escaped += "\\)";
    else {
      const code = char.charCodeAt(0);
      if (code >= 32 && code <= 126) escaped += char;
      else if (code >= 160 && code <= 255) escaped += `\\${code.toString(8).padStart(3, "0")}`;
      else escaped += "?";
    }
  }
  return `(${escaped})`;
}

function wrapPdfText(value: unknown, maxChars: number) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function dateLabel(value: unknown) {
  const text = trimNullable(value);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function inboundStatusPdfLabel(status: InboundStatus) {
  const labels: Record<InboundStatus, string> = {
    tracking_created: "Tracking erfasst",
    carrier_not_found: "nicht gefunden",
    label_created: "Label erstellt",
    tendered: "uebergeben",
    in_transit: "unterwegs",
    clearance_in_progress: "Zoll laeuft",
    clearance_action_required: "Zoll braucht Aktion",
    out_for_delivery: "in Zustellung",
    delivered: "zugestellt",
    exception: "Ausnahme",
    stale: "stale",
    closed: "geschlossen",
  };
  return labels[status] || status;
}

function safePdfFileName(value: unknown) {
  const text = String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return text || "lieferschein";
}

function addressLines(value: unknown) {
  const address = jsonRecord(value);
  return [
    recordString(address, ["company"], 180),
    recordString(address, ["name"], 180),
    [recordString(address, ["address1", "street"], 180), recordString(address, ["address2"], 180)].filter(Boolean).join(" "),
    [recordString(address, ["zip", "postalCode"], 40), recordString(address, ["city"], 120)].filter(Boolean).join(" "),
    recordString(address, ["country"], 120),
  ].filter(Boolean);
}

class InboundPdfDocument {
  private pages: string[][] = [[]];
  private y = 0;

  constructor(private readonly width = 595.28, private readonly height = 841.89) {
    this.y = this.height - 52;
  }

  private current() {
    return this.pages[this.pages.length - 1];
  }

  addPage() {
    this.pages.push([]);
    this.y = this.height - 52;
  }

  ensure(space: number) {
    if (this.y - space < 64) this.addPage();
  }

  get cursorY() {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  get pageCount() {
    return this.pages.length;
  }

  text(value: unknown, x: number, y: number, options?: { size?: number; bold?: boolean; color?: string }) {
    const size = options?.size || 10;
    const font = options?.bold ? "F2" : "F1";
    const color = options?.color || "0 0 0";
    this.current().push(`BT ${color} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(value)} Tj ET`);
  }

  multiline(value: unknown, x: number, maxChars: number, options?: { size?: number; leading?: number; bold?: boolean; color?: string }) {
    const leading = options?.leading || 13;
    for (const line of wrapPdfText(value, maxChars)) {
      this.ensure(leading);
      this.text(line, x, this.y, options);
      this.y -= leading;
    }
  }

  rect(x: number, y: number, w: number, h: number, color = "0.96 0.95 0.92") {
    this.current().push(`${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  strokeRect(x: number, y: number, w: number, h: number, color = "0.90 0.88 0.91", width = 0.7) {
    this.current().push(`${color} RG ${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }

  render() {
    const objects: string[] = [];
    const addObject = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObject("");
    const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds: number[] = [];
    for (const commands of this.pages) {
      const stream = commands.join("\n");
      const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(pdf, "utf8"));
  }
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
    return { shipment, incidents, latestEvent: latestEventByShipment.get(shipment.id) || null, visual: null, shopifyOrder: null };
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

function shopifyShopDomain() {
  const configured =
    trimNullable(process.env.SHOPIFY_SHOP_DOMAIN) ||
    trimNullable(process.env.SHOPIFY_STORE_DOMAIN) ||
    trimNullable(process.env.SHOPIFY_SHOP);
  if (!configured) return null;
  return configured
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim();
}

function shopifyOrderNumericId(value: unknown) {
  const raw = trimNullable(value);
  if (!raw) return null;
  const gidMatch = raw.match(/^gid:\/\/shopify\/Order\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function shopifyOrderNumericIdFromUrl(value: unknown) {
  const raw = trimNullable(value);
  const match = raw?.match(/\/admin\/orders\/(\d+)/i);
  return match ? match[1] : null;
}

function shopifyAdminOrderUrl(orderId: unknown) {
  const domain = shopifyShopDomain();
  const numericId = shopifyOrderNumericId(orderId);
  if (!domain || !numericId) return null;
  return `https://${domain}/admin/orders/${numericId}`;
}

function shopifyAdminOrderSearchUrl(query: unknown) {
  const domain = shopifyShopDomain();
  const search = trimNullable(query);
  if (!domain || !search) return null;
  return `https://${domain}/admin/orders?query=${encodeURIComponent(search)}`;
}

function masterOrderLink(row: InboundMasterOrderRow): InboundShopifyOrderLink | null {
  const url = shopifyAdminOrderUrl(row.shopify_order_id);
  const orderId = trimNullable(row.shopify_order_id);
  if (!url || !orderId) return null;
  return {
    orderId,
    orderNumber: trimNullable(row.shopify_order_number),
    url,
    source: "master_orders",
    matchedBy: "master_orders_request",
    matchLabel: "Request -> master_orders",
  };
}

function crmSaleOrderLink(row: InboundCrmSaleOrderRow): InboundShopifyOrderLink | null {
  const url = shopifyAdminOrderUrl(row.shopify_order_id);
  const orderId = trimNullable(row.shopify_order_id);
  if (!url || !orderId) return null;
  return {
    orderId,
    orderNumber:
      trimNullable(row.shopify_order_name) ||
      (row.shopify_order_number === null || row.shopify_order_number === undefined ? null : String(row.shopify_order_number)),
    url,
    source: "crm_sales",
    matchedBy: "crm_sales_request",
    matchLabel: "Request -> crm_sales",
  };
}

function supplierSaleOrderLink(
  row: InboundSupplierSaleOrderRow,
  match?: Pick<InboundShopifyOrderLink, "matchedBy" | "matchLabel">,
): InboundShopifyOrderLink | null {
  const rawShopify = jsonRecord(row.raw_shopify);
  const storedUrl = trimNullable(row.shopify_order_url) || recordString(rawShopify, ["admin_url", "adminUrl"], 1000);
  const orderId =
    trimNullable(row.shopify_order_id) ||
    recordString(rawShopify, ["admin_graphql_api_id", "adminGraphqlApiId", "id", "order_id", "orderId"], 180) ||
    shopifyOrderNumericIdFromUrl(storedUrl);
  const url = storedUrl || shopifyAdminOrderUrl(orderId);
  if (!url || !orderId) return null;
  return {
    orderId,
    orderNumber:
      trimNullable(row.shopify_order_name) ||
      recordString(rawShopify, ["name", "order_name", "orderName", "order_number", "orderNumber"], 120),
    url,
    source: "supplier_sales",
    matchedBy: match?.matchedBy || "supplier_sales_trello_card",
    matchLabel: match?.matchLabel || "Trello -> supplier_sales",
  };
}

function sortByOrderCreatedAt<T extends { shopify_created_at: string | null; created_at: string | null }>(rows: T[]) {
  return [...rows].sort((left, right) =>
    new Date(right.shopify_created_at || right.created_at || 0).getTime() -
    new Date(left.shopify_created_at || left.created_at || 0).getTime(),
  );
}

function sortByUpdatedAt<T extends { updated_at: string | null; created_at: string | null }>(rows: T[]) {
  return [...rows].sort((left, right) =>
    new Date(right.updated_at || right.created_at || 0).getTime() -
    new Date(left.updated_at || left.created_at || 0).getTime(),
  );
}

type InboundOfferMatchReferences = {
  offerIds: Set<string>;
  offerNumbers: Set<string>;
  idempotencyKeys: Set<string>;
};

function emptyInboundOfferMatchReferences(): InboundOfferMatchReferences {
  return { offerIds: new Set(), offerNumbers: new Set(), idempotencyKeys: new Set() };
}

function addReference(set: Set<string>, value: unknown) {
  const normalized = trimNullable(value);
  if (normalized) set.add(normalized);
}

function addSupplierSaleReferences(references: InboundOfferMatchReferences, row: InboundSupplierSaleOrderRow) {
  addReference(references.offerIds, row.offer_id);
  addReference(references.offerNumbers, row.offer_number);
  addReference(references.offerNumbers, row.document_reference);
  addReference(references.idempotencyKeys, row.idempotency_key);
}

function addQuoteReferences(references: InboundOfferMatchReferences, quote: InboundCrmQuoteRow) {
  const offerId = trimNullable(quote.id);
  const offerNumber = trimNullable(quote.quote_number);
  addReference(references.offerIds, offerId);
  addReference(references.offerNumbers, offerNumber);
  if (offerId) addReference(references.idempotencyKeys, `offer:${offerId}:shopify-sale:v1`);
}

function normalizeInboundOfferNumber(value: unknown) {
  const text = trimNullable(value);
  const match = text?.match(/A\/N\s*(\d+)/i);
  return match ? `A/N ${match[1]}` : text;
}

function extractInboundOfferReferencesFromText(values: unknown[]) {
  const references = emptyInboundOfferMatchReferences();
  const text = values.map((value) => trimNullable(value)).filter(Boolean).join("\n");
  if (!text) return references;

  for (const match of text.matchAll(/A\/N\s*\d+/gi)) addReference(references.offerNumbers, normalizeInboundOfferNumber(match[0]));
  for (const match of text.matchAll(/offer:([a-z0-9_-]+):shopify-sale:v\d+/gi)) {
    addReference(references.offerIds, match[1]);
    addReference(references.idempotencyKeys, match[0]);
  }
  for (const pattern of [
    /NEONTRIP\s+Offer\s+ID\s*:?\s*([a-z0-9_-]+)/gi,
    /Offer\s+ID\s*:?\s*([a-z0-9_-]+)/gi,
    /angebote\.neontrip\.de\/offer\/([a-z0-9_-]+)/gi,
  ]) {
    for (const match of text.matchAll(pattern)) addReference(references.offerIds, match[1]);
  }
  return references;
}

function inboundShopifySearchTerm(shipment: InboundShipment) {
  const references = extractInboundOfferReferencesFromText([
    shipment.trelloCardName,
    shipment.trackingRaw,
    shipment.shipmentKey,
    shipment.statusReason,
  ]);
  const offerNumber = Array.from(references.offerNumbers)[0];
  if (offerNumber) return offerNumber;
  const offerId = Array.from(references.offerIds)[0];
  if (offerId) return offerId;
  const idempotencyKey = Array.from(references.idempotencyKeys)[0];
  if (idempotencyKey) return idempotencyKey;
  return trimNullable(shipment.trelloCardName) || trimNullable(shipment.trackingRaw) || trimNullable(shipment.trackingNumber);
}

function shopifyAdminSearchLinkForInboundShipment(shipment: InboundShipment): InboundShopifyOrderLink | null {
  const term = inboundShopifySearchTerm(shipment);
  const url = shopifyAdminOrderSearchUrl(term);
  if (!url || !term) return null;
  return {
    orderId: term,
    orderNumber: "Suche",
    url,
    source: "shopify_admin_search",
    matchedBy: "shopify_admin_search",
    matchLabel: `kein sicherer Match -> Suche ${term}`,
  };
}

function addOrderForCard(
  ordersByCardId: Map<string, InboundShopifyOrderLink>,
  cardId: string | null | undefined,
  order: InboundShopifyOrderLink | null,
) {
  if (cardId && order && !ordersByCardId.has(cardId)) ordersByCardId.set(cardId, order);
}

function inboundShipmentHasOfferReferences(shipment: InboundShipment) {
  const references = extractInboundOfferReferencesFromText([
    shipment.trelloCardName,
    shipment.trackingRaw,
    shipment.shipmentKey,
    shipment.statusReason,
  ]);
  return Boolean(references.offerIds.size || references.offerNumbers.size || references.idempotencyKeys.size);
}

function supplierSalesSelect(extra = "") {
  const fields = [
    "id",
    "request_id",
    "trello_card_id",
    "shopify_order_id",
    "shopify_order_name",
    "shopify_order_url",
    "offer_id",
    "offer_number",
    "document_reference",
    "idempotency_key",
    "raw_shopify",
    "created_at",
    "updated_at",
  ];
  return [...fields, ...extra.split(",").map((field) => field.trim()).filter(Boolean)].join(",");
}

function supplierSalesHasShopifyOrderFilter() {
  return "(shopify_order_id.not.is.null,shopify_order_url.not.is.null,shopify_order_name.not.is.null,raw_shopify.not.is.null)";
}

async function fetchShopifyOrdersByTrelloCardId(cardIds: string[]) {
  const ordersByCardId = new Map<string, InboundShopifyOrderLink>();
  if (!cardIds.length) return ordersByCardId;

  const requests = await supabaseRequest<InboundRequestRow[]>("master_requests", undefined, {
    select: "id,request_id,trello_card_id,updated_at",
    trello_card_id: `in.(${cardIds.map(encodeFilterValue).join(",")})`,
    order: "updated_at.desc",
    limit: Math.min(Math.max(cardIds.length * 2, 10), 120),
  });
  const cardIdByRequestId = new Map<string, string>();
  for (const request of requests) {
    const cardId = trimNullable(request.trello_card_id);
    if (!cardId) continue;
    for (const requestId of uniqueValues([request.id, request.request_id])) {
      if (!cardIdByRequestId.has(requestId)) cardIdByRequestId.set(requestId, cardId);
    }
  }
  const requestIds = Array.from(cardIdByRequestId.keys());
  const requestIdFilter = requestIds.length ? `in.(${requestIds.map(encodeFilterValue).join(",")})` : null;
  const cardIdFilter = `in.(${cardIds.map(encodeFilterValue).join(",")})`;
  const [masterOrders, crmSales, supplierSalesByCard, supplierSalesByRequest, quoteRows] = await Promise.all([
    requestIdFilter
      ? supabaseRequest<InboundMasterOrderRow[]>("master_orders", undefined, {
          select: "id,request_id,shopify_order_id,shopify_order_number,created_at,shopify_created_at",
          request_id: requestIdFilter,
          order: "shopify_created_at.desc",
          limit: Math.min(Math.max(requestIds.length * 3, 10), 200),
        })
      : Promise.resolve([]),
    requestIdFilter
      ? supabaseRequest<InboundCrmSaleOrderRow[]>("crm_sales", undefined, {
          select: "id,request_id,shopify_order_id,shopify_order_number,shopify_order_name,created_at,shopify_created_at",
          request_id: requestIdFilter,
          order: "shopify_created_at.desc",
          limit: Math.min(Math.max(requestIds.length * 3, 10), 200),
        })
      : Promise.resolve([]),
    supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
      select: supplierSalesSelect(),
      trello_card_id: cardIdFilter,
      order: "updated_at.desc",
      limit: Math.min(Math.max(cardIds.length * 3, 10), 200),
    }),
    requestIdFilter
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          request_id: requestIdFilter,
          order: "updated_at.desc",
          limit: Math.min(Math.max(requestIds.length * 3, 10), 200),
        })
      : Promise.resolve([]),
    requestIdFilter
      ? supabaseRequest<InboundCrmQuoteRow[]>("crm_quotes", undefined, {
          select: "id,request_id,quote_number,status,created_at",
          request_id: requestIdFilter,
          order: "created_at.desc",
          limit: Math.min(Math.max(requestIds.length * 4, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const referencesByCardId = new Map<string, InboundOfferMatchReferences>();
  for (const cardId of cardIds) referencesByCardId.set(cardId, emptyInboundOfferMatchReferences());
  for (const quote of quoteRows) {
    const requestId = trimNullable(quote.request_id);
    const cardId = requestId ? cardIdByRequestId.get(requestId) : null;
    if (cardId) addQuoteReferences(referencesByCardId.get(cardId) || emptyInboundOfferMatchReferences(), quote);
  }
  for (const row of [...supplierSalesByCard, ...supplierSalesByRequest]) {
    const cardId = trimNullable(row.trello_card_id) || (row.request_id ? cardIdByRequestId.get(row.request_id) : null);
    if (!cardId) continue;
    const refs = referencesByCardId.get(cardId) || emptyInboundOfferMatchReferences();
    addSupplierSaleReferences(refs, row);
    referencesByCardId.set(cardId, refs);
  }
  const allOfferIds = uniqueValues(Array.from(referencesByCardId.values()).flatMap((refs) => Array.from(refs.offerIds)));
  const allOfferNumbers = uniqueValues(Array.from(referencesByCardId.values()).flatMap((refs) => Array.from(refs.offerNumbers)));
  const allIdempotencyKeys = uniqueValues(Array.from(referencesByCardId.values()).flatMap((refs) => Array.from(refs.idempotencyKeys)));
  const [supplierSalesByOfferId, supplierSalesByOfferNumber, supplierSalesByDocumentReference, supplierSalesByIdempotencyKey] = await Promise.all([
    allOfferIds.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          offer_id: `in.(${allOfferIds.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferIds.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allOfferNumbers.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          offer_number: `in.(${allOfferNumbers.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferNumbers.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allOfferNumbers.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          document_reference: `in.(${allOfferNumbers.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferNumbers.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allIdempotencyKeys.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          idempotency_key: `in.(${allIdempotencyKeys.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allIdempotencyKeys.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const supplierRowsById = new Map<string, InboundSupplierSaleOrderRow>();
  for (const row of [...supplierSalesByCard, ...supplierSalesByRequest, ...supplierSalesByOfferId, ...supplierSalesByOfferNumber, ...supplierSalesByDocumentReference, ...supplierSalesByIdempotencyKey]) {
    supplierRowsById.set(row.id, row);
  }

  for (const cardId of cardIds) {
    const refs = referencesByCardId.get(cardId);
    if (!refs) continue;
    const byOfferId = sortByUpdatedAt(supplierSalesByOfferId).find((row) => trimNullable(row.offer_id) && refs.offerIds.has(trimNullable(row.offer_id) as string));
    if (byOfferId) {
      addOrderForCard(ordersByCardId, cardId, supplierSaleOrderLink(byOfferId, { matchedBy: "supplier_sales_offer_id", matchLabel: `Offer ID ${byOfferId.offer_id}` }));
    }
    const byIdempotency = sortByUpdatedAt(supplierSalesByIdempotencyKey).find((row) => trimNullable(row.idempotency_key) && refs.idempotencyKeys.has(trimNullable(row.idempotency_key) as string));
    if (byIdempotency) {
      addOrderForCard(ordersByCardId, cardId, supplierSaleOrderLink(byIdempotency, { matchedBy: "supplier_sales_idempotency_key", matchLabel: "Idempotency Key" }));
    }
    const offerNumberRowsById = new Map([...supplierSalesByOfferNumber, ...supplierSalesByDocumentReference].filter((row) => {
      const reference = trimNullable(row.offer_number) || trimNullable(row.document_reference);
      return Boolean(reference && refs.offerNumbers.has(reference));
    }).map((row) => [row.id, row]));
    const offerNumberMatches = Array.from(offerNumberRowsById.values());
    const uniqueOfferNumbers = new Set(offerNumberMatches.map((row) => trimNullable(row.offer_number) || trimNullable(row.document_reference)).filter(Boolean));
    if (offerNumberMatches.length === 1 && uniqueOfferNumbers.size === 1) {
      const row = offerNumberMatches[0];
      addOrderForCard(ordersByCardId, cardId, supplierSaleOrderLink(row, { matchedBy: "supplier_sales_offer_number", matchLabel: `Offer Number ${trimNullable(row.offer_number) || trimNullable(row.document_reference)}` }));
    }
  }

  const directSupplierRowsByCardId = new Map<string, InboundSupplierSaleOrderRow[]>();
  for (const row of [...supplierSalesByCard, ...supplierSalesByRequest]) {
    const cardId = trimNullable(row.trello_card_id) || (row.request_id ? cardIdByRequestId.get(row.request_id) : null);
    if (!cardId || !supplierSaleOrderLink(row)) continue;
    const rows = directSupplierRowsByCardId.get(cardId) || [];
    rows.push(row);
    directSupplierRowsByCardId.set(cardId, rows);
  }
  const directSupplierRowsById = new Map<string, InboundSupplierSaleOrderRow>();
  for (const [cardId, rows] of directSupplierRowsByCardId.entries()) {
    const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values());
    if (uniqueRows.length === 1) directSupplierRowsById.set(uniqueRows[0].id, uniqueRows[0]);
    else directSupplierRowsByCardId.set(cardId, uniqueRows);
  }

  for (const row of sortByUpdatedAt(Array.from(directSupplierRowsById.values()))) {
    const cardId = trimNullable(row.trello_card_id) || (row.request_id ? cardIdByRequestId.get(row.request_id) : null);
    const matchedBy = trimNullable(row.trello_card_id) ? "supplier_sales_trello_card" : "supplier_sales_request";
    const order = supplierSaleOrderLink(row, {
      matchedBy,
      matchLabel: matchedBy === "supplier_sales_trello_card" ? "Trello -> supplier_sales" : "Request -> supplier_sales",
    });
    addOrderForCard(ordersByCardId, cardId, order);
  }
  for (const row of sortByOrderCreatedAt(masterOrders)) {
    const requestId = trimNullable(row.request_id);
    const cardId = requestId ? cardIdByRequestId.get(requestId) : null;
    addOrderForCard(ordersByCardId, cardId, masterOrderLink(row));
  }
  for (const row of sortByOrderCreatedAt(crmSales)) {
    const requestId = trimNullable(row.request_id);
    const cardId = requestId ? cardIdByRequestId.get(requestId) : null;
    addOrderForCard(ordersByCardId, cardId, crmSaleOrderLink(row));
  }

  return ordersByCardId;
}

async function fetchShopifyOrdersByLooseInboundReferences(shipments: InboundShipment[]) {
  const ordersByShipmentId = new Map<string, InboundShopifyOrderLink>();
  const referencesByShipmentId = new Map<string, InboundOfferMatchReferences>();
  for (const shipment of shipments) {
    const references = extractInboundOfferReferencesFromText([
      shipment.trelloCardName,
      shipment.trackingRaw,
      shipment.shipmentKey,
      shipment.statusReason,
    ]);
    if (references.offerIds.size || references.offerNumbers.size || references.idempotencyKeys.size) {
      referencesByShipmentId.set(shipment.id, references);
    }
  }
  if (!referencesByShipmentId.size) return ordersByShipmentId;

  const allOfferIds = uniqueValues(Array.from(referencesByShipmentId.values()).flatMap((refs) => Array.from(refs.offerIds)));
  const allOfferNumbers = uniqueValues(Array.from(referencesByShipmentId.values()).flatMap((refs) => Array.from(refs.offerNumbers)));
  const allIdempotencyKeys = uniqueValues(Array.from(referencesByShipmentId.values()).flatMap((refs) => Array.from(refs.idempotencyKeys)));
  const [supplierSalesByOfferId, supplierSalesByOfferNumber, supplierSalesByDocumentReference, supplierSalesByIdempotencyKey] = await Promise.all([
    allOfferIds.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          offer_id: `in.(${allOfferIds.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferIds.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allOfferNumbers.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          offer_number: `in.(${allOfferNumbers.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferNumbers.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allOfferNumbers.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          document_reference: `in.(${allOfferNumbers.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allOfferNumbers.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
    allIdempotencyKeys.length
      ? supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
          select: supplierSalesSelect(),
          idempotency_key: `in.(${allIdempotencyKeys.map(encodeFilterValue).join(",")})`,
          or: supplierSalesHasShopifyOrderFilter(),
          order: "updated_at.desc",
          limit: Math.min(Math.max(allIdempotencyKeys.length * 2, 10), 200),
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  for (const shipment of shipments) {
    const refs = referencesByShipmentId.get(shipment.id);
    if (!refs) continue;
    const prefix = trimNullable(shipment.trelloCardId) ? "Shipment" : "Ohne Trello-ID";
    const byOfferId = sortByUpdatedAt(supplierSalesByOfferId).find((row) => trimNullable(row.offer_id) && refs.offerIds.has(trimNullable(row.offer_id) as string));
    if (byOfferId) {
      const order = supplierSaleOrderLink(byOfferId, { matchedBy: "supplier_sales_offer_id", matchLabel: `${prefix} -> Offer ID ${byOfferId.offer_id}` });
      if (order) ordersByShipmentId.set(shipment.id, order);
      continue;
    }
    const byIdempotency = sortByUpdatedAt(supplierSalesByIdempotencyKey).find((row) => trimNullable(row.idempotency_key) && refs.idempotencyKeys.has(trimNullable(row.idempotency_key) as string));
    if (byIdempotency) {
      const order = supplierSaleOrderLink(byIdempotency, { matchedBy: "supplier_sales_idempotency_key", matchLabel: `${prefix} -> Idempotency Key` });
      if (order) ordersByShipmentId.set(shipment.id, order);
      continue;
    }
    const offerNumberRowsById = new Map([...supplierSalesByOfferNumber, ...supplierSalesByDocumentReference].filter((row) => {
      const reference = trimNullable(row.offer_number) || trimNullable(row.document_reference);
      return Boolean(reference && refs.offerNumbers.has(reference));
    }).map((row) => [row.id, row]));
    const offerNumberMatches = Array.from(offerNumberRowsById.values());
    const uniqueOfferNumbers = new Set(offerNumberMatches.map((row) => trimNullable(row.offer_number) || trimNullable(row.document_reference)).filter(Boolean));
    if (offerNumberMatches.length === 1 && uniqueOfferNumbers.size === 1) {
      const row = offerNumberMatches[0];
      const reference = trimNullable(row.offer_number) || trimNullable(row.document_reference);
      const order = supplierSaleOrderLink(row, { matchedBy: "supplier_sales_offer_number", matchLabel: `${prefix} -> Offer Number ${reference}` });
      if (order) ordersByShipmentId.set(shipment.id, order);
    }
  }
  return ordersByShipmentId;
}

function renderInboundPdfCard(pdf: InboundPdfDocument, x: number, y: number, w: number, h: number, title: string, lines: unknown[], options?: { dark?: boolean }) {
  const dark = options?.dark === true;
  pdf.rect(x, y, w, h, dark ? "0.12 0.10 0.12" : "1 1 1");
  pdf.strokeRect(x, y, w, h, dark ? "0.24 0.20 0.24" : "0.90 0.88 0.91", 0.6);
  pdf.text(title.toUpperCase(), x + 14, y + h - 19, { size: 7.5, bold: true, color: dark ? "0.70 0.64 0.70" : "0.48 0.43 0.51" });
  let currentY = y + h - 35;
  for (const line of lines.filter(Boolean).slice(0, 7)) {
    pdf.text(line, x + 14, currentY, { size: 10, color: dark ? "1 1 1" : "0.07 0.06 0.08", bold: currentY === y + h - 35 });
    currentY -= 13;
  }
}

function renderInboundPdfFooter(pdf: InboundPdfDocument, reference: string, page: number) {
  pdf.text(reference, 48, 34, { size: 7.5, color: "0.50 0.47 0.53" });
  pdf.text(`NEONTRIP Lieferschein - ${page}`, 410, 34, { size: 7.5, color: "0.50 0.47 0.53" });
}

function renderInboundPdfHeader(pdf: InboundPdfDocument, reference: string, page: number) {
  pdf.text("NEONTRIP", 430, 806, { size: 14, bold: true });
  pdf.text(reference, 48, 806, { size: 8.5, color: "0.50 0.47 0.53" });
  renderInboundPdfFooter(pdf, reference, page);
}

function inboundDeliveryLineItems(sale: InboundSupplierSaleOrderRow | null, itemRows: InboundSupplierSaleItemRow[], fallbackTitle: string) {
  const snapshot = jsonRecord(sale?.offer_snapshot);
  const snapshotItems = arrayRecords(snapshot.lineItems);
  if (snapshotItems.length) {
    return snapshotItems.map((item, index) => ({
      title: recordString(item, ["title", "name"], 240) || `Position ${index + 1}`,
      description: null,
      quantity: numericText(item.quantity) || numericText(item.normalizedQuantity) || "1",
    }));
  }
  if (itemRows.length) {
    return itemRows.map((item, index) => ({
      title: item.title || `Position ${index + 1}`,
      description: null,
      quantity: numericText(item.quantity) || "1",
    }));
  }
  return [{ title: fallbackTitle || "Inbound-Sendung", description: null, quantity: "1" }];
}

async function fetchInboundSupplierSaleForShipment(shipment: InboundShipmentRow) {
  const cardId = trimNullable(shipment.trello_card_id);
  if (!cardId) return null;
  const rows = await supabaseRequest<InboundSupplierSaleOrderRow[]>("supplier_sales", undefined, {
    select: "id,request_id,trello_card_id,shopify_order_id,shopify_order_name,shopify_order_url,offer_number,customer_name,customer_company,customer_email,offer_snapshot,raw_shopify,created_at,updated_at",
    trello_card_id: `eq.${encodeFilterValue(cardId)}`,
    order: "updated_at.desc",
    limit: 1,
  }).catch(() => []);
  return rows[0] || null;
}

export async function generateInboundDeliveryNotePdf(shipmentId: string): Promise<InboundDeliveryNotePdf> {
  const id = trimNullable(shipmentId);
  if (!id) throw new QuoteValidationError("Sendung fehlt.", ["shipmentId ist erforderlich."], 400);

  const shipments = await supabaseRequest<InboundShipmentRow[]>("inbound_shipments", undefined, {
    select: "*",
    id: `eq.${encodeFilterValue(id)}`,
    limit: 1,
  });
  const shipment = shipments[0];
  if (!shipment) throw new QuoteValidationError("Sendung nicht gefunden.", [`shipmentId=${id}`], 404);

  const [events, sale, shopifyByCard] = await Promise.all([
    supabaseRequest<InboundTrackingEventRow[]>("inbound_tracking_events", undefined, {
      select: "*",
      shipment_id: `eq.${encodeFilterValue(shipment.id)}`,
      order: "event_time.desc",
      limit: 1,
    }),
    fetchInboundSupplierSaleForShipment(shipment),
    shipment.trello_card_id ? fetchShopifyOrdersByTrelloCardId([shipment.trello_card_id]) : Promise.resolve(new Map<string, InboundShopifyOrderLink>()),
  ]);
  const itemRows = sale
    ? await supabaseRequest<InboundSupplierSaleItemRow[]>("supplier_sale_items", undefined, {
        select: "id,sale_id,title,quantity,raw_line_item",
        sale_id: `eq.${encodeFilterValue(sale.id)}`,
        order: "created_at.asc",
        limit: 200,
      }).catch(() => [])
    : [];
  const latestEvent = events[0] || null;
  const snapshot = jsonRecord(sale?.offer_snapshot);
  const customer = jsonRecord(snapshot.customer);
  const rawShopify = jsonRecord(sale?.raw_shopify);
  const shopifyOrder = shipment.trello_card_id ? shopifyByCard.get(shipment.trello_card_id) || null : null;
  const reference = sale?.offer_number || shopifyOrder?.orderNumber || shipment.tracking_number;
  const customerLabel =
    trimNullable(sale?.customer_company) ||
    trimNullable(sale?.customer_name) ||
    recordString(customer, ["company", "signerName", "name"], 180) ||
    "Empfänger";
  const customerLines = [
    customerLabel,
    sale?.customer_name && sale.customer_name !== customerLabel ? sale.customer_name : null,
    sale?.customer_email || recordString(customer, ["email"], 180),
  ].filter(Boolean);
  const deliveryAddress =
    addressLines(snapshot.deliveryAddress).length ? addressLines(snapshot.deliveryAddress) :
    addressLines(rawShopify.shipping_address).length ? addressLines(rawShopify.shipping_address) :
    addressLines(rawShopify.shippingAddress);
  const lines = inboundDeliveryLineItems(sale, itemRows, shipment.trello_card_name || shipment.tracking_number);
  const pdf = new InboundPdfDocument();

  pdf.rect(0, 0, 595.28, 841.89, "0.04 0.04 0.04");
  pdf.rect(0, 0, 595.28, 96, "0.10 0.03 0.07");
  pdf.rect(46, 746, 96, 22, "0.98 0.19 0.64");
  pdf.text("WARENAUSGANG", 58, 753, { size: 7.5, bold: true, color: "1 1 1" });
  pdf.text("NEONTRIP", 48, 792, { size: 20, bold: true, color: "1 1 1" });
  pdf.text("Lieferschein", 48, 672, { size: 40, bold: true, color: "1 1 1" });
  pdf.text("Begleitdokument zur Lieferung. Keine Preise, keine Rechnung.", 50, 640, { size: 12, color: "0.78 0.74 0.80" });
  renderInboundPdfCard(pdf, 48, 514, 226, 96, "Sendung", [
    `Tracking: ${shipment.tracking_number}`,
    `Carrier: ${shipment.carrier.toUpperCase()}`,
    `Status: ${inboundStatusPdfLabel(shipment.status)}`,
    `Letztes Event: ${dateLabel(latestEvent?.event_time || shipment.last_event_at)}`,
  ], { dark: true });
  renderInboundPdfCard(pdf, 310, 514, 220, 96, "Referenz", [
    `Dokument: ${reference}`,
    shopifyOrder?.orderNumber ? `Shopify: ${shopifyOrder.orderNumber}` : null,
    sale?.offer_number ? `Angebot: ${sale.offer_number}` : null,
    `Erstellt: ${dateLabel(new Date().toISOString())}`,
  ], { dark: true });
  renderInboundPdfCard(pdf, 48, 390, 226, 92, "Empfänger", customerLines.length ? customerLines : ["Empfänger laut Shopify/Angebot"], { dark: true });
  renderInboundPdfCard(pdf, 310, 390, 220, 92, "Lieferanschrift", deliveryAddress.length ? deliveryAddress : ["Keine Lieferanschrift gespeichert"], { dark: true });
  ["Keine Preise", "Keine Rechnung", "NEONTRIP Layout", "Wareneingang"].forEach((label, index) => {
    const x = 48 + index * 122;
    pdf.rect(x, 134, 106, 54, "0.12 0.10 0.12");
    pdf.strokeRect(x, 134, 106, 54, "0.24 0.20 0.24", 0.5);
    pdf.text(label, x + 10, 160, { size: 9.5, bold: true, color: "1 1 1" });
  });
  pdf.text("Automatisch aus Inbound Shipping erzeugt. Preis- und Zahlungsinformationen sind bewusst ausgeblendet.", 48, 76, { size: 8.5, color: "0.62 0.58 0.64" });

  pdf.addPage();
  renderInboundPdfHeader(pdf, reference, 2);
  pdf.rect(48, 728, 86, 22, "0.98 0.89 0.95");
  pdf.text("LIEFERDATEN", 60, 735, { size: 7.5, bold: true, color: "0.88 0.08 0.48" });
  pdf.text("Positionen", 48, 690, { size: 25, bold: true });
  pdf.text("Mengen und Artikelbeschreibung zur Lieferung. Keine Netto-, Brutto- oder Steuerwerte.", 48, 668, { size: 10, color: "0.42 0.38 0.45" });
  pdf.rect(48, 628, 500, 24, "0.96 0.94 0.97");
  pdf.text("Position", 62, 636, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.text("Menge", 468, 636, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.cursorY = 604;
  for (const [index, item] of lines.entries()) {
    const descriptionLines = item.description ? wrapPdfText(item.description, 70).length : 0;
    const rowHeight = Math.max(46, 32 + descriptionLines * 10);
    if (pdf.cursorY - rowHeight < 72) {
      pdf.addPage();
      renderInboundPdfHeader(pdf, reference, pdf.pageCount);
      pdf.text("Positionen (Fortsetzung)", 48, 744, { size: 18, bold: true });
      pdf.rect(48, 704, 500, 24, "0.96 0.94 0.97");
      pdf.text("Position", 62, 712, { size: 8, bold: true, color: "0.48 0.43 0.51" });
      pdf.text("Menge", 468, 712, { size: 8, bold: true, color: "0.48 0.43 0.51" });
      pdf.cursorY = 680;
    }
    const rowY = pdf.cursorY - rowHeight;
    pdf.rect(48, rowY, 500, rowHeight - 4, index % 2 === 0 ? "1 1 1" : "0.985 0.975 0.99");
    pdf.strokeRect(48, rowY, 500, rowHeight - 4, "0.90 0.88 0.91", 0.45);
    pdf.text(item.title, 62, pdf.cursorY - 18, { size: 10, bold: true });
    if (item.description) {
      const oldY = pdf.cursorY;
      pdf.cursorY = pdf.cursorY - 34;
      pdf.multiline(item.description, 62, 70, { size: 8, color: "0.42 0.38 0.45", leading: 10 });
      pdf.cursorY = oldY;
    }
    pdf.text(String(item.quantity || "1"), 474, pdf.cursorY - 18, { size: 9, bold: true });
    pdf.cursorY = rowY - 10;
  }
  pdf.rect(48, Math.max(52, pdf.cursorY - 52), 500, 42, "0.98 0.89 0.95");
  pdf.text("Hinweis", 62, Math.max(77, pdf.cursorY - 28), { size: 9, bold: true, color: "0.88 0.08 0.48" });
  pdf.text("Dieser Lieferschein enthält keine Preise und ersetzt keine Rechnung.", 62, Math.max(63, pdf.cursorY - 43), { size: 8.5, color: "0.18 0.12 0.18" });

  return {
    fileName: `lieferschein-${safePdfFileName(reference)}-${safePdfFileName(shipment.tracking_number)}.pdf`,
    bytes: pdf.render(),
  };
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
  const shipmentsWithOfferReferences = board.items.map((item) => item.shipment).filter(inboundShipmentHasOfferReferences);

  let quoteVisualsByCardId = new Map<string, InboundShipmentVisual>();
  let shopifyOrdersByCardId = new Map<string, InboundShopifyOrderLink>();
  let shopifyOrdersByShipmentId = new Map<string, InboundShopifyOrderLink>();
  if (cardIds.length) {
    try {
      quoteVisualsByCardId = await fetchQuoteVisualsByTrelloCardId(cardIds);
    } catch (error) {
      console.warn("inbound shipping quote visuals unavailable", { error });
    }
    try {
      shopifyOrdersByCardId = await fetchShopifyOrdersByTrelloCardId(cardIds);
    } catch (error) {
      console.warn("inbound shipping shopify orders unavailable", { error });
    }
  }
  try {
    shopifyOrdersByShipmentId = await fetchShopifyOrdersByLooseInboundReferences(shipmentsWithOfferReferences);
  } catch (error) {
    console.warn("inbound shipping shipment-reference shopify orders unavailable", { error });
  }

  const itemsWithQuoteVisuals = board.items.map((item) => {
    const cardId = trimNullable(item.shipment.trelloCardId);
    if (!cardId) {
      return {
        ...item,
        shopifyOrder: shopifyOrdersByShipmentId.get(item.shipment.id) || item.shopifyOrder || shopifyAdminSearchLinkForInboundShipment(item.shipment),
      };
    }
    const exactShopifyOrder = shopifyOrdersByShipmentId.get(item.shipment.id) || shopifyOrdersByCardId.get(cardId) || item.shopifyOrder;
    return {
      ...item,
      visual: quoteVisualsByCardId.get(cardId) || item.visual,
      shopifyOrder: exactShopifyOrder || shopifyAdminSearchLinkForInboundShipment(item.shipment),
    };
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

export async function markInboundShipmentOutForDelivery(shipmentId: string, actor?: InboundUpdateActor | null) {
  const id = trimNullable(shipmentId);
  if (!id) throw new QuoteValidationError("Sendung fehlt.", ["shipmentId ist erforderlich."], 400);

  const rows = await supabaseRequest<InboundShipmentRow[]>("inbound_shipments", undefined, {
    select: "*",
    id: `eq.${encodeFilterValue(id)}`,
    limit: 1,
  });
  const shipment = rows[0];
  if (!shipment) throw new QuoteValidationError("Sendung nicht gefunden.", [`shipmentId=${id}`], 404);
  if (shipment.status === "delivered" || shipment.status === "closed") {
    throw new QuoteValidationError("Sendung ist bereits abgeschlossen.", [`status=${shipment.status}`], 400);
  }
  if (shipment.status === "out_for_delivery") {
    return { shipment: mapShipment(shipment), updated: false };
  }

  const now = new Date();
  const result = await supabaseRpc("inbound_record_carrier_response", {
    p_payload: {
      shipmentId: shipment.id,
      carrier: shipment.carrier,
      trackingNumber: shipment.tracking_number,
      events: [
        {
          eventKey: `inbound:manual:${shipment.tracking_number.toLowerCase()}:out-for-delivery`,
          carrierEventId: "manual_out_for_delivery",
          statusCode: "OD",
          statusText: "Manuell als in Zustellung markiert.",
          eventTime: now.toISOString(),
          eventLocation: null,
          rawEvent: {
            source: "ops_manual",
            action: "mark_out_for_delivery",
            operatorName: actor?.operatorName || null,
            mode: actor?.mode || null,
          },
        },
      ],
      rawResponse: {
        source: "ops_manual",
        action: "mark_out_for_delivery",
        operatorName: actor?.operatorName || null,
        mode: actor?.mode || null,
      },
    },
  });

  await supabaseRequest("inbound_shipments", {
    method: "PATCH",
    body: JSON.stringify({
      status_reason: "manual_out_for_delivery",
      next_check_at: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      updated_at: now.toISOString(),
    }),
    headers: { Prefer: "return=minimal" },
  }, {
    id: `eq.${encodeFilterValue(shipment.id)}`,
  });

  return result;
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
