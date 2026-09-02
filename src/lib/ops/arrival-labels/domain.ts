import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

export const ARRIVAL_LABEL_TIMEZONE = "Europe/Berlin" as const;
export const ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID = "62bae9b97705e7419ed64593" as const;
export const ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID = "6347e09cb326e6014856bc3b" as const;
export const ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID = "69ef8a5b2e64cf224dd5746e" as const;
export const ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME = "Create Invoice (With Tracking)" as const;
export const ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION = "dhl-10-digit-suffix-v1" as const;

export type ArrivalRunMode = "dry_run" | "execute";
export type ShippingClass = "standard" | "express" | "express_09" | "express_12" | "express_18" | "urgent" | "special_case" | "unknown";
export type ExpressProductRule = "express" | "express_09" | "express_12" | "express_18" | "urgent";
export type DpdProductRule = "standard" | ExpressProductRule;
export type DestinationClass = "domestic_de" | "eu" | "switzerland" | "non_eu" | "special_territory" | "unknown";
export type DeliveryNoteStatus = "not_required" | "planned" | "qa_approved" | "print_queued" | "printed" | "manual_review";
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
  deliveryState: "unknown" | "due_today" | "delivered_today";
  expectedArrivalAt: string | null;
  messageIds: string[];
  sourceKinds: Array<"outlook_dhl" | "trello_sign_shipped" | "trello_create_invoice">;
  trelloTrigger: {
    boardId: string;
    listId: string;
    cardIds: string[];
    latestActivityAt: string | null;
    enabledAfter: string;
    titlePatternVersion: typeof ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION;
  } | null;
};

export type TrelloCardEvidence = {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  boardId?: string | null;
  listId?: string | null;
  listName?: string | null;
  dateLastActivity?: string | null;
};

export type TrelloSignShippedTriggerSettings = {
  enabled: boolean;
  enabledAfter: string;
  boardId: string;
  sourceListId: string;
  sourceListName: "Sign SHIPPED (NEON TRIP)";
  titlePatternVersion: typeof ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION;
};

