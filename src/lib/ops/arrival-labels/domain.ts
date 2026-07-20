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
  lastSix: string;
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
  adminUrl: string;
  customerName: string | null;
  note: string | null;
  customAttributes: Array<{ key: string; value: string }>;
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
  lastSix: string;
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

export type ShopifyAutomationGateReason =
  | "pickup_instruction"
  | "non_standard_shopify_note"
  | "non_standard_shopify_attribute";

export type ShopifyAutomationGate = {
  blocked: boolean;
  reasonCodes: ShopifyAutomationGateReason[];
  reason: string | null;
  noteExcerpt: string | null;
  attributeKeys: string[];
};

const OFFER_TOKEN = "[A-Za-z0-9_-]{8,128}";
const OFFER_URL = new RegExp(`^https://angebote[.]neontrip[.]de/offer/(${OFFER_TOKEN})$`);
const PDF_URL = new RegExp(`^https://angebote[.]neontrip[.]de/offer/(${OFFER_TOKEN})/pdf$`);
const OFFER_ID = new RegExp(`^${OFFER_TOKEN}$`);
const OFFER_NUMBER = /^A\/N [0-9]{1,12}$/;
const MONEY = "[0-9]+(?:[.,][0-9]{1,2})?";
const PICKUP_PATTERN = /\b(?:(?:selbst)?abhol[a-z]*|abgeholt|holt\s+ab|holen\s+ab|wird\s+abgeholt|ladenlokal|laden\s+lokal|vor\s+ort|local\s+pickup|pickup|pick\s+up|customer\s+collect)\b/i;
const STANDARD_ATTRIBUTE_KEYS = new Set([
  "NEONTRIP Offer ID",
  "NEONTRIP Offer Number",
  "NEONTRIP Offer URL",
  "NEONTRIP PDF Snapshot",
  "Trello Card ID",
  "Idempotency Key",
  "Invoice Mail Intended",
]);

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

export function lastSixOfTracking(trackingNumber: string) {
  const normalized = String(trackingNumber || "").replace(/\D/g, "");
  if (normalized.length < 6) throw new Error("DHL-Sendungsnummer muss mindestens sechs Ziffern enthalten.");
  return normalized.slice(-6);
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
        lastSix: lastSixOfTracking(trackingNumber),
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

function parseStandardOfferMetadataNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  if (!normalized) return { standard: true, offerId: null as string | null };
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 4) return { standard: false, offerId: null as string | null };
  const offerNumber = lines[0].match(/^NEONTRIP Angebot:\s*(A\/N [0-9]{1,12})$/i)?.[1]?.toUpperCase();
  const offerUrlId = lines[1].match(/^Angebotslink:\s*(https:\/\/angebote[.]neontrip[.]de\/offer\/([A-Za-z0-9_-]{8,128}))$/i)?.[2];
  const pdfUrlId = lines[2].match(/^PDF Snapshot:\s*(https:\/\/angebote[.]neontrip[.]de\/offer\/([A-Za-z0-9_-]{8,128})\/pdf)$/i)?.[2];
  const pricesMatch = new RegExp(`^Netto:\\s*${MONEY}\\s*/\\s*MwSt:\\s*${MONEY}\\s*/\\s*Brutto:\\s*${MONEY}$`, "i").test(lines[3]);
  return {
    standard: Boolean(offerNumber && offerUrlId && pdfUrlId && offerUrlId === pdfUrlId && pricesMatch),
    offerId: offerUrlId || null,
  };
}

export function isStandardOfferMetadataNote(note: string | null | undefined) {
  return parseStandardOfferMetadataNote(note).standard;
}

export function relevantOrderNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  if (!normalized || isStandardOfferMetadataNote(normalized)) return null;
  return normalized;
}

export function noteHash(note: string | null | undefined) {
  return createHash("sha256").update(String(note || ""), "utf8").digest("hex");
}

