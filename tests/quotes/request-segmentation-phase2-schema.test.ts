import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mainPath = resolve(
  process.cwd(),
  "supabase/migrations/20260819183219_harden_request_segmentation_phase2_cx8.sql",
);
const activationPath = resolve(
  process.cwd(),
  "supabase/rollouts/held/20260819193419_activate_request_segmentation_phase2_cx8_shadow.sql",
);
const snapshotPath = resolve(
  process.cwd(),
  "supabase/security-backups/request-segmentation-phase2-prechange-20260819.sql",
);
const operationalRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260819193419_request_segmentation_phase2_operational_rollback.sql",
);
const fullRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260819183219_request_segmentation_phase2_full_pre_runtime_rollback.sql",
);
const humanGoldDisagreementPath = resolve(
  process.cwd(),
  "supabase/migrations/20260820093126_allow_human_gold_customer_type_disagreement.sql",
);
const humanGoldDisagreementRollbackPath = resolve(
  process.cwd(),
  "supabase/rollbacks/20260820093126_allow_human_gold_customer_type_disagreement_rollback.sql",
);

const main = readFileSync(mainPath, "utf8");
const activation = readFileSync(activationPath, "utf8");
const humanGoldDisagreement = readFileSync(humanGoldDisagreementPath, "utf8");
const humanGoldDisagreementRollback = readFileSync(humanGoldDisagreementRollbackPath, "utf8");