export type ShopifyFulfillmentEvidence = {
  id: string;
  status: string | null;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export type ShopifyShippingAddressEvidence = {
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCodeV2: string | null;
};

export type ShopifyFinancialStatus =
  | "paid"
  | "pending"
  | "authorized"
  | "partially_paid"
  | "partially_refunded"
  | "refunded"
  | "voided"
  | "expired"
  | "unknown";

export type ShopifyOrderEvidence = {
  id: string;
  name: string;
  adminUrl: string;
  customerName: string | null;
  financialStatus: ShopifyFinancialStatus;
  note: string | null;
  shippingAddress: ShopifyShippingAddressEvidence | null;
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
  euProductMapping?: Partial<Record<DpdProductRule, string>>;
  printerKey?: string | null;
  printMedia?: string | null;
  deliveryNotePrinterKey?: string | null;
  deliveryNotePrintMedia?: string | null;
  pdfLayoutConfig?: import("./pdf").DpdPdfLayout | null;
  storageBucket?: string | null;
};

export type ArrivalCaseDecision = {
  idempotencyKey: string;
  trackingNumber: string;
  lastSix: string;
  expectedArrival: string;
  trelloCard: TrelloCardEvidence | null;
  shopifyOrder: ShopifyOrderEvidence | null;
  shippingClass: ShippingClass;
  destinationCountryCode: string | null;
  destinationClass: DestinationClass;
  deliveryNoteRequired: boolean;
  deliveryNoteStatus: DeliveryNoteStatus;
  selectedDpdProduct: string | null;
  existingDpdTracking: string | null;
  status: ArrivalCaseStatus;
  manualReviewReason: string | null;
  relevantOrderNote: string | null;
  reasons: string[];
};

export type DestinationGateReason =
  | "destination_country_missing"
  | "destination_switzerland_manual"
  | "destination_non_eu_manual"
  | "destination_special_territory_manual"
  | "delivery_note_address_incomplete"
  | "delivery_note_printer_not_configured"
  | "delivery_note_printer_not_separate";

export type DestinationGate = {
  blocked: boolean;
  destinationCountryCode: string | null;
  destinationClass: DestinationClass;
  deliveryNoteRequired: boolean;
  deliveryNoteStatus: DeliveryNoteStatus;
  reasonCode: DestinationGateReason | null;
  reason: string | null;
};

export type ShopifyAutomationGateReason =
  | "pickup_instruction"
  | "non_standard_shopify_note"
  | "non_standard_shopify_attribute"
  | "payment_terminal_status";

export type ShopifyAutomationGate = {
  blocked: boolean;
  reasonCodes: ShopifyAutomationGateReason[];
  reason: string | null;
  noteExcerpt: string | null;
  attributeKeys: string[];
};

export type TrelloAutomationGate =
  | { blocked: false; reasonCode: null; reason: null }
  | { blocked: true; reasonCode: "trello_manual_list"; reason: string };

const OFFER_TOKEN = "[A-Za-z0-9_-]{8,128}";
const OFFER_URL = new RegExp(`^https://angebote[.]neontrip[.]de/offer/(${OFFER_TOKEN})$`);
const PDF_URL = new RegExp(`^https://angebote[.]neontrip[.]de/(?:offer|api/public/offers)/(${OFFER_TOKEN})/pdf$`);
const OFFER_ID = new RegExp(`^${OFFER_TOKEN}$`);
const OFFER_NUMBER = /^A\/N [0-9]{1,12}$/;
const MONEY = "[0-9]+(?:[.,][0-9]{1,2})?";
const PICKUP_PATTERN = /\b(?:(?:selbst)?abhol[a-z]*|abgeholt|holt\s+ab|holen\s+ab|wird\s+abgeholt|ladenlokal|laden\s+lokal|vor\s+ort|local\s+pickup|pickup|pick\s+up|customer\s+collect)\b/i;
const SHIPPING_OVERRIDE_NOTE_PATTERN = /\b(?:adress(?:e|en|iert)|anschrift|address|nicht\s+(?:versenden|verschicken|senden)|kein\s+versand|do\s+not\s+ship|manuell|manual|stopp?|sperr[a-z]*|ableg[a-z]*|ablageort|hinterleg[a-z]*|hinterhof|garage|nachbar[a-z]*|briefkasten|haustu(?:r|er))\b/i;
const OFFER_METADATA_LINE_PREFIX = /^(?:NEONTRIP Angebot|Angebotslink|PDF Snapshot|Netto|Nerdy-Forms_ID|Reverse Charge \/ steuerfrei mit USt-IdNr[.]):/i;
const INTERNAL_UUID_NOTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_STANDARD_ATTRIBUTE_KEYS = new Set([
  "NEONTRIP Offer ID",
  "NEONTRIP Offer Number",
  "NEONTRIP Offer URL",
  "NEONTRIP PDF Snapshot",
  "Trello Card ID",
  "Idempotency Key",
]);
const OPTIONAL_STANDARD_ATTRIBUTE_KEYS = new Set([
  "Invoice Mail Intended",
  "Nerdy-Forms_ID",
  "Reverse Charge",
  "USt-IdNr.",
  "Request Segment",
  "Request S-Kategorie",
  "Request Segment Status",
  "Rechnungs-E-Mail",
  "Projektnummer",
]);
const VAT_ID = /^[A-Z]{2}[A-Z0-9]{6,14}$/;

// Reviewed 2026-07-20 against the official EU country and Commission territorial-scope tables.
// https://european-union.europa.eu/principles-countries-history/eu-countries_en
// https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/how-does-vat-work/territorial-scope_en
// Special VAT/customs territories are handled separately below and remain fail-closed.
const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

function normalizedPostalCode(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isSpecialEuTerritory(address: ShopifyShippingAddressEvidence) {
  const country = String(address.countryCodeV2 || "").toUpperCase();
  const postalCode = normalizedPostalCode(address.zip);
  const place = normalizeHumanText([address.city, address.provinceCode, address.address1, address.address2].filter(Boolean).join(" "));
  if (country === "DE" && (postalCode === "27498" || postalCode === "78266" || /\bhelgoland\b|\bbusingen\b/.test(place))) return true;
  if (country === "ES" && (/^(35|38|51|52)/.test(postalCode) || /\bkanar|\bcanary|\bceuta\b|\bmelilla\b/.test(place))) return true;
  if (country === "FI" && (/^22/.test(postalCode) || /\baland\b/.test(place))) return true;
  if (country === "GR" && (postalCode === "63086" || /\bmount athos\b|\bberg athos\b|\bagio oros\b/.test(place))) return true;
  if (country === "IT" && (/^(23041|22061)$/.test(postalCode) || /\blivigno\b|\bcampione d italia\b/.test(place))) return true;
  return false;
}

function hasCompleteDeliveryAddress(address: ShopifyShippingAddressEvidence) {
  return Boolean(
    (String(address.name || "").trim() || String(address.company || "").trim())
    && String(address.address1 || "").trim()
    && String(address.zip || "").trim()
    && String(address.city || "").trim()
    && String(address.countryCodeV2 || "").trim(),
  );
}

export function assessDestinationGate(order: ShopifyOrderEvidence, config: ProductConfig | null): DestinationGate {
  const address = order.shippingAddress;
  const country = String(address?.countryCodeV2 || "").trim().toUpperCase() || null;
  if (!address || !country || !/^[A-Z]{2}$/.test(country)) {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "unknown",
      deliveryNoteRequired: false,
      deliveryNoteStatus: "manual_review",
      reasonCode: "destination_country_missing",
      reason: "Zielland der Shopify-Lieferadresse fehlt oder ist ungueltig.",
    };
  }
  if (isSpecialEuTerritory(address)) {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "special_territory",
      deliveryNoteRequired: false,
      deliveryNoteStatus: "manual_review",
      reasonCode: "destination_special_territory_manual",
      reason: "Die Lieferadresse liegt in einem EU-Sondergebiet und benoetigt eine manuelle Versand- und Zollpruefung.",
    };
  }
  if (country === "CH") {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "switzerland",
      deliveryNoteRequired: false,
      deliveryNoteStatus: "manual_review",
      reasonCode: "destination_switzerland_manual",
      reason: "Sendungen in die Schweiz werden nicht automatisch gebucht oder gedruckt.",
    };
  }
  if (country === "DE") {
    return {
      blocked: false,
      destinationCountryCode: country,
      destinationClass: "domestic_de",
      deliveryNoteRequired: false,
      deliveryNoteStatus: "not_required",
      reasonCode: null,
      reason: null,
    };
  }
  if (!EU_COUNTRY_CODES.has(country)) {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "non_eu",
      deliveryNoteRequired: false,
      deliveryNoteStatus: "manual_review",
      reasonCode: "destination_non_eu_manual",
      reason: `Sendungen nach ${country} werden nicht automatisch gebucht oder gedruckt.`,
    };
  }
  if (!hasCompleteDeliveryAddress(address)) {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "eu",
      deliveryNoteRequired: true,
      deliveryNoteStatus: "manual_review",
      reasonCode: "delivery_note_address_incomplete",
      reason: "Die EU-Lieferadresse ist fuer einen belastbaren Lieferschein unvollstaendig.",
    };
  }
  if (!config?.deliveryNotePrinterKey || String(config.deliveryNotePrintMedia || "").toUpperCase() !== "A4") {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "eu",
      deliveryNoteRequired: true,
      deliveryNoteStatus: "manual_review",
      reasonCode: "delivery_note_printer_not_configured",
      reason: "Fuer EU-Sendungen ist kein freigegebener A4-Lieferscheindrucker konfiguriert.",
    };
  }
  if (!config.printerKey || config.deliveryNotePrinterKey === config.printerKey) {
    return {
      blocked: true,
      destinationCountryCode: country,
      destinationClass: "eu",
      deliveryNoteRequired: true,
      deliveryNoteStatus: "manual_review",
      reasonCode: "delivery_note_printer_not_separate",
      reason: "Der A4-Lieferscheindrucker muss physisch und logisch vom A6-Etikettendrucker getrennt sein.",
    };
  }
  return {
    blocked: false,
    destinationCountryCode: country,
    destinationClass: "eu",
    deliveryNoteRequired: true,
    deliveryNoteStatus: "planned",
    reasonCode: null,
    reason: null,
  };
}

