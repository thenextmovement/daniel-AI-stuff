import type { TrelloAttachment } from "./types";

export function attachmentName(attachment: TrelloAttachment) {
  return String(attachment.name || attachment.fileName || "").trim();
}

function mockupSortKey(name: string) {
  const normalized = name.toLowerCase();
  const match =
    normalized.match(/^mockup[\s_-]*(\d+)/i) ||
    normalized.match(/^moc[\s_-]*ab[\s_-]*(\d+)/i) ||
    normalized.match(/^mocab[\s_-]*(\d+)/i);
  return match?.[1] ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function isValidMockupAttachment(attachment: TrelloAttachment) {
  const name = attachmentName(attachment);
  const isMockupName =
    /^mockup/i.test(name) ||
    /^moc[\s_-]*ab[\s_-]*\d*/i.test(name) ||
    /^mocab[\s_-]*\d*/i.test(name);
  return isMockupName && /\.(jpe?g|png|webp|avif)$/i.test(name);
}

export function selectMockupAttachments(attachments: TrelloAttachment[]) {
  return attachments
    .filter(isValidMockupAttachment)
    .sort((a, b) => {
      const leftName = attachmentName(a);
      const rightName = attachmentName(b);
      const keyDiff = mockupSortKey(leftName) - mockupSortKey(rightName);
      if (keyDiff !== 0) return keyDiff;
      return leftName.localeCompare(rightName, "de", { numeric: true });
    })
    .slice(0, 4);
}
