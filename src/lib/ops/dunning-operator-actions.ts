import { Temporal } from "@js-temporal/polyfill";
import type { DunningCaseSummary } from "./dunning";

export function dunningPauseUntil(weeks: number, now = new Date()): string {
  if (weeks !== 1 && weeks !== 2) throw new Error("invalid_pause_weeks");
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO("Europe/Berlin")
    .add({ weeks }).toInstant().toString();
}

// Only the email cadence may be skipped by an explicit operator action.
// Financial, evidence, customer-reply and manual holds must still fail closed.
export function courtPreparationBlockers(summary: DunningCaseSummary, now = new Date()): string[] {
  const blockers = (summary.blockers || []).filter(reason =>
    reason !== "Keine weitere E-Mail-Stufe vorgesehen" && reason !== "Nächste Stufe ist noch nicht fällig");
  if (summary.amountCents < 1 || ["paid", "refunded", "voided"].includes(summary.financialStatus) || summary.state === "closed" || summary.paymentException)
    blockers.push("Offene Forderung ist nicht mehr belegt");
  if (summary.paused || summary.stopTag) blockers.push("Mahnwesen ist gesperrt oder pausiert");
  if (summary.customerReplied) blockers.push("Eine Kundenantwort muss vor dem Antrag geklärt werden");
  if (!summary.invoiceDate || !summary.easybillInvoiceNumber)
    blockers.push("Rechnungsnummer oder Rechnungsdatum fehlt");
  try {
    const due = Temporal.PlainDate.from(summary.dueDate || "");
    const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO("Europe/Berlin").toPlainDate();
    if (Temporal.PlainDate.compare(due, today) >= 0) blockers.push("Die Zahlungsfrist ist noch nicht abgelaufen");
  } catch { blockers.push("Zahlungsfrist ist nicht belegt"); }
  if (summary.courtEvents?.length) blockers.push("Ein Gerichtsvorgang ist bereits erfasst; Verlauf zuerst prüfen");
  return [...new Set(blockers)];
}
