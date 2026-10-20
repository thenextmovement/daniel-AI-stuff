// Only use explicitly linked offers from this order, never a customer-name guess.
export function dunningOfferUrl(order: { customAttributes?: unknown; note?: unknown }): string | null {
  const attributes = Array.isArray(order.customAttributes) ? order.customAttributes : [];
  const candidates = attributes.filter(a => a && typeof a === "object" &&
    ["NEONTRIP Offer URL", "Angebotslink", "Offer URL", "offer_public_url", "offerPublicUrl"].includes(a.key))
    .map(a => a.value);
  if (typeof order.note === "string") {
    candidates.push(order.note.match(/(?:NEONTRIP\s+Offer\s+URL|Angebotslink)\s*:\s*(https:\/\/\S+)/i)?.[1]);
  }
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value.trim());
      if (url.origin === "https://angebote.neontrip.de" && !url.username && !url.password &&
          /^\/offer\/[A-Za-z0-9_-]{8,128}\/?$/.test(url.pathname)) return url.origin + url.pathname;
    } catch { /* Missing/invalid references remain unlinked. */ }
  }
  return null;
}
