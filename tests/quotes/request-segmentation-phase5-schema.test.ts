import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const phase2Path = resolve(
  process.cwd(),
  "supabase/migrations/20260819183219_harden_request_segmentation_phase2_cx8.sql",
);
const phase5Path = resolve(
  process.cwd(),
  "supabase/migrations/20260820103040_prepare_request_segmentation_phase5_forced_research.sql",
);
const heldPath = resolve(
  process.cwd(),
  "supabase/rollouts/held/20260820104500_activate_request_segmentation_phase5_forced_research_shadow.sql",
);
const preRuntimeRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260820103040_prepare_request_segmentation_phase5_forced_research_rollback.sql",
);
const operationalRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260820104500_request_segmentation_phase5_operational_rollback.sql",
);
const snapshotPath = resolve(
  process.cwd(),
  "supabase/security-backups/request-segmentation-phase5-prechange-20260820.sql",
);

const phase2 = readFileSync(phase2Path, "utf8");
const phase5 = readFileSync(phase5Path, "utf8");
const held = readFileSync(heldPath, "utf8");
const preRuntimeRollback = readFileSync(preRuntimeRollbackPath, "utf8");
const operationalRollback = readFileSync(operationalRollbackPath, "utf8");
const snapshot = readFileSync(snapshotPath, "utf8");

function functionBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} body terminator missing`);
  return source.slice(start, end + "$function$;".length);
}

function withoutFunctionDefinitions(source: string) {
  return source.replace(
    /create(?:\s+or\s+replace)?\s+function\b[\s\S]*?\bas\s+(\$[a-z0-9_]*\$)[\s\S]*?\1\s*;/gi,
    "",
  );
}

test("Phase 5 base is atomic, inactive, and keeps taxonomy and prompt byte-identical", () => {
  const phase5TopLevel = withoutFunctionDefinitions(phase5);

  assert.match(phase5, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(
    phase5,
    /'nt_quality_gate_v3_20260820_cx8',[\s\S]*?'segment_classifier_v4_20260820_cx8',[\s\S]*?'segment_prompt_v4_20260819_cx8',[\s\S]*?false/i,
  );
  assert.match(
    phase5,
    /'nt_policy_v3_20260820_cx8_shadow',[\s\S]*?false,[\s\S]*?'shadow'[\s\S]*?'nt_taxonomy_v2_20260819_cx8'[\s\S]*?'segment_classifier_v4_20260820_cx8'[\s\S]*?'segment_prompt_v4_20260819_cx8'/i,
  );
  assert.doesNotMatch(phase5, /segment_prompt_v5|nt_taxonomy_v3/i);
  assert.doesNotMatch(phase5, /'gold_re_evaluation_phase5'/i);
  assert.doesNotMatch(
    phase5TopLevel,
    /update\s+public\.master_requests|delete\s+from\s+public\.request_segmentation_gold_adjudications/i,
  );
});

test("candidate policy copies exactly eight inert rules and global active counts remain singular", () => {
  assert.match(
    phase5,
    /insert into public\.segment_policy_rules[\s\S]*?'nt_policy_v3_20260820_cx8_shadow'[\s\S]*?null,[\s\S]*?0,[\s\S]*?null,[\s\S]*?'\[\]'::jsonb,[\s\S]*?'\[\]'::jsonb,[\s\S]*?false,[\s\S]*?false/i,
  );
  assert.match(phase5, /v_rule_count <> 8[\s\S]*?v_non_inert_rule_count <> 0/i);
  assert.match(phase5, /select count\(\*\) into v_global_active_policy_count[\s\S]*?where active/i);
  assert.match(phase5, /select count\(\*\) into v_global_active_quality_count[\s\S]*?where active/i);
  assert.match(phase5, /v_global_active_policy_count <> 1[\s\S]*?v_global_active_quality_count <> 1/i);
});

test("runtime Record admits only exact v3/v3-worker and v4/v4-worker pairs", () => {
  const record = functionBodyFrom(phase5, "neontrip_record_request_segment_classification");
  assert.match(
    record,
    /v_active_policy\.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'[\s\S]*?v_active_policy\.prompt_version = 'segment_prompt_v4_20260819_cx8'/i,
  );
  assert.match(
    record,
    /v_active_policy\.classifier_version = 'segment_classifier_v3_20260819_cx8'[\s\S]*?p_accepted_by = 'n8n-request-segmenter-v3'/i,
  );
  assert.match(
    record,
    /v_active_policy\.classifier_version = 'segment_classifier_v4_20260820_cx8'[\s\S]*?p_accepted_by = 'n8n-request-segmenter-v4'/i,
  );
  assert.match(record, /case when v_effective_status = 'accepted'\s+then p_accepted_by\s+else null end/i);
  assert.match(record, /v_evaluation_only or not v_master_projection_authorized[\s\S]*?'evaluation_only_no_projection'/i);
});

test("cache remains exact-contract and provenance fail-closed for the candidate", () => {
  const cache = functionBodyFrom(
    phase5,
    "neontrip_upsert_segment_research_cache_from_classification",
  );
  assert.match(
    cache,
    /p_classifier_version = 'segment_classifier_v3_20260819_cx8'[\s\S]*?v_classifier_version_json = 'segment_classifier_v3_20260819_cx8'[\s\S]*?v_prompt_version = 'segment_prompt_v4_20260819_cx8'/i,
  );
  assert.match(
    cache,
    /p_classifier_version = 'segment_classifier_v4_20260820_cx8'[\s\S]*?v_classifier_version_json = 'segment_classifier_v4_20260820_cx8'[\s\S]*?v_prompt_version = 'segment_prompt_v4_20260819_cx8'/i,
  );
  assert.match(cache, /v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'/i);
  assert.match(cache, /p_policy_mode in \('followup_live', 'pricing_live'\)/i);
});

test("Gold and review resolve only the allowlisted active gate without restoring customer-type vetoes", () => {
  const resolver = functionBodyFrom(
    phase5,
    "neontrip_get_request_segmentation_gold_target_contract",
  );
  const gold = functionBodyFrom(phase5, "neontrip_adjudicate_request_segmentation_gold");
  const review = functionBodyFrom(phase5, "neontrip_get_request_segmentation_review_context");

  assert.match(resolver, /p\.active[\s\S]*?q\.active[\s\S]*?p\.mode = 'shadow'/i);
  assert.match(resolver, /nt_policy_v2_20260819_cx8_shadow[\s\S]*?nt_quality_gate_v2_20260819_cx8/i);
  assert.match(resolver, /nt_policy_v3_20260820_cx8_shadow[\s\S]*?nt_quality_gate_v3_20260820_cx8/i);
  assert.match(gold, /v_labeling_version constant text := 'gold_labeling_v2_20260819_cx8'/i);
  assert.match(gold, /from public\.neontrip_get_request_segmentation_gold_target_contract\(\)/i);
  assert.match(gold, /v_target_contract\.classifier_version[\s\S]*?v_target_contract\.prompt_version/i);
  assert.doesNotMatch(
    gold,
    /\bv_customer_type\b|gold_private_first_party_evidence_required|gold_direct_business_first_party_evidence_required/i,
  );
  assert.match(
    phase5,
    /create or replace function public\.neontrip_get_request_segmentation_review_context\(p_request_id uuid\)/i,
  );
  assert.match(review, /from public\.neontrip_get_request_segmentation_gold_target_contract\(\)/i);
});

test("candidate quality views are additive and exact-version joined", () => {
  for (const view of [
    "gold_evaluation",
    "confusion_matrix",
    "segment_quality",
    "quality_summary",
    "mapping_integrity",
    "activation_gate_status",
    "activation_approval_status",
    "production_readiness",
  ]) {
    assert.match(
      phase5,
      new RegExp(`create view public\\.request_segmentation_v3_${view}\\s+with \\(security_invoker = true\\)`, "i"),
    );
    assert.match(
      phase5,
      new RegExp(`grant select on table public\\.request_segmentation_v3_${view} to service_role`, "i"),
    );
  }
  assert.doesNotMatch(phase5, /drop view public\.request_segmentation_v2_/i);
  assert.match(
    phase5,
    /c\.request_id = g\.request_id[\s\S]*?c\.input_hash = g\.input_hash[\s\S]*?c\.taxonomy_version = g\.taxonomy_version[\s\S]*?c\.classifier_version = tc\.classifier_version[\s\S]*?c\.prompt_version = tc\.prompt_version/i,
  );
  assert.match(phase5, /select distinct on \(g\.request_id\)[\s\S]*?gold_labeling_v2_20260819_cx8/i);
});

test("existing uniqueness gives one separate job and classification per semantic tuple", () => {
  assert.match(
    phase2,
    /request_segmentation_jobs_versioned_input_uidx[\s\S]*?request_id, input_hash, taxonomy_version, classifier_version, prompt_version/i,
  );
  assert.match(
    phase2,
    /request_segment_classifications_versioned_input_uidx[\s\S]*?request_id, input_hash, taxonomy_version, classifier_version, prompt_version/i,
  );
  const evaluation = functionBodyFrom(
    phase2,
    "neontrip_enqueue_request_segmentation_evaluation",
  );
  assert.match(evaluation, /evaluation_contract_not_configured/i);
  assert.match(evaluation, /'evaluation_only', true[\s\S]*?'master_projection_authorized', false/i);
  assert.match(
    evaluation,
    /on conflict \([\s\S]*?request_id, input_hash, taxonomy_version, classifier_version, prompt_version[\s\S]*?\)/i,
  );
});

test("held cutover stages exactly four current Gold inputs and atomically flips one global active contract", () => {
  assert.match(held, /^-- HOLD:[\s\S]*?deliberately outside migrations[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(
    held,
    /lock table public\.segment_quality_gate_versions[\s\S]*?lock table public\.segment_policy_versions in access exclusive mode[\s\S]*?lock table public\.request_segmentation_jobs/i,
  );
  assert.match(held, /phase5_activation_requires_pristine_candidate_lane/i);
  assert.match(held, /phase5_activation_requires_exact_four_current_pilot_gold/i);
  assert.match(held, /v_staged_count <> 4/i);
  assert.match(held, /'gold_re_evaluation_phase5'/i);
  assert.match(held, /'evaluation_only', 'false'[\s\S]*?master_projection_authorized/i);
  assert.match(held, /v_global_active_policy_count <> 1[\s\S]*?v_global_active_quality_count <> 1/i);
  assert.match(
    held,
    /set active = false[\s\S]*?nt_policy_v2_20260819_cx8_shadow[\s\S]*?set active = true[\s\S]*?nt_policy_v3_20260820_cx8_shadow/i,
  );
});

test("rollback paths preserve runtime history and restore the current human-Gold body", () => {
  assert.match(preRuntimeRollback, /^-- NEONTRIP Phase-5 exact pre-runtime rollback[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(preRuntimeRollback, /phase5_base_rollback_requires_zero_candidate_runtime_rows/i);
  assert.match(
    preRuntimeRollback,
    /create or replace function public\.neontrip_get_request_segmentation_review_context\(p_request_id uuid\)/i,
  );
  const restoredGold = functionBodyFrom(
    preRuntimeRollback,
    "neontrip_adjudicate_request_segmentation_gold",
  );
  assert.doesNotMatch(
    restoredGold,
    /\bv_customer_type\b|gold_private_first_party_evidence_required|gold_direct_business_first_party_evidence_required/i,
  );
  assert.match(operationalRollback, /preserves every candidate job,[\s\S]*?classification,[\s\S]*?immutable Gold/i);
  assert.doesNotMatch(
    operationalRollback,
    /delete\s+from\s+public\.(?:request_segmentation_jobs|request_segment_classifications|request_segmentation_gold_adjudications)/i,
  );
  assert.match(operationalRollback, /candidate_jobs_still_processing/i);
  assert.match(operationalRollback, /v_global_active_policy_count <> 1|all_active_policies/i);
});

test("snapshot is aggregate-only and records the zero candidate side-effect baseline", () => {
  assert.match(snapshot, /No request IDs, customer IDs, names, domains, email addresses/i);
  assert.match(snapshot, /candidate_runtime_rows/i);
  assert.match(snapshot, /master_authority_rows/i);
  assert.match(snapshot, /approval_rows/i);
  assert.match(snapshot, /md5\(pg_get_functiondef\(p\.oid\)\)/i);
  assert.doesNotMatch(snapshot, /select\s+[^;]*\b(?:email|first_name|last_name|company_name|evidence_urls|reasoning_short)\b/i);
});