const EXPRESS_DPD_ITEM_PATTERN = /\b(?:expressversand|expresszustellung|expresslieferung|express\s+(?:versand|zustellung|lieferung|shipping|delivery|produktion)|eilauftrag)\b/i;
const EXPRESS_SHIPPING_LINE_PATTERN = /\bexpress\b/i;
const STANDARD_SHIPPING_ITEM_PATTERN = /\b(?:standardversand|standardlieferung|standard\s+(?:versand|lieferung|shipping|delivery)|normaler\s+versand)\b/i;
const STANDARD_SHIPPING_LINE_PATTERN = /\b(?:standard|normal|classic|b2c)\b/i;
const SHIPPING_ITEM_PATTERN = /\b(?:versand|versandkosten|lieferung|zustellung|liefertermin|direktfahrt|abholung|shipping|delivery|courier|kurier)\b/i;
const EXPRESS_NEGATION_PATTERN = /\b(?:kein|nicht|ohne)\s+(?:dpd\s+)?express(?:versand|zustellung|lieferung|\s+(?:versand|zustellung|lieferung))?\b|\bstandard\s+statt\s+express\b/i;

function hasExpressDeadline(evidence: string, hour: "09" | "12" | "18") {
  const shortHour = hour === "09" ? "0?9" : hour;
  const time = `${shortHour}(?:(?::|\\.)00|\\s*uhr)`;
  const expressFirst = `(?:express(?:\\s*-?\\s*(?:versand|zustellung|lieferung))?|expressversand|expresszustellung|expresslieferung)[^\\n.]{0,40}(?:bis\\s*)?${time}`;
  const deadlineFirst = `(?:bis|vor|spaetestens)\\s*${time}[^\\n.]{0,40}(?:zustellung|lieferung|versand|express)`;
  return new RegExp(`(?:${expressFirst}|${deadlineFirst})`, "i").test(evidence);
}

