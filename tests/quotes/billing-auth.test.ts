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
const opsAuthSource = fs.readFileSync(path.join(process.cwd(), "src/lib/ops/auth.ts"), "utf8");
const opsSessionRouteSource = fs.readFileSync(path.join(process.cwd(), "src/app/api/ops/session/route.ts"), "utf8");
const opsLoginSource = fs.readFileSync(path.join(process.cwd(), "src/app/ops-login/page-client.tsx"), "utf8");
const billingClientSource = fs.readFileSync(path.join(process.cwd(), "src/app/ops/rechnungen/page-client.tsx"), "utf8");

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

test("billing actions derive the audit actor from the personal Ops login", () => {
  assert.match(actionRouteSource, /resolvePersonalOpsRequestActor\(host, request\.headers\)/);
  assert.match(actionRouteSource, /personal_login_required/);
  assert.doesNotMatch(actionRouteSource, /input\.operatorName|parsed\.operatorName/);
  assert.doesNotMatch(billingClientSource, /neontrip-billing-operator|operatorName\.trim\(\)/);
  assert.doesNotMatch(billingClientSource, /operatorName:/);
  assert.match(billingClientSource, /showOperatorName=\{false\}/);
});

test("the internal Ops login binds its actor to a signed HttpOnly session", () => {
  assert.match(opsSessionRouteSource, /applyOpsSession\(NextResponse\.json\(\{ ok: true \}\), body\.token, body\.operatorName\)/);
  assert.match(opsLoginSource, /JSON\.stringify\(\{ token, operatorName: operatorName\.trim\(\) \}\)/);
  assert.match(opsAuthSource, /const OPS_ACTOR_COOKIE = "neontrip_ops_actor"/);
  assert.match(opsAuthSource, /createHmac\("sha256", sessionDigest\(token\)\)/);
  assert.match(opsAuthSource, /httpOnly: true/);
  assert.match(opsAuthSource, /resolveSignedSessionActor\(\)/);
});
