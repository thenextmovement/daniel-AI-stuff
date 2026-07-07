import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteEmailLogPayload,
  buildQuoteEmailLogUniqueId,
} from "@/lib/ops/offer-send-evidence";

test("quote email evidence uses a stable idempotency key", () => {
  const input = {
    offerId: "offer-1",
    offerNumber: "A/N 14427",
    recipientEmail: "kunde@example.com",
    sourceEventId: "event-1",
  };

  assert.equal(buildQuoteEmailLogUniqueId(input), buildQuoteEmailLogUniqueId(input));
  assert.match(buildQuoteEmailLogUniqueId(input), /^ops-offer-send:[a-f0-9]{40}$/);
});

test("quote email evidence payload records an outbound sent proof", () => {
  const payload = buildQuoteEmailLogPayload({
    offerId: "offer-1",
    offerNumber: "A/N 14427",
    trelloCardId: "card-1",
    recipientEmail: "kunde@example.com",
    subject: "Ihr NEONTRIP Angebot Nr. 14427",
    status: "sent",
    sentAt: "2026-07-07T09:00:00.000Z",
    idempotencyKey: "send-key-1",
  });

  assert.equal(payload.angebotsnummer, "A/N 14427");
  assert.equal(payload.card_id, "card-1");
  assert.equal(payload.recipient_email, "kunde@example.com");
  assert.equal(payload.status, "sent");
  assert.equal(payload.sent_at, "2026-07-07T09:00:00.000Z");
  assert.equal(payload.error_message, null);
});
