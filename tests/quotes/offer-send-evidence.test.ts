import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteEmailLogPayload,
  buildQuoteEmailLogUniqueId,
  recordQuoteEmailSentEvidence,
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
    requestId: "REQ-14427",
    trelloCardId: "card-1",
    recipientEmail: "kunde@example.com",
    subject: "Ihr NEONTRIP Angebot Nr. 14427",
    status: "sent",
    sentAt: "2026-07-07T09:00:00.000Z",
    idempotencyKey: "send-key-1",
  });

  assert.equal(payload.request_id, "REQ-14427");
  assert.equal(payload.offer_id, "offer-1");
  assert.equal(payload.angebotsnummer, "A/N 14427");
  assert.equal(payload.card_id, "card-1");
  assert.equal(payload.recipient_email, "kunde@example.com");
  assert.equal(payload.status, "sent");
  assert.equal(payload.sent_at, "2026-07-07T09:00:00.000Z");
  assert.equal(payload.error_message, null);
});

test("quote email evidence retries with legacy payload when new evidence columns are not migrated yet", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        code: "PGRST204",
        message: "Could not find the request_id column of quote_email_log in the schema cache",
      }), { status: 400 });
    }
    return new Response(JSON.stringify([{ id: 123, unique_id: "ops-offer-send:abc" }]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const rows = await recordQuoteEmailSentEvidence({
      offerId: "offer-legacy",
      offerNumber: "A/N 14428",
      requestId: "REQ-LEGACY",
      trelloCardId: "card-legacy",
      recipientEmail: "kunde@example.com",
      subject: "Ihr NEONTRIP Angebot Nr. 14428",
      status: "sent",
      sentAt: "2026-07-07T10:00:00.000Z",
      sourceEventId: "event-legacy",
      idempotencyKey: "send-key-legacy",
    });

    assert.equal(rows[0]?.id, 123);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.request_id, "REQ-LEGACY");
    assert.equal(calls[0].body.offer_id, "offer-legacy");
    assert.equal(calls[0].body.source_event_id, "event-legacy");
    assert.equal(calls[0].body.idempotency_key, "send-key-legacy");
    assert.equal("request_id" in calls[1].body, false);
    assert.equal("offer_id" in calls[1].body, false);
    assert.equal("source_event_id" in calls[1].body, false);
    assert.equal("idempotency_key" in calls[1].body, false);
    assert.match(calls[1].url, /on_conflict=unique_id/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});
