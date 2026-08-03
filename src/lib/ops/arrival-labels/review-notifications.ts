import { createHash } from "node:crypto";
import type { ArrivalCaseDecision, ArrivalCaseStatus } from "./domain";
import { PrintInputError } from "./printing";

export const ARRIVAL_REVIEW_RECIPIENT = "info@neontrip.de" as const;

const BLOCKED_STATUSES = new Set<ArrivalCaseStatus>([
  "manual_review",
  "missing_data",
  "ambiguous_match",
  "conflicting_instructions",
  "special_case",
]);

export type ArrivalReviewNotification = {
  notificationKey: string;
  recipientEmail: typeof ARRIVAL_REVIEW_RECIPIENT;
  subject: string;
  bodyText: string;
  shopifyOrderUrl: string | null;
};

export function validateReviewWorkerId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(value)) throw new PrintInputError("Ungueltige Pruefmail-Worker-ID.");
  return value;
}

function singleLine(value: unknown, maximum = 300) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[Link entfernt]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function isTrustedShopifyAdminUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9-]+[.]myshopify[.]com$/i.test(url.hostname)
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && /^\/admin\/orders\/[0-9]+$/.test(url.pathname)
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function safeTrelloUrl(value: string | null | undefined) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !/(^|[.])trello[.]com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function reviewSnapshot(decision: ArrivalCaseDecision) {
  return JSON.stringify({
    idempotencyKey: decision.idempotencyKey,
    status: decision.status,
    reason: decision.manualReviewReason,
    reasons: [...decision.reasons].sort(),
    destinationCountryCode: decision.destinationCountryCode,
    destinationClass: decision.destinationClass,
    deliveryNoteRequired: decision.deliveryNoteRequired,
    deliveryNoteStatus: decision.deliveryNoteStatus,
    note: decision.shopifyOrder?.note || null,
    attributes: [...(decision.shopifyOrder?.customAttributes || [])]
      .map((attribute) => ({ key: attribute.key, value: attribute.value }))
      .sort((a, b) => `${a.key}\u0000${a.value}`.localeCompare(`${b.key}\u0000${b.value}`)),
  });
}

export function buildArrivalReviewNotification(decision: ArrivalCaseDecision): ArrivalReviewNotification | null {
  if (!BLOCKED_STATUSES.has(decision.status)) return null;
  const shopifyOrderUrl = decision.shopifyOrder?.adminUrl && isTrustedShopifyAdminUrl(decision.shopifyOrder.adminUrl)
    ? decision.shopifyOrder.adminUrl
    : null;
  const trelloUrl = safeTrelloUrl(decision.trelloCard?.url);
  const reason = singleLine(decision.manualReviewReason || "Automatische Verarbeitung wurde gesperrt.", 500);
  const noteExcerpt = singleLine(decision.relevantOrderNote, 500);
  const notificationKey = `arrival-review:${createHash("sha256").update(reviewSnapshot(decision), "utf8").digest("hex")}`;
  const orderLabel = singleLine(decision.shopifyOrder?.name || "ohne eindeutige Shopify-Zuordnung", 100);
  const deliveryNoteLabel = decision.deliveryNoteRequired
    ? decision.deliveryNoteStatus
    : decision.destinationClass === "domestic_de" ? "nicht erforderlich" : "nicht automatisch geplant";
  const subject = `[NEONTRIP] Versandetikett manuell pruefen: ${orderLabel} / DHL ${decision.lastSix}`;
  const purchaseStatusLine = decision.reasons.includes("browser_purchase_manual_review")
    ? "EasyDPD kann bereits einen Kaufversuch erhalten haben. Vor einer manuellen Wiederholung zuerst EasyDPD-Historie und DPD-Sendungsnummer pruefen; nicht automatisch erneut buchen oder drucken."
    : "Es wurde fuer diesen Fall kein neues Versandetikett gekauft und kein Druckauftrag erzeugt.";
  const lines = [
    "Automatische Verarbeitung gesperrt.",
    purchaseStatusLine,
    "",
    `Bestellung: ${orderLabel}`,
    `Kunde: ${singleLine(decision.shopifyOrder?.customerName || "nicht eindeutig", 150)}`,
    `Eingehende DHL-Sendung: ${decision.trackingNumber}`,
    `Letzte 6 Ziffern: ${decision.lastSix}`,
    `Zielland: ${singleLine(decision.destinationCountryCode || "nicht eindeutig", 10)} (${decision.destinationClass})`,
    `Lieferschein: ${deliveryNoteLabel}`,
    `Grund: ${reason}`,
    `Pruefcodes: ${decision.reasons.length ? decision.reasons.join(", ") : decision.status}`,
    `Shopify: ${shopifyOrderUrl || "kein vertrauenswuerdiger Direktlink verfuegbar"}`,
    `Trello: ${trelloUrl || "kein vertrauenswuerdiger Direktlink verfuegbar"}`,
  ];
  if (noteExcerpt) lines.push("", `Shopify-Notiz (ungepruefter Inhalt, Links entfernt): ${noteExcerpt}`);
  lines.push("", "Bitte den Shopify-Auftrag händisch prüfen und den Versandfall manuell entscheiden.");
  const notification = {
    notificationKey,
    recipientEmail: ARRIVAL_REVIEW_RECIPIENT,
    subject,
    bodyText: lines.join("\n"),
    shopifyOrderUrl,
  } satisfies ArrivalReviewNotification;
  return validateArrivalReviewNotification(notification);
}

export function validateArrivalReviewNotification(value: ArrivalReviewNotification) {
  const keys = Object.keys(value).sort();
  const expected = ["bodyText", "notificationKey", "recipientEmail", "shopifyOrderUrl", "subject"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error("Pruefmail enthaelt unerwartete Felder.");
  if (value.recipientEmail !== ARRIVAL_REVIEW_RECIPIENT) throw new Error("Pruefmail-Empfaenger ist nicht freigegeben.");
  if (!/^arrival-review:[0-9a-f]{64}$/.test(value.notificationKey)) throw new Error("Pruefmail-Schluessel ist ungueltig.");
  if (!value.subject.startsWith("[NEONTRIP] Versandetikett manuell pruefen:") || value.subject.length > 200 || /[\r\n]/.test(value.subject)) {
    throw new Error("Pruefmail-Betreff ist ungueltig.");
  }
  if (value.bodyText.length < 50 || value.bodyText.length > 4_000 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.bodyText)) {
    throw new Error("Pruefmail-Text ist ungueltig.");
  }
  if (value.shopifyOrderUrl !== null && !isTrustedShopifyAdminUrl(value.shopifyOrderUrl)) {
    throw new Error("Shopify-Direktlink ist nicht vertrauenswuerdig.");
  }
  return value;
}
