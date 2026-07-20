import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260720094159_create_arrival_label_automation.sql";

test("arrival-label schema enforces source-of-truth, RLS and idempotency boundaries", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /idempotency_key text not null unique/i);
  assert.match(sql, /trigger_type in \('manual_cli', 'manual_api', 'n8n_email', 'n8n_schedule', 'fixture_test'\)/i);
  assert.match(sql, /express_product_mapping ->> 'express_09'/i);
  assert.match(sql, /express_product_mapping ->> 'express_12'/i);
  assert.match(sql, /unique index[\s\S]+shopify_order_id, incoming_dhl_tracking_number/i);
  for (const table of ["product_config", "runs", "cases", "run_cases", "events", "artifacts", "print_jobs", "review_notifications"]) {
    assert.match(sql, new RegExp(`arrival_label_${table} enable row level security`, "i"));
  }
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_expires_at/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.arrival_label_product_config/i);
  assert.doesNotMatch(sql, /grant select, insert, update, delete on table public\.arrival_label_events/i);
  assert.match(sql, /arrival_labels_enqueue_print_job/i);
  assert.match(sql, /only a QA-approved annotated PDF can be printed/i);
  assert.match(sql, /p_result = 'dispatching'[\s\S]+invalid transition to dispatching/i);
  assert.match(sql, /status in \('queued', 'claimed', 'retryable_error'\)/i);
  assert.match(sql, /Print worker stopped before dispatch and exhausted safe retry attempts/i);
  assert.match(sql, /valid CUPS job id is required/i);
  assert.match(sql, /retry is safe only before print dispatch/i);
  assert.match(sql, /v_retry_exhausted := p_result = 'retryable_error' and v_job\.attempts >= v_job\.max_attempts/i);
  assert.match(sql, /maximale Anzahl sicherer Vorab-Versuche erreicht/i);
  assert.match(sql, /physisch pruefen und nicht automatisch erneut drucken/i);
  assert.match(sql, /incoming_dhl_last_six text generated always as \(right\(incoming_dhl_tracking_number, 6\)\)/i);
  assert.doesNotMatch(sql, /incoming_dhl_last_four/i);
  assert.match(sql, /recipient_email = 'info@neontrip[.]de'/i);
  assert.match(sql, /only a blocked case without DPD product can enqueue a review notification/i);
  assert.match(sql, /review notification idempotency key belongs to different input/i);
  assert.match(sql, /Mail dispatch began but completion is unknown; do not automatically resend/i);
  assert.match(sql, /review retry is safe only before mail dispatch/i);
  assert.match(sql, /status = 'sent'[\s\S]+and p_result = 'sent'/i);
  assert.match(sql, /dispatch_receipt_id text null/i);
  assert.match(sql, /dispatch receipt id is required/i);
});

test("rollback removes all arrival-label objects in dependency order", async () => {
  const sql = await readFile("supabase/rollbacks/20260720094159_create_arrival_label_automation_rollback.sql", "utf8");
  assert.match(sql, /drop function if exists public\.arrival_labels_claim_case/i);
  assert.match(sql, /drop table if exists public\.arrival_label_run_cases/i);
  assert.match(sql, /drop table if exists public\.arrival_label_print_jobs/i);
  assert.match(sql, /drop table if exists public\.arrival_label_review_notifications/i);
  assert.match(sql, /drop function if exists public\.arrival_labels_claim_review_notification/i);
  assert.ok(sql.indexOf("arrival_label_print_jobs") < sql.indexOf("arrival_label_artifacts"));
  assert.ok(sql.indexOf("arrival_label_review_notifications") < sql.indexOf("arrival_label_cases"));
  assert.ok(sql.indexOf("arrival_label_run_cases") < sql.indexOf("arrival_label_cases"));
});
