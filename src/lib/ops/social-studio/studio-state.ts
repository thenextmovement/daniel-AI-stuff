import { CHANNELS, type Channel, type Texts } from "./studio-contract";
export type Delivery = {
  draft_id: string;
  channel: Channel;
  status: string;
  buffer_id: string | null;
  image_url: string | null;
  error: string | null;
  due_at: string | null;
  checked_at: string | null;
  sent_at: string | null;
  external_link: string | null;
  updated_at: string;
};
export type Draft = {
  id: string;
  texts: Texts;
  revision: number;
  status: string;
  due_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
  deliveries: Delivery[];
};
export const stateNames: Record<string, string> = {
  draft: "Entwurf",
  preparing: "Freigabe wird gespeichert",
  scheduling: "Wird eingeplant",
  rescheduling: "Termin wird geändert",
  withdrawing: "Freigabe wird zurückgezogen",
  scheduled: "Geplant",
  sending: "Wird veröffentlicht",
  sent: "Veröffentlicht",
  manual_review: "Bitte prüfen",
  pending: "Wartet",
  inflight: "Ergebnis unklar",
  failed: "Fehlgeschlagen",
  draft_buffer: "Bei Buffer als Entwurf",
};
export function providerState(s: string) {
  return s === "sent"
    ? "sent"
    : ["buffer", "scheduled"].includes(s)
      ? "scheduled"
      : s === "sending"
        ? "sending"
        : s === "draft"
          ? "draft_buffer"
          : ["failed", "error"].includes(s)
            ? "failed"
            : "manual_review";
}
export function overallState(rs: Pick<Delivery, "channel" | "status">[]) {
  if (
    rs.length !== CHANNELS.length ||
    !CHANNELS.every((c) => rs.some((r) => r.channel === c))
  )
    return "manual_review";
  if (rs.every((r) => r.status === "sent")) return "sent";
  if (
    rs.some((r) => r.status === "sending") &&
    rs.every((r) => ["sending", "sent", "scheduled"].includes(r.status))
  )
    return "sending";
  if (rs.every((r) => ["sent", "scheduled"].includes(r.status)))
    return "scheduled";
  return "manual_review";
}
export function berlin(s: string | null) {
  return s
    ? new Date(s).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Noch kein Termin";
}
export function publicLink(s: unknown) {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
