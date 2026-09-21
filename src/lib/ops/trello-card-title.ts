export const KEY_CUSTOMER_TRELLO_PREFIX = "KEY KUNDE";

export type KeyCustomerTitleParts = {
  hasKeyCustomerPrefix: boolean;
  titleWithoutKeyCustomerPrefix: string;
};

export function splitKeyCustomerTrelloTitle(value: unknown): KeyCustomerTitleParts {
  const title = typeof value === "string" ? value : String(value ?? "");
  let remaining = title.replace(
    /^((?:⚠️ MOCKUP PRÜFEN|🎨 DESIGN ABWEICHUNG) ·\s*)KEY\s+KUNDE\s*\|\s*/u,
    "KEY KUNDE | $1",
  );
  let hasKeyCustomerPrefix = false;
  // Other title writers can move the marker behind a product/order prefix.
  // Remove only whole pipe-delimited markers; preserve every other title part.
  const marker = /(^|\s*\|\s*)KEY\s+KUNDE(?=\s*(?:\||$))/i;
  let match: RegExpMatchArray | null;
  while ((match = remaining.match(marker))) {
    hasKeyCustomerPrefix = true;
    const index = match.index!;
    remaining = remaining.slice(0, index) + remaining.slice(index + match[0].length);
    if (index === 0) remaining = remaining.replace(/^\s*\|\s*/, "");
  }

  return {
    hasKeyCustomerPrefix,
    titleWithoutKeyCustomerPrefix: remaining,
  };
}

export function buildKeyCustomerTrelloTitle(currentTitle: unknown) {
  const title = typeof currentTitle === "string" ? currentTitle : String(currentTitle ?? "");
  if (!title.trim()) return null;
  const parts = splitKeyCustomerTrelloTitle(title);
  if (parts.hasKeyCustomerPrefix) {
    return parts.titleWithoutKeyCustomerPrefix
      ? `${KEY_CUSTOMER_TRELLO_PREFIX} | ${parts.titleWithoutKeyCustomerPrefix}`
      : KEY_CUSTOMER_TRELLO_PREFIX;
  }

  return `${KEY_CUSTOMER_TRELLO_PREFIX} | ${title}`;
}

export function restoreKeyCustomerTrelloPrefix(title: string, hasKeyCustomerPrefix: boolean) {
  if (!hasKeyCustomerPrefix) return title;
  return title ? `${KEY_CUSTOMER_TRELLO_PREFIX} | ${title}` : KEY_CUSTOMER_TRELLO_PREFIX;
}
