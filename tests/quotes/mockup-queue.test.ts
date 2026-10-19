import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PARALLEL_MOCKUPS_PER_CARD,
  expectedMockupCount,
  mockupOrderTerminalState,
  quoteReadyMockupOrderKey,
} from "@/lib/ops/mockup-queue";

test("Table Stand variants always require exactly one mockup", () => {
  for (const value of ["Table Stand", "table_stand", "Table-Stands", "Tischaufsteller", "Tischgerät"]) {
    assert.equal(expectedMockupCount(value, 8), 1, value);
  }
});

test("other product counts are bounded and deterministic", () => {
  assert.equal(expectedMockupCount("LED Neon", 8), 8);
  assert.throws(() => expectedMockupCount("LED Neon", 0), /mockup_expected_count_invalid/);
  assert.throws(() => expectedMockupCount("LED Neon", 21), /mockup_expected_count_invalid/);
  assert.equal(MAX_PARALLEL_MOCKUPS_PER_CARD, 2);
});

test("order key is stable for Trello card revision replays", () => {
  assert.equal(
    quoteReadyMockupOrderKey({ trelloCardId: "abc", sourceRevision: "rev-1" }),
    quoteReadyMockupOrderKey({ trelloCardId: " abc ", sourceRevision: " rev-1 " }),
  );
});

test("terminal state only completes after every slot uploaded", () => {
  assert.equal(mockupOrderTerminalState(2, ["completed", "retry_wait"]), "processing");
  assert.equal(mockupOrderTerminalState(2, ["completed", "completed"]), "completed");
  assert.equal(mockupOrderTerminalState(2, ["completed", "failed_terminal"]), "failed_terminal");
  assert.throws(() => mockupOrderTerminalState(2, ["completed"]), /mockup_slot_plan_incomplete/);
});

test("database contract enforces two active cards, bounded retries, slot idempotency and terminal projection fields", () => {
  const sql = readFileSync("supabase/migrations/20260724143000_create_quote_ready_mockup_queue.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('quote_ready_mockup_order_claim'\)\)/);
  assert.match(sql, /status in \('leased','processing'\) and lease_expires_at > now\(\)\) >= 2/);
  assert.doesNotMatch(sql, /unique index[^;]+active_order/is);
  assert.match(sql, /where status in \('leased','processing'\)/);
  assert.match(sql, /unique \(order_id, slot_number\)/);
  assert.match(sql, /attempt_count between 0 and max_attempts/);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit,2\),1\),2\)/);
  assert.match(sql, /terminal_projected_at/);
  assert.match(sql, /upload_label_projected_at/);
  assert.match(sql, /completed item requires Trello attachment id/);
  assert.doesNotMatch(sql, /card_title|label_name|checklist/);
});
