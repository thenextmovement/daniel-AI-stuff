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
  source: "customer_records" | "offers" | "offer_bridge";
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

export type CompanyBrainCheck = {
  key: "offer_sent" | "color" | "design" | "product_type" | "customer_reply" | "order";
  label: string;
  status: "verified" | "warning" | "missing" | "unknown";
  summary: string;
  evidenceIds: string[];
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
  checks: CompanyBrainCheck[];
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

function buildConflicts(records: CompanyBrainRecordSummary[], offers: CompanyBrainOfferSummary[]) {
  const conflicts: CompanyBrainFinding[] = [];
  const requestColors = uniqueStrings(records.flatMap((record) => record.requestedColors));
  const offerColors = uniqueStrings(offers.flatMap((offer) => offer.colorHints));
  if (requestColors.length && offerColors.length) {
    const normalizedOfferColors = new Set(offerColors.map(normalizeColorGroup));
    const missingInOffer = requestColors.filter((color) => !normalizedOfferColors.has(normalizeColorGroup(color)));
    if (missingInOffer.length) {
      conflicts.push({
        severity: "warning",
        title: "Farbhinweise weichen ab",
        detail: `Request nennt ${requestColors.join(", ")}; im Angebotstext erkannt: ${offerColors.join(", ")}.`,
        source: "request_vs_offer",
      });
    }
  }
  return conflicts;
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
  const colorConflict = conflicts.find((entry) => entry.source === "request_vs_offer") || null;
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
  const conflicts = buildConflicts(recordSummaries, offerSummaries);
  const gaps = buildGaps(recordSummaries, offerSummaries, diagnostics);
  const checks = buildChecks(recordSummaries, offerSummaries, evidence, conflicts, question);
  const answer = buildAnswer(recordSummaries, offerSummaries, evidence, gaps, conflicts, question);

  return {
    query,
    question,
    generatedAt: new Date().toISOString(),
    mode: "deterministic_read_only",
    identifiers,
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    checks,
    evidence,
    conflicts,
    gaps,
    diagnostics,
    nextActions: nextActionsFor(gaps, conflicts),
  };
}
