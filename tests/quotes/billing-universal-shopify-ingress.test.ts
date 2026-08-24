import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = JSON.parse(fs.readFileSync(path.join(
  process.cwd(),
  "workflows/billing-v2/generated/shopify-order-intake-adapter-v2.inactive.json",
), "utf8")) as {
  active: boolean;
  name: string;
  nodes: Array<{ name: string; type: string; parameters?: { jsCode?: string; url?: string; authentication?: string }; credentials?: Record<string, { name?: string }> }>;
  connections: Record<string, unknown>;
};
const migration = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260824133000_universal_shopify_billing_intake.sql",
), "utf8");

test("universal Shopify billing ingress covers every production order source", () => {
  assert.equal(workflow.active, false);
  assert.match(workflow.name, /Universal Shopify Order Intake/);
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const fetch = workflow.nodes.find((node) => node.name === "Read Recent Shopify Orders");
  assert.equal(fetch?.parameters?.url,
    "https://galaxybuzzdk.myshopify.com/admin/api/2025-10/orders.json?status=any&limit=50&order=created_at%20desc");
  const normalize = workflow.nodes.find((node) => node.name === "Normalize Unseen Shopify Orders")?.parameters?.jsCode || "";
  assert.match(normalize, /shopify-universal/);
  assert.match(normalize, /financial_status/);
  assert.match(normalize, /order\.email \|\| order\.contact_email \|\| order\.customer\?\.email/);
  assert.match(normalize, /gid:\/\/shopify\/Order\//);
  assert.match(normalize, /state\.completed\[fingerprint\]/);
  const intake = workflow.nodes.find((node) => node.name === "Create or Replay BillingCase");
  assert.equal(intake?.parameters?.authentication, "genericCredentialType");
  assert.equal(intake?.credentials?.httpHeaderAuth?.name, "NEONTRIP Billing Worker");
  assert.doesNotMatch(JSON.stringify(workflow), /BILLING_WEBHOOK_SECRET/);
  assert.ok(workflow.connections["Create or Replay BillingCase"]);
});

test("initial document decision and replay are atomic and idempotent", () => {
  assert.match(migration, /v_initial_type text := upper/);
  assert.match(migration, /v_initial_type = 'INVOICE'/);
  assert.match(migration, /v_job_type := 'CREATE_INVOICE'/);
  assert.match(migration, /v_job_type := 'CREATE_PROFORMA'/);
  assert.match(migration, /where shopify_order_id = p_case->>'shopify_order_id'/);
  assert.match(migration, /v_universal_replay := p_case->>'source_system' = 'shopify-universal'/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /job_type in \('CREATE_PROFORMA','CREATE_INVOICE'\)/);
});
