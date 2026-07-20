import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as claimReview } from "../../src/app/api/internal/arrival-labels/review-notifications/claim/route";
import { POST as updateReview } from "../../src/app/api/internal/arrival-labels/review-notifications/[notificationId]/result/route";

const TOKEN = "arrival-label-agent-test-token";
const WORKER_ID = "n8n-review-worker-01";
const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";

function request(path: string, body: Record<string, unknown>, token = TOKEN, workerId = WORKER_ID) {
  return new NextRequest(`https://ops.example.invalid${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Neontrip-Review-Worker": workerId,
    },
    body: JSON.stringify(body),
  });
}

async function withEnvironment<T>(run: () => Promise<T>) {
  const previous = {
    token: process.env.ARRIVAL_LABEL_AGENT_API_TOKEN,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = TOKEN;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  try {
    return await run();
  } finally {
    if (previous.token === undefined) delete process.env.ARRIVAL_LABEL_AGENT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_AGENT_API_TOKEN = previous.token;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
}

test("review claim requires the agent bearer and matching worker header", async () => {
  await withEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const unauthorized = await claimReview(request("/claim", { workerId: WORKER_ID }, "wrong-token"));
    assert.equal(unauthorized.status, 401);
    const mismatch = await claimReview(request("/claim", { workerId: "another-worker" }));
    assert.equal(mismatch.status, 400);
    assert.equal(called, false);
  });
});

test("review claim returns only validated fixed-recipient mail data", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /rpc\/arrival_labels_claim_review_notification/);
      return Response.json([{
        id: NOTIFICATION_ID,
        case_id: "22222222-2222-4222-8222-222222222222",
        notification_key: `arrival-review:${"a".repeat(64)}`,
        recipient_email: "info@neontrip.de",
        subject: "[NEONTRIP] Versandetikett manuell pruefen: #NEONT100 / DHL 567890",
        body_text: "Automatische Verarbeitung gesperrt.\nEs wurde kein neues Versandetikett gekauft und kein Druckauftrag erzeugt.\nShopify: https://neontrip.myshopify.com/admin/orders/100",
        shopify_order_url: "https://neontrip.myshopify.com/admin/orders/100",
        status: "claimed",
        attempts: 1,
        max_attempts: 3,
        lease_owner: WORKER_ID,
        lease_expires_at: "2026-07-20T10:00:00Z",
        dispatch_receipt_id: null,
        last_error: null,
      }]);
    };
    const response = await claimReview(request("/claim", { workerId: WORKER_ID }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.notification.to, "info@neontrip.de");
    assert.equal(payload.notification.id, NOTIFICATION_ID);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("review result validates status and records the n8n dispatch receipt", async () => {
  await withEnvironment(async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /rpc\/arrival_labels_update_review_notification/);
      requestBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      return Response.json([{ status: "sent" }]);
    };
    const response = await updateReview(
      request(`/review/${NOTIFICATION_ID}`, { workerId: WORKER_ID, result: "sent", dispatchReceiptId: "n8n:123:test" }),
      { params: Promise.resolve({ notificationId: NOTIFICATION_ID }) },
    );
    assert.equal(response.status, 200);
    assert.equal(requestBodies[0]?.p_dispatch_receipt_id, "n8n:123:test");

    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const invalid = await updateReview(
      request(`/review/${NOTIFICATION_ID}`, { workerId: WORKER_ID, result: "send-again" }),
      { params: Promise.resolve({ notificationId: NOTIFICATION_ID }) },
    );
    assert.equal(invalid.status, 400);
    assert.equal(called, false);
  });
});