function hasUnsupportedExpressService(evidence: string) {
  if (hasExpressDeadline(evidence, "09") || hasExpressDeadline(evidence, "18")) return true;
  if (/\bexpress[^\n.]{0,40}\b0?8(?:(?::|\.)30|\s*uhr)\b/i.test(evidence)) return true;
  return /\b(?:dpd\s+de\s+)?express\s+(?:0830|09|0900|18|1800)\b/i.test(normalizeHumanText(evidence));
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

export function extractTrailingDhlExpressTracking(cardName: string) {
  const normalized = String(cardName || "").trim();
  const match = normalized.match(/(?:^|[\s|:/-])(\d{10})$/);
  return match?.[1] || null;
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
    const futureDelivery = /\b(?:wird|werden)\b.{0,40}\bzugestellt\b|\bin\s+zustellung\b|\bout\s+for\s+delivery\b|\bscheduled\s+for\s+delivery\b/i.test(text);
    const confirmedDelivery = /\b(?:wurde|ist|erfolgreich)\b.{0,40}\bzugestellt\b|\bhas\s+been\s+delivered\b|\bwas\s+delivered\b|\bdelivered\s+successfully\b|\bdelivery\s+complete\b/i.test(text);
    const deliveredToday = confirmedDelivery
      && !futureDelivery
      && (receivedLocalDate === localDate || dateTextMatches(text, localDate));
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
        sourceKinds: ["outlook_dhl"],
        trelloTrigger: null,
      });
    }
  }
  return [...byTracking.values()].sort((a, b) => a.trackingNumber.localeCompare(b.trackingNumber));
}

export function arrivalsFromTrelloSignShipped(
  cards: TrelloCardEvidence[],
  localDate: string,
  settings: TrelloSignShippedTriggerSettings | null,
) {
  if (!settings?.enabled) return [];
  if (
    settings.boardId !== ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID
    || settings.sourceListId !== ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID
    || normalizeHumanText(settings.sourceListName) !== "sign shipped neon trip"
    || settings.titlePatternVersion !== ARRIVAL_LABEL_TRELLO_TITLE_PATTERN_VERSION
  ) {
    throw new Error("Trello-Sign-SHIPPED-Triggerkonfiguration ist ungueltig.");
  }

  let enabledAfter: Temporal.Instant;
  try {
    enabledAfter = Temporal.Instant.from(settings.enabledAfter);
  } catch {
    throw new Error("Trello-Sign-SHIPPED-Aktivierungszeitpunkt ist ungueltig.");
  }

  const byTracking = new Map<string, DhlArrival>();
  for (const card of cards) {
    const isSignShipped = card.listId === settings.sourceListId
      && normalizeHumanText(card.listName) === "sign shipped neon trip";
    const isCreateInvoice = card.listId === ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID
      && normalizeHumanText(card.listName) === normalizeHumanText(ARRIVAL_LABEL_CREATE_INVOICE_LIST_NAME);
    if (
      card.boardId !== settings.boardId
      || (!isSignShipped && !isCreateInvoice)
    ) continue;

    const trackingNumber = extractTrailingDhlExpressTracking(card.name);
    if (!trackingNumber) continue;
    let activityAt: string | null = null;
    if (card.dateLastActivity) {
      try {
        activityAt = Temporal.Instant.from(card.dateLastActivity).toString();
      } catch {
        activityAt = null;
      }
    }
    const previous = byTracking.get(trackingNumber);
    const previousTrigger = previous?.trelloTrigger;
    byTracking.set(trackingNumber, {
      trackingNumber,
      lastSix: lastSixOfTracking(trackingNumber),
      localDate,
      deliveryState: "unknown",
      expectedArrivalAt: null,
      messageIds: [],
      sourceKinds: [isCreateInvoice ? "trello_create_invoice" : "trello_sign_shipped"],
      trelloTrigger: {
        boardId: settings.boardId,
        listId: isCreateInvoice ? ARRIVAL_LABEL_CREATE_INVOICE_LIST_ID : settings.sourceListId,
        cardIds: [...new Set([...(previousTrigger?.cardIds || []), card.id])].sort(),
        latestActivityAt: laterInstant(previousTrigger?.latestActivityAt, activityAt),
        enabledAfter: enabledAfter.toString(),
        titlePatternVersion: settings.titlePatternVersion,
      },
    });
  }
  return [...byTracking.values()].sort((a, b) => a.trackingNumber.localeCompare(b.trackingNumber));
}

function laterInstant(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right || null;
  if (!right) return left;
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) >= 0 ? left : right;
}

