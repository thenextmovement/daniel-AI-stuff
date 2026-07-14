import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260714083929_enable_email_support_knowledge.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260714083929_enable_email_support_knowledge_rollback.sql",
  "utf8",
);
const searchMigration = readFileSync(
  "supabase/migrations/20260714084703_improve_email_support_knowledge_search.sql",
  "utf8",
);

test("email support knowledge is approved, bounded and private", () => {
  assert.match(migration, /'email_drafting'/);
  assert.match(migration, /version\.status = 'approved'/);
  assert.match(migration, /version\.risk_class <> 'restricted'/);
  assert.match(migration, /version\.valid_from is null or version\.valid_from <= now\(\)/);
  assert.match(migration, /version\.valid_until is null or version\.valid_until > now\(\)/);
  assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 6\), 1\), 8\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.search_approved_support_knowledge\(text, integer\)/);
  assert.match(migration, /grant execute on function public\.search_approved_support_knowledge\(text, integer\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,120}to (anon|authenticated)/i);
});

test("starter knowledge excludes conflicting commitment claims", () => {
  assert.match(migration, /keine unbestätigten Preise, Rabatte, Liefertermine/);
  assert.match(migration, /konkrete aktuelle Angebot oder die Bestellung maßgeblich/);
  assert.doesNotMatch(migration, /12-monatigen Herstellergarantie|24 Monate Garantie|5–7 Werktage|Express in 3 Tagen/);
});

test("knowledge usage is auditable and rollback disables email mode", () => {
  assert.match(migration, /knowledge_version_ids uuid\[\]/);
  assert.match(migration, /knowledge_match_count integer/);
  assert.match(rollback, /drop function if exists public\.search_approved_support_knowledge/);
  assert.match(rollback, /array_remove\(allowed_modes, 'email_drafting'\)/);
  assert.match(rollback, /then 'retired'/);
});

test("natural language retrieval uses bounded sanitized OR terms", () => {
  assert.match(searchMigration, /lower\(left\(trim\(coalesce\(p_query, ''\)\), 240\)\)/);
  assert.match(searchMigration, /\[\^\[:alnum:\]äöüß\]\+/);
  assert.match(searchMigration, /where char_length\(token\) >= 3/);
  assert.match(searchMigration, /limit 24/);
  assert.match(searchMigration, /string_agg\(token, ' OR '/);
  assert.match(searchMigration, /numnode\(search_query\.ts_query\) > 0/);
  assert.match(searchMigration, /limit least\(greatest\(coalesce\(p_limit, 6\), 1\), 8\)/);
});
