import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260819190000_create_billing_financial_events.sql"), "utf8");
const rollback = fs.readFileSync(path.join(process.cwd(), "supabase/rollbacks/20260819190000_create_billing_financial_events_rollback.sql"), "utf8");

test("full payment creates invoice and projections while partial payment remains manual", () => {
  assert.match(migration, /v_match := case when v_total=v_case\.total_gross_cents then 'MATCHED'/);
  assert.match(migration, /Teil- oder Überzahlungen erzeugen nicht automatisch eine finale Rechnung/);
  assert.match(migration, /'PAYMENT_RECEIVED'/);
  assert.match(migration, /'PROJECT_PAYMENT_SHOPIFY'/);
});

test("Shopify cancel and refund distinguish Pro-forma from final invoice", () => {
  assert.match(migration, /if v_case\.final_invoice_at is null then/);
  assert.match(migration, /document_type='PROFORMA'/);
  assert.match(migration, /'CREATE_CREDIT'/);
  assert.match(migration, /'CREATE_CANCELLATION'/);
  assert.match(migration, /BILLING_REFUND_POST_LINES_REQUIRED/);
  assert.match(migration, /'PF-'\|\|replace\(v_case\.shopify_order_name/);
  assert.match(migration, /'GS-'\|\|replace\(v_case\.shopify_order_name/);
  assert.match(migration, /'ST-'\|\|replace\(v_case\.shopify_order_name/);
  assert.doesNotMatch(migration, /accepted_at.*interval.*cancel/i);
});

test("financial event functions are service-role only and reversible", () => {
  assert.match(migration, /revoke all on function public\.billing_payment_ingest/);
  assert.match(migration, /revoke all on function public\.billing_shopify_event_ingest/);
  assert.match(rollback, /drop function if exists public\.billing_payment_ingest/);
  assert.match(rollback, /drop function if exists public\.billing_shopify_event_ingest/);
});
