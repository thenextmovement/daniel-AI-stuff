import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260820121334_prepare_request_segmentation_phase6_privacy_safe_research.sql",
);
const heldPath = resolve(
  process.cwd(),
  "supabase/rollouts/held/20260820123000_stage_request_segmentation_phase6_privacy_safe_gold.sql",
);
const preRuntimeRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260820121334_prepare_request_segmentation_phase6_privacy_safe_research_rollback.sql",
);
const operationalRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260820123000_request_segmentation_phase6_operational_rollback.sql",
);
const snapshotPath = resolve(
  process.cwd(),
  "supabase/security-backups/request-segmentation-phase6-prechange-20260820.sql",
);
const documentationPath = resolve(
  process.cwd(),
  "docs/projects/customer-records-ops/request-segmentation.md",
);

const migration = readFileSync(migrationPath, "utf8");
const held = readFileSync(heldPath, "utf8");
const preRuntimeRollback = readFileSync(preRuntimeRollbackPath, "utf8");
const operationalRollback = readFileSync(operationalRollbackPath, "utf8");
const snapshot = readFileSync(snapshotPath, "utf8");
const documentation = readFileSync(documentationPath, "utf8");

function functionBodyFrom(source: string, name: string) {
  const start = source.search(
    new RegExp(`create(?: or replace)? function public\\.${name}\\b`, "i"),
  );
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} body terminator missing`);
  return source.slice(start, end + "$function$;".length);
}

function viewBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create view public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf(`comment on view public.${name}`, start);
  assert.ok(end > start, `${name} comment terminator missing`);
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
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
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
      if (current === "'" && next === "'") {
        index += 1;
      } else if (current === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'") {
      singleQuoted = true;
      continue;
    }
    if (current === "$") {
      const match = source.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
      }
    }
  }

  assert.equal(singleQuoted, false, `${label} has an unclosed single quote`);
  assert.equal(blockComment, false, `${label} has an unclosed block comment`);
  assert.equal(dollarTag, null, `${label} has an unclosed dollar quote`);
}

test("all Phase-6 SQL artifacts have balanced quoted bodies and atomic boundaries", () => {
  for (const [label, source] of [
    ["migration", migration],
    ["held", held],
    ["pre-runtime rollback", preRuntimeRollback],
    ["operational rollback", operationalRollback],
    ["snapshot", snapshot],
  ] as const) {
    assertBalancedSqlQuotes(source, label);
  }

  assert.match(migration, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(held, /^-- HOLD:[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(preRuntimeRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(operationalRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
});

test("base migration is additive DB-only and leaves v2 solely active", () => {
  const topLevel = withoutFunctionDefinitions(migration);

  assert.doesNotMatch(topLevel, /create\s+table|create\s+(?:unique\s+)?index|alter\s+table[\s\S]*?add\s+column/i);
  assert.doesNotMatch(topLevel, /insert\s+into\s+public\.request_segmentation_jobs/i);
  assert.doesNotMatch(topLevel, /update\s+public\.master_requests|delete\s+from\s+public\.request_segmentation_gold_adjudications/i);
  assert.match(migration, /Phase-2 policy\/gate remain the sole active contract/i);
  assert.match(
    migration,
    /'nt_quality_gate_v4_20260820_cx8'[\s\S]*?'segment_classifier_v5_20260820_cx8'[\s\S]*?'segment_prompt_v5_20260820_cx8'[\s\S]*?false/i,
  );
  assert.match(
    migration,
    /'nt_policy_v4_20260820_cx8_shadow',[\s\S]*?false,[\s\S]*?'shadow'/i,
  );
});

test("base migration locks the semantic cut and proves four pristine candidate stores", () => {
  const expectedLockOrder = [
    "segment_taxonomy_versions in share row exclusive mode",
    "segment_taxonomy_definitions in share row exclusive mode",
    "segment_quality_gate_versions in share row exclusive mode",
    "segment_policy_versions in share row exclusive mode",
    "segment_policy_rules in share row exclusive mode",
    "request_segmentation_jobs in share mode",
    "request_segment_classifications in share mode",
    "segment_research_cache in share mode",
    "request_segmentation_activation_approvals in share mode",
  ];
  let previousIndex = -1;
  for (const lock of expectedLockOrder) {
    const currentIndex = migration.indexOf(`lock table public.${lock};`);
    assert.ok(currentIndex > previousIndex, `missing or out-of-order lock: ${lock}`);
    previousIndex = currentIndex;
  }

  const preconditionStart = migration.indexOf("do $phase6_base_precondition$");
  const preconditionEnd = migration.indexOf("$phase6_base_precondition$;", preconditionStart);
  const postconditionStart = migration.indexOf("do $phase6_base_postcondition$");
  const postconditionEnd = migration.indexOf("$phase6_base_postcondition$;", postconditionStart);
  const precondition = migration.slice(preconditionStart, preconditionEnd);
  const postcondition = migration.slice(postconditionStart, postconditionEnd);

  for (const body of [precondition, postcondition]) {
    assert.match(body, /v_candidate_job_count\s*<>\s*0/i);
    assert.match(body, /v_candidate_classification_count\s*<>\s*0/i);
    assert.match(body, /v_candidate_cache_count\s*<>\s*0/i);
    assert.match(body, /v_candidate_approval_count\s*<>\s*0/i);
  }
  assert.match(precondition, /phase6_base_requires_pristine_candidate_runtime/i);
});

test("one exact guard pins both gate configurations, eight inert mappings, and taxonomy evidence", () => {
  const guard = functionBodyFrom(migration, "neontrip_phase6_evaluation_contract_is_exact");

  assert.match(guard, /segment_policy_versions where active\) = 1/i);
  assert.match(guard, /segment_quality_gate_versions where active\) = 1/i);
  assert.match(guard, /nt_policy_v2_20260819_cx8_shadow[\s\S]*?nt_quality_gate_v2_20260819_cx8[\s\S]*?q\.active/i);
  assert.match(guard, /nt_policy_v4_20260820_cx8_shadow[\s\S]*?nt_quality_gate_v4_20260820_cx8[\s\S]*?not q\.active/i);
  for (const threshold of [
    "q.min_unique_gold_total = 300",
    "q.min_gold_per_segment = 25",
    "q.min_precision_per_predicted_class = 0.90",
    "q.min_recall_per_actual_class = 0.85",
    "q.min_accepted_coverage = 0.80",
    "q.min_critical_precision = 0.95",
    "q.required_mapping_integrity = 1.0",
    "q.max_provenance_violations = 0",
  ]) {
    assert.ok(guard.includes(threshold), `missing exact threshold ${threshold}`);
  }
  assert.match(guard, /select count\(\*\) = 8[\s\S]*?nt_policy_v2_20260819_cx8_shadow/i);
  assert.match(guard, /select count\(\*\) = 8[\s\S]*?nt_policy_v4_20260820_cx8_shadow/i);
  assert.match(guard, /"NT-10": \["S4", 0\.85, 50\]/i);
  assert.match(guard, /"NT-9": \["S3", 0\.82, 50\]/i);
  assert.match(guard, /"NT-9": \["S3", 0\.82, 30, "verified_direct_business"\]/i);
  assert.match(guard, /automation_enabled[\s\S]*?price_factor is not null[\s\S]*?call_sequence <> '\[\]'::jsonb/i);
});

test("claim is service-role-only, current-Gold-bound, attempt-bounded, and exact-v5", () => {
  const claim = functionBodyFrom(
    migration,
    "neontrip_claim_request_segmentation_phase6_evaluation",
  );

  assert.match(claim, /if not public\.neontrip_phase6_evaluation_contract_is_exact\(\)/i);
  assert.match(claim, /p_limit integer default 1/i);
  assert.match(claim, /p_limit is distinct from 1[\s\S]*?phase6_evaluation_claim_limit_must_equal_1/i);
  assert.match(claim, /j\.attempts < j\.max_attempts/i);
  assert.match(claim, /gold_labeling_v2_20260819_cx8/i);
  assert.match(claim, /neontrip_compute_request_segment_input_hash\(j\.request_id\) = j\.input_hash/i);
  assert.match(claim, /source = 'gold_re_evaluation_phase6'/i);
  assert.match(claim, /classifier_version = 'segment_classifier_v5_20260820_cx8'/i);
  assert.match(migration, /revoke all on function public\.neontrip_claim_request_segmentation_phase6_evaluation[\s\S]*?grant execute[\s\S]*?to service_role/i);
});

test("payload exposes only the exact minimized ten-key input and no lineage IDs", () => {
  const payload = functionBodyFrom(
    migration,
    "neontrip_get_request_segmentation_phase6_evaluation_payload",
  );
  const minimizedStart = payload.indexOf("minimized_input as (");
  const minimizedEnd = payload.indexOf("definitions as (", minimizedStart);
  assert.ok(minimizedStart >= 0 && minimizedEnd > minimizedStart);
  const minimized = payload.slice(minimizedStart, minimizedEnd);

  for (const key of [
    "title",
    "description",
    "declared_customer_type",
    "declared_customer_type_first_party_verified",
    "application",
    "country",
    "company",
    "company_lookup_allowed",
    "email_domain",
    "domain_facts",
  ]) {
    assert.match(minimized, new RegExp(`'${key}'`));
  }
  assert.match(minimized, /'declared_customer_type', 'unknown'/i);
  assert.match(minimized, /'declared_customer_type_first_party_verified', false/i);
  assert.doesNotMatch(minimized, /'job_id'|'request_id'|'input_hash'|'email'|'phone'|'name'|'gold'|'segment'|'price'|'cache'/i);
  assert.match(payload, /'lifecycle_status', tv\.lifecycle_status/i);
  assert.match(payload, /neontrip_phase6_evaluation_research_context\(j\.id\)/i);
  assert.match(payload, /gold_labeling_v2_20260819_cx8/i);
  assert.match(payload, /neontrip_lock_request_segmentation_input_hash\(j\.request_id\) = j\.input_hash/i);
});

test("company and domain lookup plan is deterministic and privacy-fail-closed", () => {
  const planner = functionBodyFrom(
    migration,
    "neontrip_phase6_evaluation_research_context",
  );

  assert.match(planner, /length\(rl\.raw_company\) not between 2 and 120/i);
  assert.match(planner, /cardinality\(regexp_split_to_array\(rl\.raw_company,[\s\S]*?not between 2 and 10/i);
  assert.match(planner, /length\(company_token\.token\) > 40/i);
  assert.match(planner, /length\(company_token\.token\) >= 24[\s\S]*?company_token\.token ~ '\[0-9_-\]'/i);
  assert.match(planner, /cs\.safe_company ~\* '[^']*gmbh[^']*services[^']*'[\s\S]*?as company_lookup_allowed/i);
  assert.match(planner, /'company', case when ep\.company_lookup_allowed then ep\.safe_company else null end/i);
  assert.match(planner, /email_domain_cache_allowed[\s\S]*?not coalesce\(\(s\.domain_facts->>'is_freemail'\)/i);
  assert.match(planner, /site:[\s\S]*?Unternehmen Leistungen Kundenprojekte Standorte Impressum/i);
  assert.match(planner, /offizielle Website Unternehmen Leistungen Kundenprojekte Standorte/i);
  assert.match(planner, /length\(concat\([\s\S]*?\)\) between 1 and 240/i);
  assert.doesNotMatch(planner, /consulting|Muster Consulting/i);
});

test("redactor statements terminate exactly once before the next assignment", () => {
  const redactor = functionBodyFrom(
    migration,
    "neontrip_phase6_redact_segmentation_text",
  );

  assert.match(
    redactor,
    /'\[EMAIL\]',\s*'gi'\s*\);\s*v_output := regexp_replace\(v_output, '\(https\?:\/\//i,
  );
  assert.doesNotMatch(redactor, /'\[EMAIL\]',\s*'gi'\s*\);\s*\);/i);
});

test("19-argument Record overload is bounded, cross-lane safe, and replay-safe", () => {
  const record = functionBodyFrom(
    migration,
    "neontrip_record_request_segment_classification",
  );

  assert.match(record, /p_research_contract text[\s\S]*?returns jsonb/i);
  assert.match(record, /p_status not in \('accepted', 'needs_review'\)/i);
  assert.match(record, /p_segment is not null and p_segment not in \([\s\S]*?'NT-9'[\s\S]*?\)/i);
  assert.doesNotMatch(record, /'NT-2'/i);
  assert.match(record, /phase6_evaluation_record_job_identity_mismatch/i);
  assert.match(record, /select \* into v_request[\s\S]*?for update[\s\S]*?master_customers[\s\S]*?for share[\s\S]*?select \* into v_job[\s\S]*?for update/i);
  assert.match(record, /phase6_evaluation_record_current_input_hash_mismatch/i);
  assert.match(record, /v_job\.status in \('completed', 'needs_review'\)[\s\S]*?idempotent_replay', true/i);
  assert.match(record, /classifier_json->>'proposed_segment' is not distinct from p_segment/i);
  assert.match(record, /classifier_json->>'submitted_confidence' is not distinct from p_confidence::text/i);
  assert.match(record, /pg_column_size\(v_classifier_json\) > 262144/i);
  assert.match(record, /jsonb_array_length\(coalesce\(p_evidence_json, '\[\]'::jsonb\)\) > 12/i);
  assert.match(record, /v_verified_source_count <= 20/i);
  assert.match(record, /length\(source\.value->>'url'\) between 10 and 2048/i);
  assert.match(record, /v_effective_risk_flags && array\[[\s\S]*?'prompt_injection_seen'[\s\S]*?'stale_input_hash'[\s\S]*?then[\s\S]*?v_effective_status := 'needs_review'/i);
});

test("provenance has exact 15/5-key shapes, exact query binding, and four 320-char refs", () => {
  const record = functionBodyFrom(
    migration,
    "neontrip_record_request_segment_classification",
  );

  assert.match(record, /select count\(\*\) = 15[\s\S]*?'research_query'[\s\S]*?'verified_sources'/i);
  assert.match(record, /select count\(\*\) = 5[\s\S]*?'source_ref'[\s\S]*?'research_response_ref'/i);
  assert.match(record, /v_research_query = v_expected_research_query/i);
  assert.match(record, /v_verified_source_count > 0/i);
  assert.match(record, /length\(v_research_response_id\) <= 320/i);
  assert.match(record, /length\(v_research_call_id\) <= 320/i);
  assert.match(record, /jsonb_typeof\(v_provenance->'research_response_id'\) = 'string'/i);
  assert.match(record, /jsonb_typeof\(v_provenance->'research_call_id'\) = 'string'/i);
  assert.match(record, /jsonb_typeof\(source\.value->'source_ref'\) = 'string'/i);
  assert.match(record, /jsonb_typeof\(source\.value->'research_response_ref'\) = 'string'/i);
  assert.match(record, /length\(source\.value->>'source_ref'\) <= 320/i);
  assert.match(record, /length\(source\.value->>'research_response_ref'\) <= 320/i);
  assert.match(record, /v_provenance_shape_valid[\s\S]*?and v_positive_codes_shape_valid[\s\S]*?and case[\s\S]*?when v_research_performed/i);
  assert.match(record, /research_performed' = 'false'::jsonb[\s\S]*?research_query' = 'null'::jsonb[\s\S]*?v_verified_source_count = 0/i);
  assert.match(record, /source_type' = 'web_search_call'/i);
  assert.doesNotMatch(record, /verified_db_cache/i);
});

test("numeric research refs fail closed before text coercion in Record and diagnostics", () => {
  const record = functionBodyFrom(
    migration,
    "neontrip_record_request_segment_classification",
  );
  const goldView = viewBodyFrom(migration, "request_segmentation_v4_gold_evaluation");

  for (const guard of [
    /jsonb_typeof\(v_provenance->'research_response_id'\) = 'string'[\s\S]*?length\(v_research_response_id\) <= 320/i,
    /jsonb_typeof\(v_provenance->'research_call_id'\) = 'string'[\s\S]*?length\(v_research_call_id\) <= 320/i,
    /jsonb_typeof\(source\.value->'source_ref'\) = 'string'[\s\S]*?length\(source\.value->>'source_ref'\) <= 320/i,
    /jsonb_typeof\(source\.value->'research_response_ref'\) = 'string'[\s\S]*?length\(source\.value->>'research_response_ref'\) <= 320/i,
  ]) {
    assert.match(record, guard);
  }
  assert.match(
    goldView,
    /jsonb_typeof\(source\.value->'source_ref'\) = 'string'[\s\S]*?length\(coalesce\(source\.value->>'source_ref', ''\)\) between 1 and 320/i,
  );
  assert.match(
    goldView,
    /jsonb_typeof\(source\.value->'research_response_ref'\) = 'string'[\s\S]*?length\(coalesce\(source\.value->>'research_response_ref', ''\)\) between 1 and 320/i,
  );
});

test("technical research integrity remains true-capable for a clean abstention", () => {
  const goldView = viewBodyFrom(migration, "request_segmentation_v4_gold_evaluation");
  const evidenceColumnReferences = goldView.match(/c\.evidence_provenance_valid/g) ?? [];

  assert.equal(
    evidenceColumnReferences.length,
    1,
    "evidence_provenance_valid may be selected but must not gate technical integrity",
  );
  assert.match(goldView, /jsonb_typeof\(c\.classifier_json->'evidence_provenance'->'valid'\) = 'boolean'/i);
  assert.doesNotMatch(goldView, /evidence_provenance'->'valid' = 'true'::jsonb/i);
  assert.match(goldView, /research_performed' = 'true'::jsonb[\s\S]*?expected_research_query[\s\S]*?\) > 0/i);
  assert.match(goldView, /research_performed' = 'false'::jsonb[\s\S]*?research_query' = 'null'::jsonb/i);
  assert.match(goldView, /length\(c\.classifier_json->'evidence_provenance'->>'research_response_id'\) between 1 and 320/i);
  assert.match(goldView, /length\(c\.classifier_json->'evidence_provenance'->>'research_call_id'\) between 1 and 320/i);
  assert.match(goldView, /jsonb_typeof\(source\.value->'source_ref'\) = 'string'/i);
  assert.match(goldView, /jsonb_typeof\(source\.value->'research_response_ref'\) = 'string'/i);
  assert.match(goldView, /source\.value->>'source_ref'[\s\S]*?source\.value->>'research_response_ref'/i);
  assert.match(goldView, /ep\.expected_research_query like 'site:%'[\s\S]*?ep\.email_domain/i);
});

test("NT-9 accepts only bound external direct-business evidence while NT-8 stays first-party-only", () => {
  const record = functionBodyFrom(
    migration,
    "neontrip_record_request_segment_classification",
  );

  assert.match(record, /p_segment in \('NT-1', 'NT-3', 'NT-4', 'NT-5', 'NT-6', 'NT-9'\) then 'segment_role'/i);
  assert.match(migration, /"NT-9": \["S3", 0\.82, 30, "verified_direct_business"\]/i);
  assert.match(record, /v_required_positive_code = any\(v_positive_codes\)[\s\S]*?cardinality\(v_positive_codes\) = 1/i);
  assert.match(record, /evidence\.value->>'type' = 'web_search'[\s\S]*?evidence\.value->>'used_for' = v_required_role_use/i);
  assert.match(record, /v_nt9_higher_role_conflict := p_segment = 'NT-9'[\s\S]*?'institution_status', 'segment_role', 'organization_scale'[\s\S]*?'verified_enterprise'/i);
  assert.match(record, /v_nt9_higher_role_conflict[\s\S]*?array\['conflicting_evidence'\]/i);
  assert.match(record, /when p_segment = 'NT-8' then v_private_declaration_evidence_valid/i);
  assert.match(record, /v_private_declaration_evidence_valid := v_first_party_customer_type_verified/i);
  assert.doesNotMatch(record, /business_declaration_evidence_valid|direct_business_first_party/i);
});

test("diagnostic views count all contract violations and keep activation fail-closed", () => {
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
      migration,
      new RegExp(`create view public\\.request_segmentation_v4_${view}\\s+with \\(security_invoker = true\\)`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`grant select on table public\\.request_segmentation_v4_${view} to service_role`, "i"),
    );
  }
  assert.match(migration, /classification_id is not null and not e\.model_contract_integrity[\s\S]*?as model_contract_violations/i);
  assert.match(migration, /classification_id is not null and not e\.research_contract_integrity[\s\S]*?as research_contract_violations/i);
  assert.match(migration, /s\.model_contract_violations = 0[\s\S]*?s\.research_contract_violations = 0[\s\S]*?technical_quality_gate_passed/i);
  assert.match(migration, /case when s\.model_contract_violations <> 0 then 'model_contract_violations_present'/i);
  assert.match(migration, /case when s\.research_contract_violations <> 0 then 'research_contract_violations_present'/i);

  const mappingView = viewBodyFrom(migration, "request_segmentation_v4_mapping_integrity");
  const mappingProjection = mappingView.slice(
    mappingView.lastIndexOf("select\n  tc.taxonomy_version"),
    mappingView.indexOf("from target_contract tc", mappingView.lastIndexOf("select\n  tc.taxonomy_version")),
  );
  assert.equal((mappingProjection.match(/tc\.classifier_version/g) ?? []).length, 1);
  assert.equal((mappingProjection.match(/tc\.prompt_version/g) ?? []).length, 1);
});

test("held staging inserts exactly four pristine Gold jobs without flipping or mutating", () => {
  assert.match(held, /phase6_stage_requires_four_current_gold_and_pristine_lane/i);
  assert.match(held, /insert into public\.request_segmentation_jobs/i);
  assert.match(held, /attempts, max_attempts, next_attempt_at/i);
  assert.match(held, /900,\s*0,\s*3,\s*now\(\)/i);
  assert.match(held, /v_inserted <> 4/i);
  assert.match(held, /j\.max_attempts <> 3/i);
  assert.match(held, /v_job_count <> 4[\s\S]*?v_invalid_job_count <> 0/i);
  assert.doesNotMatch(held, /update\s+public\.request_segmentation_jobs|delete\s+from\s+public\.request_segmentation_jobs/i);
  assert.doesNotMatch(held, /set\s+active\s*=/i);
  assert.match(held, /not public\.neontrip_phase6_evaluation_contract_is_exact\(\)/i);
});

test("rollback and snapshot preserve history and prove independent global state", () => {
  assert.match(preRuntimeRollback, /requires_zero_candidate_runtime/i);
  assert.match(preRuntimeRollback, /drop function public\.neontrip_record_request_segment_classification\([\s\S]*?text\s*\);/i);
  assert.doesNotMatch(preRuntimeRollback, /drop function public\.neontrip_record_request_segment_classification\([\s\S]*?p_accepted_by text\s*\)/i);
  assert.match(operationalRollback, /phase6_operational_stop_requires_zero_processing_jobs/i);
  assert.match(operationalRollback, /revoke execute on function public\.neontrip_claim_request_segmentation_phase6_evaluation/i);
  assert.doesNotMatch(operationalRollback, /delete\s+from\s+public\.(?:request_segmentation_jobs|request_segment_classifications|request_segmentation_gold_adjudications)/i);
  assert.match(snapshot, /select count\(\*\)::integer from public\.segment_policy_versions where active/i);
  assert.match(snapshot, /select count\(\*\)::integer from public\.segment_quality_gate_versions where active/i);
  assert.match(snapshot, /master_authority_hash/i);
  assert.match(snapshot, /phase6_activation_approvals/i);
  assert.doesNotMatch(snapshot, /select\s+[^;]*\b(?:email|first_name|last_name|company_name|reasoning_short)\b/i);
});

test("runbook freezes overload reload proof, pairing, Gold-2 conflict, and history rollback", () => {
  assert.match(documentation, /19-Argument-Overload[\s\S]*?p_research_contract[\s\S]*?18-Argument-Funktion/i);
  assert.match(documentation, /p_limit=1[\s\S]*?Vier-Item-Fixture/i);
  assert.match(documentation, /max_attempts=3/i);
  assert.match(documentation, /Goldfall 2 \(`NT-8`\) ist fachlich[\s\S]*?kein Privatbeleg/i);
  assert.match(documentation, /niemals als einfaches 4\/4-Gate/i);
  assert.match(documentation, /Re-Adjudikationsbedarf[\s\S]*?Gold-Aenderung/i);
  assert.match(documentation, /research_contract_integrity=true[\s\S]*?evidence_provenance_valid=false/i);
  assert.match(documentation, /NT-9[\s\S]*?verified_direct_business[\s\S]*?segment_role/i);
  assert.match(documentation, /loescht oder resettet keine Jobs,[\s\S]*?History-Hashes/i);
});
