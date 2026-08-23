import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { signBillingWebhook, verifyBillingWebhook } from "../../src/lib/ops/billing/auth";

const secret = "s".repeat(64);
const body = JSON.stringify({ shopifyOrderId: "1" });
const timestamp = "1787133600";
const eventId = "shopify:order:1:created";
const authSource = fs.readFileSync(path.join(process.cwd(), "src/lib/ops/billing/auth.ts"), "utf8");
const actionRouteSource = fs.readFileSync(path.join(process.cwd(), "src/app/api/ops/billing/[caseId]/actions/route.ts"), "utf8");
const billingClientSource = fs.readFileSync(path.join(process.cwd(), "src/app/ops/rechnungen/page-client.tsx"), "utf8");
const opsLoginSource = fs.readFileSync(path.join(process.cwd(), "src/app/ops-login/page-client.tsx"), "utf8");

function headers(values: Record<string, string>) {
  return { get(name: string) { return values[name.toLowerCase()] || null; } };
}

test("billing webhook accepts one fresh signed event", () => {
  const result = verifyBillingWebhook({
    body, secret, nowSeconds: Number(timestamp),
    headers: headers({ "x-neontrip-timestamp": timestamp, "x-neontrip-event-id": eventId, "x-neontrip-signature": signBillingWebhook(body, timestamp, secret) }),
  });
  assert.deepEqual(result, { ok: true, eventId, timestamp });
});

test("billing webhook rejects tampering, stale signatures and missing event ids", () => {
  const signed = signBillingWebhook(body, timestamp, secret);
  assert.equal(verifyBillingWebhook({ body: `${body}x`, secret, nowSeconds: Number(timestamp), headers: headers({ "x-neontrip-timestamp": timestamp, "x-neontrip-event-id": eventId, "x-neontrip-signature": signed }) }).ok, false);
  assert.equal(verifyBillingWebhook({ body, secret, nowSeconds: Number(timestamp) + 301, headers: headers({ "x-neontrip-timestamp": timestamp, "x-neontrip-event-id": eventId, "x-neontrip-signature": signed }) }).ok, false);
  assert.equal(verifyBillingWebhook({ body, secret, nowSeconds: Number(timestamp), headers: headers({ "x-neontrip-timestamp": timestamp, "x-neontrip-signature": signed }) }).ok, false);
});

test("billing webhook requires its dedicated secret", () => {
  assert.doesNotMatch(authSource, /SHOPIFY_SALE_WEBHOOK_SECRET|QUOTE_INTERNAL_API_TOKEN/);
});

test("billing actions derive the audit actor only from the existing Ops session", () => {
  assert.match(actionRouteSource, /resolveOpsRequestActor\(host, request\.headers\)/);
  assert.match(actionRouteSource, /personal_login_required/);
  assert.doesNotMatch(actionRouteSource, /input\.operatorName|parsed\.operatorName/);
  assert.doesNotMatch(billingClientSource, /neontrip-billing-operator|operatorName\.trim\(\)/);
  assert.doesNotMatch(billingClientSource, /operatorName:/);
  assert.match(billingClientSource, /showOperatorName=\{false\}/);
  assert.doesNotMatch(opsLoginSource, /operatorName|operatorNameKey/);
  assert.match(opsLoginSource, /JSON\.stringify\(\{ token \}\)/);
  assert.match(opsLoginSource, /showOperatorName=\{false\}/);
});
