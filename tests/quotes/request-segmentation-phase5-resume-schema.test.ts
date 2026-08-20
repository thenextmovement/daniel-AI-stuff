import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resumePath = resolve(
  process.cwd(),
  "supabase/rollouts/held/20260820111828_resume_request_segmentation_phase5_forced_research_shadow.sql",
);

const resume = readFileSync(resumePath, "utf8");

test("Phase 5 resume is held, atomic, and mutates only the four active flags", () => {
  assert.match(
    resume,
    /^-- HOLD:[\s\S]*?never stages, retries, resets, deletes,[\s\S]*?\nbegin;[\s\S]*\ncommit;\s*$/i,
  );
  assert.match(
    resume,
    /lock table public\.segment_policy_versions in access exclusive mode[\s\S]*?lock table public\.request_segmentation_jobs in share row exclusive mode[\s\S]*?lock table public\.request_segment_classifications in share row exclusive mode[\s\S]*?lock table public\.segment_research_cache in share row exclusive mode/i,
  );
  assert.doesNotMatch(
    resume,
    /(?:insert\s+into|update|delete\s+from)\s+public\.(?:request_segmentation_jobs|request_segment_classifications|segment_research_cache|request_segmentation_gold_adjudications)/i,
  );
  assert.doesNotMatch(
    resume,
    /neontrip_enqueue_request_segmentation_evaluation|set\s+attempts\s*=|set\s+next_attempt_at\s*=/i,
  );

  const runtimeUpdates = [
    ...resume.matchAll(/update\s+public\.([a-z0-9_]+)/gi),
  ].map((match) => match[1]);
  assert.deepEqual(runtimeUpdates, [
    "segment_quality_gate_versions",
    "segment_policy_versions",
    "segment_quality_gate_versions",
    "segment_policy_versions",
  ]);
});

test("Phase 5 resume pins the exact rollback contract and inert candidate rules", () => {
  assert.match(
    resume,
    /nt_policy_v2_20260819_cx8_shadow[\s\S]*?segment_classifier_v3_20260819_cx8[\s\S]*?nt_quality_gate_v2_20260819_cx8/i,
  );
  assert.match(
    resume,
    /nt_policy_v3_20260820_cx8_shadow[\s\S]*?segment_classifier_v4_20260820_cx8[\s\S]*?nt_quality_gate_v3_20260820_cx8/i,
  );
  assert.match(
    resume,
    /v_global_active_policy_count <> 1[\s\S]*?v_global_active_quality_count <> 1[\s\S]*?v_candidate_rule_count <> 8[\s\S]*?v_non_inert_candidate_rule_count <> 0/i,
  );
  assert.match(
    resume,
    /automation_enabled[\s\S]*?needs_human_review[\s\S]*?price_factor is not null[\s\S]*?max_followups <> 0[\s\S]*?call_sequence <> '\[\]'::jsonb[\s\S]*?email_sequence <> '\[\]'::jsonb/i,
  );
  assert.equal(
    [
      ...resume.matchAll(
        /q\.critical_segments = array\['NT-8', 'NT-10'\]::text\[\]\s+and q\.min_critical_precision = 0\.95/gi,
      ),
    ].length,
    2,
  );
  assert.match(resume, /phase5_resume_old_contract_jobs_not_drained/i);
});

test("Phase 5 resume admits only the frozen five-job recovery composition", () => {
  assert.match(
    resume,
    /v_candidate_job_count <> 5[\s\S]*?v_candidate_pending_count <> 5[\s\S]*?v_candidate_processing_count <> 0[\s\S]*?v_candidate_non_pending_count <> 0/i,
  );
  assert.match(
    resume,
    /v_gold_job_count <> 4[\s\S]*?v_gold_attempt_one_count <> 3[\s\S]*?v_gold_attempt_zero_count <> 1[\s\S]*?v_ingress_job_count <> 1[\s\S]*?v_ingress_attempt_zero_count <> 1/i,
  );
  assert.match(
    resume,
    /v_candidate_locked_count <> 0[\s\S]*?v_candidate_linked_classification_count <> 0/i,
  );
  assert.match(
    resume,
    /j\.last_error_code = 'n8n_node_error'[\s\S]*?lower\(btrim\(coalesce\(j\.last_error_message, ''\)\)\) = 'invalid syntax'[\s\S]*?v_gold_attempt_one_expected_error_count <> 3/i,
  );
  assert.match(
    resume,
    /j\.attempts = 0[\s\S]*?j\.last_error_code is null[\s\S]*?j\.last_error_message is null[\s\S]*?v_attempt_zero_clean_error_count <> 2/i,
  );
  assert.match(
    resume,
    /j\.source = 'gold_re_evaluation_phase5'[\s\S]*?j\.source <> 'gold_re_evaluation_phase5'[\s\S]*?j\.metadata->>'policy_version' = 'nt_policy_v3_20260820_cx8_shadow'[\s\S]*?j\.metadata->>'contract_lane' = 'versioned'/i,
  );
  assert.match(
    resume,
    /phase5_resume_requires_exact_four_current_pilot_gold_jobs/i,
  );
  assert.match(
    resume,
    /v_candidate_classification_count <> 0 or v_candidate_cache_count <> 0/i,
  );
  assert.match(
    resume,
    /summary_json->>'classifier_version' = 'segment_classifier_v4_20260820_cx8'/i,
  );
});

test("Phase 5 resume proves the flip and preserves every candidate job byte-for-byte", () => {
  assert.match(
    resume,
    /md5\(string_agg\(to_jsonb\(j\)::text, '\|' order by j\.id\)\)[\s\S]*?v_job_state_hash_before/i,
  );
  assert.match(
    resume,
    /v_job_state_hash_after is distinct from v_job_state_hash_before/i,
  );
  assert.match(
    resume,
    /set active = false[\s\S]*?nt_quality_gate_v2_20260819_cx8[\s\S]*?set active = false[\s\S]*?nt_policy_v2_20260819_cx8_shadow[\s\S]*?set active = true[\s\S]*?nt_quality_gate_v3_20260820_cx8[\s\S]*?set active = true[\s\S]*?nt_policy_v3_20260820_cx8_shadow/i,
  );
  assert.match(
    resume,
    /v_post_global_active_policy <> 1[\s\S]*?v_post_global_active_quality <> 1[\s\S]*?v_post_candidate_job_count <> 5/i,
  );
  assert.match(resume, /phase5_resume_postcondition_failed/i);
});
