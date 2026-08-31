import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260831144500_mark_explicit_followup_decline_lost.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/rollbacks/20260831144500_mark_explicit_followup_decline_lost_rollback.sql", import.meta.url),
  "utf8",
);
const fixture = readFileSync(
  new URL("../../supabase/tests/followup_cadence_replies.sql", import.meta.url),
  "utf8",
);

test("explicit validated decline marks only an open canonical request lost", () => {
  assert.match(migration, /if safe_decision = 'DECLINED' then/i);
  assert.match(migration, /p_confidence < 0\.90/i);
  assert.match(migration, /safe_reason not in \('explicit_decline', 'bought_elsewhere', 'do_not_contact'\)/i);
  assert.match(migration, /set deal_status = 'lost'/i);
  assert.match(migration, /lower\(coalesce\(nullif\(btrim\(deal_status\), ''\), 'open'\)\) = 'open'/i);
  assert.match(migration, /existing_terminal_state_protected/i);
  assert.match(migration, /'deal_marked_lost', deal_marked_lost/i);
});

test("snooze and ambiguous reply branches do not write deal status", () => {
  const declineStart = migration.indexOf("if safe_decision = 'DECLINED' then", migration.indexOf("update public.followup_delivery_attempts"));
  const snoozeStart = migration.indexOf("elsif safe_decision = 'SNOOZE_7_DAYS' then", declineStart);
  const manualStart = migration.indexOf("else", snoozeStart);
  assert.ok(declineStart >= 0 && snoozeStart > declineStart && manualStart > snoozeStart);
  assert.doesNotMatch(migration.slice(snoozeStart, manualStart), /deal_status\s*=/i);
});

test("fixture proves decline side effect, snooze neighbor and audit metadata", () => {
  assert.match(fixture, /deal_status = 'open'/i);
  assert.match(fixture, /result->>'deal_marked_lost' <> 'true'/i);
  assert.match(fixture, /deal_status = 'lost'/i);
  assert.match(fixture, /metadata->>'deal_marked_lost' = 'true'/i);
});

test("rollback restores the exact prior function and remains drift gated", () => {
  assert.match(rollback, /cf7eabf48a68c007b0e6626d838e9ec9/i);
  assert.match(rollback, /5e49a9a85c9c348d672f4a1bec0d8eff/i);
  assert.doesNotMatch(rollback, /set deal_status = 'lost'/i);
});
