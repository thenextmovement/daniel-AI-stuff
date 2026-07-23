import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260723103508_finalize_dhl_delivery_to_trello_sign_arrived.sql";
const rollbackPath = "supabase/rollbacks/20260723103508_finalize_dhl_delivery_to_trello_sign_arrived_rollback.sql";
const sqlBehaviorPath = "supabase/tests/arrival_label_trello_arrival.sql";

test("Trello arrival schema is print-gated, archive-gated, fail-closed and idempotent", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /arrival_label_trello_arrival_settings[\s\S]+enabled boolean not null default false/i);
  assert.match(sql, /arrival_label_trello_arrival_jobs[\s\S]+case_id uuid not null unique/i);
  assert.match(sql, /outlook_delivery_state = 'delivered_today'/i);
  assert.match(sql, /document_kind = 'label'[\s\S]+status = 'printed'/i);
  assert.match(sql, /source_message_id_sha256[\s\S]+status = 'archived'/i);
  assert.match(sql, /archived_at >= s[.]enabled_after/i);
  assert.match(sql, /cardinality\(c[.]outlook_message_ids\) > 0/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /Trello move began but completion is unknown; do not automatically move again/i);
  assert.match(sql, /Trello arrival retry is safe only before move dispatch/i);
  assert.match(sql, /p_result in \('invalid_target', 'uncertain'\)[\s\S]+manual_review/i);
  assert.match(sql, /arrival_label_trello_arrival_settings enable row level security/i);
  assert.match(sql, /arrival_label_trello_arrival_jobs enable row level security/i);
  assert.match(sql, /revoke all on table public[.]arrival_label_trello_arrival_settings from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public[.]arrival_label_trello_arrival_jobs to service_role/i);
  assert.match(sql, /array_agg\(distinct message_id order by message_id\)/i);
  assert.match(sql, /old[.]outlook_delivery_state = 'delivered_today'[\s\S]+new[.]outlook_delivery_state := 'delivered_today'/i);
});

test("Trello arrival rollback removes its trigger, functions and tables before restoring the previous merge behavior", async () => {
  const sql = await readFile(rollbackPath, "utf8");
  assert.match(sql, /drop trigger if exists arrival_label_outlook_archives_queue_trello_arrival/i);
  assert.ok(sql.indexOf("drop trigger") < sql.indexOf("drop function"));
  assert.ok(sql.indexOf("drop function") < sql.indexOf("drop table"));
  assert.match(sql, /create or replace function public[.]arrival_labels_preserve_case_progress/i);
  assert.doesNotMatch(sql, /array_agg\(distinct message_id/i);
});

test("Trello arrival SQL behavior suite covers late mail merge, archive gate, claim and exact receipt replay", async () => {
  const sql = await readFile(sqlBehaviorPath, "utf8");
  assert.match(sql, /due-today mail incorrectly queued/i);
  assert.match(sql, /late delivered mail was not merged monotonically/i);
  assert.match(sql, /before every exact Outlook mail was archived/i);
  assert.match(sql, /arrival_labels_claim_trello_arrival/i);
  assert.match(sql, /'dispatching'/i);
  assert.match(sql, /'moved'/i);
  assert.match(sql, /identical receipt replay/i);
  assert.match(sql, /has_function_privilege\('anon'/i);
  assert.match(sql, /rollback;/i);
});
