import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

export const ARRIVAL_LABEL_TIMEZONE = "Europe/Berlin" as const;

export type ArrivalRunMode = "dry_run" | "execute";
export type ShippingClass = "standard" | "express" | "express_09" | "express_12" | "express_18" | "urgent" | "special_case" | "unknown";
export type ExpressProductRule = "express" | "express_09" | "express_12" | "express_18" | "urgent";
export type ArrivalCaseStatus =
  | "label_planned"
  | "existing_label"
  | "manual_review"
  | "missing_data"
  | "ambiguous_match"
  | "conflicting_instructions"
  | "special_case";

export type DhlMailEvidence = {
  messageId: string;
  receivedAt: string;
  senderAddress: string;
  subject: string;
  bodyText: string;
};

export type DhlArrival = {
  trackingNumber: string;
  lastFour: string;
  localDate: string;
  deliveryState: "due_today" | "delivered_today";
  expectedArrivalAt: string | null;
  messageIds: string[];
};

export type TrelloCardEvidence = {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  listId?: string | null;
};

export type ShopifyFulfillmentEvidence = {
  id: string;
  status: string | null;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export type ShopifyOrderEvidence = {
  id: string;
  name: string;
  customerName: string | null;
  note: string | null;
  tags: string[];
  lineItems: Array<{ title: string; quantity: number }>;
  shippingLines: Array<{ title: string; code: string | null }>;
  fulfillments: ShopifyFulfillmentEvidence[];
};

export type ExistingDpdEvidence = {
  trackingNumber: string;
  labelPdfUrl?: string | null;
  source: "shopify" | "database" | "easydpd";
};

export type ProductConfig = {
  version: string;
  enabled: boolean;
  standardProductCode: string | null;
  expressProductMapping: Partial<Record<ExpressProductRule, string>>;
  printerKey?: string | null;
  printMedia?: string | null;
};

export type ArrivalCaseDecision = {
  idempotencyKey: string;
  trackingNumber: string;
  lastFour: string;
  expectedArrival: string;
  trelloCard: TrelloCardEvidence | null;
  shopifyOrder: ShopifyOrderEvidence | null;
  shippingClass: ShippingClass;
  selectedDpdProduct: string | null;
  existingDpdTracking: string | null;
  status: ArrivalCaseStatus;
  manualReviewReason: string | null;
  relevantOrderNote: string | null;
  reasons: string[];
};

const STANDARD_NOTE_PATTERNS = [
  /^NEONTRIP Angebot:\s*.+$/i,
  /^Angebotslink:\s*https:\/\/.+$/i,
  /^PDF Snapshot:\s*https:\/\/.+$/i,
  /^Netto:\s*.+\/\s*MwSt:\s*.+\/\s*Brutto:\s*.+$/i,
];

const EXPRESS_PATTERN = /\b(express(?:\s*-?\s*(?:versand|zustellung|lieferung))?|expressversand|expresszustellung|expresslieferung)\b/i;
const URGENT_PATTERN = /\b(eilauftrag|eilproduktion|eilig|rush|urgent|priority|priorisierte\s+produktion)\b/i;
const STANDARD_PATTERN = /\b(standard(?:\s*-?\s*versand|lieferung)|normaler\s+versand)\b/i;
const EXPRESS_NEGATION_PATTERN = /\b(kein|nicht|ohne)\s+(?:dpd\s+)?express\b|\bstandard\s+statt\s+express\b/i;

function hasExpressDeadline(evidence: string, hour: "09" | "12" | "18") {
  const shortHour = hour === "09" ? "0?9" : hour;
  const time = `${shortHour}(?:(?::|\\.)00|\\s*uhr)`;
  const expressFirst = `(?:express(?:\\s*-?\\s*(?:versand|zustellung|lieferung))?|expressversand|expresszustellung|expresslieferung)[^\\n.]{0,40}(?:bis\\s*)?${time}`;
  const deadlineFirst = `(?:bis|vor|spaetestens)\\s*${time}[^\\n.]{0,40}(?:zustellung|lieferung|versand|express)`;
  return new RegExp(`(?:${expressFirst}|${deadlineFirst})`, "i").test(evidence);
}

export function normalizeHumanText(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function extractDhlTrackingNumbers(value: unknown) {
  const text = String(value || "");
  const numbers = new Set<string>();
  const contextual = /(?:sendungs(?:nummer|nr\.?|nummern)|tracking(?:\s*number)?|dhl\s*express)[^0-9]{0,40}((?:\d[\s.\/-]?){9,39}\d)/gi;
  for (const match of text.matchAll(contextual)) {
    const digits = String(match[1] || "").replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 40) numbers.add(digits);
  }
  return [...numbers];
}

export function lastFourOfTracking(trackingNumber: string) {
  const normalized = String(trackingNumber || "").replace(/\D/g, "");
  if (normalized.length < 4) throw new Error("DHL-Sendungsnummer muss mindestens vier Ziffern enthalten.");
  return normalized.slice(-4);
}

export function arrivalsFromDhlMessages(messages: DhlMailEvidence[], localDate: string) {
  const byTracking = new Map<string, DhlArrival>();
  for (const message of messages) {
    const sender = normalizeHumanText(message.senderAddress);
    const text = `${message.subject}\n${message.bodyText}`;
    if (!sender.includes("dhl") && !/dhl\s+express/i.test(text)) continue;

    const receivedLocalDate = receivedDateInBerlin(message.receivedAt);
    const relativeToday = /\b(HEUTE|TODAY)\b/i.test(text) && receivedLocalDate === localDate;
    const relativeTomorrow = /\b(MORGEN|TOMORROW)\b/i.test(text)
      && receivedLocalDate !== null
      && Temporal.PlainDate.from(receivedLocalDate).add({ days: 1 }).toString() === localDate;
    const explicitDate = dateTextMatches(text, localDate) && /\b(zustell|liefer|delivery|arriv|scheduled)\w*/i.test(text);
    const dueToday = relativeToday || relativeTomorrow || explicitDate;
    const deliveredToday = /\bzugestellt\b/i.test(text) && dateTextMatches(text, localDate);
    if (!dueToday && !deliveredToday) continue;

    for (const trackingNumber of extractDhlTrackingNumbers(text)) {
      const previous = byTracking.get(trackingNumber);
      const deliveryState = deliveredToday ? "delivered_today" : previous?.deliveryState || "due_today";
      byTracking.set(trackingNumber, {
        trackingNumber,
        lastFour: lastFourOfTracking(trackingNumber),
        localDate,
        deliveryState,
        expectedArrivalAt: null,
        messageIds: [...new Set([...(previous?.messageIds || []), message.messageId])],
      });
    }
  }
  return [...byTracking.values()].sort((a, b) => a.trackingNumber.localeCompare(b.trackingNumber));
}

function receivedDateInBerlin(value: string) {
  try {
    return Temporal.Instant.from(value).toZonedDateTimeISO(ARRIVAL_LABEL_TIMEZONE).toPlainDate().toString();
  } catch {
    return null;
  }
}

function dateTextMatches(text: string, localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  const englishMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const english = new RegExp(`\\b${day}\\s+${englishMonths[month - 1]}(?:[a-z]*)?\\s+${year}\\b`, "i");
  const german = new RegExp(`\\b${String(day).padStart(2, "0")}[.]${String(month).padStart(2, "0")}[.]${year}\\b`);
  return english.test(text) || german.test(text);
}

export function findTrelloCardForTracking(cards: TrelloCardEvidence[], trackingNumber: string) {
  const matches = cards.filter((card) => card.name.includes(trackingNumber));
  if (matches.length === 1) return { card: matches[0], error: null as string | null };
  if (matches.length === 0) return { card: null, error: `Keine Trello-Karte enthaelt ${trackingNumber}.` };
  return { card: null, error: `${matches.length} Trello-Karten enthalten ${trackingNumber}.` };
}

export function orderNameFromTrelloCard(cardName: string) {
  return cardName.match(/#NEONT\d+/i)?.[0]?.toUpperCase() || null;
}

export function isDimmerSpecialCase(card: TrelloCardEvidence) {
  const text = normalizeHumanText(`${card.name} ${card.description || ""}`);
  const quantity = /\b100\s*(stuck|stk|pieces?|pcs?)\b/.test(text);
  const dimmer = /\bdimmers?\b/.test(text);
  const singleColor = /\b(einfarbig|single\s+colou?r)\b/.test(text);
  return quantity && dimmer && singleColor;
}

export function isStandardOfferMetadataNote(note: string | null | undefined) {
  const lines = String(note || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => STANDARD_NOTE_PATTERNS.some((pattern) => pattern.test(line)));
}

export function relevantOrderNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  if (!normalized || isStandardOfferMetadataNote(normalized)) return null;
  return normalized;
}

export function noteHash(note: string | null | undefined) {
  return createHash("sha256").update(String(note || ""), "utf8").digest("hex");
}

export function classifyShipping(order: ShopifyOrderEvidence, card?: TrelloCardEvidence | null) {
  const evidence = [
    order.note || "",
    ...order.tags,
    ...order.lineItems.map((item) => `${item.quantity} ${item.title}`),
    ...order.shippingLines.flatMap((line) => [line.title, line.code || ""]),
    card?.name || "",
    card?.description || "",
  ].join("\n");
  const express = EXPRESS_PATTERN.test(evidence);
  const urgent = URGENT_PATTERN.test(evidence);
  const explicitNegation = EXPRESS_NEGATION_PATTERN.test(evidence);
  const standard = STANDARD_PATTERN.test(evidence);
  const deadlines = (["09", "12", "18"] as const)
    .filter((hour) => hasExpressDeadline(evidence, hour))
    .map((hour) => `express_${hour}` as "express_09" | "express_12" | "express_18");

  if (deadlines.length > 1) {
    return { shippingClass: "unknown" as const, conflict: "Mehrere Express-Zustellzeiten widersprechen sich." };
  }
  if ((express || urgent || deadlines.length) && explicitNegation) {
    return { shippingClass: "unknown" as const, conflict: "Express-Hinweis und ausdruecklicher Ausschluss widersprechen sich." };
  }
  if (deadlines[0]) return { shippingClass: deadlines[0], conflict: null };
  if (urgent) return { shippingClass: "urgent" as const, conflict: null };
  if (express) return { shippingClass: "express" as const, conflict: null };
  if (standard || explicitNegation) return { shippingClass: "standard" as const, conflict: null };
  return { shippingClass: "unknown" as const, conflict: null };
}

export function resolveShopifyOrder(input: {
  card: TrelloCardEvidence;
  orders: ShopifyOrderEvidence[];
  customerNameHints?: string[];
}) {
  const explicitOrderName = orderNameFromTrelloCard(input.card.name);
  if (explicitOrderName) {
    const exact = input.orders.filter((order) => order.name.toUpperCase() === explicitOrderName);
    if (exact.length === 1) return { order: exact[0], error: null as string | null };
    if (exact.length > 1) return { order: null, error: `Shopify-Bestellnummer ${explicitOrderName} ist nicht eindeutig.` };
    return { order: null, error: `Shopify-Bestellung ${explicitOrderName} wurde nicht gefunden.` };
  }

  const hints = (input.customerNameHints || []).map(normalizeHumanText).filter((value) => value.length >= 4);
  const matches = input.orders.filter((order) => {
    const customer = normalizeHumanText(order.customerName);
    return customer && hints.includes(customer);
  });
  if (matches.length === 1) return { order: matches[0], error: null as string | null };
  if (matches.length === 0) return { order: null, error: "Keine eindeutig passende Shopify-Bestellung gefunden." };
  return { order: null, error: `${matches.length} Shopify-Bestellungen passen zum Kundennamen.` };
}

export function existingDpdFromOrder(order: ShopifyOrderEvidence, databaseEvidence: ExistingDpdEvidence[] = []) {
  const shopify = order.fulfillments
    .filter((fulfillment) => fulfillment.trackingNumber)
    .map((fulfillment) => ({
      trackingNumber: fulfillment.trackingNumber as string,
      source: "shopify" as const,
      fulfillmentId: fulfillment.id,
    }));
  const combined = [
    ...shopify,
    ...databaseEvidence.map((entry) => ({ trackingNumber: entry.trackingNumber, source: entry.source, fulfillmentId: null })),
  ];
  const dpd = combined.find((entry) => /dpd/i.test(
    order.fulfillments.find((fulfillment) => fulfillment.id === entry.fulfillmentId)?.trackingCompany || entry.source,
  ));
  return dpd || combined[0] || null;
}

export function selectDpdProduct(shippingClass: ShippingClass, config: ProductConfig | null) {
  if (!config?.enabled) return null;
  if (shippingClass === "standard") return config.standardProductCode;
  if (["express", "express_09", "express_12", "express_18", "urgent"].includes(shippingClass)) {
    return config.expressProductMapping[shippingClass as ExpressProductRule] || null;
  }
  return null;
}

export function buildIdempotencyKey(shopifyOrderId: string | null, trackingNumber: string, specialCase = false) {
  if (specialCase) return `special:dhl:${trackingNumber}`;
  if (!shopifyOrderId) return `unmatched:dhl:${trackingNumber}`;
  return `shopify:${shopifyOrderId}:dhl:${trackingNumber}`;
}

export function decideArrivalCase(input: {
  arrival: DhlArrival;
  trelloCards: TrelloCardEvidence[];
  shopifyOrders: ShopifyOrderEvidence[];
  customerNameHintsByCardId?: Record<string, string[]>;
  existingDpdEvidence?: ExistingDpdEvidence[];
  productConfig: ProductConfig | null;
}): ArrivalCaseDecision {
  const reasons: string[] = [];
  const trelloMatch = findTrelloCardForTracking(input.trelloCards, input.arrival.trackingNumber);
  if (!trelloMatch.card) {
    return {
      idempotencyKey: buildIdempotencyKey(null, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: null,
      shopifyOrder: null,
      shippingClass: "unknown",
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: trelloMatch.error?.startsWith("Keine") ? "missing_data" : "ambiguous_match",
      manualReviewReason: trelloMatch.error,
      relevantOrderNote: null,
      reasons,
    };
  }

  if (isDimmerSpecialCase(trelloMatch.card)) {
    return {
      idempotencyKey: buildIdempotencyKey(null, input.arrival.trackingNumber, true),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: null,
      shippingClass: "special_case",
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "special_case",
      manualReviewReason: "Sonderfall: 100 Stueck einfarbige Dimmer ohne erwartete Shopify-Bestellung.",
      relevantOrderNote: null,
      reasons: ["dimmer_special_case"],
    };
  }

  const orderMatch = resolveShopifyOrder({
    card: trelloMatch.card,
    orders: input.shopifyOrders,
    customerNameHints: input.customerNameHintsByCardId?.[trelloMatch.card.id],
  });
  if (!orderMatch.order) {
    return {
      idempotencyKey: buildIdempotencyKey(null, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: null,
      shippingClass: "unknown",
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: /nicht eindeutig|Bestellungen passen/.test(orderMatch.error || "") ? "ambiguous_match" : "missing_data",
      manualReviewReason: orderMatch.error,
      relevantOrderNote: null,
      reasons,
    };
  }

  const existing = existingDpdFromOrder(orderMatch.order, input.existingDpdEvidence);
  const note = relevantOrderNote(orderMatch.order.note);
  const shipping = classifyShipping(orderMatch.order, trelloMatch.card);
  if (shipping.conflict) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: "unknown",
      selectedDpdProduct: null,
      existingDpdTracking: existing?.trackingNumber || null,
      status: "conflicting_instructions",
      manualReviewReason: shipping.conflict,
      relevantOrderNote: note,
      reasons,
    };
  }
  if (existing) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      selectedDpdProduct: null,
      existingDpdTracking: existing.trackingNumber,
      status: "existing_label",
      manualReviewReason: null,
      relevantOrderNote: note,
      reasons: [`existing_${existing.source}_tracking`],
    };
  }
  if (note) reasons.push("non_standard_shopify_note");
  if (note) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: "Shopify enthaelt eine nicht standardisierte interne Notiz.",
      relevantOrderNote: note,
      reasons,
    };
  }
  if (shipping.shippingClass === "unknown") {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: "unknown",
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: "Versandart konnte nicht sicher bestimmt werden.",
      relevantOrderNote: null,
      reasons,
    };
  }

  const product = selectDpdProduct(shipping.shippingClass, input.productConfig);
  if (!product) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastFour: input.arrival.lastFour,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: `Kein bestaetigtes DPD-Produkt fuer ${shipping.shippingClass} konfiguriert.`,
      relevantOrderNote: null,
      reasons: [...reasons, "dpd_product_config_missing"],
    };
  }

  return {
    idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
    trackingNumber: input.arrival.trackingNumber,
    lastFour: input.arrival.lastFour,
    expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
    trelloCard: trelloMatch.card,
    shopifyOrder: orderMatch.order,
    shippingClass: shipping.shippingClass,
    selectedDpdProduct: product,
    existingDpdTracking: null,
    status: "label_planned",
    manualReviewReason: null,
    relevantOrderNote: null,
    reasons,
  };
}
