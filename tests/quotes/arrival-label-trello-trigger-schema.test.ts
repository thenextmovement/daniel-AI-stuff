import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260729182845_arrival_label_trello_sign_shipped_trigger.sql";
const rollbackPath = "supabase/rollbacks/20260729182845_arrival_label_trello_sign_shipped_trigger_rollback.sql";
const arrivalFinalizerPath = "supabase/migrations/20260723103508_finalize_dhl_delivery_to_trello_sign_arrived.sql";

test("Sign SHIPPED trigger settings are disabled by default, cutoff-gated and service-role only", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /arrival_label_trello_trigger_settings[\s\S]+enabled boolean not null default false/i);
  assert.match(sql, /enabled_after timestamptz not null default now\(\)/i);
  assert.match(sql, /source_list_name = 'Sign SHIPPED \(NEON TRIP\)'/i);
  assert.match(sql, /title_pattern_version = 'dhl-10-digit-suffix-v1'/i);
  assert.match(sql, /not enabled or \(approved_at is not null and approved_by is not null\)/i);
  assert.match(sql, /arrival_label_trello_trigger_settings enable row level security/i);
  assert.match(sql, /revoke all on table public[.]arrival_label_trello_trigger_settings from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public[.]arrival_label_trello_trigger_settings to service_role/i);
  assert.match(sql, /values \(\s*true,\s*false,/i);
});

test("Sign SHIPPED trigger rollback is additive and exact", async () => {
  const sql = await readFile(rollbackPath, "utf8");
  assert.match(sql, /drop table if exists public[.]arrival_label_trello_trigger_settings/i);
  assert.doesNotMatch(sql, /arrival_label_cases/i);
});

test("Sign Arrived remains delivery- and Outlook-archive-gated", async () => {
  const sql = await readFile(arrivalFinalizerPath, "utf8");
  assert.match(sql, /outlook_delivery_state = 'delivered_today'/i);
  assert.match(sql, /cardinality\(c[.]outlook_message_ids\) > 0/i);
  assert.match(sql, /source_message_id_sha256[\s\S]+status = 'archived'/i);
  assert.match(sql, /document_kind = 'label'[\s\S]+status = 'printed'/i);
});
