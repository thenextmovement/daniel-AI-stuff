import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260720184500_archive_dhl_outlook_after_label_print.sql";
const pgcryptoFixMigrationPath = "supabase/migrations/20260720205000_fix_arrival_outlook_archive_pgcrypto_search_path.sql";
const pgcryptoFixRollbackPath = "supabase/rollbacks/20260720205000_fix_arrival_outlook_archive_pgcrypto_search_path_rollback.sql";

test("Outlook archive schema is fail-closed, exact-message idempotent and print-gated", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /arrival_label_outlook_archive_settings[\s\S]+enabled boolean not null default false/i);
  assert.match(sql, /arrival_label_outlook_archive_jobs[\s\S]+source_message_id_sha256/i);
  assert.match(sql, /unique \(case_id, source_message_id_sha256\)/i);
  assert.match(sql, /new[.]document_kind = 'label'[\s\S]+new[.]status = 'printed'/i);
  assert.match(sql, /old[.]status is distinct from 'printed'/i);
  assert.match(sql, /j[.]printed_at >= s[.]enabled_after/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /Outlook move began but completion is unknown; do not automatically move again/i);
  assert.match(sql, /Outlook archive retry is safe only before move dispatch/i);
  assert.match(sql, /p_result in \('invalid_target', 'uncertain'\)[\s\S]+manual_review/i);
  assert.match(sql, /arrival_label_outlook_archive_settings enable row level security/i);
  assert.match(sql, /arrival_label_outlook_archive_jobs enable row level security/i);
  assert.doesNotMatch(sql, /grant .+ to anon|grant .+ to authenticated/i);
  assert.match(sql, /exception when others[\s\S]+raise warning/i);
});

test("Outlook archive rollback removes trigger, functions and tables in dependency order", async () => {
  const sql = await readFile("supabase/rollbacks/20260720184500_archive_dhl_outlook_after_label_print_rollback.sql", "utf8");
  assert.match(sql, /drop trigger if exists arrival_label_print_jobs_queue_outlook_archives/i);
  assert.ok(sql.indexOf("drop trigger") < sql.indexOf("drop function"));
  assert.ok(sql.indexOf("drop function") < sql.indexOf("drop table"));
  assert.ok(sql.indexOf("arrival_label_outlook_archive_jobs") < sql.lastIndexOf("arrival_label_outlook_archive_settings"));
});

test("Outlook archive runtime functions resolve pgcrypto from the managed extensions schema", async () => {
  const migration = await readFile(pgcryptoFixMigrationPath, "utf8");
  const rollback = await readFile(pgcryptoFixRollbackPath, "utf8");

  assert.match(migration, /arrival_labels_enqueue_outlook_archives_for_print\(uuid, timestamptz\)[\s\S]+search_path = public, extensions, pg_temp/i);
  assert.match(migration, /arrival_labels_claim_outlook_archive\(text, integer, timestamptz\)[\s\S]+search_path = public, extensions, pg_temp/i);
  assert.match(rollback, /arrival_labels_enqueue_outlook_archives_for_print\(uuid, timestamptz\)[\s\S]+search_path = public, pg_temp/i);
  assert.match(rollback, /arrival_labels_claim_outlook_archive\(text, integer, timestamptz\)[\s\S]+search_path = public, pg_temp/i);
  assert.doesNotMatch(rollback, /extensions/i);
});
