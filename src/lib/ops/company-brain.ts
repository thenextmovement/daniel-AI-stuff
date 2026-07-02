import {
  getCustomerRecordByRequestId,
  listCustomerRecordsByOfferBridge,
  searchCustomerRecords,
  type CustomerSearchResult,
  type CustomerTimelineEntry,
} from "@/lib/ops/customer-records";
import {
  getOfferById,
  searchOffers,
  type OpsOfferApiError,
  type OpsOfferSearchResult,
  type OpsOfferSnapshot,
} from "@/lib/ops/offers";
import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyBrainIdentifierType =
  | "request_id"
  | "offer_number"
  | "offer_id"
  | "email"
  | "trello_card_id"
  | "shopify_order"
  | "tracking_number"
  | "free_text";

export type CompanyBrainIdentifier = {
  type: CompanyBrainIdentifierType;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  href: string | null;
};

export type CompanyBrainEvidence = {
  id: string;
  source: string;
  title: string;
  detail: string | null;
  occurredAt: string | null;
  direction: "inbound" | "outbound" | "internal" | "system";
  href: string | null;
  confidence: "high" | "medium" | "low";
};

export type CompanyBrainRecordSummary = {
  requestId: string;
  displayName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  title: string | null;
  requestedSize: string | null;
  requestedColors: string[];
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  latestOfferSentAt: string | null;
  latestOfferViewedAt: string | null;
  latestOfferSignedAt: string | null;
  latestOrderNumber: string | null;
  latestOrderStatus: string | null;
  latestOutboundAt: string | null;
  latestInboundAt: string | null;
  communicationsCount: number;
  timelineCount: number;
};

export type CompanyBrainOfferSummary = {
  offerId: string;
  offerNumber: string | null;
  documentReference: string;
  publicUrl: string | null;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  projectTitle: string | null;
  trelloCardId: string | null;
  updatedAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  itemCount: number;
  imageCount: number;
  selectedItemCount: number;
  designEvidenceCount: number;
  productHints: string[];
  colorHints: string[];
  selectedItems: Array<{
    title: string;
    section: string | null;
    description: string | null;
    quantity: number;
    unitPriceNet: number;
  }>;
  imageEvidence: Array<{
    title: string | null;
    kind: string;
    enabled: boolean;
    linkedItemTitle: string | null;
  }>;
};

export type CompanyBrainDiagnostic = {
  source: "customer_records" | "offers" | "offer_bridge" | "workflow_audit" | "integration_readiness";
  ok: boolean;
  label: string;
  detail: string | null;
  count: number;
};

export type CompanyBrainFinding = {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  source: string | null;
};

export type CompanyBrainCaseEvent = {
  id: string;
  category: "customer_message" | "offer" | "order" | "automation" | "trello" | "design" | "internal";
  label: string;
  summary: string;
  occurredAt: string | null;
  source: string;
  direction: CompanyBrainEvidence["direction"];
  href: string | null;
  confidence: CompanyBrainEvidence["confidence"];
  evidenceIds: string[];
};

export type CompanyBrainAsset = {
  id: string;
  kind: "reference_image" | "mockup" | "offer_image" | "video" | "followup_mockup" | "pdf" | "other";
  label: string;
  source: "trello" | "offers" | "customer_records" | "outlook_mirror";
  href: string | null;
  linkedTo: string | null;
  status: "available" | "metadata_only" | "missing";
  evidenceIds: string[];
};

export type CompanyBrainCrossCheck = {
  key: "color_match" | "offer_sent" | "design_count" | "product_type" | "customer_confirmation" | "order_link";
  label: string;
  status: "pass" | "review" | "fail" | "unknown";
  severity: "info" | "warning" | "critical";
  expected: string | null;
  actual: string | null;
  summary: string;
  evidenceIds: string[];
};

export type CompanyBrainIntegrationReadiness = {
  key: "live_outlook" | "n8n_live" | "coolify";
  label: string;
  status: "configured" | "partial" | "missing";
  summary: string;
  detail: string | null;
};

export type CompanyBrainWatcher = {
  key:
    | "offer_without_send_proof"
    | "customer_reply_without_task"
    | "order_without_color_confirmation"
    | "automation_failed"
    | "missing_live_outlook"
    | "missing_design_assets";
  severity: "info" | "warning" | "critical";
  status: "open" | "ok";
  title: string;
  detail: string;
  actionKey: string | null;
};

export type CompanyBrainActionProposal = {
  key:
    | "copy_reply_draft"
    | "create_internal_task"
    | "verify_live_outlook"
    | "open_offer_admin"
    | "inspect_n8n_run"
    | "collect_design_assets";
  label: string;
  type: "copy" | "manual_check" | "prepared_task" | "open_link";
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  enabled: boolean;
  summary: string;
  confirmationText: string;
  href: string | null;
  payloadPreview: string[];
};

export type CompanyBrainCheck = {
  key: "offer_sent" | "color" | "design" | "product_type" | "customer_reply" | "order";
  label: string;
  status: "verified" | "warning" | "missing" | "unknown";
  summary: string;
  evidenceIds: string[];
};

export type CompanyBrainSourceHealth = {
  key:
    | "customer_records"
    | "offers"
    | "offer_bridge"
    | "outlook_mirror"
    | "workflow_audit"
    | "shopify"
    | "trello"
    | "evidence";
  label: string;
  status: "ok" | "partial" | "missing" | "error";
  summary: string;
  count: number;
  lastSeenAt: string | null;
  detail: string | null;
};

export type CompanyBrainAutomationRun = {
  id: string;
  workflowName: string | null;
  action: string | null;
  status: string | null;
  error: string | null;
  createdAt: string | null;
  requestId: string | null;
  executionId: string | null;
  correlationId: string | null;
  sourceEventId: string | null;
  targetRecordId: string | null;
};

export type CompanyBrainDossierSection = {
  title: string;
  lines: string[];
};

export type CompanyBrainDossier = {
  title: string;
  generatedAt: string;
  confidence: "high" | "medium" | "low";
  sections: CompanyBrainDossierSection[];
  copyText: string;
};

export type CompanyBrainReplyDraft = {
  title: string;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: true;
  canSendAutomatically: false;
  subject: string;
  body: string;
  blockers: string[];
  sourceEvidenceIds: string[];
};

export type CompanyBrainResolveInput = {
  query: string;
  question?: string | null;
  limit?: number | null;
};