export function mergeDhlArrivals(...groups: DhlArrival[][]) {
  const byTracking = new Map<string, DhlArrival>();
  const stateRank = { unknown: 0, due_today: 1, delivered_today: 2 } as const;
  for (const arrival of groups.flat()) {
    const previous = byTracking.get(arrival.trackingNumber);
    if (!previous) {
      byTracking.set(arrival.trackingNumber, arrival);
      continue;
    }
    const latestTrelloActivity = laterInstant(
      previous.trelloTrigger?.latestActivityAt,
      arrival.trelloTrigger?.latestActivityAt,
    );
    const trelloTrigger = previous.trelloTrigger || arrival.trelloTrigger
      ? {
        ...(previous.trelloTrigger || arrival.trelloTrigger)!,
        cardIds: [...new Set([
          ...(previous.trelloTrigger?.cardIds || []),
          ...(arrival.trelloTrigger?.cardIds || []),
        ])].sort(),
        latestActivityAt: latestTrelloActivity,
      }
      : null;
    byTracking.set(arrival.trackingNumber, {
      ...previous,
      deliveryState: stateRank[arrival.deliveryState] > stateRank[previous.deliveryState]
        ? arrival.deliveryState
        : previous.deliveryState,
      expectedArrivalAt: previous.expectedArrivalAt || arrival.expectedArrivalAt,
      messageIds: [...new Set([...previous.messageIds, ...arrival.messageIds])].sort(),
      sourceKinds: [...new Set([...previous.sourceKinds, ...arrival.sourceKinds])].sort() as DhlArrival["sourceKinds"],
      trelloTrigger,
    });
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

export function assessTrelloAutomationGate(card: TrelloCardEvidence): TrelloAutomationGate {
  const listName = normalizeHumanText(card.listName);
  const manualList = /^(?:problems? with signs?|problem mit(?: dem)? schild|schildprobleme?|manual review|manuelle? prufung|sonderfalle?)$/.test(listName);
  if (!manualList) return { blocked: false, reasonCode: null, reason: null };
  const safeListName = String(card.listName || "manuelle Trello-Liste")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return {
    blocked: true,
    reasonCode: "trello_manual_list",
    reason: `Trello-Karte liegt in der manuellen Sperrliste "${safeListName}".`,
  };
}

function parseStandardOfferMetadataNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  const empty = {
    standard: false,
    offerNumber: null as string | null,
    publicToken: null as string | null,
    nerdyFormsId: null as string | null,
    reverseChargeVatId: null as string | null,
  };
  if (!normalized) return { ...empty, standard: true };
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let offerNumber: string | null = null;
  let offerUrlId: string | null = null;
  let pdfUrlId: string | null = null;
  let pricesMatch = false;
  let nerdyFormsId: string | null = null;
  let reverseChargeVatId: string | null = null;
  for (const line of lines) {
    const parsedOfferNumber = line.match(/^NEONTRIP Angebot:\s*(A\/N [0-9]{1,12})$/i)?.[1]?.toUpperCase() || null;
    if (parsedOfferNumber && !offerNumber) {
      offerNumber = parsedOfferNumber;
      continue;
    }
    const offerUrl = line.match(/^Angebotslink:\s*(https:\/\/angebote[.]neontrip[.]de\/offer\/([A-Za-z0-9_-]{8,128}))$/i)?.[2] || null;
    if (offerUrl && !offerUrlId) {
      offerUrlId = offerUrl;
      continue;
    }
    const pdfSnapshotUrl = line.match(/^PDF Snapshot:\s*(\S+)$/i)?.[1] || "";
    const pdfUrl = pdfSnapshotUrl.match(PDF_URL)?.[1] || null;
    if (pdfUrl && !pdfUrlId) {
      pdfUrlId = pdfUrl;
      continue;
    }
    if (!pricesMatch && new RegExp(`^Netto:\\s*${MONEY}\\s*/\\s*MwSt:\\s*${MONEY}\\s*/\\s*Brutto:\\s*${MONEY}$`, "i").test(line)) {
      pricesMatch = true;
      continue;
    }
    const nerdy = line.match(/^Nerdy-Forms_ID:\s*([0-9a-f-]{36})$/i)?.[1] || null;
    if (nerdy && INTERNAL_UUID_NOTE.test(nerdy) && !nerdyFormsId) {
      nerdyFormsId = nerdy.toLowerCase();
      continue;
    }
    const vatId = line.match(/^Reverse Charge \/ steuerfrei mit USt-IdNr[.]:\s*([A-Z]{2}[A-Z0-9]{6,14})$/i)?.[1] || null;
    if (vatId && VAT_ID.test(vatId.toUpperCase()) && !reverseChargeVatId) {
      reverseChargeVatId = vatId.toUpperCase();
      continue;
    }
    if (/^(?:Rechnungs-E-Mail|Projektnummer):/i.test(line)) continue;
    if (OFFER_METADATA_LINE_PREFIX.test(line) || PICKUP_PATTERN.test(normalizeHumanText(line)) || SHIPPING_OVERRIDE_NOTE_PATTERN.test(normalizeHumanText(line))) return empty;
  }
  return {
    standard: Boolean(offerNumber && offerUrlId && pdfUrlId && offerUrlId === pdfUrlId && pricesMatch),
    offerNumber: offerNumber || null,
    publicToken: offerUrlId || null,
    nerdyFormsId,
    reverseChargeVatId,
  };
}

export function isStandardOfferMetadataNote(note: string | null | undefined) {
  return parseStandardOfferMetadataNote(note).standard;
}

export function isAutomationSafeOrderNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  return !normalized || isStandardOfferMetadataNote(normalized) || INTERNAL_UUID_NOTE.test(normalized);
}

