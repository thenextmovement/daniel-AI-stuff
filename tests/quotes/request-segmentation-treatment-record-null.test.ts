import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const base = readFileSync(resolve(root,
  "supabase/migrations/20260820190414_prepare_request_segmentation_treatment_focus_evaluation.sql"), "utf8");
const repair = readFileSync(resolve(root,
  "supabase/migrations/20260820202053_fix_treatment_record_mapping_integrity_null.sql"), "utf8");
const rollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260820202053_fix_treatment_record_mapping_integrity_null_rollback.sql"), "utf8");

function assertBalancedSqlQuotes(source: string) {
  let singleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (singleQuoted) {
      if (current === "'" && next === "'") index += 1;
      else if (current === "'") singleQuoted = false;
      continue;
    }
    if (current === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (current === "'") { singleQuoted = true; continue; }
    if (current === "$") {
      const match = source.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) { dollarTag = match[0]; index += dollarTag.length - 1; }
    }
  }
  assert.equal(singleQuoted, false, "unclosed SQL quote");
  assert.equal(blockComment, false, "unclosed SQL comment");
  assert.equal(dollarTag, null, "unclosed SQL dollar quote");
}

test("treatment mapping-integrity repair is quote-balanced and pins one exact source", () => {
  assertBalancedSqlQuotes(repair);
  assertBalancedSqlQuotes(rollback);
  assert.match(repair, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(rollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(repair, /v_old_definition_md5 <> 'd044af0edef486594b5869bc5575163a'/i);
  assert.match(repair, /v_new_definition_md5 <> 'dd0202c8ed45e3568631f4ab02014961'/i);
  assert.match(repair, /length\(v_function_definition\)[\s\S]*?length\(v_old_fragment\) <> 1/i);
  assert.match(repair, /v_function_definition := replace\([\s\S]*?v_old_fragment,[\s\S]*?v_new_fragment/i);
});

test("rollback restores only the exact pre-fix 20-argument body", () => {
  assert.match(rollback, /md5\(v_function_definition\) <> 'dd0202c8ed45e3568631f4ab02014961'/i);
  assert.match(rollback, /md5\(pg_get_functiondef\(v_function_oid\)\) <> 'd044af0edef486594b5869bc5575163a'/i);
  assert.match(rollback, /execute replace\(v_function_definition, v_fixed_fragment, v_previous_fragment\)/i);
  assert.match(rollback, /known[\s\S]*NULL-on-needs-review defect/i);
  assert.doesNotMatch(rollback, /drop\s+function|alter\s+table|update\s+public\.master_requests/i);
});

test("only the treatment 20-argument overload is replaced", () => {
  assert.match(repair, /v_signature constant text :=[\s\S]*?text,text,text\)'/i);
  assert.match(repair, /v_overload_18_md5_before[\s\S]*?v_overload_19_md5_before/i);
  assert.match(repair, /neighbor_overload_missing/i);
  assert.match(repair, /is distinct from v_overload_18_md5_before/i);
  assert.match(repair, /is distinct from v_overload_19_md5_before/i);
  assert.equal((repair.match(/execute v_function_definition/gi) ?? []).length, 1);
  assert.doesNotMatch(repair, /drop\s+function|alter\s+table|update\s+public\.master_requests/i);
});

test("nullable SQL mapping result becomes deterministic false", () => {
  assert.match(base, /v_mapping_integrity :=\s*p_segment is not null[\s\S]*?v_classifier_json->>'s_kategorie' = v_policy_rule\.s_kategorie;/i);
  assert.match(repair, /v_mapping_integrity := coalesce\(\([\s\S]*?v_classifier_json->>'s_kategorie' = v_policy_rule\.s_kategorie\s*\), false\);/i);
  assert.match(base, /organization_scale, evidence_provenance_valid, mapping_integrity[\s\S]*?v_evidence_provenance_valid,\s*v_mapping_integrity/i);
});

test("repair is paused-lane-only and preserves the service-role ACL", () => {
  assert.match(repair, /nt_policy_v5_20260820_treatment_focus_shadow[\s\S]*?and active/i);
  assert.match(repair, /nt_quality_gate_v5_20260820_treatment_focus[\s\S]*?and active/i);
  assert.match(repair, /status = 'processing' or locked_at is not null or lock_owner is not null/i);
  assert.match(repair, /treatment_record_mapping_fix_runtime_not_paused/i);
  assert.match(repair, /not has_function_privilege\('service_role',[\s\S]*?'EXECUTE'\)/i);
  assert.match(repair, /has_function_privilege\('anon',[\s\S]*?'EXECUTE'\)/i);
  assert.match(repair, /has_function_privilege\('authenticated',[\s\S]*?'EXECUTE'\)/i);
});
