import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260819183000_create_billing_job_worker.sql"), "utf8");
const rollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260819183000_create_billing_job_worker_rollback.sql"), "utf8");
const internalAuth = fs.readFileSync(path.join(process.cwd(), "src/lib/ops/billing/internal-auth.ts"), "utf8");

test("billing worker claims one leased job and blocks after bounded retries", () => {
  assert.match(migration, /for update skip locked limit 1/);
  assert.match(migration, /job_type=any\(p_job_types\)/);
  assert.match(migration, /lease_expires_at>now\(\)/);
  assert.match(migration, /when 3 then now\(\)\+interval '15 minutes'/);
  assert.match(migration, /then 'BLOCKED' else 'FAILED'/);
  assert.match(migration, /Fehler Rechnung Shopify\/Easybill/);
  assert.match(migration, /document_number,status,easybill_document_id/);
  assert.match(rollback, /drop function if exists public\.billing_job_claim/);
});

test("billing worker API requires a constant-time bearer token", () => {
  assert.doesNotMatch(internalAuth, /QUOTE_INTERNAL_API_TOKEN|SHOPIFY_SALE_WEBHOOK_SECRET/);
  const original = process.env.BILLING_WORKER_API_TOKEN;
  process.env.BILLING_WORKER_API_TOKEN = "billing-worker-test-token-123456789";
  try {
    assert.equal(isBillingWorkerAuthorized(new Headers({ authorization: "Bearer billing-worker-test-token-123456789" })), true);
    assert.equal(isBillingWorkerAuthorized(new Headers({ authorization: "Bearer wrong-token" })), false);
    assert.equal(isBillingWorkerAuthorized(new Headers()), false);
  } finally {
    if (original === undefined) delete process.env.BILLING_WORKER_API_TOKEN;
    else process.env.BILLING_WORKER_API_TOKEN = original;
  }
});
