export type CourtNomination = { id: string; at: string; actor: string };
type Audit = { id: string; created_at: string; metadata?: Record<string, unknown> | null };
type CourtEvent = { eventType: string };

export function pendingCourtNomination(order: string, rows: Audit[], events: CourtEvent[]): CourtNomination | null {
  // Existing court proceedings must never appear as an uncreated application.
  if (events.length) return null;
  const row = rows.filter(row => row.metadata?.order_number === order)
    .sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
  return row ? { id: row.id, at: row.created_at, actor: String(row.metadata?.actor || "Unbekannt") } : null;
}

export function nominationBlockers(entry: { amountCents: number; financialStatus: string; state: string; paused: boolean; stopTag: boolean; paymentException: boolean; courtEvents: CourtEvent[] }): string[] {
  const reasons: string[] = [];
  if (entry.amountCents <= 0 || ["paid", "refunded", "voided"].includes(entry.financialStatus) || entry.state === "closed" || entry.paymentException)
    reasons.push("Der Fall ist bezahlt oder abgeschlossen.");
  if (entry.paused || entry.stopTag) reasons.push("Der Fall ist gesperrt oder pausiert.");
  if (entry.courtEvents.length) reasons.push("Ein Gerichtsvorgang ist bereits vorhanden. Bitte die Fallakte öffnen.");
  return reasons;
}

export function courtNominationConfirmation(order: string, createdAt: string | null, now = new Date()): string {
  const timestamp = createdAt ? Date.parse(createdAt) : NaN;
  const age = Math.floor((now.getTime() - timestamp) / 86_400_000);
  const warning = !Number.isFinite(age) ? "Das Bestelldatum fehlt oder ist ungültig. Bitte vor der weiteren Bearbeitung prüfen.\n\n"
    : age < 0 ? "Das Bestelldatum liegt in der Zukunft. Bitte prüfen.\n\n"
    : age < 21 ? `Achtung: Diese Bestellung ist erst ${age} Tage alt (weniger als 3 Wochen). Bist du sicher, dass du sie bereits vormerken möchtest?\n\n` : "";
  return `${warning}${order} für einen gelben Brief vormerken?\n\nEs wird jetzt kein Antrag erstellt oder versandt. Vor der späteren Erstellung müssen Zahlung, Kundenkommunikation, Adresse und Insolvenz geprüft werden.`;
}
