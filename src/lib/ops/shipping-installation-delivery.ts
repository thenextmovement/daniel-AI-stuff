import { createHash, randomUUID } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { prepareInstallationMail } from "./shipping-installation-documents";

type Obj = Record<string, any>;
const obj = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MAILBOX = "support@neontrip.de";
const MAILBOX_ID = "4d977ed3-c401-43e5-ad00-b171a294e787";
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Graph wraps HTML. Compare all visible text, plus the signature asset URLs separately. */
export function installationBodyHash(value: string) {
  return hash(value.replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()] || "")
    .replace(/\s+/g, " ").trim());
}

function attachmentEvidence(attachments: unknown) {
  if (!Array.isArray(attachments)) throw new Error("attachment_evidence_missing");
  return attachments.map((a: Obj) => {
    if (a["@odata.type"] !== "#microsoft.graph.fileAttachment" || typeof a.contentBytes !== "string" || a.contentType !== "application/pdf" || a.isInline === true) throw new Error("attachment_evidence_invalid");
    const bytes = Buffer.from(a.contentBytes, "base64");
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("attachment_evidence_invalid");
    return { name: a.name, bytes: bytes.length, sha256: hash(bytes) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function reserveInstallationDelivery(input: Obj) {
  const profile = obj(input.mailboxProfile);
  if (profile.id !== MAILBOX_ID || str(profile.mail || profile.userPrincipalName).toLowerCase() !== MAILBOX || !str(input.sentFolderId)) throw new Error("installation_mailbox_mismatch");
  const order = obj(input.order);
  const fulfillmentId = str(input.fulfillmentId);
  const prepared = await prepareInstallationMail(order, fulfillmentId);
  const fulfillment = Array.isArray(order.fulfillments) ? order.fulfillments.find((f: Obj) => str(f.id) === fulfillmentId) : undefined;
  // A foreign, cancelled, or malformed fulfillment never reserves an unrelated shipment.
  if (!fulfillment || str(fulfillment.order_id) !== str(order.id) || fulfillment.status !== "success" || order.cancelled_at) return { ready: false, reason: "fulfillment_not_successful" };
  const trackingNumbers = [...new Set((Array.isArray(fulfillment.tracking_numbers) && fulfillment.tracking_numbers.length ? fulfillment.tracking_numbers : [fulfillment.tracking_number]).map(str).filter(Boolean))];
  if (!trackingNumbers.length) return { ready: false, reason: "tracking_missing" };
  const owner = randomUUID();
  const expected = prepared.ready ? {
    subject: prepared.subject, recipient: prepared.graphDraft.toRecipients[0].emailAddress.address,
    bodyHash: installationBodyHash(prepared.bodyHtml), attachments: attachmentEvidence(prepared.graphDraft.attachments),
    notificationKey: prepared.selection.notificationKey, sentFolderId: input.sentFolderId,
    assetUrls: [...prepared.bodyHtml.matchAll(/<img\b[^>]*src="([^"]+)"/gi)].map(m => m[1]),
  } : null;
  const rows = await supabaseRpc<Obj[]>("shipping_reserve_installation_documents", {
    p_order_id: prepared.selection.orderId, p_fulfillment_id: fulfillmentId, p_tracking_numbers: trackingNumbers,
    p_recipient: str(order.email).trim().toLowerCase() || "missing-recipient", p_owner: owner,
    p_metadata: { expected, document_ids: prepared.selection.documentIds, review_reason: prepared.ready ? null : prepared.selection.reviewReasons.join(", ") },
  });
  if (!rows?.length) return { ready: false, reason: "no_new_transport_scan_or_already_reserved" };
  if (!prepared.ready) return { ready: false, notificationId: rows[0].id, reason: "document_review_required" };
  return { ready: true, notificationId: rows[0].id, owner, graphDraft: prepared.graphDraft };
}

export function validateInstallationMessage(message: Obj, expected: Obj, sent: boolean) {
  const recipients = (key: string) => Array.isArray(message[key]) ? message[key] : [];
  if (!str(message.id) || message.isDraft !== !sent || message.subject !== expected.subject
    || recipients("toRecipients").length !== 1 || str(recipients("toRecipients")[0]?.emailAddress?.address).toLowerCase() !== expected.recipient
    || recipients("ccRecipients").length || recipients("bccRecipients").length
    || recipients("replyTo").length !== 1 || str(recipients("replyTo")[0]?.emailAddress?.address).toLowerCase() !== MAILBOX
    || installationBodyHash(str(message.body?.content)) !== expected.bodyHash
    || !expected.assetUrls.every((url: string) => str(message.body?.content).replaceAll("&amp;", "&").includes(url.replaceAll("&amp;", "&")))
    || !Array.isArray(message.internetMessageHeaders)
    || message.internetMessageHeaders.filter((h: Obj) => str(h.name).toLowerCase() === "x-neontrip-installation-key" && h.value === expected.notificationKey).length !== 1
    || JSON.stringify(attachmentEvidence(message.attachments)) !== JSON.stringify(expected.attachments)) throw new Error("installation_message_mismatch");
  if (sent && (str(message.from?.emailAddress?.address).toLowerCase() !== MAILBOX
    || str(message.sender?.emailAddress?.address).toLowerCase() !== MAILBOX
    || message.parentFolderId !== expected.sentFolderId || !str(message.internetMessageId)
    || !Number.isFinite(Date.parse(message.sentDateTime)))) throw new Error("installation_sent_evidence_missing");
}

export async function checkpointInstallationDelivery(input: Obj, sent: boolean) {
  if (!uuid(input.notificationId) || !uuid(input.owner)) throw new Error("installation_claim_invalid");
  const rows = await supabaseRequest<Obj[]>("shipping_notifications", {}, {
    id: `eq.${input.notificationId}`, kind: "eq.customer_installation_documents", select: "id,status,metadata,provider_message_id,claimed_at", limit: 1,
  });
  const row = rows?.[0];
  if (!row || row.metadata?.owner_token !== input.owner || !row.metadata.expected || row.status !== (sent ? "sending" : "pending")) return { ready: false, reason: "claim_not_owned_or_already_used" };
  const message = obj(input.message);
  validateInstallationMessage(message, row.metadata.expected, sent);
  if (sent && (message.id !== row.provider_message_id || Date.parse(message.sentDateTime) < Date.parse(row.claimed_at) - 60_000 || Date.parse(message.sentDateTime) > Date.now() + 300_000)) throw new Error("installation_receipt_mismatch");
  const updated = await supabaseRpc<Obj[]>(sent ? "shipping_complete_installation_send" : "shipping_authorize_installation_send", {
    p_id: row.id, p_owner: input.owner, p_draft_id: message.id,
    ...(sent ? { p_receipt: { id: message.id, isDraft: false, internetMessageId: message.internetMessageId, parentFolderId: message.parentFolderId, sentDateTime: message.sentDateTime, verifiedAt: new Date().toISOString(), attachmentHashes: row.metadata.expected.attachments } } : {}),
  });
  return { ready: !sent && updated?.length === 1, status: updated?.[0]?.status || "unchanged", notificationId: row.id, owner: input.owner, draftId: updated?.[0]?.provider_message_id };
}