export function relevantOrderNote(note: string | null | undefined) {
  const normalized = String(note || "").trim();
  if (isAutomationSafeOrderNote(normalized)) return null;
  return normalized;
}

export function noteHash(note: string | null | undefined) {
  return createHash("sha256").update(String(note || ""), "utf8").digest("hex");
}

function standardAttributes(
  attributes: ShopifyOrderEvidence["customAttributes"],
  noteMetadata: ReturnType<typeof parseStandardOfferMetadataNote>,
) {
  if (attributes.length === 0) return !noteMetadata.nerdyFormsId && !noteMetadata.reverseChargeVatId;
  const values = new Map<string, string>();
  for (const attribute of attributes) {
    const key = String(attribute.key || "").trim();
    const value = String(attribute.value || "").trim();
    if ((!REQUIRED_STANDARD_ATTRIBUTE_KEYS.has(key) && !OPTIONAL_STANDARD_ATTRIBUTE_KEYS.has(key)) || values.has(key)) return false;
    values.set(key, value);
  }
  if ([...REQUIRED_STANDARD_ATTRIBUTE_KEYS].some((key) => !values.has(key))) return false;
  const offerId = values.get("NEONTRIP Offer ID") || "";
  const offerUrlId = values.get("NEONTRIP Offer URL")?.match(OFFER_URL)?.[1] || "";
  const pdfUrlId = values.get("NEONTRIP PDF Snapshot")?.match(PDF_URL)?.[1] || "";
  const baseValid = OFFER_ID.test(offerId)
    && OFFER_NUMBER.test(values.get("NEONTRIP Offer Number") || "")
    && Boolean(offerUrlId)
    && pdfUrlId === offerUrlId
    && /^[a-f0-9]{24}$/i.test(values.get("Trello Card ID") || "")
    && values.get("Idempotency Key") === `offer:${offerId}:shopify-sale:v1`
    && (!noteMetadata.offerNumber || noteMetadata.offerNumber === values.get("NEONTRIP Offer Number"))
    && (!noteMetadata.publicToken || noteMetadata.publicToken === offerUrlId);
  if (!baseValid) return false;

  const nerdyFormsId = values.get("Nerdy-Forms_ID")?.toLowerCase() || null;
  if (Boolean(nerdyFormsId) !== Boolean(noteMetadata.nerdyFormsId)
    || (nerdyFormsId && (!INTERNAL_UUID_NOTE.test(nerdyFormsId) || nerdyFormsId !== noteMetadata.nerdyFormsId))) return false;

  const reverseCharge = values.get("Reverse Charge") || null;
  const vatId = values.get("USt-IdNr.")?.toUpperCase() || null;
  if (Boolean(reverseCharge || vatId) !== Boolean(noteMetadata.reverseChargeVatId)
    || (noteMetadata.reverseChargeVatId && (reverseCharge !== "yes_vies_validated" || vatId !== noteMetadata.reverseChargeVatId))) return false;

  const segmentValues = [values.get("Request Segment"), values.get("Request S-Kategorie"), values.get("Request Segment Status")];
  const hasSegmentMetadata = segmentValues.some((value) => value !== undefined);
  if (hasSegmentMetadata) {
    return segmentValues[0] === "NT-2"
      && segmentValues[1] === "S3"
      && segmentValues[2] === "accepted";
  }
  return true;
}