function functionBodyFrom(source: string, name: string) {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} body terminator missing`);
  return source.slice(start, end + "$function$;".length);
}

function functionBody(name: string) {
  return functionBodyFrom(main, name);
}

test("main migration is atomic and stages CX8 inactive", () => {
  assert.match(main, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(
    main,
    /'nt_policy_v2_20260819_cx8_shadow',\s+false,\s+'shadow'/i,
  );
  assert.doesNotMatch(main, /update public\.segment_policy_versions[\s\S]{0,300}version = 'nt_policy_v1_20260520_shadow'/i);
  assert.match(main, /automation_enabled, taxonomy_version[\s\S]*?false, 'nt_taxonomy_v2_20260819_cx8'/i);
});

test("CX8 has eight versioned definitions and deterministic evidence codes", () => {
  for (const [segment, code] of Object.entries({
    "NT-10": "verified_public_or_institutional_entity",
    "NT-1": "verified_physical_project_supplier",
    "NT-4": "verified_client_project_intermediary",
    "NT-3": "verified_event_or_media_operator",
    "NT-5": "verified_multisite_or_franchise",
    "NT-6": "verified_enterprise",
    "NT-8": "explicit_private_use",
    "NT-9": "verified_direct_business",
  })) {
    assert.match(main, new RegExp(`when '${segment}' then '${code}'`, "i"));
  }
  assert.match(main, /segment_taxonomy_definitions_evidence_code_uidx/i);
  assert.match(main, /required_evidence_code', td\.required_evidence_code/i);
  assert.match(main, /priority applies only after positive evidence|priority_applies_only_after_positive_evidence/i);
});

test("versioned uniqueness includes prompt and all version tuples are complete", () => {
  assert.match(
    main,
    /request_segmentation_jobs_versioned_input_uidx[\s\S]*?request_id, input_hash, taxonomy_version, classifier_version, prompt_version/i,
  );
  assert.match(
    main,
    /request_segment_classifications_versioned_input_uidx[\s\S]*?request_id, input_hash, taxonomy_version, classifier_version, prompt_version/i,
  );
  assert.match(main, /request_segmentation_jobs_contract_completeness_check[\s\S]*?num_nonnulls\(taxonomy_version, classifier_version, prompt_version\) = 0[\s\S]*?nullif\(btrim\(classifier_version\), ''\) is not null[\s\S]*?nullif\(btrim\(prompt_version\), ''\) is not null/i);
  assert.match(main, /segment_policy_versions_contract_completeness_check/i);
  assert.match(main, /request_segmentation_activation_approvals_contract_check/i);
});

test("claim RPC has one explicit optional three-version filter and fails partial filters", () => {
  const claim = functionBody("neontrip_claim_request_segmentation_jobs");
  assert.match(claim, /p_taxonomy_version text default null[\s\S]*?p_classifier_version text default null[\s\S]*?p_prompt_version text default null/i);
  assert.match(claim, /num_nonnulls\(p_taxonomy_version, p_classifier_version, p_prompt_version\) not in \(0, 3\)/i);
  assert.match(claim, /segmentation_claim_contract_filter_all_or_none/i);
  assert.match(claim, /p\.active[\s\S]*?j\.taxonomy_version = p_taxonomy_version[\s\S]*?j\.classifier_version = p_classifier_version[\s\S]*?j\.prompt_version = p_prompt_version/i);
});

test("payload remains Phase-1 compatible pre-flip and exposes the exact CX8 contract post-flip", () => {
  const payload = functionBody("neontrip_get_request_segmentation_payload");
  assert.match(payload, /when \(select taxonomy_version from active_policy\) is null then\s+\(select to_jsonb\(req\) from req\)/i);
  assert.match(payload, /else \([\s\S]*?- 'segment'[\s\S]*?- 'commercial_playbook'/i);
  assert.match(payload, /'taxonomy'[\s\S]*?'definitions'[\s\S]*?'tie_break_order'/i);
  assert.match(payload, /'quality_gate'[\s\S]*?'min_precision_per_predicted_class'[\s\S]*?'min_recall_per_actual_class'/i);
});

test("manual authority is dual-lane and CX8 writes the taxonomy atomically without creating Gold", () => {
  const manual = functionBody("neontrip_set_manual_request_segment");
  assert.match(manual, /p_actor->>'segmentTaxonomyVersion'/i);
  assert.match(manual, /if v_active_policy\.taxonomy_version is not null then\s+raise exception 'manual_segment_taxonomy_marker_required'/i);
  assert.match(manual, /segment_taxonomy_version = v_target_taxonomy/i);
  assert.match(manual, /from public\.segment_taxonomy_definitions[\s\S]*?d\.active/i);
  assert.match(manual, /not v_is_cx8[\s\S]*?v_request\.segment_taxonomy_version = v_cx8_taxonomy[\s\S]*?legacy_manual_cannot_overwrite_cx8_authority/i);
  assert.match(manual, /'gold_label_created', false/i);
  assert.doesNotMatch(manual, /insert into public\.request_segmentation_gold_adjudications/i);
});

test("Record fails cross-lane jobs before classification and never projects evaluation jobs", () => {
  const record = functionBody("neontrip_record_request_segment_classification");
  const contractFailure = record.indexOf("segmentation_job_active_contract_mismatch");
  const classificationInsert = record.indexOf("insert into public.request_segment_classifications");
  assert.ok(contractFailure >= 0 && contractFailure < classificationInsert);
  assert.match(record, /status = 'failed'[\s\S]*?last_error_code = 'segmentation_job_active_contract_mismatch'[\s\S]*?lock_owner = null/i);
  assert.match(record, /'classification_id', null[\s\S]*?'active_contract_mismatch_no_classification'/i);
  assert.match(record, /v_evaluation_only or not v_master_projection_authorized[\s\S]*?'evaluation_only_no_projection'/i);
  assert.match(record, /v_effective_status = 'accepted'[\s\S]*?and not v_evaluation_only[\s\S]*?and v_master_projection_authorized[\s\S]*?neontrip_upsert_segment_research_cache/i);
});

test("Record binds evidence code, semantic use, evidence item and verified source on the same URL", () => {
  const record = functionBody("neontrip_record_request_segment_classification");
  assert.match(record, /evidence\.item->>'url' = source\.item->>'url'/i);
  assert.match(record, /evidence\.item->>'evidence_code' = source_code\.code/i);
  assert.match(record, /when p_segment = 'NT-10' then evidence\.item->>'used_for' = 'institution_status'/i);
  assert.match(record, /when p_segment in \('NT-1', 'NT-4', 'NT-3', 'NT-5', 'NT-6', 'NT-9'\)[\s\S]*?evidence\.item->>'used_for' = 'segment_role'/i);
  assert.doesNotMatch(record, /when p_segment = 'NT-10' then[^\n]*segment_role/i);
  assert.match(record, /v_organization_scale_evidence_valid := exists[\s\S]*?'organization_scale'/i);
  assert.match(record, /v_organization_scale_evidence_valid := exists[\s\S]*?source\.item->'validated_positive_evidence_codes'[\s\S]*?source_code\.code = v_required_positive_code/i);
  assert.match(record, /p_segment = 'NT-6' and v_organization_scale is distinct from 'enterprise'/i);
  assert.match(record, /p_segment = 'NT-8'[\s\S]*?v_organization_scale is not null[\s\S]*?'invalid_organization_scale'/i);
  assert.match(record, /jsonb_typeof\(v_effective_classifier_json->'organization_scale'\) = 'null'[\s\S]*?jsonb_typeof\(v_effective_classifier_json->'organization_scale'\) = 'string'/i);
  assert.match(record, /evidence\.item \?& array\['type', 'url', 'used_for', 'evidence_code'\]/i);
  assert.match(record, /context_value\(item\)[\s\S]*?jsonb_typeof\(context_value\.item\) <> 'string'/i);
  assert.match(record, /item \?& array\['url', 'source_type', 'source_ref', 'validated_positive_evidence_codes'\]/i);
  assert.match(record, /jsonb_typeof\(item->'url'\) = 'string'[\s\S]*?jsonb_typeof\(item->'source_ref'\) = 'string'/i);
  assert.match(record, /where (?:source_)?code(?:\.code)? is null\s+or (?:source_)?code(?:\.code)? not in/i);
  assert.match(record, /jsonb_typeof\(v_provenance->'valid'\) = 'boolean'/i);
  assert.match(record, /jsonb_typeof\(v_provenance->'request_evidence_used'\) = 'boolean'/i);
});

test("CX8 research cache persists and replays only exact contract-bound evidence", () => {
  const cache = functionBody("neontrip_upsert_segment_research_cache_from_classification");
  const payload = functionBody("neontrip_get_request_segmentation_payload");
  const record = functionBody("neontrip_record_request_segment_classification");
  assert.match(cache, /v_taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'/i);
  assert.match(cache, /v_classifier_version_json = 'segment_classifier_v3_20260819_cx8'/i);
  assert.match(cache, /v_prompt_version = 'segment_prompt_v4_20260819_cx8'/i);
  assert.match(cache, /evidence\.item->>'evidence_code' = v_required_evidence_code/i);
  assert.match(cache, /evidence\.item->>'used_for' = v_required_role_use/i);
  assert.match(cache, /source\.item->>'url' = evidence\.item->>'url'/i);
  assert.match(cache, /cached\.cache_key = source\.item->>'source_ref'[\s\S]*?cached_evidence\.item->>'evidence_code' = evidence\.item->>'evidence_code'[\s\S]*?cached_evidence\.item->>'used_for' = evidence\.item->>'used_for'/i);
  assert.doesNotMatch(main, /jsonb_array_elements\((?:cached|src)\.evidence_json\)/i);
  assert.match(cache, /v_cache_evidence_json, v_summary/i);
  assert.match(cache, /'taxonomy_version', v_taxonomy_version[\s\S]*?'classifier_version', p_classifier_version[\s\S]*?'prompt_version', v_prompt_version/i);
  assert.match(cache, /'evidence_contract_valid'/i);
  assert.match(payload, /src\.summary_json->>'taxonomy_version' = ap\.taxonomy_version[\s\S]*?src\.summary_json->>'classifier_version' = ap\.classifier_version[\s\S]*?src\.summary_json->>'prompt_version' = ap\.prompt_version[\s\S]*?src\.summary_json->>'evidence_contract_valid' = 'true'/i);
  assert.match(payload, /cached_definition\.required_evidence_code = src\.summary_json->>'required_evidence_code'[\s\S]*?cached_evidence\.item->>'evidence_code' <> cached_definition\.required_evidence_code[\s\S]*?cached_role\.item->>'used_for'/i);
  assert.match(record, /'taxonomy_version', v_active_policy\.taxonomy_version[\s\S]*?'classifier_version', v_active_policy\.classifier_version[\s\S]*?'prompt_version', v_active_policy\.prompt_version[\s\S]*?'effective_segment', v_effective_segment/i);
  assert.match(record, /cached\.cache_key = source\.item->>'source_ref'[\s\S]*?cached\.summary_json->>'taxonomy_version' = v_active_policy\.taxonomy_version[\s\S]*?cached_evidence\.item->>'used_for' = evidence\.item->>'used_for'/i);
});

test("normal and evaluation enqueue metadata cannot retain the wrong projection authority", () => {
  const enqueue = functionBody("neontrip_enqueue_request_segmentation");
  const evaluation = functionBody("neontrip_enqueue_request_segmentation_evaluation");
  assert.match(enqueue, /'evaluation_only', false[\s\S]*?'master_projection_authorized', true/i);
  assert.match(enqueue, /metadata = public\.request_segmentation_jobs\.metadata \|\| excluded\.metadata[\s\S]*?metadata->>'evaluation_only'[\s\S]*?'evaluation_only', true[\s\S]*?'master_projection_authorized', false/i);
  assert.match(evaluation, /'evaluation_only', true[\s\S]*?'master_projection_authorized', false/i);
  assert.doesNotMatch(evaluation, /\bp_segment\b|\bv_customer_type\b|\bp_organization_scale\b/);
});

test("Gold is locked, insert-once, evidence-bound and taxonomy-consistent", () => {
  const lock = functionBody("neontrip_lock_request_segmentation_input_hash");
  const gold = functionBodyFrom(humanGoldDisagreement, "neontrip_adjudicate_request_segmentation_gold");
  assert.match(lock, /from public\.master_requests[\s\S]*?for share[\s\S]*?from public\.master_customers[\s\S]*?for share[\s\S]*?neontrip_compute_request_segment_input_hash/i);
  assert.match(gold, /neontrip_lock_request_segmentation_input_hash\(p_request_id\)/i);
  assert.match(gold, /on conflict \(request_id, input_hash, taxonomy_version\) do nothing/i);
  assert.match(gold, /gold_adjudication_conflict_requires_explicit_superseding_revision/i);
  assert.match(main, /before update or delete on public\.request_segmentation_gold_adjudications/i);
  assert.match(gold, /cardinality\(v_evidence_urls\) = 0 and p_segment <> 'NT-8'/i);
  assert.match(gold, /p_segment = 'NT-8' and p_organization_scale is not null/i);
  assert.doesNotMatch(gold, /\bv_customer_type\b|gold_private_first_party_evidence_required|gold_direct_business_first_party_evidence_required/i);
  assert.match(gold, /p_segment = 'NT-5' and p_organization_scale is null/i);
  assert.match(gold, /p_segment = 'NT-6' and p_organization_scale is distinct from 'enterprise'/i);
  assert.match(gold, /length\(v_actor\) > 320[\s\S]*?length\(v_reason\) > 4000/i);
  assert.match(gold, /cardinality\(v_context_tags\) > 10/i);
  assert.match(gold, /length\(tag\) > 80[\s\S]*?gold_context_tag_too_long/i);
  assert.match(gold, /length\(btrim\(url\)\) > 2048[\s\S]*?cardinality\(v_evidence_urls\) > 12/i);
  assert.match(main, /request_segmentation_gold_adjudications_context_tags_check[\s\S]*?is_canonical\(context_tags, 10, 80\)/i);
  assert.match(main, /request_segmentation_gold_adjudications_evidence_urls_check[\s\S]*?is_canonical\(evidence_urls, 12, 2048\)/i);
  assert.match(humanGoldDisagreement, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(humanGoldDisagreement, /revoke all on function public\.neontrip_adjudicate_request_segmentation_gold[\s\S]*?from public, anon, authenticated[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(humanGoldDisagreement, /update\s+public\.master_requests|segment_policy_rules|request_segmentation_v2_production_readiness/i);
  assert.match(humanGoldDisagreementRollback, /^--[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(humanGoldDisagreementRollback, /v_customer_type text[\s\S]*?gold_private_first_party_evidence_required[\s\S]*?gold_direct_business_first_party_evidence_required/i);
  assert.match(humanGoldDisagreementRollback, /revoke all on function public\.neontrip_adjudicate_request_segmentation_gold[\s\S]*?from public, anon, authenticated[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(humanGoldDisagreementRollback, /delete\s+from\s+public\.request_segmentation_gold_adjudications|update\s+public\.master_requests/i);
});

test("quality metrics use exact version/hash joins and true precision, recall and coverage", () => {
  assert.match(main, /latest_gold_per_request[\s\S]*?select distinct on \(g\.request_id\)[\s\S]*?order by g\.request_id, g\.created_at desc, g\.id desc/i);
  assert.match(main, /c\.request_id = g\.request_id[\s\S]*?c\.input_hash = g\.input_hash[\s\S]*?c\.taxonomy_version = g\.taxonomy_version[\s\S]*?c\.classifier_version = tc\.classifier_version[\s\S]*?c\.prompt_version = tc\.prompt_version/i);
  assert.match(main, /request_segmentation_v2_segment_quality[\s\S]*?predicted_stats[\s\S]*?group by e\.accepted_predicted_segment/i);
  assert.match(main, /actual_stats[\s\S]*?group by e\.actual_segment/i);
  assert.match(main, /accepted_coverage[\s\S]*?precision[\s\S]*?recall/i);
  assert.match(main, /filter \(where e\.classifier_status = 'accepted' and e\.mapping_integrity\)[\s\S]*?as accepted_mapping_integrity/i);
  assert.match(main, /min_critical_precision[\s\S]*?critical_segments/i);
});

test("review contract returns locked hash and deterministic Gold eligibility without raw PII", () => {
  const review = functionBody("neontrip_get_request_segmentation_review_context");
  assert.match(review, /neontrip_lock_request_segmentation_input_hash\(p_request_id\)/i);
  assert.match(review, /'gold_eligibility'[\s\S]*?'normalized_customer_type'[\s\S]*?'nt8_first_party_eligible'[\s\S]*?'nt9_first_party_eligible'/i);
  assert.match(review, /'nt6_required_organization_scale', 'enterprise'/i);
  assert.doesNotMatch(review, /'email'|'phone'|'name'/i);
});

test("automation decision requires exact active taxonomy authority and exposes the pinned playbook contract", () => {
  const decision = functionBody("neontrip_get_request_segmentation_automation_decision");
  assert.match(decision, /mr\.segment_taxonomy_version is not distinct from ap\.taxonomy_version[\s\S]*?ds\.mapping_valid/i);
  assert.match(decision, /segment_taxonomy_definitions td[\s\S]*?td\.taxonomy_version = ap\.taxonomy_version[\s\S]*?td\.active/i);
  assert.match(decision, /'taxonomy'[\s\S]*?'active_taxonomy_version'[\s\S]*?'master_taxonomy_matches_active'[\s\S]*?'classification_taxonomy_matches_active'/i);
  for (const key of [
    "segment_status", "segment", "s_kategorie", "segment_confidence",
    "segment_source", "segment_policy_version", "segment_taxonomy_version",
    "context_tags", "organization_scale", "segment_classified_at",
  ]) {
    assert.match(decision, new RegExp(`'${key}'`, "i"));
  }
  for (const key of [
    "segment", "s_kategorie", "taxonomy_version", "policy_version", "mode",
    "sales_priority", "max_followups", "first_call_after_minutes",
    "pricing_enabled", "price_factor", "automation_enabled",
  ]) {
    assert.match(decision, new RegExp(`'${key}'`, "i"));
  }
  assert.match(decision, /when \(select can_use_for_followup or can_use_for_pricing from decisions\)[\s\S]*?else jsonb_build_object\([\s\S]*?'automation_enabled', false/i);
});

test("new tables and invoker views are service-role-only", () => {
  for (const object of [
    "segment_taxonomy_versions",
    "segment_taxonomy_definitions",
    "segment_context_definitions",
    "segment_quality_gate_versions",
    "request_segmentation_gold_adjudications",
  ]) {
    assert.match(main, new RegExp(`alter table public\\.${object} enable row level security`, "i"));
    assert.match(main, new RegExp(`revoke all on table public\\.${object} from public, anon, authenticated`, "i"));
    assert.match(
      main,
      new RegExp(
        `revoke all on table public\\.${object} from service_role;[\\s\\S]*?grant select on table public\\.${object} to service_role;`,
        "i",
      ),
    );
    assert.doesNotMatch(
      main,
      new RegExp(
        `grant\\s+(?:all|insert|update|delete|truncate|references|trigger)\\b[^;]*on table public\\.${object} to service_role`,
        "i",
      ),
    );
    const definition = main.match(
      new RegExp(`create table public\\.${object}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"),
    );
    assert.ok(definition, `${object} definition missing`);
    assert.doesNotMatch(
      definition[1],
      /\\b(?:smallserial|serial|bigserial)\\b|generated\\s+(?:always|by default)\\s+as identity/i,
    );
  }
  assert.match(main, /create view public\.request_segmentation_v2_gold_evaluation\s+with \(security_invoker = true\)/i);
  assert.match(main, /grant select on table public\.request_segmentation_v2_production_readiness to service_role/i);
});

