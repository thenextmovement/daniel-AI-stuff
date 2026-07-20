import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260720094159_create_arrival_label_automation.sql";

test("arrival-label schema enforces source-of-truth, RLS and idempotency boundaries", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /idempotency_key text not null unique/i);
  assert.match(sql, /unique index[\s\S]+shopify_order_id, incoming_dhl_tracking_number/i);
  for (const table of ["product_config", "runs", "cases", "run_cases", "events", "artifacts"]) {
    assert.match(sql, new RegExp(`arrival_label_${table} enable row level security`, "i"));
  }
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_expires_at/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.arrival_label_product_config/i);
  assert.doesNotMatch(sql, /grant select, insert, update, delete on table public\.arrival_label_events/i);
});

test("rollback removes all arrival-label objects in dependency order", async () => {
  const sql = await readFile("supabase/rollbacks/20260720094159_create_arrival_label_automation_rollback.sql", "utf8");
  assert.match(sql, /drop function if exists public\.arrival_labels_claim_case/i);
  assert.match(sql, /drop table if exists public\.arrival_label_run_cases/i);
  assert.ok(sql.indexOf("arrival_label_run_cases") < sql.indexOf("arrival_label_cases"));
});
