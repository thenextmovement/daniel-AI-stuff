import assert from "node:assert/strict";
import test from "node:test";
import { dunningPauseUntil, courtPreparationBlockers } from "../../src/lib/ops/dunning-operator-actions";
import type { DunningCaseSummary } from "../../src/lib/ops/dunning";

const open = { amountCents: 11900, financialStatus: "pending", state: "scheduled", paused: false,
  paymentException: false, stopTag: false, customerReplied: false, dueDate: "2026-09-30",
  invoiceDate: "2026-08-30T12:00:00Z", easybillInvoiceNumber: "2026-123", currentStage: 2,
  blockers: ["Nächste Stufe ist noch nicht fällig"], courtEvents: [] } as unknown as DunningCaseSummary;
const now = new Date("2026-10-20T10:00:00Z");

test("one/two week pause keeps Berlin wall time across the October clock change", () => {
  assert.equal(dunningPauseUntil(1, now), "2026-10-27T11:00:00Z");
  assert.equal(dunningPauseUntil(2, now), "2026-11-03T11:00:00Z");
  assert.throws(() => dunningPauseUntil(0, now));
  assert.throws(() => dunningPauseUntil(3, now));
});
test("manual court preparation can precede stage six only for an evidenced overdue open case", () => {
  assert.deepEqual(courtPreparationBlockers(open, now), []);
  for (const patch of [
    { financialStatus: "paid" }, { amountCents: 0 }, { paused: true }, { stopTag: true },
    { paymentException: true }, { customerReplied: true }, { state: "closed" },
    { dueDate: "2026-10-30" }, { dueDate: null }, { invoiceDate: null }, { easybillInvoiceNumber: null },
    { blockers: ["Bank- oder Shopify-Spiegel nicht vollständig aktuell"] },
    { blockers: ["Mögliche Zahlung noch nicht eindeutig zugeordnet"] },
    { courtEvents: [{ eventType: "application_submitted" }] },
    { courtEvents: [{ eventType: "application_draft_created" }] },
  ]) assert.ok(courtPreparationBlockers({ ...open, ...patch } as DunningCaseSummary, now).length, JSON.stringify(patch));
});

import { recordDunningPhoneCall } from "../../src/lib/ops/dunning";
import { sendDunningOperatorAlert } from "../../src/lib/ops/dunning-court-application";

test("call records retain operator, note and idempotency ID without changing a dunning stage", async () => {
  const originalFetch = globalThis.fetch;
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://database.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init: init! }); return new Response(null, { status: 204 }); };
  try {
    const id = "12345678-1234-4234-8234-123456789abc";
    await recordDunningPhoneCall({ id, orderNumber: "#NEONT5000", actor: "operator@example.test", note: " Rückruf vereinbart " });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.url, /workflow_audit_log\?on_conflict=id$/);
    const body = JSON.parse(String(requests[0]!.init.body));
    assert.equal(body.id, id); assert.equal(body.metadata.actor, "operator@example.test");
    assert.equal(body.metadata.note, "Rückruf vereinbart"); assert.equal(body.action, "ops_dunning_phone_call");
    assert.match(String((requests[0]!.init.headers as Record<string,string>).Prefer), /ignore-duplicates/);
    await assert.rejects(recordDunningPhoneCall({ id, orderNumber: "#NEONT5000", actor: "", note: "Test" }));
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key,value] of Object.entries({ SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.key })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("manual insolvency failures alert support and a rejected alert remains an error", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "MICROSOFT_GRAPH_MAILBOX"];
  const previous = names.map(name => process.env[name]); names.forEach(name => process.env[name] = "test");
  let reject = false; let messages = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2")) return Response.json({ access_token: "fake" });
    const body = JSON.parse(String(init?.body));
    assert.equal(body.message.toRecipients[0].emailAddress.address, "support@neontrip.de");
    assert.match(body.message.body.content, /Insolvenzprüfung/);
    messages++;
    return new Response(null, { status: reject ? 503 : 202 });
  };
  try {
    await sendDunningOperatorAlert("#NEONT5000");
    reject = true;
    await assert.rejects(sendDunningOperatorAlert("#NEONT5000"), /ALERT_UNCONFIRMED/);
    assert.equal(messages, 2, "uncertain sends must not blindly retry");
  } finally { globalThis.fetch = originalFetch; names.forEach((name,index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
