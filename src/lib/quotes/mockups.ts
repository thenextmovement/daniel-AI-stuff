import type { TrelloAttachment } from "./types";

export function attachmentName(attachment: TrelloAttachment) {
  return String(attachment.name || attachment.fileName || "").trim();
}

export function isValidMockupAttachment(attachment: TrelloAttachment) {
  const name = attachmentName(attachment);
  return /^mockup/i.test(name) && /\.(jpe?g|png|webp|avif)$/i.test(name);
}

export function selectMockupAttachments(attachments: TrelloAttachment[]) {
  return attachments
    .filter(isValidMockupAttachment)
    .sort((a, b) => attachmentName(a).localeCompare(attachmentName(b), "de", { numeric: true }))
    .slice(0, 4);
}
