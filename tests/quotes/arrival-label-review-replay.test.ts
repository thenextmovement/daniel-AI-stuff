import assert from "node:assert/strict";
import test from "node:test";
import { enqueueArrivalReviewNotification, type ArrivalReviewNotificationRow } from "../../src/lib/ops/arrival-labels/repository";
import type { ArrivalReviewNotification } from "../../src/lib/ops/arrival-labels/review-notifications";

const notification: ArrivalReviewNotification = {
  notificationKey: `arrival-review:${"a".repeat(64)}`,
  recipientEmail: "info@neontrip.de",
  subject: "[NEONTRIP] Versandetikett manuell pruefen: #TEST / DHL 123456",
  bodyText: "Automatische Verarbeitung gesperrt. Kein neuer Kauf. Trello: https://trello.com/c/newlink",
  shopifyOrderUrl: "https://galaxybuzzdk.myshopify.com/admin/orders/100",
};
const stored: ArrivalReviewNotificationRow = {
  id: "11111111-1111-4111-8111-111111111111", case_id: "22222222-2222-4222-8222-222222222222",
  notification_key: notification.notificationKey, recipient_email: notification.recipientEmail,
  subject: notification.subject, body_text: "Automatische Verarbeitung gesperrt. Kein neuer Kauf. Trello: kein Direktlink verfuegbar",
  shopify_order_url: notification.shopifyOrderUrl, status: "sent", attempts: 1, max_attempts: 3,
  lease_owner: null, lease_expires_at: null, dispatch_receipt_id: "original-receipt", last_error: null,
};
const conflict = { code: "P0001", message: "review notification idempotency key belongs to different input" };

async function scenario(rows: ArrivalReviewNotificationRow[], error = conflict, status = 400) {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const calls: string[] = [];
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    calls.push(method);
    if (method === "POST") {
      assert.equal(calls.length, 1, "never retry enqueue or reset a queue");
      assert.equal(url.pathname, "/rest/v1/rpc/arrival_labels_enqueue_review_notification");
      return Response.json(error, { status });
    }
    assert.equal(method, "GET", "recovery must be read-only");
    assert.equal(url.pathname, "/rest/v1/arrival_label_review_notifications");
    assert.equal(url.searchParams.get("notification_key"), `eq.${notification.notificationKey}`);
    return Response.json(rows);
  };
  try { return { value: await enqueueArrivalReviewNotification({ caseId: stored.case_id, notification }), calls }; }
  finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [["SUPABASE_URL", previous.url], ["SUPABASE_SERVICE_ROLE_KEY", previous.key]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  }
}

for (const status of ["pending", "sent", "dispatching", "manual_review", "cancelled"] as const) {
  test(`same blocked review with changed display text preserves ${status} notification without a second write`, async () => {
    const existing = { ...stored, status };
    const result = await scenario([existing]);
    assert.deepEqual(result.value, existing);
    assert.deepEqual(result.calls, ["POST", "GET"]);
  });
}
for (const patch of [
  { case_id: "another-case" }, { notification_key: `arrival-review:${"b".repeat(64)}` },
  { recipient_email: "other@example.invalid" }, { shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/101" },
]) {
  test(`review conflict fails closed for a different ${Object.keys(patch)[0]}`, async () => {
    await assert.rejects(scenario([{ ...stored, ...patch }]), /Supabase Anfrage fehlgeschlagen/);
  });
}
test("missing or ambiguous persisted review cannot be accepted as handled", async () => {
  await assert.rejects(scenario([]), /Supabase Anfrage fehlgeschlagen/);
  await assert.rejects(scenario([stored, stored]), /Supabase Anfrage fehlgeschlagen/);
});
test("unrelated database failures are not swallowed", async () => {
  await assert.rejects(scenario([stored], { code: "P0001", message: "case is not blocked" }), /Supabase Anfrage fehlgeschlagen/);
  await assert.rejects(scenario([stored], conflict, 500), /Supabase Anfrage fehlgeschlagen/);
});
