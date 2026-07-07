import { createHash } from "node:crypto";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";

export type OfferSendEvidenceInput = {
  offerId: string;
  offerNumber?: string | null;
  requestId?: string | null;
  trelloCardId?: string | null;
  trelloCardUrl?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  subject?: string | null;
  status?: string | null;
  sentAt?: string | null;
  sourceEventId?: string | null;
  idempotencyKey?: string | null;
};

export type QuoteEmailSentEvidenceRow = {
  id?: string | number | null;
  unique_id?: string | null;
  recipient_email?: string | null;
  angebotsnummer?: string | null;
  subject?: string | null;
  status?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  card_id?: string | null;
  card_url?: string | null;
};

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export function buildQuoteEmailLogUniqueId(input: OfferSendEvidenceInput) {
  const stableSource = cleanText(input.sourceEventId || input.idempotencyKey || input.sentAt || "sent", 300);
  return `ops-offer-send:${hashKey([input.offerId, input.offerNumber || "", input.recipientEmail || "", stableSource].join("|"))}`;
}

export function buildQuoteEmailLogPayload(input: OfferSendEvidenceInput) {
  const now = new Date().toISOString();
  const sentAt = cleanText(input.sentAt, 80) || now;
  return {
    unique_id: buildQuoteEmailLogUniqueId(input),
    card_id: cleanText(input.trelloCardId, 180) || null,
    card_url: cleanText(input.trelloCardUrl, 500) || null,
    recipient_email: cleanText(input.recipientEmail, 240) || null,
    recipient_name: cleanText(input.recipientName, 240) || null,
    angebotsnummer: cleanText(input.offerNumber, 120) || null,
    subject: cleanText(input.subject, 300) || null,
    status: cleanText(input.status, 80) || "sent",
    error_type: null,
    error_message: null,
    last_error_type: null,
    last_error_message: null,
    last_attempt_at: sentAt,
    sent_at: sentAt,
    updated_at: now,
  };
}

export async function recordQuoteEmailSentEvidence(input: OfferSendEvidenceInput) {
  return supabaseRequest<QuoteEmailSentEvidenceRow[]>(
    "quote_email_log",
    {
      method: "POST",
      body: JSON.stringify(buildQuoteEmailLogPayload(input)),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    },
    { on_conflict: "unique_id" },
  );
}
