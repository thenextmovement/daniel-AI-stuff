import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260910103300_stop_private_followup_weekends.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../supabase/rollbacks/20260910103300_stop_private_followup_weekends_rollback.sql", import.meta.url), "utf8");
const checks = readFileSync(new URL("../../supabase/tests/followup_verified_private_weekends.sql", import.meta.url), "utf8");

test("changes only the private weekend predicate in the exact live cadence function", () => {
  const old = migration.match(/old_block constant text := \$old\$([\s\S]*?)\$old\$/)?.[1];
  const next = migration.match(/new_block constant text := \$new\$([\s\S]*?)\$new\$/)?.[1];
  assert.ok(old?.includes("resolved_segment = 'NT-8'"));
  assert.equal(next, "      false as weekend_allowed,");
  assert.match(migration, /7b81bf6b3fa457e4cc0974b2f948ae9d/);
  assert.match(migration, /replace\(before_definition, old_block, new_block\)/);
  assert.doesNotMatch(migration, /\b(?:update|insert into|delete from|drop function|create table)\b/i);
});

test("refuses a concurrent delivery or unexpected source/permissions change", () => {
  assert.match(migration, /status = 'processing'/);
  assert.match(migration, /followup_cadence_source_drift/);
  assert.match(migration, /has_function_privilege\('anon'/);
  assert.match(migration, /has_function_privilege\('authenticated'/);
  assert.match(migration, /has_function_privilege\('service_role'/);
  assert.match(migration, /pg_get_functiondef\(target\) is distinct from after_definition/);
  assert.match(migration, /is distinct from before_acl/);
});

test("rollback is exact and does not revive any queue entries", () => {
  assert.match(rollback, /7d26968effd57fce22fa23d884d8f1db/);
  assert.match(rollback, /7b81bf6b3fa457e4cc0974b2f948ae9d/);
  assert.match(rollback, /status = 'processing'/);
  assert.doesNotMatch(rollback, /\b(?:update|insert into|delete from|drop function|create table)\b/i);
});

test("existing SQL checks cover private/manual/AI, small and weekly neighbors", () => {
  assert.match(checks, /private_decision->>'weekend_allowed' <> 'false'/);
  assert.match(checks, /ai_private_decision->>'weekend_allowed' <> 'false'/);
  assert.match(checks, /small_decision->>'cadence_tier' <> 'frequent'/);
  assert.match(checks, /weekly_decision->>'cadence_tier' <> 'weekly'/);
  assert.match(checks, /private_decision->>'segment' <> 'NT-8'/);
  assert.match(checks, /2026-08-31 08:59:59/);
  assert.match(checks, /2026-08-31 16:00:00/);
  assert.match(checks, /rollback;/);
});