test("held activation is preconditioned, atomic, and keeps every CX8 rule inert", () => {
  assert.match(activation, /^-- HOLD:[\s\S]*?deliberately outside supabase\/migrations[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(activation, /cx8_activation_requires_active_v1_shadow/i);
  assert.match(
    activation,
    /lock table public\.segment_taxonomy_versions in share row exclusive mode;[\s\S]*?lock table public\.segment_taxonomy_definitions in share row exclusive mode;[\s\S]*?lock table public\.segment_quality_gate_versions in share row exclusive mode;[\s\S]*?lock table public\.segment_policy_versions in access exclusive mode;[\s\S]*?lock table public\.segment_policy_rules in share row exclusive mode;[\s\S]*?lock table public\.request_segmentation_jobs in share row exclusive mode;/i,
  );
  assert.match(activation, /j\.status in \('pending', 'processing'\)[\s\S]*?j\.status = 'failed' and j\.attempts < j\.max_attempts[\s\S]*?cx8_activation_v1_jobs_not_drained/i);
  assert.match(activation, /pending_v1_jobs=%s processing_v1_jobs=%s retryable_failed_v1_jobs=%s/i);
  assert.match(activation, /automation_enabled[\s\S]*?price_factor is not null[\s\S]*?max_followups <> 0/i);
  assert.match(activation, /required_evidence_code is distinct from case r\.segment/i);
  assert.match(activation, /left join public\.segment_taxonomy_definitions d/i);
  assert.match(activation, /segment_quality_gate_versions q[\s\S]*?min_unique_gold_total = 300[\s\S]*?manual_activation_required[\s\S]*?cx8_activation_quality_gate_contract_missing_or_unexpected/i);
  assert.match(activation, /set active = false[\s\S]*?nt_policy_v1_20260520_shadow[\s\S]*?set active = true[\s\S]*?nt_policy_v2_20260819_cx8_shadow/i);
});

test("rollback artifacts document pre-runtime full restore and non-destructive runtime rollback", () => {
  const snapshot = readFileSync(snapshotPath, "utf8");
  const operational = readFileSync(operationalRollbackPath, "utf8");
  const full = readFileSync(fullRollbackPath, "utf8");
  assert.match(snapshot, /No customer rows, domains, email addresses, or other PII/i);
  assert.match(snapshot, /versioned_runtime_rows_must_be_zero/i);
  assert.match(snapshot, /request_segmentation_jobs_request_id_input_hash_key/i);
  assert.match(snapshot, /request_segment_classificatio_request_id_input_hash_classif_key/i);
  assert.match(full, /^-- NEONTRIP Phase-2 exact pre-runtime schema rollback[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.match(full, /versioned_runtime_rows_must_be_zero/i);
  assert.match(full, /phase2_full_rollback_requires_v1_active_v2_inactive/i);
  assert.match(full, /exact live Phase-1 function definitions, comments and ACLs follow/i);
  assert.match(full, /add constraint request_segmentation_jobs_request_id_input_hash_key/i);
  assert.match(full, /add constraint request_segment_classificatio_request_id_input_hash_classif_key/i);
  assert.match(full, /drop table public\.segment_taxonomy_versions/i);
  assert.match(operational, /never delete CX8 jobs,\s*-- classifications, or Gold/i);
  assert.match(operational, /request_segmentation_operational_rollback_v2_jobs_still_processing/i);
  assert.match(operational, /lock table public\.segment_policy_versions in access exclusive mode[\s\S]*?lock table public\.request_segmentation_jobs in share row exclusive mode/i);
  assert.match(operational, /pending\/failed CX8 jobs are retained but suspended/i);
  assert.match(operational, /set active = false[\s\S]*?nt_policy_v2_20260819_cx8_shadow/i);
  assert.match(operational, /set active = true[\s\S]*?nt_policy_v1_20260520_shadow/i);
});