function standardAttributes(attributes: ShopifyOrderEvidence["customAttributes"]) {
  if (attributes.length === 0) return true;
  if (attributes.length !== STANDARD_ATTRIBUTE_KEYS.size) return false;
  const values = new Map<string, string>();
  for (const attribute of attributes) {
    const key = String(attribute.key || "").trim();
    const value = String(attribute.value || "").trim();
    if (!STANDARD_ATTRIBUTE_KEYS.has(key) || values.has(key)) return false;
    values.set(key, value);
  }
  const offerId = values.get("NEONTRIP Offer ID") || "";
  const offerUrlId = values.get("NEONTRIP Offer URL")?.match(OFFER_URL)?.[1] || "";
  const pdfUrlId = values.get("NEONTRIP PDF Snapshot")?.match(PDF_URL)?.[1] || "";
  return OFFER_ID.test(offerId)
    && OFFER_NUMBER.test(values.get("NEONTRIP Offer Number") || "")
    && offerUrlId === offerId
    && pdfUrlId === offerId
    && /^[a-f0-9]{24}$/i.test(values.get("Trello Card ID") || "")
    && values.get("Idempotency Key") === `offer:${offerId}:shopify-sale:v1`
    && ["yes_private_email", "business_email_no_shopify_receipt"].includes(values.get("Invoice Mail Intended") || "");
}

export function assessShopifyAutomationGate(order: ShopifyOrderEvidence): ShopifyAutomationGate {
  const reasonCodes: ShopifyAutomationGateReason[] = [];
  const note = String(order.note || "").trim();
  const pickupEvidence = [
    note,
    ...order.customAttributes.flatMap((attribute) => [attribute.key, attribute.value]),
    ...order.tags,
    ...order.shippingLines.flatMap((line) => [line.title, line.code || ""]),
  ].map(normalizeHumanText).join("\n");
  if (PICKUP_PATTERN.test(pickupEvidence)) reasonCodes.push("pickup_instruction");
  if (!isStandardOfferMetadataNote(note)) reasonCodes.push("non_standard_shopify_note");
  if (!standardAttributes(order.customAttributes)) reasonCodes.push("non_standard_shopify_attribute");
  const uniqueCodes = [...new Set(reasonCodes)];
  const reasonParts = uniqueCodes.map((code) => ({
    pickup_instruction: "Shopify enthaelt einen Abhol- oder Ladenlokal-Hinweis.",
    non_standard_shopify_note: "Shopify enthaelt eine Notiz ausserhalb des freigegebenen NEONTRIP-Angebotsformats.",
    non_standard_shopify_attribute: "Shopify enthaelt Zusatzfelder ausserhalb des freigegebenen NEONTRIP-Angebotsformats.",
  })[code]);
  return {
    blocked: uniqueCodes.length > 0,
    reasonCodes: uniqueCodes,
    reason: reasonParts.join(" ") || null,
    noteExcerpt: note ? note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 500) : null,
    attributeKeys: [...new Set(order.customAttributes.map((attribute) => String(attribute.key || "").trim()).filter(Boolean))].sort(),
  };
}

export function classifyShipping(order: ShopifyOrderEvidence, card?: TrelloCardEvidence | null) {
  const evidence = [
    order.note || "",
    ...order.tags,
    ...order.customAttributes.flatMap((attribute) => [attribute.key, attribute.value]),
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
      lastSix: input.arrival.lastSix,
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
      lastSix: input.arrival.lastSix,
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
      lastSix: input.arrival.lastSix,
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
  const gate = assessShopifyAutomationGate(orderMatch.order);
  const note = relevantOrderNote(orderMatch.order.note);
  const shipping = classifyShipping(orderMatch.order, trelloMatch.card);
  if (gate.blocked) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      selectedDpdProduct: null,
      existingDpdTracking: existing?.trackingNumber || null,
      status: "manual_review",
      manualReviewReason: gate.reason,
      relevantOrderNote: gate.noteExcerpt,
      reasons: gate.reasonCodes,
    };
  }
  if (shipping.conflict) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
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
      lastSix: input.arrival.lastSix,
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
  if (shipping.shippingClass === "unknown") {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
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
      lastSix: input.arrival.lastSix,
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
    lastSix: input.arrival.lastSix,
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