export type CompanyBrainResolveResult = {
  query: string;
  question: string | null;
  generatedAt: string;
  mode: "deterministic_read_only";
  identifiers: CompanyBrainIdentifier[];
  answer: {
    verdict: "found" | "partial" | "not_found";
    confidence: "high" | "medium" | "low";
    headline: string;
    bullets: string[];
  };
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  caseEvents: CompanyBrainCaseEvent[];
  assets: CompanyBrainAsset[];
  crossChecks: CompanyBrainCrossCheck[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  watchers: CompanyBrainWatcher[];
  actionProposals: CompanyBrainActionProposal[];
  checks: CompanyBrainCheck[];
  sourceHealth: CompanyBrainSourceHealth[];
  automationRuns: CompanyBrainAutomationRun[];
  dossier: CompanyBrainDossier;
  replyDraft: CompanyBrainReplyDraft;
  evidence: CompanyBrainEvidence[];
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  diagnostics: CompanyBrainDiagnostic[];
  nextActions: string[];
};

const MAX_QUERY_LENGTH = 240;
const DEFAULT_LIMIT = 5;
const COLOR_WORDS = [
  "blau",
  "blue",
  "rot",
  "red",
  "gruen",
  "green",
  "grün",
  "pink",
  "rosa",
  "weiss",
  "weiß",
  "white",
  "warmweiss",
  "warmweiß",
  "kaltweiss",
  "kaltweiß",
  "gelb",
  "yellow",
  "orange",
  "lila",
  "purple",
  "violett",
  "schwarz",
  "black",
  "rgb",
];

const COLOR_GROUPS: Record<string, string[]> = {
  blau: ["blau", "blue"],
  rot: ["rot", "red"],
  gruen: ["gruen", "green", "grün"],
  pink: ["pink", "rosa"],
  weiss: ["weiss", "weiß", "white", "warmweiss", "warmweiß", "kaltweiss", "kaltweiß"],
  gelb: ["gelb", "yellow"],
  orange: ["orange"],
  lila: ["lila", "purple", "violett"],
  schwarz: ["schwarz", "black"],
  rgb: ["rgb"],
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function clampLimit(value: number | null | undefined) {
  if (!Number.isFinite(value || 0)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(10, Number(value)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function latestIso(values: Array<string | null | undefined>) {
  const times = values
    .map((value) => (value ? new Date(value).getTime() : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);
  return times[0] ? new Date(times[0]).toISOString() : null;
}

function metadataText(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = cleanText(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

function pushIdentifier(
  identifiers: CompanyBrainIdentifier[],
  type: CompanyBrainIdentifierType,
  label: string,
  value: string,
  confidence: CompanyBrainIdentifier["confidence"],
  href: string | null = null,
) {
  const normalized = cleanText(value);
  if (!normalized) return;
  const exists = identifiers.some((entry) => entry.type === type && entry.value.toLowerCase() === normalized.toLowerCase());
  if (!exists) identifiers.push({ type, label, value: normalized, confidence, href });
}

export function normalizeCompanyBrainQuery(query: string) {
  return cleanText(query).slice(0, MAX_QUERY_LENGTH);
}

export function extractCompanyBrainIdentifiers(query: string): CompanyBrainIdentifier[] {
  const normalized = normalizeCompanyBrainQuery(query);
  const identifiers: CompanyBrainIdentifier[] = [];
  const lower = normalized.toLowerCase();

  for (const match of normalized.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    pushIdentifier(identifiers, "email", "E-Mail", match[0].toLowerCase(), "high", null);
  }

  for (const match of normalized.matchAll(/\bAN[-\s]?\d{3,}\b/gi)) {
    pushIdentifier(identifiers, "offer_number", "Angebotsnummer", match[0].replace(/\s+/g, "-").toUpperCase(), "high", null);
  }

  for (const match of normalized.matchAll(/\b(?:REQ|REQUEST)[-_]?[A-Z0-9-]{4,}\b/gi)) {
    pushIdentifier(identifiers, "request_id", "Request-ID", match[0], "high", null);
  }

  for (const match of normalized.matchAll(/\b(?:trello:)?([a-f0-9]{24}|[A-Za-z0-9]{8})\b/g)) {
    const value = match[1] || match[0];
    if (lower.includes("trello") || value.length === 24) {
      pushIdentifier(identifiers, "trello_card_id", "Trello-ID", value, "medium", null);
    }
  }

  for (const match of normalized.matchAll(/\b(?:#|order\s*)?(\d{4,8})\b/gi)) {
    if (lower.includes("shopify") || lower.includes("bestellung") || lower.includes("order")) {
      pushIdentifier(identifiers, "shopify_order", "Bestellung", match[1] || match[0], "medium", null);
    }
  }

  for (const match of normalized.matchAll(/\b([A-Z]{2}\d{9}[A-Z]{2}|1Z[A-Z0-9]{16}|[A-Z0-9]{10,32})\b/gi)) {
    if (lower.includes("tracking") || lower.includes("sendung") || lower.includes("paket")) {
      pushIdentifier(identifiers, "tracking_number", "Tracking", match[1] || match[0], "medium", null);
    }
  }

  if (!identifiers.length && normalized) {
    pushIdentifier(identifiers, "free_text", "Freitext", normalized, "low", null);
  }

  return identifiers;
}

function timelineTime(entry: Pick<CustomerTimelineEntry, "occurredAt">) {
  return entry.occurredAt ? new Date(entry.occurredAt).getTime() : 0;
}

function latestTimelineAt(record: CustomerSearchResult, direction: "inbound" | "outbound") {
  return record.timeline
    .filter((entry) => entry.direction === direction)
    .sort((left, right) => timelineTime(right) - timelineTime(left))[0]?.occurredAt || null;
}

function mapRecordSummary(record: CustomerSearchResult): CompanyBrainRecordSummary {
  return {
    requestId: record.requestId,
    displayName: record.displayName,
    company: record.company,
    email: record.email,
    phone: record.phone,
    status: record.request?.status || record.opsState.label || null,
    title: record.request?.title || null,
    requestedSize: record.request?.size || null,
    requestedColors: record.request?.colors || [],
    trelloCardId: record.request?.trelloCardId || null,
    trelloCardUrl: record.request?.trelloCardUrl || null,
    latestOfferSentAt: record.quote?.sentAt || null,
    latestOfferViewedAt: record.quote?.viewedAt || record.offerTracking?.lastViewedAt || null,
    latestOfferSignedAt: record.quote?.signedAt || record.offerTracking?.acceptedAt || null,
    latestOrderNumber: record.order?.orderNumber || null,
    latestOrderStatus: record.order?.fulfillmentStatus || record.order?.status || null,
    latestOutboundAt: latestTimelineAt(record, "outbound"),
    latestInboundAt: latestTimelineAt(record, "inbound"),
    communicationsCount: record.communications.length,
    timelineCount: record.timeline.length,
  };
}

function extractColorHints(text: string) {
  const normalized = text.toLowerCase();
  return COLOR_WORDS.filter((word) => normalized.includes(word.toLowerCase()));
}

function normalizeColorGroup(color: string) {
  const normalized = color.toLowerCase();
  for (const [group, aliases] of Object.entries(COLOR_GROUPS)) {
    if (aliases.some((alias) => normalized.includes(alias))) return group;
  }
  return normalized;
}

function normalizeColorList(colors: string[]) {
  return uniqueStrings(colors.map(normalizeColorGroup));
}

function quotedCount(text: string, pattern: RegExp) {
  const normalized = text.toLowerCase();
  const matches = normalized.match(pattern);
  if (!matches) return null;
  const numeric = matches.map((match) => Number.parseInt(match.replace(/\D+/g, ""), 10)).find((value) => Number.isFinite(value));
  if (numeric) return numeric;
  if (/\bzwei\b|\b2\b/.test(normalized)) return 2;
  if (/\bdrei\b|\b3\b/.test(normalized)) return 3;
  if (/\bein\b|\b1\b/.test(normalized)) return 1;
  return null;
}

export function extractCompanyBrainSignals(text: string) {
  const normalized = cleanText(text);
  const lower = normalized.toLowerCase();
  return {
    colors: normalizeColorList(extractColorHints(normalized)),
    designCount: quotedCount(lower, /\b\d+\s*(?:designs?|entwuerfe|entwürfe|mockups?|motive|bilder)\b/g) ||
      (/\bzwei\s+(?:designs?|entwuerfe|entwürfe|mockups?|motive|bilder)\b/.test(lower) ? 2 : null),
    mentions3d: /\b3\s*-?\s*d\b|\b3d\b/.test(lower),
    asksOfferSent: /\b(raus|gesendet|verschickt|versendet|mail|e-?mail|angebot.*weg)\b/i.test(normalized),
    asksCustomerConfirmation: /\b(bestätigt|bestaetigt|freigabe|zugesagt|antwort|kunde sagt|kundin sagt)\b/i.test(normalized),
    asksOrder: /\b(bestellung|shopify|bezahlt|gekauft|order)\b/i.test(normalized),
  };
}

function offerText(offer: OpsOfferSnapshot) {
  return [
    offer.offer.projectTitle,
    offer.offer.notes,
    offer.offer.discountText,
    ...offer.items.flatMap((item) => [item.title, item.description, item.section]),
    ...offer.images.map((image) => image.title),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function mapOfferSummary(offer: OpsOfferSnapshot): CompanyBrainOfferSummary {
  const text = offerText(offer);
  const lower = text.toLowerCase();
  const designEvidenceCount =
    offer.images.length ||
    offer.items.filter((item) => /design|entwurf|mockup|motiv|layout/i.test(`${item.title} ${item.description || ""}`)).length;
  const productHints = uniqueStrings([
    lower.includes("3d") || lower.includes("3-d") ? "3D" : null,
    lower.includes("neon") ? "Neon" : null,
    lower.includes("schild") || lower.includes("sign") ? "Schild" : null,
    lower.includes("acryl") ? "Acryl" : null,
    lower.includes("led") ? "LED" : null,
  ]);

  return {
    offerId: offer.offerId,
    offerNumber: offer.offerNumber,
    documentReference: offer.documentReference,
    publicUrl: offer.publicUrl || null,
    status: offer.status,
    customerName: uniqueStrings([offer.offer.customerFirstName, offer.offer.customerLastName]).join(" ") || offer.offer.customerCompany,
    customerEmail: offer.offer.customerEmail,
    projectTitle: offer.offer.projectTitle,
    trelloCardId: offer.trelloCardId,
    updatedAt: offer.updatedAt,
    viewedAt: offer.viewedAt,
    acceptedAt: offer.acceptedAt,
    itemCount: offer.items.length,
    imageCount: offer.images.length,
    selectedItemCount: offer.items.filter((item) => item.selectedFinal ?? item.selectedByDefault).length,
    designEvidenceCount,
    productHints,
    colorHints: uniqueStrings(extractColorHints(text)),
    selectedItems: offer.items
      .filter((item) => item.selectedFinal ?? item.selectedByDefault)
      .slice(0, 8)
      .map((item) => ({
        title: item.title,
        section: item.section,
        description: item.description,
        quantity: item.quantity,
        unitPriceNet: item.unitPriceNet,
      })),
    imageEvidence: offer.images
      .filter((image) => image.enabled)
      .slice(0, 8)
      .map((image) => ({
        title: image.title,
        kind: image.kind,
        enabled: image.enabled,
        linkedItemTitle: image.linkedItemTitle,
      })),
  };
}

function mapTimelineEvidence(record: CustomerSearchResult): CompanyBrainEvidence[] {
  return record.timeline.slice(0, 14).map((entry) => ({
    id: `${record.requestId}-${entry.id}`,
    source: entry.source,
    title: entry.title,
    detail: entry.description || entry.body || entry.valueLabel,
    occurredAt: entry.occurredAt,
    direction: entry.direction,
    href: entry.href,
    confidence: "high",
  }));
}

function mapOfferEvidence(offer: CompanyBrainOfferSummary): CompanyBrainEvidence[] {
  const entries: CompanyBrainEvidence[] = [
    {
      id: `offer-${offer.offerId}-updated`,
      source: "offers_api",
      title: `Angebot ${offer.offerNumber || offer.documentReference}`,
      detail: [
        offer.status ? `Status: ${offer.status}` : null,
        offer.itemCount ? `${offer.itemCount} Positionen` : null,
        offer.imageCount ? `${offer.imageCount} Designs/Bilder` : null,
      ].filter(Boolean).join(" · ") || null,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    },
  ];
  if (offer.viewedAt) {
    entries.push({
      id: `offer-${offer.offerId}-viewed`,
      source: "offers_api",
      title: "Angebot angesehen",
      detail: offer.offerNumber || offer.documentReference,
      occurredAt: offer.viewedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  if (offer.acceptedAt) {
    entries.push({
      id: `offer-${offer.offerId}-accepted`,
      source: "offers_api",
      title: "Angebot angenommen",
      detail: offer.offerNumber || offer.documentReference,
      occurredAt: offer.acceptedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  for (const item of offer.selectedItems.slice(0, 5)) {
    entries.push({
      id: `offer-${offer.offerId}-item-${item.title}`,
      source: "offers_api.items",
      title: `Ausgewählte Position: ${item.title}`,
      detail: [
        item.section,
        item.quantity ? `Menge ${item.quantity}` : null,
        item.description,
      ].filter(Boolean).join(" · ") || null,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  for (const image of offer.imageEvidence.slice(0, 5)) {
    entries.push({
      id: `offer-${offer.offerId}-image-${image.title || image.kind}`,
      source: "offers_api.images",
      title: image.title ? `Design/Bild: ${image.title}` : "Design/Bild im Angebot",
      detail: image.linkedItemTitle ? `Verknüpft mit: ${image.linkedItemTitle}` : image.kind,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  return entries;
}

function dedupeRecords(records: CustomerSearchResult[]) {
  const byRequestId = new Map<string, CustomerSearchResult>();
  for (const record of records) {
    if (!byRequestId.has(record.requestId)) byRequestId.set(record.requestId, record);
  }
  return [...byRequestId.values()];
}

function dedupeOfferSearchResults(results: OpsOfferSearchResult[]) {
  const byId = new Map<string, OpsOfferSearchResult>();
  for (const result of results) {
    if (!byId.has(result.offerId)) byId.set(result.offerId, result);
  }
  return [...byId.values()];
}

function addRecordIdentifiers(identifiers: CompanyBrainIdentifier[], records: CustomerSearchResult[]) {
  for (const record of records) {
    pushIdentifier(identifiers, "request_id", "Request-ID", record.requestId, "high", `/ops/customer-records?query=${encodeURIComponent(record.requestId)}`);
    if (record.email) pushIdentifier(identifiers, "email", "E-Mail", record.email, "high", null);
    if (record.request?.trelloCardId) {
      pushIdentifier(identifiers, "trello_card_id", "Trello-ID", record.request.trelloCardId, "high", record.request.trelloCardUrl);
    }
  }
}

function addOfferIdentifiers(identifiers: CompanyBrainIdentifier[], offers: CompanyBrainOfferSummary[]) {
  for (const offer of offers) {
    pushIdentifier(identifiers, "offer_id", "Offer-ID", offer.offerId, "high", offer.publicUrl);
    if (offer.offerNumber) pushIdentifier(identifiers, "offer_number", "Angebotsnummer", offer.offerNumber, "high", offer.publicUrl);
    if (offer.trelloCardId) pushIdentifier(identifiers, "trello_card_id", "Trello-ID", offer.trelloCardId, "medium", null);
  }
}

function buildGaps(records: CompanyBrainRecordSummary[], offers: CompanyBrainOfferSummary[], diagnostics: CompanyBrainDiagnostic[]) {
  const gaps: CompanyBrainFinding[] = [];
  if (!records.length) {
    gaps.push({
      severity: "warning",
      title: "Keine Kundenakte eindeutig gefunden",
      detail: "Die Suche hat keinen verknüpften Request in der Ops-Kundenakte geliefert.",
      source: "customer_records",
    });
  }
  if (!offers.length) {
    gaps.push({
      severity: "warning",
      title: "Kein Angebotssnapshot geladen",
      detail: "Die Angebotssoftware lieferte keinen passenden Snapshot oder war nicht erreichbar.",
      source: "offers",
    });
  }
  if (records.length && !records.some((record) => record.latestOutboundAt || record.latestOfferSentAt)) {
    gaps.push({
      severity: "warning",
      title: "Kein Versandbeleg sichtbar",
      detail: "In den angebundenen Timeline-Quellen wurde kein ausgehender Angebots- oder Mailzeitpunkt gefunden.",
      source: "timeline",
    });
  }
  for (const diagnostic of diagnostics.filter((entry) => !entry.ok)) {
    gaps.push({
      severity: "info",
      title: `${diagnostic.label} nicht vollständig verfügbar`,
      detail: diagnostic.detail || "Quelle konnte nicht gelesen werden.",
      source: diagnostic.source,
    });
  }
  return gaps;
}

type WorkflowAuditLogRow = {
  id: string;
  document_id?: string | null;
  workflow_name?: string | null;
  action?: string | null;
  status?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

async function fetchAutomationRuns(records: CompanyBrainRecordSummary[], offers: CompanyBrainOfferSummary[]): Promise<{
  runs: CompanyBrainAutomationRun[];
  diagnostic: CompanyBrainDiagnostic;
}> {
  const requestIds = uniqueStrings(records.map((record) => record.requestId));
  const offerNumbers = uniqueStrings(offers.map((offer) => offer.offerNumber));
  const filters = [
    requestIds.length ? `document_id.in.(${requestIds.map(encodeURIComponent).join(",")})` : null,
    ...requestIds.map((requestId) => `metadata->>request_id.eq.${encodeURIComponent(requestId)}`),
    ...offerNumbers.map((offerNumber) => `metadata->>offer_number.eq.${encodeURIComponent(offerNumber)}`),
  ].filter((value): value is string => Boolean(value));

  if (!filters.length) {
    return {
      runs: [],
      diagnostic: { source: "workflow_audit", ok: true, label: "Automation Audit", detail: "Kein Request/Angebot für Audit-Lookup.", count: 0 },
    };
  }

  try {
    const rows = await supabaseRequest<WorkflowAuditLogRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
      or: `(${filters.join(",")})`,
      order: "created_at.desc",
      limit: 30,
    });
    const runs = rows.map((row) => ({
      id: row.id,
      workflowName: cleanText(row.workflow_name) || null,
      action: cleanText(row.action) || null,
      status: cleanText(row.status) || null,
      error: cleanText(row.error_message) || null,
      createdAt: row.created_at || null,
      requestId: cleanText(row.document_id) || metadataText(row.metadata, ["request_id", "task_request_id"]),
      executionId: metadataText(row.metadata, ["execution_id", "n8n_execution_id", "workflow_execution_id"]),
      correlationId: metadataText(row.metadata, ["correlation_id", "request_correlation_id", "idempotency_key"]),
      sourceEventId: metadataText(row.metadata, ["source_event_id", "event_id", "message_id", "offer_event_id"]),
      targetRecordId: metadataText(row.metadata, ["target_record_id", "task_id", "offer_id", "shopify_order_id"]),
    }));
    return {
      runs,
      diagnostic: { source: "workflow_audit", ok: true, label: "Automation Audit", detail: null, count: runs.length },
    };
  } catch (error) {
    return {
      runs: [],
      diagnostic: {
        source: "workflow_audit",
        ok: false,
        label: "Automation Audit",
        detail: error instanceof SupabaseRestError ? error.message : errorMessage(error),
        count: 0,
      },
    };
  }
}

function buildSourceHealth(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  diagnostics: CompanyBrainDiagnostic[],
  automationRuns: CompanyBrainAutomationRun[],
): CompanyBrainSourceHealth[] {
  const diagnosticBySource = new Map(diagnostics.map((entry) => [entry.source, entry] as const));
  const customerDiagnostic = diagnosticBySource.get("customer_records");
  const offerDiagnostic = diagnosticBySource.get("offers");
  const bridgeDiagnostics = diagnostics.filter((entry) => entry.source === "offer_bridge");
  const workflowDiagnostic = diagnosticBySource.get("workflow_audit");
  const outlookEvidence = evidence.filter((entry) => entry.source === "customer_email_messages");
  const shopifyLinked = records.filter((record) => record.latestOrderNumber);
  const trelloLinked = records.filter((record) => record.trelloCardId || record.trelloCardUrl);

  return [
    {
      key: "customer_records",
      label: "Kundenakte",
      status: customerDiagnostic?.ok ? (records.length ? "ok" : "missing") : "error",
      summary: records.length ? `${records.length} Kundenakte(n) gefunden.` : customerDiagnostic?.ok ? "Keine Kundenakte gefunden." : "Kundenakte nicht lesbar.",
      count: records.length,
      lastSeenAt: latestIso(records.map((record) => record.latestInboundAt || record.latestOutboundAt || record.latestOfferViewedAt)),
      detail: customerDiagnostic?.detail || null,
    },
    {
      key: "offers",
      label: "Angebote",
      status: offerDiagnostic?.ok ? (offers.length ? "ok" : "missing") : "error",
      summary: offers.length ? `${offers.length} Angebotssnapshot(s) geladen.` : offerDiagnostic?.ok ? "Kein Angebotssnapshot gefunden." : "Offers API nicht lesbar.",
      count: offers.length,
      lastSeenAt: latestIso(offers.map((offer) => offer.updatedAt || offer.viewedAt || offer.acceptedAt)),
      detail: offerDiagnostic?.detail || null,
    },
    {
      key: "offer_bridge",
      label: "Offer-Bridge",
      status: bridgeDiagnostics.some((entry) => !entry.ok) ? "partial" : bridgeDiagnostics.length ? "ok" : "missing",
      summary: bridgeDiagnostics.length
        ? `${bridgeDiagnostics.reduce((sum, entry) => sum + entry.count, 0)} verknüpfte Bridge-Treffer.`
        : "Keine Bridge-Nachsuche ausgeführt.",
      count: bridgeDiagnostics.reduce((sum, entry) => sum + entry.count, 0),
      lastSeenAt: null,
      detail: bridgeDiagnostics.find((entry) => !entry.ok)?.detail || null,
    },
    {
      key: "outlook_mirror",
      label: "Outlook-Spiegel",
      status: outlookEvidence.length ? "ok" : records.length ? "missing" : "partial",
      summary: outlookEvidence.length ? `${outlookEvidence.length} Outlook-Mailbeleg(e) im Spiegel.` : "Kein Outlook-Spiegel-Beleg in diesem Ergebnis.",
      count: outlookEvidence.length,
      lastSeenAt: latestIso(outlookEvidence.map((entry) => entry.occurredAt)),
      detail: "Quelle: customer_email_messages, nicht Live Outlook.",
    },
    {
      key: "workflow_audit",
      label: "n8n / Automation Audit",
      status: workflowDiagnostic?.ok ? (automationRuns.length ? "ok" : "missing") : "error",
      summary: automationRuns.length ? `${automationRuns.length} Automation-/Workflow-Einträge.` : "Keine Workflow-Audit-Einträge für diesen Fall.",
      count: automationRuns.length,
      lastSeenAt: latestIso(automationRuns.map((run) => run.createdAt)),
      detail: workflowDiagnostic?.detail || "Read-only aus workflow_audit_log.",
    },
    {
      key: "shopify",
      label: "Shopify",
      status: shopifyLinked.length ? "ok" : records.length ? "missing" : "partial",
      summary: shopifyLinked.length ? `${shopifyLinked.length} verknüpfte Bestellung(en).` : "Keine verknüpfte Bestellung im geladenen Fall.",
      count: shopifyLinked.length,
      lastSeenAt: null,
      detail: null,
    },
    {
      key: "trello",
      label: "Trello",
      status: trelloLinked.length ? "ok" : records.length ? "missing" : "partial",
      summary: trelloLinked.length ? `${trelloLinked.length} Trello-Referenz(en).` : "Keine Trello-Referenz im geladenen Fall.",
      count: trelloLinked.length,
      lastSeenAt: null,
      detail: "Trello bleibt Projektion, nicht Source of Truth.",
    },
    {
      key: "evidence",
      label: "Beleg-Timeline",
      status: evidence.length ? "ok" : "missing",
      summary: evidence.length ? `${evidence.length} Belege geladen.` : "Keine Belege geladen.",
      count: evidence.length,
      lastSeenAt: latestIso(evidence.map((entry) => entry.occurredAt)),
      detail: null,
    },
  ];
}

function hasEnv(...names: string[]) {
  return names.some((name) => Boolean(cleanText(process.env[name])));
}

function buildIntegrationReadiness(): CompanyBrainIntegrationReadiness[] {
  const graphTenant = hasEnv("MICROSOFT_GRAPH_TENANT_ID", "AZURE_TENANT_ID");
  const graphClient = hasEnv("MICROSOFT_GRAPH_CLIENT_ID", "AZURE_CLIENT_ID");
  const graphSecret = hasEnv("MICROSOFT_GRAPH_CLIENT_SECRET", "AZURE_CLIENT_SECRET");
  const graphMailbox = hasEnv("MICROSOFT_GRAPH_MAILBOX", "OUTLOOK_SHARED_MAILBOX", "OUTLOOK_MAILBOX");
  const n8nApi = hasEnv("N8N_API_URL", "N8N_BASE_URL") && hasEnv("N8N_API_KEY");
  const n8nWebhooks = hasEnv(
    "OPS_VISUAL_REQUEST_WEBHOOK_URL",
    "SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "N8N_SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
    "N8N_SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
  );
  const coolifyRuntime = hasEnv("COOLIFY_API_URL", "COOLIFY_URL") && hasEnv("COOLIFY_API_TOKEN");
  const coolifyDeploy = hasEnv("COOLIFY_DEPLOY_WEBHOOK");

  return [
    {
      key: "live_outlook",
      label: "Live Outlook / Graph",
      status: graphTenant && graphClient && graphSecret && graphMailbox ? "configured" : graphTenant || graphClient || graphSecret || graphMailbox ? "partial" : "missing",
      summary: graphTenant && graphClient && graphSecret && graphMailbox
        ? "Graph-Livezugriff scheint im Runtime-Env konfiguriert."
        : "Kein vollständiger Graph-Livezugriff im Runtime-Env erkannt; Company Brain nutzt den Outlook-Spiegel.",
      detail: "Erwartete Bausteine: Tenant, Client, Secret und Mailbox. Secrets werden nicht angezeigt.",
    },
    {
      key: "n8n_live",
      label: "Live n8n",
      status: n8nApi ? "configured" : n8nWebhooks ? "partial" : "missing",
      summary: n8nApi
        ? "n8n API-Zugriff scheint konfiguriert."
        : n8nWebhooks
          ? "n8n Webhooks sind teilweise konfiguriert; Live-Workflow-API ist nicht vollständig erkannt."
          : "Kein Live-n8n-API-Zugriff im Runtime-Env erkannt.",
      detail: "Read-only Live-Workflowdiagnose braucht N8N_API_URL/N8N_BASE_URL plus N8N_API_KEY. Aktuell bleiben workflow_audit_log und Webhook-Readiness die sichere Quelle.",
    },
    {
      key: "coolify",
      label: "Coolify",
      status: coolifyRuntime ? "configured" : coolifyDeploy ? "partial" : "missing",
      summary: coolifyRuntime
        ? "Coolify API-Zugriff scheint konfiguriert."
        : coolifyDeploy
          ? "Deploy-Webhook ist konfiguriert; Runtime-API-Health ist nicht vollständig erkannt."
          : "Kein Coolify Runtime-API-Zugriff im App-Env erkannt.",
      detail: "GitHub Actions triggert Deploys über Secrets. Die App zeigt keine Secret-Werte und führt keine Deploy-Aktion aus.",
    },
  ];
}

function buildAssetInventory(records: CustomerSearchResult[], offers: CompanyBrainOfferSummary[], evidence: CompanyBrainEvidence[]): CompanyBrainAsset[] {
  const assets: CompanyBrainAsset[] = [];
  const addAsset = (asset: CompanyBrainAsset) => {
    if (assets.some((entry) => entry.id === asset.id)) return;
    assets.push(asset);
  };

  for (const record of records) {
    if (record.trello?.referenceImage) {
      addAsset({
        id: `trello-reference:${record.trello.referenceImage.cardId}:${record.trello.referenceImage.attachmentId}`,
        kind: "reference_image",
        label: record.trello.referenceImage.name || "Referenzbild",
        source: "trello",
        href: record.trello.referenceImage.proxyUrl,
        linkedTo: record.trello.referenceImage.cardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const mockup of record.trello?.mockups || []) {
      addAsset({
        id: `trello-mockup:${mockup.cardId}:${mockup.attachmentId}`,
        kind: "mockup",
        label: mockup.name || "Mockup",
        source: "trello",
        href: mockup.proxyUrl,
        linkedTo: mockup.cardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const video of record.trello?.videoLinks || []) {
      addAsset({
        id: `trello-video:${video.url}`,
        kind: "video",
        label: video.label || "Video",
        source: "trello",
        href: video.url,
        linkedTo: video.boardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const mockup of record.followupMockups || []) {
      addAsset({
        id: `followup-mockup:${mockup.followupId}:${mockup.url}`,
        kind: "followup_mockup",
        label: mockup.label || `Follow-up Mockup ${mockup.followupNumber || ""}`.trim(),
        source: "customer_records",
        href: mockup.url,
        linkedTo: mockup.status || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
  }

  for (const offer of offers) {
    for (const image of offer.imageEvidence) {
      addAsset({
        id: `offer-image:${offer.offerId}:${image.title || image.kind}:${image.linkedItemTitle || "unlinked"}`,
        kind: "offer_image",
        label: image.title || "Angebotsbild",
        source: "offers",
        href: offer.publicUrl,
        linkedTo: image.linkedItemTitle || offer.offerNumber || offer.documentReference,
        status: image.enabled ? "metadata_only" : "missing",
        evidenceIds: evidence
          .filter((entry) => entry.source === "offers_api.images" && entry.title.includes(image.title || "Design/Bild"))
          .slice(0, 2)
          .map((entry) => entry.id),
      });
    }
  }

  return assets.slice(0, 40);
}

function buildDossier(input: {
  generatedAt: string;
  answer: CompanyBrainResolveResult["answer"];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  caseEvents: CompanyBrainCaseEvent[];
  assets: CompanyBrainAsset[];
  crossChecks: CompanyBrainCrossCheck[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  watchers: CompanyBrainWatcher[];
  actionProposals: CompanyBrainActionProposal[];
  checks: CompanyBrainCheck[];
  sourceHealth: CompanyBrainSourceHealth[];
  automationRuns: CompanyBrainAutomationRun[];
  replyDraft: CompanyBrainReplyDraft;
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  evidence: CompanyBrainEvidence[];
}): CompanyBrainDossier {
  const primaryRecord = input.records[0] || null;
  const title = primaryRecord
    ? `Fall-Dossier ${primaryRecord.displayName || primaryRecord.company || primaryRecord.email || primaryRecord.requestId}`
    : "Fall-Dossier";
  const sections: CompanyBrainDossierSection[] = [
    {
      title: "Kurzfazit",
      lines: [input.answer.headline, ...input.answer.bullets],
    },
    {
      title: "Kunde / Anfrage",
      lines: primaryRecord
        ? [
            `Request: ${primaryRecord.requestId}`,
            `Kontakt: ${primaryRecord.displayName || primaryRecord.company || primaryRecord.email || "unbekannt"}`,
            `E-Mail: ${primaryRecord.email || "unbekannt"}`,
            `Farbe: ${primaryRecord.requestedColors.join(", ") || "keine Angabe"}`,
            `Größe: ${primaryRecord.requestedSize || "keine Angabe"}`,
            `Trello: ${primaryRecord.trelloCardId || primaryRecord.trelloCardUrl || "nicht verknüpft"}`,
          ]
        : ["Keine Kundenakte eindeutig gefunden."],
    },
    {
      title: "Angebote",
      lines: input.offers.length
        ? input.offers.flatMap((offer) => [
            `${offer.offerNumber || offer.documentReference}: ${offer.status}, ${offer.itemCount} Positionen, ${offer.imageCount} Bilder/Designs`,
            `Ausgewählt: ${offer.selectedItems.map((item) => item.title).join(", ") || "keine Angabe"}`,
            `Produkt/Farbe: ${offer.productHints.join(", ") || "unbekannt"} / ${offer.colorHints.join(", ") || "unbekannt"}`,
          ])
        : ["Kein Angebotssnapshot geladen."],
    },
    {
      title: "Prüfmatrix",
      lines: input.checks.map((check) => `${check.label}: ${check.status} - ${check.summary}`),
    },
    {
      title: "Konfliktmatrix",
      lines: input.crossChecks.map((check) => `${check.label}: ${check.status} - Erwartet: ${check.expected || "unbekannt"} / Tatsächlich: ${check.actual || "unbekannt"} - ${check.summary}`),
    },
    {
      title: "Fallakte",
      lines: input.caseEvents.length
        ? input.caseEvents.slice(0, 12).map((event) => `${event.occurredAt || "ohne Zeit"} · ${event.label} · ${event.summary}`)
        : ["Keine normalisierten Fallereignisse geladen."],
    },
    {
      title: "Assets / Anhänge",
      lines: input.assets.length
        ? input.assets.slice(0, 12).map((asset) => `${asset.kind} · ${asset.label} · ${asset.source} · ${asset.status}${asset.linkedTo ? ` · ${asset.linkedTo}` : ""}`)
        : ["Keine Design-/Anhang-Assets im geladenen Fall gefunden."],
    },
    {
      title: "Integrations-Readiness",
      lines: input.integrationReadiness.map((entry) => `${entry.label}: ${entry.status} - ${entry.summary}`),
    },
    {
      title: "Proaktive Wächter",
      lines: input.watchers.length
        ? input.watchers.map((watcher) => `${watcher.status}/${watcher.severity}: ${watcher.title} - ${watcher.detail}`)
        : ["Keine Wächter ausgewertet."],
    },
    {
      title: "Action Center",
      lines: input.actionProposals.length
        ? input.actionProposals.map((action) => `${action.label}: ${action.enabled ? "bereit" : "nicht direkt ausführbar"} - ${action.summary}`)
        : ["Keine Aktion vorgeschlagen."],
    },
    {
      title: "Automationen / n8n",
      lines: input.automationRuns.length
        ? input.automationRuns.slice(0, 8).map((run) => `${run.createdAt || "ohne Zeit"} · ${run.workflowName || "Workflow"} · ${run.action || "Aktion"} · ${run.status || "Status unbekannt"}${run.error ? ` · Fehler: ${run.error}` : ""}`)
        : ["Keine Workflow-Audit-Einträge für diesen Fall."],
    },
    {
      title: "Quellenstatus",
      lines: input.sourceHealth.map((source) => `${source.label}: ${source.status} - ${source.summary}`),
    },
    {
      title: "Lücken / Konflikte",
      lines: [...input.conflicts, ...input.gaps].length
        ? [...input.conflicts, ...input.gaps].map((finding) => `${finding.severity}: ${finding.title} - ${finding.detail}`)
        : ["Keine Konflikte oder kritischen Lücken im geladenen Ergebnis."],
    },
    {
      title: "Antwortentwurf",
      lines: [
        `Freigabe erforderlich: ${input.replyDraft.approvalRequired ? "ja" : "nein"}`,
        `Risiko: ${input.replyDraft.riskLevel}`,
        `Betreff: ${input.replyDraft.subject}`,
        ...input.replyDraft.body.split("\n"),
        ...(input.replyDraft.blockers.length ? ["Blocker:", ...input.replyDraft.blockers] : []),
      ],
    },
    {
      title: "Jüngste Belege",
      lines: input.evidence.slice(0, 10).map((entry) => `${entry.occurredAt || "ohne Zeit"} · ${entry.source} · ${entry.title}${entry.detail ? ` · ${entry.detail}` : ""}`),
    },
  ];
  return {
    title,
    generatedAt: input.generatedAt,
    confidence: input.answer.confidence,
    sections,
    copyText: [`${title}`, `Erstellt: ${input.generatedAt}`, ...sections.flatMap((section) => ["", section.title, ...section.lines])].join("\n"),
  };
}

function eventCategoryFromEvidence(entry: CompanyBrainEvidence): CompanyBrainCaseEvent["category"] {
  const text = `${entry.source} ${entry.title} ${entry.detail || ""}`.toLowerCase();
  if (/design|bild|mockup|entwurf|motiv|layout/.test(text)) return "design";
  if (/bestellung|shopify|order|zahlung|bezahlt/.test(text)) return "order";
  if (/trello/.test(text)) return "trello";
  if (entry.source.startsWith("offers_api") || /angebot|quote|offer/.test(text)) return "offer";
  if (entry.direction === "inbound" || entry.direction === "outbound" || entry.source === "customer_email_messages") return "customer_message";
  return entry.direction === "system" ? "internal" : "internal";
}

function buildCaseEvents(evidence: CompanyBrainEvidence[], automationRuns: CompanyBrainAutomationRun[]): CompanyBrainCaseEvent[] {
  const evidenceEvents = evidence.map((entry) => ({
    id: `evidence:${entry.id}`,
    category: eventCategoryFromEvidence(entry),
    label: entry.title,
    summary: entry.detail || entry.source,
    occurredAt: entry.occurredAt,
    source: entry.source,
    direction: entry.direction,
    href: entry.href,
    confidence: entry.confidence,
    evidenceIds: [entry.id],
  } satisfies CompanyBrainCaseEvent));

  const automationEvents = automationRuns.map((run) => ({
    id: `automation:${run.id}`,
    category: "automation" as const,
    label: run.workflowName || "Automation",
    summary: [
      run.action || "Aktion unbekannt",
      run.status || "Status unbekannt",
      run.error ? `Fehler: ${run.error}` : null,
    ].filter(Boolean).join(" · "),
    occurredAt: run.createdAt,
    source: "workflow_audit_log",
    direction: "system" as const,
    href: null,
    confidence: "high" as const,
    evidenceIds: [],
  }));

  return [...evidenceEvents, ...automationEvents]
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .slice(0, 40);
}

function statusSeverity(status: CompanyBrainCrossCheck["status"]): CompanyBrainCrossCheck["severity"] {
  if (status === "fail") return "critical";
  if (status === "review") return "warning";
  return "info";
}

function joinOrNull(values: string[]) {
  return values.length ? values.join(", ") : null;
}

export function buildCompanyBrainCrossChecks(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  question: string | null;
}): CompanyBrainCrossCheck[] {
  const { records, offers, evidence, question } = input;
  const signals = extractCompanyBrainSignals(`${question || ""} ${evidence.filter((entry) => entry.direction === "inbound").map((entry) => `${entry.title} ${entry.detail || ""}`).join(" ")}`);
  const requestedColors = normalizeColorList(records.flatMap((record) => record.requestedColors));
  const inboundColors = normalizeColorList(evidence.filter((entry) => entry.direction === "inbound").flatMap((entry) => extractColorHints(`${entry.title} ${entry.detail || ""}`)));
  const expectedColors = uniqueStrings([...requestedColors, ...inboundColors, ...signals.colors]);
  const offerColors = normalizeColorList(offers.flatMap((offer) => offer.colorHints));
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const outboundEvidence = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up|dokument/i.test(`${entry.title} ${entry.detail || ""}`));
  const inboundEvidence = evidence.find((entry) => entry.direction === "inbound");
  const offerEvidence = evidence.find((entry) => entry.source.startsWith("offers_api"));
  const designEvidence = evidence.filter((entry) => /design|bild|position|mockup|entwurf|motiv/i.test(`${entry.title} ${entry.detail || ""}`));
  const maxDesignEvidence = Math.max(...offers.map((offer) => Math.max(offer.designEvidenceCount, offer.imageCount)), 0);
  const checks: CompanyBrainCrossCheck[] = [];

  const missingColors = expectedColors.filter((color) => !offerColors.includes(color));
  const colorStatus: CompanyBrainCrossCheck["status"] =
    expectedColors.length && offerColors.length
      ? missingColors.length ? "fail" : "pass"
      : expectedColors.length || offerColors.length
        ? "review"
        : "unknown";
  checks.push({
    key: "color_match",
    label: "Farbe Request/Kunde vs. Angebot",
    status: colorStatus,
    severity: statusSeverity(colorStatus),
    expected: joinOrNull(expectedColors),
    actual: joinOrNull(offerColors),
    summary: colorStatus === "fail"
      ? `Im Kunden-/Request-Kontext steht ${expectedColors.join(", ")}, im Angebot aber ${offerColors.join(", ")}.`
      : colorStatus === "pass"
        ? "Farbhinweise aus Kunde/Request und Angebot passen zusammen."
        : "Farben sind nicht vollständig belegt.",
    evidenceIds: evidence.filter((entry) => /farbe|color|angebot|position/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 6).map((entry) => entry.id),
  });

  const offerSent = Boolean(latestRecord?.latestOfferSentAt || outboundEvidence);
  const offerSentStatus: CompanyBrainCrossCheck["status"] = offerSent ? "pass" : latestOffer ? "review" : "unknown";
  checks.push({
    key: "offer_sent",
    label: "Angebotsversand",
    status: offerSentStatus,
    severity: statusSeverity(offerSentStatus),
    expected: signals.asksOfferSent ? "Versandstatus beantworten" : "Versandbeleg",
    actual: latestRecord?.latestOfferSentAt || outboundEvidence?.occurredAt || null,
    summary: offerSent
      ? "Ein Versand- oder Ausgangsbeleg ist vorhanden."
      : latestOffer
        ? "Angebot existiert, aber ein eindeutiger Versandbeleg fehlt im geladenen Ergebnis."
        : "Kein Angebot für Versandprüfung geladen.",
    evidenceIds: [outboundEvidence?.id, offerEvidence?.id].filter(Boolean) as string[],
  });

  const designStatus: CompanyBrainCrossCheck["status"] =
    signals.designCount
      ? maxDesignEvidence >= signals.designCount ? "pass" : latestOffer ? "fail" : "unknown"
      : maxDesignEvidence ? "pass" : "review";
  checks.push({
    key: "design_count",
    label: "Design-/Bildanzahl",
    status: designStatus,
    severity: statusSeverity(designStatus),
    expected: signals.designCount ? `${signals.designCount} Design/Bild-Hinweis(e)` : null,
    actual: latestOffer ? `${maxDesignEvidence} Design-/Bildhinweis(e)` : null,
    summary: signals.designCount
      ? (maxDesignEvidence >= signals.designCount ? "Die angefragte Designanzahl ist belegt." : "Die angefragte Designanzahl ist im Angebot nicht belegt.")
      : "Keine konkrete Designanzahl angefragt; vorhandene Design-/Bildhinweise werden angezeigt.",
    evidenceIds: designEvidence.slice(0, 8).map((entry) => entry.id),
  });

  const productStatus: CompanyBrainCrossCheck["status"] =
    signals.mentions3d ? latestOffer?.productHints.includes("3D") ? "pass" : latestOffer ? "fail" : "unknown" : latestOffer?.productHints.length ? "pass" : "unknown";
  checks.push({
    key: "product_type",
    label: "Produktart",
    status: productStatus,
    severity: statusSeverity(productStatus),
    expected: signals.mentions3d ? "3D" : null,
    actual: latestOffer?.productHints.length ? latestOffer.productHints.join(", ") : null,
    summary: signals.mentions3d
      ? (latestOffer?.productHints.includes("3D") ? "3D-Hinweis im Angebot gefunden." : "3D-Hinweis im Angebot nicht gefunden.")
      : "Produkt-Hinweise aus dem Angebot extrahiert.",
    evidenceIds: [offerEvidence?.id].filter(Boolean) as string[],
  });

  const confirmationStatus: CompanyBrainCrossCheck["status"] = inboundEvidence ? "pass" : signals.asksCustomerConfirmation ? "fail" : "unknown";
  checks.push({
    key: "customer_confirmation",
    label: "Kundenbestätigung",
    status: confirmationStatus,
    severity: statusSeverity(confirmationStatus),
    expected: signals.asksCustomerConfirmation ? "Kundenantwort/Freigabe" : null,
    actual: inboundEvidence?.occurredAt || null,
    summary: inboundEvidence ? `Kundeneingang vorhanden: ${inboundEvidence.title}.` : "Keine Kundenantwort im geladenen Ergebnis.",
    evidenceIds: [inboundEvidence?.id].filter(Boolean) as string[],
  });

  const orderStatus: CompanyBrainCrossCheck["status"] = latestRecord?.latestOrderNumber ? "pass" : signals.asksOrder ? "fail" : "unknown";
  checks.push({
    key: "order_link",
    label: "Bestellung verknüpft",
    status: orderStatus,
    severity: statusSeverity(orderStatus),
    expected: signals.asksOrder ? "Shopify-/Bestellbeleg" : null,
    actual: latestRecord?.latestOrderNumber || null,
    summary: latestRecord?.latestOrderNumber ? `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft.` : "Keine Bestellung im geladenen Fall verknüpft.",
    evidenceIds: evidence.filter((entry) => /bestellung|order|shopify/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 4).map((entry) => entry.id),
  });

  return checks;
}

function buildConflicts(crossChecks: CompanyBrainCrossCheck[]) {
  const conflicts: CompanyBrainFinding[] = [];
  for (const check of crossChecks.filter((entry) => entry.status === "fail")) {
    conflicts.push({
      severity: check.severity,
      title: check.label,
      detail: check.summary,
      source: check.key,
    });
  }
  for (const check of crossChecks.filter((entry) => entry.status === "review" && entry.severity === "warning")) {
    conflicts.push({
      severity: "warning",
      title: `${check.label} prüfen`,
      detail: check.summary,
      source: check.key,
    });
  }
  return conflicts;
}

function buildReplyDraft(input: {
  answer: CompanyBrainResolveResult["answer"];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  crossChecks: CompanyBrainCrossCheck[];
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  evidence: CompanyBrainEvidence[];
}): CompanyBrainReplyDraft {
  const primaryRecord = input.records[0] || null;
  const primaryOffer = input.offers[0] || null;
  const blockers = [
    ...input.conflicts.filter((finding) => finding.severity !== "info").map((finding) => `${finding.title}: ${finding.detail}`),
    ...input.gaps.filter((finding) => finding.severity === "warning").map((finding) => `${finding.title}: ${finding.detail}`),
  ].slice(0, 8);
  const riskLevel: CompanyBrainReplyDraft["riskLevel"] = input.conflicts.some((finding) => finding.severity === "critical")
    ? "high"
    : blockers.length
      ? "medium"
      : "low";
  const subjectReference = primaryOffer?.offerNumber || primaryOffer?.documentReference || primaryRecord?.requestId || "Ihrem Anliegen";
  const provenLines = input.crossChecks
    .filter((check) => check.status === "pass")
    .slice(0, 4)
    .map((check) => `- ${check.label}: ${check.actual || check.summary}`);
  const uncertainLines = [...input.conflicts, ...input.gaps]
    .filter((finding) => finding.severity !== "info")
    .slice(0, 4)
    .map((finding) => `- ${finding.title}: ${finding.detail}`);

  return {
    title: "Interner Antwortentwurf",
    riskLevel,
    approvalRequired: true,
    canSendAutomatically: false,
    subject: `Prüfung zu ${subjectReference}`,
    body: [
      "Hallo,",
      "",
      "wir haben den Fall anhand der internen Belege geprüft.",
      provenLines.length ? "" : null,
      provenLines.length ? "Belegt ist:" : null,
      ...provenLines,
      uncertainLines.length ? "" : null,
      uncertainLines.length ? "Vor einer verbindlichen Aussage müssen wir noch prüfen:" : null,
      ...uncertainLines,
      "",
      "Bitte diesen Entwurf vor dem Versand fachlich prüfen und erst nach Freigabe anpassen/versenden.",
      "",
      "Viele Grüße",
      "NEONTRIP",
    ].filter((line): line is string => line !== null).join("\n"),
    blockers,
    sourceEvidenceIds: input.evidence.slice(0, 8).map((entry) => entry.id),
  };
}

function buildWatchers(input: {
  records: CustomerSearchResult[];
  recordSummaries: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  crossChecks: CompanyBrainCrossCheck[];
  automationRuns: CompanyBrainAutomationRun[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  assets: CompanyBrainAsset[];
}): CompanyBrainWatcher[] {
  const watchers: CompanyBrainWatcher[] = [];
  const latestRecord = input.recordSummaries[0] || null;
  const latestOffer = input.offers[0] || null;
  const latestInbound = input.evidence.find((entry) => entry.direction === "inbound") || null;
  const openTasks = input.records.flatMap((record) => record.internalTasks || []).filter((task) => task.status === "open");
  const failedAutomation = input.automationRuns.find((run) => /fail|error|failed/i.test(`${run.status || ""} ${run.error || ""}`)) || null;
  const offerSentCheck = input.crossChecks.find((check) => check.key === "offer_sent");
  const colorCheck = input.crossChecks.find((check) => check.key === "color_match");
  const liveOutlook = input.integrationReadiness.find((entry) => entry.key === "live_outlook");
  const designAssets = input.assets.filter((asset) => asset.kind === "reference_image" || asset.kind === "mockup" || asset.kind === "offer_image");

  watchers.push({
    key: "offer_without_send_proof",
    severity: offerSentCheck?.status === "review" ? "warning" : "info",
    status: offerSentCheck?.status === "review" ? "open" : "ok",
    title: "Angebot ohne eindeutigen Versandbeleg",
    detail: offerSentCheck?.summary || "Kein Angebot für Versandprüfung geladen.",
    actionKey: offerSentCheck?.status === "review" ? "verify_live_outlook" : null,
  });

  watchers.push({
    key: "customer_reply_without_task",
    severity: latestInbound && !openTasks.length ? "warning" : "info",
    status: latestInbound && !openTasks.length ? "open" : "ok",
    title: "Kundenantwort ohne offene Aufgabe",
    detail: latestInbound
      ? openTasks.length
        ? `${openTasks.length} offene Aufgabe(n) im Fall vorhanden.`
        : `Kundeneingang ${latestInbound.occurredAt || "ohne Zeitpunkt"} gefunden, aber keine offene interne Aufgabe im geladenen Fall.`
      : "Kein Kundeneingang im geladenen Zeitstrahl.",
    actionKey: latestInbound && !openTasks.length ? "create_internal_task" : null,
  });

  watchers.push({
    key: "order_without_color_confirmation",
    severity: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "critical" : "info",
    status: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "open" : "ok",
    title: "Bestellung ohne saubere Farbbestätigung",
    detail: latestRecord?.latestOrderNumber
      ? colorCheck?.status === "pass"
        ? `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft und Farbe ist belegt.`
        : `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft, aber Farbe ist nicht eindeutig bestätigt.`
      : "Keine verknüpfte Bestellung im geladenen Fall.",
    actionKey: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "copy_reply_draft" : null,
  });

  watchers.push({
    key: "automation_failed",
    severity: failedAutomation ? "critical" : "info",
    status: failedAutomation ? "open" : "ok",
    title: "n8n-/Automation-Fehler",
    detail: failedAutomation
      ? `${failedAutomation.workflowName || "Workflow"} · ${failedAutomation.action || "Aktion"} · ${failedAutomation.error || failedAutomation.status || "Fehlerstatus"}`
      : "Keine fehlgeschlagenen Automation-Runs im geladenen Audit gefunden.",
    actionKey: failedAutomation ? "inspect_n8n_run" : null,
  });

  watchers.push({
    key: "missing_live_outlook",
    severity: liveOutlook?.status === "configured" ? "info" : "warning",
    status: liveOutlook?.status === "configured" ? "ok" : "open",
    title: "Live-Outlook nicht vollständig angebunden",
    detail: liveOutlook?.summary || "Outlook-Readiness konnte nicht bestimmt werden.",
    actionKey: liveOutlook?.status === "configured" ? null : "verify_live_outlook",
  });

  watchers.push({
    key: "missing_design_assets",
    severity: latestOffer && !designAssets.length ? "warning" : "info",
    status: latestOffer && !designAssets.length ? "open" : "ok",
    title: "Design-/Anhang-Assets fehlen",
    detail: designAssets.length
      ? `${designAssets.length} Design-/Anhang-Asset(s) im geladenen Fall gefunden.`
      : latestOffer
        ? "Angebot gefunden, aber kein direktes Design-/Anhang-Asset im Inventar."
        : "Kein Angebot für Asset-Prüfung geladen.",
    actionKey: latestOffer && !designAssets.length ? "collect_design_assets" : null,
  });

  return watchers;
}

function buildActionProposals(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  replyDraft: CompanyBrainReplyDraft;
  watchers: CompanyBrainWatcher[];
  automationRuns: CompanyBrainAutomationRun[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  assets: CompanyBrainAsset[];
}): CompanyBrainActionProposal[] {
  const primaryRecord = input.records[0] || null;
  const primaryOffer = input.offers[0] || null;
  const liveOutlook = input.integrationReadiness.find((entry) => entry.key === "live_outlook");
  const failedAutomation = input.automationRuns.find((run) => /fail|error|failed/i.test(`${run.status || ""} ${run.error || ""}`)) || null;
  const openWatcherTitles = input.watchers.filter((watcher) => watcher.status === "open").map((watcher) => watcher.title);

  const actions: CompanyBrainActionProposal[] = [
    {
      key: "copy_reply_draft",
      label: "Antwortentwurf kopieren",
      type: "copy",
      riskLevel: input.replyDraft.riskLevel,
      approvalRequired: true,
      enabled: true,
      summary: "Kopiert den internen Entwurf. Versand bleibt manuell und freigabepflichtig.",
      confirmationText: "Entwurf nur nach fachlicher Freigabe an Kunden senden.",
      href: null,
      payloadPreview: [`Betreff: ${input.replyDraft.subject}`, ...input.replyDraft.body.split("\n").slice(0, 6)],
    },
    {
      key: "create_internal_task",
      label: "Interne Aufgabe vorbereiten",
      type: "prepared_task",
      riskLevel: openWatcherTitles.length ? "medium" : "low",
      approvalRequired: true,
      enabled: false,
      summary: "Bereitet eine Aufgabenbeschreibung aus offenen Watchern vor. Es wird noch nichts in die DB geschrieben.",
      confirmationText: "Vor dem Anlegen Assignee, Priorität und Fälligkeit prüfen.",
      href: primaryRecord ? `/ops/tasks?requestId=${encodeURIComponent(primaryRecord.requestId)}` : "/ops/tasks",
      payloadPreview: [
        `Request: ${primaryRecord?.requestId || "unbekannt"}`,
        `Titel: Company-Brain-Prüfung ${primaryOffer?.offerNumber || primaryRecord?.requestId || ""}`.trim(),
        ...openWatcherTitles.map((title) => `Offen: ${title}`),
      ],
    },
    {
      key: "verify_live_outlook",
      label: "Live-Outlook prüfen",
      type: "manual_check",
      riskLevel: "low",
      approvalRequired: false,
      enabled: liveOutlook?.status === "configured",
      summary: liveOutlook?.status === "configured"
        ? "Runtime wirkt vorbereitet; Live-Suche kann als nächster Backend-Schritt aktiviert werden."
        : "Graph-Konfiguration fehlt oder ist unvollständig; aktuell nur Outlook-Spiegel nutzen.",
      confirmationText: "Nur lesen, keine Mail senden.",
      href: null,
      payloadPreview: [
        `Status: ${liveOutlook?.status || "unknown"}`,
        primaryRecord?.email ? `Kunde: ${primaryRecord.email}` : "Kunde: unbekannt",
        primaryOffer?.offerNumber ? `Angebot: ${primaryOffer.offerNumber}` : "Angebot: unbekannt",
      ],
    },
    {
      key: "open_offer_admin",
      label: "Angebot prüfen",
      type: "open_link",
      riskLevel: "low",
      approvalRequired: false,
      enabled: Boolean(primaryOffer?.publicUrl),
      summary: "Öffnet den vorhandenen Angebotslink zur manuellen Sichtprüfung.",
      confirmationText: "Nur prüfen; Änderungen im Angebotsadmin separat bestätigen.",
      href: primaryOffer?.publicUrl || null,
      payloadPreview: [
        `Angebot: ${primaryOffer?.offerNumber || primaryOffer?.documentReference || "unbekannt"}`,
        `Assets: ${input.assets.length}`,
      ],
    },
    {
      key: "inspect_n8n_run",
      label: "n8n-Run untersuchen",
      type: "manual_check",
      riskLevel: failedAutomation ? "medium" : "low",
      approvalRequired: false,
      enabled: Boolean(failedAutomation),
      summary: failedAutomation ? "Ein fehlerhafter Audit-Run ist vorhanden." : "Kein fehlerhafter Audit-Run im Fall.",
      confirmationText: "Keinen Workflow ohne Backup, Diff und Rollback ändern.",
      href: null,
      payloadPreview: failedAutomation
        ? [
            `Workflow: ${failedAutomation.workflowName || "unbekannt"}`,
            `Action: ${failedAutomation.action || "unbekannt"}`,
            `Execution: ${failedAutomation.executionId || "unbekannt"}`,
          ]
        : ["Kein Fehler-Run gefunden."],
    },
    {
      key: "collect_design_assets",
      label: "Design-Assets sammeln",
      type: "manual_check",
      riskLevel: input.assets.length ? "low" : "medium",
      approvalRequired: false,
      enabled: true,
      summary: input.assets.length ? `${input.assets.length} Asset(s) im Inventar.` : "Keine Assets im Inventar; Trello/Angebot/Outlook-Anhänge prüfen.",
      confirmationText: "Keine Kundenaussage über Designs treffen, solange relevante Anhänge fehlen.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: input.assets.length
        ? input.assets.slice(0, 5).map((asset) => `${asset.kind}: ${asset.label}`)
        : ["Trello-Referenzbild, Mockups, Angebotsbilder und Outlook-Anhänge prüfen."],
    },
  ];

  return actions;
}

function questionMentions(question: string | null, ...needles: string[]) {
  const normalized = (question || "").toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function buildChecks(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  conflicts: CompanyBrainFinding[],
  question: string | null,
): CompanyBrainCheck[] {
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const outboundEvidence = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up|dokument/i.test(entry.title));
  const inboundEvidence = evidence.find((entry) => entry.direction === "inbound");
  const offerEvidence = evidence.find((entry) => entry.source.startsWith("offers_api"));
  const designEvidence = evidence.filter((entry) => /design|bild|position|mockup|entwurf/i.test(`${entry.title} ${entry.detail || ""}`));
  const colorConflict = conflicts.find((entry) => entry.source === "color_match") || null;
  const requestColors = uniqueStrings(records.flatMap((record) => record.requestedColors));
  const offerColors = uniqueStrings(offers.flatMap((offer) => offer.colorHints));
  const checks: CompanyBrainCheck[] = [];

  checks.push({
    key: "offer_sent",
    label: "Angebot versendet",
    status: latestRecord?.latestOfferSentAt || outboundEvidence ? "verified" : latestOffer ? "warning" : "unknown",
    summary:
      latestRecord?.latestOfferSentAt
        ? `Master-Quote meldet Versand am ${latestRecord.latestOfferSentAt}.`
        : outboundEvidence?.occurredAt
          ? `Timeline enthält ausgehenden Beleg am ${outboundEvidence.occurredAt}.`
          : latestOffer
            ? "Angebot existiert, aber kein eindeutiger Versandbeleg in der Timeline."
            : "Kein Angebot gefunden.",
    evidenceIds: [outboundEvidence?.id, offerEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "color",
    label: "Farbe belegt",
    status:
      colorConflict
        ? "warning"
        : requestColors.length && offerColors.length
          ? "verified"
          : questionMentions(question, "farbe", "blau", "rot", "grün", "gruen", "weiss", "weiß", "pink")
            ? "missing"
            : "unknown",
    summary:
      colorConflict?.detail ||
      (requestColors.length || offerColors.length
        ? `Request: ${requestColors.join(", ") || "keine Farbe"} · Angebot: ${offerColors.join(", ") || "keine Farbe"}`
        : "Keine belastbare Farbangabe in den angebundenen Quellen."),
    evidenceIds: evidence.filter((entry) => /farbe|color|angebot|position/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 4).map((entry) => entry.id),
  });

  checks.push({
    key: "design",
    label: "Designs/Bilder",
    status: latestOffer?.designEvidenceCount ? "verified" : questionMentions(question, "design", "entwurf", "mockup", "motiv") ? "missing" : "unknown",
    summary: latestOffer
      ? `${latestOffer.designEvidenceCount} Design-/Bildhinweise im Angebot, ${latestOffer.imageCount} aktive Bilder.`
      : "Kein Angebotssnapshot für Designprüfung geladen.",
    evidenceIds: designEvidence.slice(0, 6).map((entry) => entry.id),
  });

  checks.push({
    key: "product_type",
    label: "Produktart",
    status:
      questionMentions(question, "3d", "3-d")
        ? latestOffer?.productHints.includes("3D")
          ? "verified"
          : latestOffer
            ? "warning"
            : "unknown"
        : latestOffer?.productHints.length
          ? "verified"
          : "unknown",
    summary: latestOffer?.productHints.length ? `Produkt-Hinweise: ${latestOffer.productHints.join(", ")}.` : "Keine Produktart sicher erkannt.",
    evidenceIds: [offerEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "customer_reply",
    label: "Kundenantwort",
    status: inboundEvidence ? "verified" : "unknown",
    summary: inboundEvidence?.occurredAt ? `Letzter Eingang am ${inboundEvidence.occurredAt}: ${inboundEvidence.title}.` : "Kein Eingang in den geladenen Timeline-Belegen.",
    evidenceIds: [inboundEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "order",
    label: "Bestellung",
    status: latestRecord?.latestOrderNumber ? "verified" : questionMentions(question, "bestellung", "shopify", "bezahlt", "gekauft") ? "missing" : "unknown",
    summary: latestRecord?.latestOrderNumber
      ? `Bestellung ${latestRecord.latestOrderNumber}${latestRecord.latestOrderStatus ? ` · ${latestRecord.latestOrderStatus}` : ""}.`
      : "Keine verknüpfte Bestellung im geladenen Fall.",
    evidenceIds: evidence.filter((entry) => /bestellung|order|shopify/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 3).map((entry) => entry.id),
  });

  return checks;
}

function buildAnswer(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  gaps: CompanyBrainFinding[],
  conflicts: CompanyBrainFinding[],
  question: string | null,
) {
  const bullets: string[] = [];
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const lowerQuestion = (question || "").toLowerCase();

  if (latestRecord) {
    bullets.push(`Kundenakte: ${latestRecord.displayName || latestRecord.company || latestRecord.email || latestRecord.requestId} (${latestRecord.requestId}).`);
    if (latestRecord.requestedColors.length) bullets.push(`Bestell-/Anfragefarbe laut Request: ${latestRecord.requestedColors.join(", ")}.`);
    if (latestRecord.latestOfferSentAt) bullets.push(`Letzter Angebotsversand laut Master-Quote: ${latestRecord.latestOfferSentAt}.`);
    if (latestRecord.latestOutboundAt) bullets.push(`Letzte ausgehende Kommunikation in der Timeline: ${latestRecord.latestOutboundAt}.`);
  }
  if (latestOffer) {
    bullets.push(`Angebot: ${latestOffer.offerNumber || latestOffer.documentReference}, Status ${latestOffer.status}, ${latestOffer.itemCount} Positionen, ${latestOffer.imageCount} Bilder/Designs.`);
    if (latestOffer.productHints.length) bullets.push(`Produkt-Hinweise im Angebot: ${latestOffer.productHints.join(", ")}.`);
    if (latestOffer.colorHints.length) bullets.push(`Farb-Hinweise im Angebot: ${latestOffer.colorHints.join(", ")}.`);
    if (latestOffer.selectedItems.length) bullets.push(`Ausgewählte Positionen: ${latestOffer.selectedItems.map((item) => item.title).slice(0, 3).join(", ")}.`);
  }
  if (lowerQuestion.includes("3d") || lowerQuestion.includes("design")) {
    if (latestOffer) {
      bullets.push(`Design-Prüfung: ${latestOffer.designEvidenceCount} Design-/Bildhinweise; 3D-Hinweis ${latestOffer.productHints.includes("3D") ? "gefunden" : "nicht gefunden"}.`);
    }
  }
  if (lowerQuestion.includes("mail") || lowerQuestion.includes("email") || lowerQuestion.includes("raus") || lowerQuestion.includes("gesendet")) {
    const outbound = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up/i.test(entry.title));
    bullets.push(outbound ? `Versandbeleg gefunden: ${outbound.title}${outbound.occurredAt ? ` am ${outbound.occurredAt}` : ""}.` : "Kein eindeutiger Versandbeleg gefunden.");
  }
  if (conflicts.length) bullets.push(`Konflikt: ${conflicts[0].detail}`);
  if (!bullets.length) bullets.push("Keine belastbare Aussage möglich, weil keine verknüpften Daten gefunden wurden.");

  const verdict = records.length || offers.length ? (gaps.some((gap) => gap.severity !== "info") ? "partial" : "found") : "not_found";
  const confidence = conflicts.length || gaps.some((gap) => gap.severity === "warning") ? "medium" : verdict === "found" ? "high" : "low";

  return {
    verdict,
    confidence,
    headline:
      verdict === "found"
        ? "Fall gefunden, Belege geladen."
        : verdict === "partial"
          ? "Fall teilweise gefunden, Quellenlücken beachten."
          : "Kein belastbarer Falltreffer.",
    bullets: bullets.slice(0, 8),
  } satisfies CompanyBrainResolveResult["answer"];
}

function nextActionsFor(gaps: CompanyBrainFinding[], conflicts: CompanyBrainFinding[]) {
  const actions = [
    conflicts.length ? "Konflikt mit Kunde/Angebot manuell prüfen, bevor eine Antwort rausgeht." : null,
    gaps.some((gap) => gap.source === "customer_records") ? "Mit E-Mail, Angebotsnummer oder Trello-ID erneut suchen." : null,
    gaps.some((gap) => gap.source === "offers") ? "Angebotssoftware-Verbindung prüfen oder direkt im Angebotsadmin öffnen." : null,
    gaps.some((gap) => gap.title.includes("Versandbeleg")) ? "Outlook-/customer_email_messages-Sync prüfen, bevor Versandstatus bestätigt wird." : null,
  ].filter(Boolean) as string[];
  return actions.length ? actions : ["Belege im Zeitstrahl prüfen und erst danach Kundenaussage formulieren."];
}

export async function resolveCompanyBrain(input: CompanyBrainResolveInput): Promise<CompanyBrainResolveResult> {
  const query = normalizeCompanyBrainQuery(input.query);
  const question = cleanText(input.question) || null;
  const limit = clampLimit(input.limit);
  if (query.length < 2) throw new QuoteValidationError("Bitte mindestens 2 Zeichen suchen.");

  const diagnostics: CompanyBrainDiagnostic[] = [];
  const identifiers = extractCompanyBrainIdentifiers(query);
  const customerRecords: CustomerSearchResult[] = [];
  let offerSearchResults: OpsOfferSearchResult[] = [];

  try {
    customerRecords.push(...await searchCustomerRecords(query));
    diagnostics.push({ source: "customer_records", ok: true, label: "Kundenakte", detail: null, count: customerRecords.length });
  } catch (error) {
    diagnostics.push({ source: "customer_records", ok: false, label: "Kundenakte", detail: errorMessage(error), count: 0 });
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "request_id").slice(0, 2)) {
    try {
      customerRecords.push(await getCustomerRecordByRequestId(identifier.value));
    } catch {
      // searchCustomerRecords already records the customer-record diagnostic.
    }
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "trello_card_id").slice(0, 2)) {
    try {
      customerRecords.push(...await searchCustomerRecords(`trello:${identifier.value}`));
    } catch {
      // the main customer-record diagnostic above is enough for the operator.
    }
  }

  try {
    const offerSearch = await searchOffers(query, limit);
    offerSearchResults = dedupeOfferSearchResults(offerSearch.results).slice(0, limit);
    diagnostics.push({ source: "offers", ok: true, label: "Angebote", detail: null, count: offerSearchResults.length });
  } catch (error) {
    diagnostics.push({ source: "offers", ok: false, label: "Angebote", detail: errorMessage(error as OpsOfferApiError), count: 0 });
  }

  for (const offer of offerSearchResults.slice(0, 3)) {
    try {
      customerRecords.push(...await listCustomerRecordsByOfferBridge(
        { offerId: offer.offerId, offerNumber: offer.offerNumber || undefined, documentReference: offer.documentReference },
        { includeActivity: true, includeOfferTracking: true, includeRelated: true, includeTrello: false },
      ));
    } catch (error) {
      diagnostics.push({ source: "offer_bridge", ok: false, label: "Offer-Bridge", detail: errorMessage(error), count: 0 });
    }
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "offer_number").slice(0, 3)) {
    try {
      const bridgeRecords = await listCustomerRecordsByOfferBridge(
        { offerNumber: identifier.value },
        { includeActivity: true, includeOfferTracking: true, includeRelated: true, includeTrello: false },
      );
      customerRecords.push(...bridgeRecords);
      diagnostics.push({ source: "offer_bridge", ok: true, label: `Offer-Bridge ${identifier.value}`, detail: null, count: bridgeRecords.length });
    } catch (error) {
      diagnostics.push({ source: "offer_bridge", ok: false, label: `Offer-Bridge ${identifier.value}`, detail: errorMessage(error), count: 0 });
    }
  }

  const records = dedupeRecords(customerRecords).slice(0, limit);
  const offerSnapshots: OpsOfferSnapshot[] = [];
  for (const offer of offerSearchResults.slice(0, Math.min(3, limit))) {
    try {
      offerSnapshots.push(await getOfferById(offer.offerId));
    } catch (error) {
      diagnostics.push({ source: "offers", ok: false, label: `Angebot ${offer.offerNumber || offer.offerId}`, detail: errorMessage(error), count: 0 });
    }
  }

  const recordSummaries = records.map(mapRecordSummary);
  const offerSummaries = offerSnapshots.map(mapOfferSummary);
  addRecordIdentifiers(identifiers, records);
  addOfferIdentifiers(identifiers, offerSummaries);

  const evidence = [
    ...records.flatMap(mapTimelineEvidence),
    ...offerSummaries.flatMap(mapOfferEvidence),
  ]
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .slice(0, 30);
  const assets = buildAssetInventory(records, offerSummaries, evidence);
  const integrationReadiness = buildIntegrationReadiness();
  diagnostics.push({
    source: "integration_readiness",
    ok: true,
    label: "Integrations-Readiness",
    detail: integrationReadiness.map((entry) => `${entry.label}: ${entry.status}`).join(" · "),
    count: integrationReadiness.filter((entry) => entry.status === "configured").length,
  });
  const crossChecks = buildCompanyBrainCrossChecks({ records: recordSummaries, offers: offerSummaries, evidence, question });
  const conflicts = buildConflicts(crossChecks);
  const gaps = buildGaps(recordSummaries, offerSummaries, diagnostics);
  const checks = buildChecks(recordSummaries, offerSummaries, evidence, conflicts, question);
  const answer = buildAnswer(recordSummaries, offerSummaries, evidence, gaps, conflicts, question);
  const automation = await fetchAutomationRuns(recordSummaries, offerSummaries);
  diagnostics.push(automation.diagnostic);
  const caseEvents = buildCaseEvents(evidence, automation.runs);
  const sourceHealth = buildSourceHealth(recordSummaries, offerSummaries, evidence, diagnostics, automation.runs);
  const generatedAt = new Date().toISOString();
  const replyDraft = buildReplyDraft({
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    crossChecks,
    conflicts,
    gaps,
    evidence,
  });
  const watchers = buildWatchers({
    records,
    recordSummaries,
    offers: offerSummaries,
    evidence,
    crossChecks,
    automationRuns: automation.runs,
    integrationReadiness,
    assets,
  });
  const actionProposals = buildActionProposals({
    records: recordSummaries,
    offers: offerSummaries,
    replyDraft,
    watchers,
    automationRuns: automation.runs,
    integrationReadiness,
    assets,
  });
  const dossier = buildDossier({
    generatedAt,
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    caseEvents,
    assets,
    crossChecks,
    integrationReadiness,
    watchers,
    actionProposals,
    checks,
    sourceHealth,
    automationRuns: automation.runs,
    replyDraft,
    conflicts,
    gaps,
    evidence,
  });

  return {
    query,
    question,
    generatedAt,
    mode: "deterministic_read_only",
    identifiers,
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    caseEvents,
    assets,
    crossChecks,
    integrationReadiness,
    watchers,
    actionProposals,
    checks,
    sourceHealth,
    automationRuns: automation.runs,
    dossier,
    replyDraft,
    evidence,
    conflicts,
    gaps,
    diagnostics,
    nextActions: nextActionsFor(gaps, conflicts),
  };
}
