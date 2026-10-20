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

export function dunningOfferReference(order: { customAttributes?: unknown; note?: unknown }) {
  const attributes = Array.isArray(order.customAttributes) ? order.customAttributes : [];
  function explicit(keys: string[], pattern: RegExp): string | null {
    for (const attribute of attributes) {
      if (attribute && keys.includes(attribute.key) && typeof attribute.value === "string" && attribute.value.trim()) {
        return attribute.value.trim();
      }
    }
    return typeof order.note === "string" ? order.note.match(pattern)?.[1]?.trim() || null : null;
  }
  const number = explicit(["NEONTRIP Offer Number", "NEONTRIP Angebot", "Offer Number", "offer_number", "offerNumber"], /(?:NEONTRIP\s+Offer\s+Number|NEONTRIP\s+Angebot|Angebotsnummer)\s*:?\s*(A\/N\s*\d+)/i);
  const id = explicit(["NEONTRIP Offer ID", "Offer ID", "offer_id", "offerId"], /NEONTRIP\s+Offer\s+ID\s*:?\s*([a-z0-9_-]+)/i);
  return {
    number,
    adminUrl: id && /^[A-Za-z0-9_-]{8,120}$/.test(id)
      ? `/api/ops/customer-records/offers/${encodeURIComponent(id)}/admin` : null,
  };
}