export function assessShopifyAutomationGate(order: ShopifyOrderEvidence): ShopifyAutomationGate {
  const reasonCodes: ShopifyAutomationGateReason[] = [];
  const note = String(order.note || "").trim();
  const noteMetadata = parseStandardOfferMetadataNote(note);
  const pickupEvidence = [
    note,
    ...order.customAttributes.flatMap((attribute) => [attribute.key, attribute.value]),
    ...order.tags,
    ...order.shippingLines.flatMap((line) => [line.title, line.code || ""]),
  ].map(normalizeHumanText).join("\n");
  if (PICKUP_PATTERN.test(pickupEvidence)) reasonCodes.push("pickup_instruction");
  if (!noteMetadata.standard && !INTERNAL_UUID_NOTE.test(note)) reasonCodes.push("non_standard_shopify_note");
  if (!standardAttributes(order.customAttributes, noteMetadata)) reasonCodes.push("non_standard_shopify_attribute");
  if (["refunded", "voided", "expired"].includes(order.financialStatus)) reasonCodes.push("payment_terminal_status");
  const uniqueCodes = [...new Set(reasonCodes)];
  const reasonParts = uniqueCodes.map((code) => ({
    pickup_instruction: "Shopify enthaelt einen Abhol- oder Ladenlokal-Hinweis.",
    non_standard_shopify_note: "Shopify enthaelt eine Notiz ausserhalb der freigegebenen Automationsformate.",
    non_standard_shopify_attribute: "Shopify enthaelt Zusatzfelder ausserhalb des freigegebenen NEONTRIP-Angebotsformats.",
    payment_terminal_status: `Shopify-Zahlungsstatus ${order.financialStatus} weist auf eine beendete oder rueckabgewickelte Bestellung hin.`,
  })[code]);
  return {
    blocked: uniqueCodes.length > 0,
    reasonCodes: uniqueCodes,
    reason: reasonParts.join(" ") || null,
    noteExcerpt: note ? note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 500) : null,
    attributeKeys: [...new Set(order.customAttributes.map((attribute) => String(attribute.key || "").trim()).filter(Boolean))].sort(),
  };
}

function trelloCardIdsFromOrderAttributes(attributes: ShopifyOrderEvidence["customAttributes"]) {
  return [...new Set(attributes
    .filter((attribute) => String(attribute.key || "").trim() === "Trello Card ID")
    .map((attribute) => String(attribute.value || "").trim().toLowerCase())
    .filter((value) => /^[a-f0-9]{24}$/.test(value)))];
}

export function classifyShipping(order: ShopifyOrderEvidence, _card?: TrelloCardEvidence | null) {
  const lineItemEvidence = order.lineItems.map((item) => item.title).filter(Boolean);
  const shippingLineEvidence = order.shippingLines
    .flatMap((line) => [line.title, line.code || ""])
    .filter(Boolean);
  const expressEvidence = [
    ...lineItemEvidence.filter((value) => EXPRESS_DPD_ITEM_PATTERN.test(normalizeHumanText(value))),
    ...shippingLineEvidence.filter((value) => EXPRESS_SHIPPING_LINE_PATTERN.test(normalizeHumanText(value))),
  ];
  const normalizedShippingEvidence = [...lineItemEvidence, ...shippingLineEvidence]
    .map(normalizeHumanText)
    .join("\n");
  const explicitNegation = EXPRESS_NEGATION_PATTERN.test(normalizedShippingEvidence);
  const deadlines = (["09", "12", "18"] as const)
    .filter((hour) => expressEvidence.some((value) => hasExpressDeadline(value, hour)))
    .map((hour) => `express_${hour}` as "express_09" | "express_12" | "express_18");

  if (deadlines.length > 1) {
    return { shippingClass: "unknown" as const, conflict: "Mehrere Express-Zustellzeiten widersprechen sich." };
  }
  if (expressEvidence.length && explicitNegation) {
    return { shippingClass: "unknown" as const, conflict: "Express-Hinweis und ausdruecklicher Ausschluss widersprechen sich." };
  }
  if (expressEvidence.some(hasUnsupportedExpressService) || (deadlines[0] && deadlines[0] !== "express_12")) {
    return { shippingClass: "unknown" as const, conflict: "Shopify enthaelt eine Express-Zustellzeit, die nicht 12:00 Uhr ist." };
  }
  if (expressEvidence.length) return { shippingClass: "express_12" as const, conflict: null };

  const standard = lineItemEvidence.some((value) => STANDARD_SHIPPING_ITEM_PATTERN.test(normalizeHumanText(value)))
    || shippingLineEvidence.some((value) => STANDARD_SHIPPING_LINE_PATTERN.test(normalizeHumanText(value)));
  if (standard || explicitNegation) return { shippingClass: "standard" as const, conflict: null };

  const unclassifiedShippingItem = lineItemEvidence.some((value) => SHIPPING_ITEM_PATTERN.test(normalizeHumanText(value)));
  if (unclassifiedShippingItem || shippingLineEvidence.length) return { shippingClass: "unknown" as const, conflict: null };
  return { shippingClass: "standard" as const, conflict: null };
}

