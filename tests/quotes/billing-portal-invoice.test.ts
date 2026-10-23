import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { getBillingPortal } from "../../src/lib/ops/billing/repository";

const token = "a".repeat(43);
const row = { id: "case-test", current_revision: 0, updated_at: "2026-10-23T10:00:00.000Z", invoice_requested_at: "2026-10-23T10:00:01.000Z", final_invoice_at: null, customer_email: "purchasing@example.com", billing_address: { invoiceEmail: "accounts@example.com" } };
test("accepted invoice request locks the portal before the final document exists", async (t) => {
  process.env.SUPABASE_URL = "https://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  t.mock.method(globalThis, "fetch", async (url: string) => new Response(JSON.stringify(
    new URL(url).pathname.endsWith("/billing_cases") ? [row] : []
  )));
  const portal = await getBillingPortal(token);
  assert.equal(portal?.readOnly, true);
  assert.equal(portal?.billingCase.invoiceEmail, "accounts@example.com");
});

test("invoice endpoint requires explicit consent and never trusts customer-supplied billing values", async (t) => {
  const { POST } = await import("../../src/app/api/rechnung/[token]/invoice/route");
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url); throw new Error("Unexpected network request");
  });
  for (const body of [
    {}, { confirmed: false }, { confirmed: "true" },
    { confirmed: true, consentVersion: "2026-10-23", revision: -1, updatedAt: row.updated_at },
    { confirmed: true, consentVersion: "2026-10-23", revision: 0, updatedAt: row.updated_at, amount: 1 },
  ]) {
    const response = await POST(new NextRequest("http://localhost/api/rechnung/"+token+"/invoice",
      {method:"POST", body:JSON.stringify(body)}), {params:Promise.resolve({token})});
    assert.equal(response.status, 422);
  }
  assert.equal(calls.length, 0);
});

test("invoice endpoint hashes the token, queues once and distinguishes stale data from outages", async (t) => {
  const { POST } = await import("../../src/app/api/rechnung/[token]/invoice/route");
  process.env.SUPABASE_URL = "https://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  let error: string | null = null;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/billing_portal_request_invoice");
    const args = JSON.parse(String(init.body));
    assert.equal(args.p_confirmed, true);
    assert.equal(args.p_revision, 0);
    assert.equal(args.p_updated_at, row.updated_at);
    assert.equal(args.p_consent_version, "2026-10-23");
    assert.match(args.p_portal_token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(args.p_portal_token_hash, token);
    return error ? new Response(JSON.stringify({message:error}), {status:400})
      : new Response(JSON.stringify({status:"INVOICE_PENDING",duplicate:false}));
  });
  const request = () => POST(new NextRequest("http://localhost/api/rechnung/"+token+"/invoice",
    {method:"POST",body:JSON.stringify({confirmed:true, consentVersion:"2026-10-23",revision:0,updatedAt:row.updated_at})}),
    {params:Promise.resolve({token})});
  let response = await request();
  assert.equal(response.status, 202);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal((await response.json()).ok, true);
  error = "BILLING_INVOICE_STALE";
  response = await request();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "BILLING_INVOICE_STALE");
  error = "private database detail must not leak";
  response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {ok:false,error:"invoice_request_unavailable"});
  assert.equal(calls, 3);
});


test("invoice failure routing uses support without changing other workflow recipients", async () => {
  const { readFileSync } = await import("node:fs");
  const patch = JSON.parse(readFileSync("n8n/patches/2026-10-23-portal-invoice-alerts.json", "utf8"));
  assert.equal(patch.id, "M4uG1HAtN9Zggxww");
  assert.equal(patch.operations.length, 1);
  assert.equal(patch.operations[0].nodeName, "Send Prepared Alert Email");
  const expression = patch.operations[0].updates["parameters.toRecipients"].slice(3, -2).trim();
  const recipient = new Function("$json", "return (" + expression + ");");
  for (const workflowId of ["u48KZyTcU2J9pw2P", "wqaTsVKuKqKnp2AG"]) {
    assert.equal(recipient({ source_workflow_id: workflowId }), "support@neontrip.de");
    assert.equal(recipient({ source_workflow_id: "billing-ops-outage", metadata: { affected_workflow_ids: ["another-worker", workflowId] } }), "support@neontrip.de");
  }
  assert.equal(recipient({ source_workflow_id: "another-worker" }), "info@NeonTrip.de");
  assert.equal(recipient({ source_workflow_id: "billing-ops-outage", metadata: { affected_workflow_ids: ["another-worker"] } }), "info@NeonTrip.de");
});
