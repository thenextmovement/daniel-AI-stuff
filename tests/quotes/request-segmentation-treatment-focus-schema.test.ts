import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root,
  "supabase/migrations/20260820190414_prepare_request_segmentation_treatment_focus_evaluation.sql"), "utf8");
const held = readFileSync(resolve(root,
  "supabase/rollouts/held/20260820193000_stage_request_segmentation_treatment_focus_gold.sql"), "utf8");
const preRuntimeRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260820190414_prepare_request_segmentation_treatment_focus_evaluation_rollback.sql"), "utf8");
const operationalRollback = readFileSync(resolve(root,
  "supabase/rollbacks/20260820193000_request_segmentation_treatment_focus_operational_rollback.sql"), "utf8");
const snapshot = readFileSync(resolve(root,
  "supabase/security-backups/request-segmentation-treatment-focus-prechange-20260820.sql"), "utf8");

function functionBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} terminator missing`);
  return source.slice(start, end + "$function$;".length);
}

function viewBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create view public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf(`comment on view public.${name}`, start);
  assert.ok(end > start, `${name} comment missing`);
  return source.slice(start, end);
}

function withoutFunctionDefinitions(source: string) {
  return source.replace(
    /create(?:\s+or\s+replace)?\s+function\b[\s\S]*?\bas\s+(\$[a-z0-9_]*\$)[\s\S]*?\1\s*;/gi,
    "",
  );
}

function assertBalancedSqlQuotes(source: string, label: string) {
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
  assert.equal(singleQuoted, false, `${label} unclosed quote`);
  assert.equal(blockComment, false, `${label} unclosed comment`);
  assert.equal(dollarTag, null, `${label} unclosed dollar quote`);
}

test("all treatment SQL artifacts are atomic and quote-balanced", () => {
  for (const [label, source] of [
    ["migration", migration], ["held", held], ["pre-runtime rollback", preRuntimeRollback],
    ["operational rollback", operationalRollback], ["snapshot", snapshot],
  ] as const) assertBalancedSqlQuotes(source, label);
  assert.match(migration, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(held, /^-- HOLD:[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(preRuntimeRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(operationalRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
});

test("base migration is additive and keeps v2 as the sole active contract", () => {
  const topLevel = withoutFunctionDefinitions(migration);
  assert.doesNotMatch(topLevel, /create\s+table|create\s+(?:unique\s+)?index|alter\s+table[\s\S]*?add\s+column/i);
  assert.doesNotMatch(topLevel, /insert\s+into\s+public\.request_segmentation_jobs/i);
  assert.doesNotMatch(topLevel, /update\s+public\.master_requests/i);
  assert.match(migration, /Phase-2 policy\/gate remain the sole active contract/i);
  assert.match(migration, /'nt_quality_gate_v5_20260820_treatment_focus'[\s\S]*?'segment_classifier_v6_20260820_treatment_focus'[\s\S]*?false/i);
  assert.match(migration, /'nt_policy_v5_20260820_treatment_focus_shadow',[\s\S]*?false,[\s\S]*?'shadow'/i);
});

test("one exact guard pins v2 plus an inactive eight-rule treatment lane", () => {
  const guard = functionBodyFrom(migration, "neontrip_treatment_evaluation_contract_is_exact");
  assert.match(guard, /segment_policy_versions where active\) = 1/i);
  assert.match(guard, /segment_quality_gate_versions where active\) = 1/i);
  assert.match(guard, /nt_policy_v2_20260819_cx8_shadow[\s\S]*?nt_quality_gate_v2_20260819_cx8[\s\S]*?q\.active/i);
  assert.match(guard, /nt_policy_v5_20260820_treatment_focus_shadow[\s\S]*?nt_quality_gate_v5_20260820_treatment_focus[\s\S]*?not q\.active/i);
  assert.match(guard, /select count\(\*\) = 8[\s\S]*?nt_policy_v5_20260820_treatment_focus_shadow/i);
  assert.match(guard, /automation_enabled[\s\S]*?price_factor is not null[\s\S]*?call_sequence <> '\[\]'::jsonb/i);
});

test("claim and payload are current-Gold-only, service-role-only, and identifier-free", () => {
  const claim = functionBodyFrom(migration, "neontrip_claim_request_segmentation_treatment_evaluation");
  const payload = functionBodyFrom(migration, "neontrip_get_request_segmentation_treatment_evaluation_payload");
  assert.match(claim, /p_limit is distinct from 1[\s\S]*?treatment_evaluation_claim_limit_must_equal_1/i);
  assert.match(claim, /source = 'gold_re_evaluation_phase7_treatment'/i);
  assert.match(claim, /j\.attempts < j\.max_attempts/i);
  assert.match(claim, /gold_labeling_v2_20260819_cx8/i);
  assert.match(migration, /revoke all on function public\.neontrip_claim_request_segmentation_treatment_evaluation[\s\S]*?grant execute[\s\S]*?to service_role/i);
  const minimized = payload.slice(payload.indexOf("minimized_input as ("), payload.indexOf("definitions as ("));
  for (const key of ["title", "description", "application", "country", "company", "email_domain", "domain_facts"]) {
    assert.match(minimized, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(minimized, /'job_id'|'request_id'|'input_hash'|'email'|'phone'|'gold'|'price'|'cache'/i);
});

test("research planner allows only an exact non-freemail business domain", () => {
  const planner = functionBodyFrom(migration, "neontrip_treatment_evaluation_research_context");
  assert.match(planner, /domain_lookup_allowed as external_research_required/i);
  assert.match(planner, /site:[\s\S]*?Unternehmen Leistungen Kundenprojekte Standorte Impressum/i);
  assert.match(planner, /'company_lookup_allowed', false/i);
  assert.doesNotMatch(planner, /when ep\.company_lookup_allowed then concat/i);
  assert.match(planner, /not coalesce\(\(s\.domain_facts->>'is_freemail'\)/i);
  assert.match(planner, /not coalesce\(\(s\.domain_facts->>'is_shared_provider'\)/i);
});

test("20-argument record overload leaves 18/19-argument functions intact", () => {
  const record = functionBodyFrom(migration, "neontrip_record_request_segment_classification");
  assert.match(record, /p_research_contract text,\s*p_treatment_contract text/i);
  assert.match(record, /p_treatment_contract = 'treatment_focus_v1_20260820_standard_vs_special'/i);
  assert.match(record, /p_accepted_by = 'n8n-request-segmenter-v6'/i);
  assert.match(migration, /20-argument overload keeps the existing 18-argument production and[\s\S]*?19-argument Phase-6/i);
  assert.match(migration, /to_regprocedure\('public\.neontrip_record_request_segment_classification\(uuid,uuid,text,text,text,numeric,text,text,text\[\],jsonb,jsonb,jsonb,text\[\],text,text,text,text,text,text,text\)'\) is null/i);
  assert.match(migration, /to_regprocedure\('public\.neontrip_record_request_segment_classification\(uuid,uuid,text,text,text,numeric,text,text,text\[\],jsonb,jsonb,jsonb,text\[\],text,text,text,text,text,text\)'\) is null/i);
  assert.match(migration, /to_regprocedure\('public\.neontrip_record_request_segment_classification\(uuid,uuid,text,text,text,numeric,text,text,text\[\],jsonb,jsonb,jsonb,text\[\],text,text,text,text,text\)'\) is null/i);
});

test("standard request evidence is accepted without research while special remains web-bound", () => {
  const record = functionBodyFrom(migration, "neontrip_record_request_segment_classification");
  assert.match(record, /evidence\.value->>'type' in \('request', 'customer_declared'\)[\s\S]*?v_standard_request_evidence_valid/i);
  assert.match(record, /when v_special_handling_required then v_external_positive_evidence_bound[\s\S]*?else v_standard_request_evidence_valid or v_external_positive_evidence_bound/i);
  assert.match(record, /p_segment in \('NT-10', 'NT-5', 'NT-6'\)[\s\S]*?v_organization_scale in \('large', 'enterprise'\)/i);
  assert.match(record, /p_status = 'accepted' and v_special_handling_required and not v_research_performed/i);
  assert.match(record, /v_verified_source_count = 0[\s\S]*?v_verified_source_shape_valid\s*\n\s*end;/i);
  assert.doesNotMatch(record, /v_verified_source_shape_valid\s*\n\s*and cardinality\(v_positive_codes\) = 0\s*\n\s*end;/i);
});

test("treatment metadata and boolean types are deterministic and fail closed", () => {
  const record = functionBodyFrom(migration, "neontrip_record_request_segment_classification");
  for (const field of ["special_handling_required", "external_evidence_required", "standard_request_evidence_valid"]) {
    assert.match(record, new RegExp(`jsonb_typeof\\(v_classifier_json->'${field}'\\) = 'boolean'`));
  }
  assert.match(record, /v_classifier_json->>'treatment_tier' = v_expected_treatment_tier/i);
  assert.match(record, /p_status = 'accepted' and not v_treatment_metadata_valid[\s\S]*?taxonomy_contract_mismatch/i);
  assert.match(record, /'treatment_contract_valid', v_treatment_metadata_valid/i);
});

test("NT-9 request conflict and large-scale special evidence are aligned", () => {
  const record = functionBodyFrom(migration, "neontrip_record_request_segment_classification");
  assert.match(record, /v_nt9_higher_role_conflict := p_segment = 'NT-9'[\s\S]*?type' in \('web_search', 'request', 'customer_declared'\)/i);
  assert.match(record, /v_scale_evidence_valid := case[\s\S]*?v_organization_scale not in \('large', 'enterprise'\)[\s\S]*?used_for' = 'organization_scale'/i);
  assert.match(record, /v_nt9_higher_role_conflict[\s\S]*?array\['conflicting_evidence'\]/i);
});

test("diagnostic views make treatment the primary reported outcome and remain closed", () => {
  for (const view of ["gold_evaluation", "confusion_matrix", "segment_quality", "quality_summary", "mapping_integrity", "activation_gate_status", "activation_approval_status", "production_readiness"]) {
    assert.match(migration, new RegExp(`create view public\\.request_segmentation_v5_${view}\\s+with \\(security_invoker = true\\)`, "i"));
    assert.match(migration, new RegExp(`grant select on table public\\.request_segmentation_v5_${view} to service_role`, "i"));
  }
  const goldView = viewBodyFrom(migration, "request_segmentation_v5_gold_evaluation");
  assert.match(goldView, /actual_treatment_tier/i);
  assert.match(goldView, /accepted_treatment_tier/i);
  assert.match(goldView, /treatment_contract_integrity/i);
  assert.match(goldView, /treatment_evaluation_status/i);
  assert.match(migration, /correct_treatment_predictions[\s\S]*?wrong_treatment_predictions[\s\S]*?treatment_accuracy_on_accepted/i);
  assert.match(migration, /treatment_contract_violations = 0[\s\S]*?technical_quality_gate_passed/i);
  assert.match(migration, /false as followup_pricing_activation_allowed/i);
});

test("held stages exactly four immutable-current Gold jobs with no policy flip", () => {
  assert.match(held, /treatment_stage_requires_four_current_gold_and_pristine_lane/i);
  assert.match(held, /insert into public\.request_segmentation_jobs/i);
  assert.match(held, /'gold_re_evaluation_phase7_treatment'/i);
  assert.match(held, /'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special'/i);
  assert.match(held, /900,\s*0,\s*3,\s*now\(\)/i);
  assert.match(held, /v_inserted <> 4/i);
  assert.doesNotMatch(held, /set\s+active\s*=/i);
  assert.doesNotMatch(held, /update\s+public\.master_requests/i);
});

test("rollback targets only the new 20-argument surface and preserves history", () => {
  assert.match(preRuntimeRollback, /requires_zero_candidate_runtime/i);
  assert.match(preRuntimeRollback, /drop function public\.neontrip_record_request_segment_classification\([\s\S]*?text, text, text\s*\);/i);
  assert.match(operationalRollback, /treatment_operational_stop_requires_zero_processing_jobs/i);
  assert.match(operationalRollback, /revoke execute on function public\.neontrip_record_request_segment_classification\([\s\S]*?text, text, text\s*\)/i);
  assert.doesNotMatch(operationalRollback, /delete\s+from\s+public\.(?:request_segmentation_jobs|request_segment_classifications|request_segmentation_gold_adjudications)/i);
  assert.match(snapshot, /existing_record_18_argument_overload/i);
  assert.match(snapshot, /existing_record_19_argument_overload/i);
  assert.match(snapshot, /treatment_record_20_argument_overload/i);
  assert.match(snapshot, /master_authority_hash/i);
});

test("no treatment evaluation surface can authorize cache, projection, or customer actions", () => {
  const record = functionBodyFrom(migration, "neontrip_record_request_segment_classification");
  assert.match(record, /'evaluation_only', true/i);
  assert.match(record, /'master_projection_authorized', false/i);
  assert.match(record, /'research_cache_written', false/i);
  assert.match(record, /'cache_write_authorized', false/i);
  assert.doesNotMatch(record, /insert\s+into\s+public\.segment_research_cache/i);
  assert.doesNotMatch(record, /update\s+public\.master_requests/i);
  assert.doesNotMatch(record, /trello|followup|pricing|email_sequence|call_sequence/i);
});