export function resolveShopifyOrder(input: {
  card: TrelloCardEvidence;
  orders: ShopifyOrderEvidence[];
  customerNameHints?: string[];
}) {
  const cardId = String(input.card.id || "").trim().toLowerCase();
  if (/^[a-f0-9]{24}$/.test(cardId)) {
    const linked = input.orders.filter((order) => trelloCardIdsFromOrderAttributes(order.customAttributes).includes(cardId));
    if (linked.length === 1) return { order: linked[0], error: null as string | null };
    if (linked.length > 1) return { order: null, error: `Trello Card ID ${cardId} ist in Shopify nicht eindeutig.` };
  }

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

export function selectDpdProduct(
  shippingClass: ShippingClass,
  config: ProductConfig | null,
  destinationClass: DestinationClass = "domestic_de",
) {
  if (!config?.enabled) return null;
  if (destinationClass === "eu") {
    if (shippingClass === "standard") return config.euProductMapping?.standard || null;
    if (["express", "express_09", "express_12", "express_18", "urgent"].includes(shippingClass)) {
      return config.euProductMapping?.[shippingClass as ExpressProductRule] || null;
    }
    return null;
  }
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
  const unresolvedDestination = {
    destinationCountryCode: null,
    destinationClass: "unknown" as const,
    deliveryNoteRequired: false,
    deliveryNoteStatus: "manual_review" as const,
  };
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
      ...unresolvedDestination,
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
      ...unresolvedDestination,
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
  const trelloGate = assessTrelloAutomationGate(trelloMatch.card);
  if (trelloGate.blocked) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order?.id || null, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: "special_case",
      ...unresolvedDestination,
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: trelloGate.reason,
      relevantOrderNote: orderMatch.order ? relevantOrderNote(orderMatch.order.note) : null,
      reasons: [trelloGate.reasonCode],
    };
  }
  if (!orderMatch.order) {
    return {
      idempotencyKey: buildIdempotencyKey(null, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: null,
      shippingClass: "unknown",
      ...unresolvedDestination,
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
  const destination = assessDestinationGate(orderMatch.order, input.productConfig);
  const note = relevantOrderNote(orderMatch.order.note);
  const shipping = classifyShipping(orderMatch.order, trelloMatch.card);
  if (gate.blocked || destination.blocked) {
    const blockedReasons = [gate.reason, destination.reason].filter(Boolean).join(" ");
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      destinationCountryCode: destination.destinationCountryCode,
      destinationClass: destination.destinationClass,
      deliveryNoteRequired: destination.deliveryNoteRequired,
      deliveryNoteStatus: "manual_review",
      selectedDpdProduct: null,
      existingDpdTracking: existing?.trackingNumber || null,
      status: "manual_review",
      manualReviewReason: blockedReasons,
      relevantOrderNote: gate.noteExcerpt,
      reasons: [...gate.reasonCodes, ...(destination.reasonCode ? [destination.reasonCode] : [])],
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
      destinationCountryCode: destination.destinationCountryCode,
      destinationClass: destination.destinationClass,
      deliveryNoteRequired: destination.deliveryNoteRequired,
      deliveryNoteStatus: destination.deliveryNoteStatus,
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
      destinationCountryCode: destination.destinationCountryCode,
      destinationClass: destination.destinationClass,
      deliveryNoteRequired: destination.deliveryNoteRequired,
      deliveryNoteStatus: destination.deliveryNoteStatus,
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
      destinationCountryCode: destination.destinationCountryCode,
      destinationClass: destination.destinationClass,
      deliveryNoteRequired: destination.deliveryNoteRequired,
      deliveryNoteStatus: destination.deliveryNoteStatus,
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: "Versandart konnte nicht sicher bestimmt werden.",
      relevantOrderNote: null,
      reasons,
    };
  }

  const product = selectDpdProduct(shipping.shippingClass, input.productConfig, destination.destinationClass);
  if (!product) {
    return {
      idempotencyKey: buildIdempotencyKey(orderMatch.order.id, input.arrival.trackingNumber),
      trackingNumber: input.arrival.trackingNumber,
      lastSix: input.arrival.lastSix,
      expectedArrival: `${input.arrival.localDate} (${input.arrival.deliveryState})`,
      trelloCard: trelloMatch.card,
      shopifyOrder: orderMatch.order,
      shippingClass: shipping.shippingClass,
      destinationCountryCode: destination.destinationCountryCode,
      destinationClass: destination.destinationClass,
      deliveryNoteRequired: destination.deliveryNoteRequired,
      deliveryNoteStatus: destination.deliveryNoteStatus,
      selectedDpdProduct: null,
      existingDpdTracking: null,
      status: "manual_review",
      manualReviewReason: `Kein bestaetigtes ${destination.destinationClass === "eu" ? "EU-" : ""}DPD-Produkt fuer ${shipping.shippingClass} konfiguriert.`,
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
    destinationCountryCode: destination.destinationCountryCode,
    destinationClass: destination.destinationClass,
    deliveryNoteRequired: destination.deliveryNoteRequired,
    deliveryNoteStatus: destination.deliveryNoteStatus,
    selectedDpdProduct: product,
    existingDpdTracking: null,
    status: "label_planned",
    manualReviewReason: null,
    relevantOrderNote: null,
    reasons,
  };
}
