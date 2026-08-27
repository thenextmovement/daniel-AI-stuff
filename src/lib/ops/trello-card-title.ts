export const KEY_CUSTOMER_TRELLO_PREFIX = "KEY KUNDE";

export type KeyCustomerTitleParts = {
  hasKeyCustomerPrefix: boolean;
  titleWithoutKeyCustomerPrefix: string;
};

export function splitKeyCustomerTrelloTitle(value: unknown): KeyCustomerTitleParts {
  const title = typeof value === "string" ? value : String(value ?? "");
  const match = title.match(/^KEY\s+KUNDE(?:\s*\|\s*|\s*$)/i);
  if (!match) {
    return {
      hasKeyCustomerPrefix: false,
      titleWithoutKeyCustomerPrefix: title,
    };
  }

  return {
    hasKeyCustomerPrefix: true,
    titleWithoutKeyCustomerPrefix: title.slice(match[0].length),
  };
}

export function buildKeyCustomerTrelloTitle(currentTitle: unknown) {
  const title = typeof currentTitle === "string" ? currentTitle : String(currentTitle ?? "");
  if (!title.trim()) return null;
  if (title === KEY_CUSTOMER_TRELLO_PREFIX || title.startsWith(`${KEY_CUSTOMER_TRELLO_PREFIX} | `)) {
    return title;
  }

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
