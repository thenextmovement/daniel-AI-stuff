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
