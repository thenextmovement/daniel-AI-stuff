import type { Scope } from "./types.js";

export type Capability = {
  name: string;
  title: string;
  scope: Scope;
  service: "system" | "billing" | "offers";
  access: "read" | "write";
  destructive: boolean;
  sideEffects: string[];
};

export const CAPABILITIES: Capability[] = [
  { name: "neontrip_capabilities", title: "Verfügbare NEONTRIP-Funktionen", scope: "system:read", service: "system", access: "read", destructive: false, sideEffects: [] },
  { name: "neontrip_health", title: "NEONTRIP-Verbindungen prüfen", scope: "system:read", service: "system", access: "read", destructive: false, sideEffects: [] },
  { name: "billing_list_cases", title: "Rechnungsvorgänge suchen", scope: "billing:read", service: "billing", access: "read", destructive: false, sideEffects: [] },
  { name: "billing_get_case", title: "Rechnungsvorgang lesen", scope: "billing:read", service: "billing", access: "read", destructive: false, sideEffects: [] },
  { name: "billing_save_change_draft", title: "Rechnungsänderung als Entwurf speichern", scope: "billing:change:draft", service: "billing", access: "write", destructive: false, sideEffects: ["Ändert den internen Prüfvorschlag, aber entscheidet den Vorgang nicht."] },
  { name: "billing_accept_change_request", title: "Rechnungsänderung annehmen", scope: "billing:change:accept", service: "billing", access: "write", destructive: true, sideEffects: ["Ändert Rechnungsdaten.", "Der bestehende OPS-Ablauf kann eine Kundenbenachrichtigung einreihen."] },
  { name: "billing_reject_change_request", title: "Rechnungsänderung ablehnen", scope: "billing:change:reject", service: "billing", access: "write", destructive: true, sideEffects: ["Lehnt den Vorgang endgültig ab.", "Der bestehende OPS-Ablauf kann eine Kundenbenachrichtigung einreihen."] },
  { name: "billing_apply_action", title: "Rechnungs-OPS-Aktion ausführen", scope: "billing:actions", service: "billing", access: "write", destructive: true, sideEffects: ["Kann Dokumente erstellen oder Zahlungs- und Lieferstatus ändern."] },
  { name: "offers_search", title: "Angebote suchen", scope: "offers:read", service: "offers", access: "read", destructive: false, sideEffects: [] },
  { name: "offers_get", title: "Angebot lesen", scope: "offers:read", service: "offers", access: "read", destructive: false, sideEffects: [] },
  { name: "offers_preview_update", title: "Angebotsänderung simulieren", scope: "offers:read", service: "offers", access: "read", destructive: false, sideEffects: [] },
  { name: "offers_update", title: "Angebot aktualisieren", scope: "offers:write", service: "offers", access: "write", destructive: true, sideEffects: ["Ändert das Angebot, versendet es aber nicht."] },
  { name: "offers_send", title: "Angebot versenden", scope: "offers:send", service: "offers", access: "write", destructive: true, sideEffects: ["Versendet eine E-Mail an angegebene Empfänger."] },
];

export function capabilitiesForScopes(scopes: readonly string[]) {
  const allowed = new Set(scopes);
  return CAPABILITIES.filter((capability) => allowed.has(capability.scope));
}
