-- HOLD: apply only after the repaired v4 n8n graph is published and its exact
-- active graph has been read back. This recovery artifact resumes the existing
-- Phase-5 candidate lane after the non-destructive operational rollback. It
-- never stages, retries, resets, deletes, or otherwise mutates a runtime row.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve the established segmentation lock order. The cache lock closes the
-- final side-effect lane while the zero-candidate-cache assertion is checked.
lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in access exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share row exclusive mode;
lock table public.segment_research_cache in share row exclusive mode;
lock table public.request_segmentation_gold_adjudications in share mode;

do $phase5_resume_cutover$
declare
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
  v_old_policy_count integer;
  v_candidate_policy_count integer;
  v_old_quality_count integer;
  v_candidate_quality_count integer;
  v_candidate_rule_count integer;
  v_non_inert_candidate_rule_count integer;
  v_old_claimable_jobs integer;
  v_old_processing_jobs integer;
  v_candidate_job_count integer;
  v_candidate_pending_count integer;
  v_candidate_processing_count integer;
  v_candidate_non_pending_count integer;
  v_candidate_retry_exhausted_count integer;
  v_candidate_contract_metadata_invalid_count integer;
  v_candidate_locked_count integer;
  v_candidate_linked_classification_count integer;
  v_gold_job_count integer;
  v_gold_attempt_one_count integer;
  v_gold_attempt_one_expected_error_count integer;
  v_gold_attempt_zero_count integer;
  v_ingress_job_count integer;
  v_ingress_attempt_zero_count integer;
  v_attempt_zero_clean_error_count integer;
  v_invalid_lane_count integer;
  v_pilot_cohort_count integer;
  v_current_pilot_gold_count integer;
  v_gold_job_current_match_count integer;
  v_candidate_classification_count integer;
  v_candidate_cache_count integer;
  v_job_state_hash_before text;
  v_job_state_hash_after text;
  v_updated_old_quality integer;
  v_updated_old_policy integer;
  v_updated_candidate_quality integer;
  v_updated_candidate_policy integer;
  v_post_old_inactive_quality integer;
  v_post_old_inactive_policy integer;
  v_post_candidate_active_quality integer;
  v_post_candidate_active_policy integer;
  v_post_global_active_quality integer;
  v_post_global_active_policy integer;
  v_post_candidate_job_count integer;
  v_post_candidate_classification_count integer;
  v_post_candidate_cache_count integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_old_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v2_20260819_cx8_shadow'
    and p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8';

  select count(*) into v_candidate_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v3_20260820_cx8_shadow'
    and not p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8';

  select count(*) into v_old_quality_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
    and q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_candidate_quality_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and q.min_unique_gold_total = 300
    and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1
    and q.max_provenance_violations = 0
    and q.manual_activation_required;

  select
    count(*),
    count(*) filter (
      where r.automation_enabled
         or r.needs_human_review
         or r.price_factor is not null
         or r.max_followups <> 0
         or r.first_call_after_minutes is not null
         or r.call_sequence <> '[]'::jsonb
         or r.email_sequence <> '[]'::jsonb
    )
  into v_candidate_rule_count, v_non_inert_candidate_rule_count
  from public.segment_policy_rules r
  where r.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
    and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8';

  if v_old_policy_count <> 1
     or v_candidate_policy_count <> 1
     or v_old_quality_count <> 1
     or v_candidate_quality_count <> 1
     or v_global_active_policy_count <> 1
     or v_global_active_quality_count <> 1
     or v_candidate_rule_count <> 8
     or v_non_inert_candidate_rule_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_contract_precondition_failed',
      detail = format(
        'old_policy=%s candidate_policy=%s old_quality=%s candidate_quality=%s active_policies=%s active_gates=%s rules=%s non_inert=%s',
        v_old_policy_count, v_candidate_policy_count, v_old_quality_count,
        v_candidate_quality_count, v_global_active_policy_count,
        v_global_active_quality_count, v_candidate_rule_count,
        v_non_inert_candidate_rule_count
      );
  end if;

  select count(*) into v_old_claimable_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and (
      j.status = 'pending'
      or (j.status = 'failed' and j.attempts < j.max_attempts)
    );

  select count(*) into v_old_processing_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and j.status = 'processing';

  if v_old_claimable_jobs <> 0 or v_old_processing_jobs <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_old_contract_jobs_not_drained',
      detail = format(
        'claimable_old_jobs=%s processing_old_jobs=%s',
        v_old_claimable_jobs, v_old_processing_jobs
      );
  end if;

  select
    count(*),
    count(*) filter (where j.status = 'pending'),
    count(*) filter (where j.status = 'processing'),
    count(*) filter (where j.status <> 'pending'),
    count(*) filter (where j.attempts >= j.max_attempts),
    count(*) filter (
      where j.metadata->>'taxonomy_version' is distinct from 'nt_taxonomy_v2_20260819_cx8'
         or j.metadata->>'classifier_version' is distinct from 'segment_classifier_v4_20260820_cx8'
         or j.metadata->>'prompt_version' is distinct from 'segment_prompt_v4_20260819_cx8'
         or j.metadata->>'quality_gate_version' is distinct from 'nt_quality_gate_v3_20260820_cx8'
    ),
    count(*) filter (where j.lock_owner is not null or j.locked_at is not null),
    count(*) filter (where j.last_classification_id is not null),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
        and j.source = 'gold_re_evaluation_phase5'
    ),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
        and j.source = 'gold_re_evaluation_phase5'
        and j.attempts = 1
    ),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
        and j.source = 'gold_re_evaluation_phase5'
        and j.attempts = 1
        and j.last_error_code = 'n8n_node_error'
        and lower(btrim(coalesce(j.last_error_message, ''))) = 'invalid syntax'
    ),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
        and j.source = 'gold_re_evaluation_phase5'
        and j.attempts = 0
    ),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'false'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'true'
        and nullif(btrim(j.source), '') is not null
        and j.source <> 'gold_re_evaluation_phase5'
        and j.metadata->>'policy_version' = 'nt_policy_v3_20260820_cx8_shadow'
        and j.metadata->>'contract_lane' = 'versioned'
    ),
    count(*) filter (
      where lower(coalesce(j.metadata->>'evaluation_only', '')) = 'false'
        and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'true'
        and nullif(btrim(j.source), '') is not null
        and j.source <> 'gold_re_evaluation_phase5'
        and j.metadata->>'policy_version' = 'nt_policy_v3_20260820_cx8_shadow'
        and j.metadata->>'contract_lane' = 'versioned'
        and j.attempts = 0
    ),
    count(*) filter (
      where j.attempts = 0
        and j.last_error_code is null
        and j.last_error_message is null
    ),
    count(*) filter (
      where not (
        (
          lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
          and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
          and j.source = 'gold_re_evaluation_phase5'
        )
        or (
          lower(coalesce(j.metadata->>'evaluation_only', '')) = 'false'
          and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'true'
          and nullif(btrim(j.source), '') is not null
          and j.source <> 'gold_re_evaluation_phase5'
          and j.metadata->>'policy_version' = 'nt_policy_v3_20260820_cx8_shadow'
          and j.metadata->>'contract_lane' = 'versioned'
        )
      )
    ),
    md5(string_agg(to_jsonb(j)::text, '|' order by j.id))
  into
    v_candidate_job_count,
    v_candidate_pending_count,
    v_candidate_processing_count,
    v_candidate_non_pending_count,
    v_candidate_retry_exhausted_count,
    v_candidate_contract_metadata_invalid_count,
    v_candidate_locked_count,
    v_candidate_linked_classification_count,
    v_gold_job_count,
    v_gold_attempt_one_count,
    v_gold_attempt_one_expected_error_count,
    v_gold_attempt_zero_count,
    v_ingress_job_count,
    v_ingress_attempt_zero_count,
    v_attempt_zero_clean_error_count,
    v_invalid_lane_count,
    v_job_state_hash_before
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8';

  if v_candidate_job_count <> 5
     or v_candidate_pending_count <> 5
     or v_candidate_processing_count <> 0
     or v_candidate_non_pending_count <> 0
     or v_candidate_retry_exhausted_count <> 0
     or v_candidate_contract_metadata_invalid_count <> 0
     or v_candidate_locked_count <> 0
     or v_candidate_linked_classification_count <> 0
     or v_gold_job_count <> 4
     or v_gold_attempt_one_count <> 3
     or v_gold_attempt_one_expected_error_count <> 3
     or v_gold_attempt_zero_count <> 1
     or v_ingress_job_count <> 1
     or v_ingress_attempt_zero_count <> 1
     or v_attempt_zero_clean_error_count <> 2
     or v_invalid_lane_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_candidate_job_composition_invalid',
      detail = format(
        'jobs=%s pending=%s processing=%s non_pending=%s exhausted=%s invalid_contract=%s locked=%s linked_classification=%s gold=%s gold_attempt1=%s gold_attempt1_expected_error=%s gold_attempt0=%s ingress=%s ingress_attempt0=%s clean_attempt0=%s invalid_lane=%s',
        v_candidate_job_count, v_candidate_pending_count,
        v_candidate_processing_count, v_candidate_non_pending_count,
        v_candidate_retry_exhausted_count,
        v_candidate_contract_metadata_invalid_count, v_candidate_locked_count,
        v_candidate_linked_classification_count, v_gold_job_count,
        v_gold_attempt_one_count, v_gold_attempt_one_expected_error_count,
        v_gold_attempt_zero_count, v_ingress_job_count,
        v_ingress_attempt_zero_count, v_attempt_zero_clean_error_count,
        v_invalid_lane_count
      );
  end if;

  with pilot_cohort as (
    select j.request_id, min(j.created_at) as first_job_created_at
    from public.request_segmentation_jobs j
    where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and j.classifier_version = 'segment_classifier_v3_20260819_cx8'
      and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
      and j.created_at <= timestamptz '2026-08-20T08:15:00.000Z'
    group by j.request_id
    order by min(j.created_at), j.request_id
    limit 4
  ), current_pilot_gold as (
    select g.request_id, g.input_hash, g.taxonomy_version
    from pilot_cohort pc
    join public.request_segmentation_gold_adjudications g
      on g.request_id = pc.request_id
     and g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
     and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
     and g.input_hash = public.neontrip_compute_request_segment_input_hash(g.request_id)
  )
  select
    (select count(*) from pilot_cohort),
    (select count(*) from current_pilot_gold),
    count(*)
  into
    v_pilot_cohort_count,
    v_current_pilot_gold_count,
    v_gold_job_current_match_count
  from public.request_segmentation_jobs j
  join current_pilot_gold g
    on g.request_id = j.request_id
   and g.input_hash = j.input_hash
   and g.taxonomy_version = j.taxonomy_version
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and lower(coalesce(j.metadata->>'evaluation_only', '')) = 'true'
    and lower(coalesce(j.metadata->>'master_projection_authorized', '')) = 'false'
    and j.source = 'gold_re_evaluation_phase5';

  if v_pilot_cohort_count <> 4
     or v_current_pilot_gold_count <> 4
     or v_gold_job_current_match_count <> 4 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_requires_exact_four_current_pilot_gold_jobs',
      detail = format(
        'pilot_cohort=%s current_gold=%s matching_jobs=%s',
        v_pilot_cohort_count, v_current_pilot_gold_count,
        v_gold_job_current_match_count
      );
  end if;

  select count(*) into v_candidate_classification_count
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and c.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_candidate_cache_count
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v4_20260820_cx8'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v4_20260819_cx8';

  if v_candidate_classification_count <> 0 or v_candidate_cache_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_candidate_side_effect_lane_not_empty',
      detail = format(
        'classifications=%s cache_rows=%s',
        v_candidate_classification_count, v_candidate_cache_count
      );
  end if;

  update public.segment_quality_gate_versions
  set active = false
  where version = 'nt_quality_gate_v2_20260819_cx8'
    and active;
  get diagnostics v_updated_old_quality = row_count;

  update public.segment_policy_versions
  set active = false
  where version = 'nt_policy_v2_20260819_cx8_shadow'
    and active;
  get diagnostics v_updated_old_policy = row_count;

  update public.segment_quality_gate_versions
  set active = true
  where version = 'nt_quality_gate_v3_20260820_cx8'
    and not active;
  get diagnostics v_updated_candidate_quality = row_count;

  update public.segment_policy_versions
  set active = true
  where version = 'nt_policy_v3_20260820_cx8_shadow'
    and not active;
  get diagnostics v_updated_candidate_policy = row_count;

  if v_updated_old_quality <> 1
     or v_updated_old_policy <> 1
     or v_updated_candidate_quality <> 1
     or v_updated_candidate_policy <> 1 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_cutover_rowcount_invalid',
      detail = format(
        'old_quality=%s old_policy=%s candidate_quality=%s candidate_policy=%s',
        v_updated_old_quality, v_updated_old_policy,
        v_updated_candidate_quality, v_updated_candidate_policy
      );
  end if;

  select count(*) into v_post_global_active_policy
  from public.segment_policy_versions
  where active;

  select count(*) into v_post_global_active_quality
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_post_old_inactive_policy
  from public.segment_policy_versions
  where version = 'nt_policy_v2_20260819_cx8_shadow'
    and not active;

  select count(*) into v_post_old_inactive_quality
  from public.segment_quality_gate_versions
  where version = 'nt_quality_gate_v2_20260819_cx8'
    and not active;

  select count(*) into v_post_candidate_active_policy
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v3_20260820_cx8_shadow'
    and p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8';

  select count(*) into v_post_candidate_active_quality
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
    and q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95;

  select
    count(*),
    md5(string_agg(to_jsonb(j)::text, '|' order by j.id))
  into v_post_candidate_job_count, v_job_state_hash_after
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_post_candidate_classification_count
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and c.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_post_candidate_cache_count
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v4_20260820_cx8'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v4_20260819_cx8';

  if v_post_global_active_policy <> 1
     or v_post_global_active_quality <> 1
     or v_post_old_inactive_policy <> 1
     or v_post_old_inactive_quality <> 1
     or v_post_candidate_active_policy <> 1
     or v_post_candidate_active_quality <> 1
     or v_post_candidate_job_count <> 5
     or v_job_state_hash_after is distinct from v_job_state_hash_before
     or v_post_candidate_classification_count <> 0
     or v_post_candidate_cache_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_resume_postcondition_failed',
      detail = format(
        'active_policies=%s active_gates=%s old_policy_inactive=%s old_gate_inactive=%s candidate_policy_active=%s candidate_gate_active=%s jobs=%s job_state_unchanged=%s classifications=%s cache_rows=%s',
        v_post_global_active_policy, v_post_global_active_quality,
        v_post_old_inactive_policy, v_post_old_inactive_quality,
        v_post_candidate_active_policy, v_post_candidate_active_quality,
        v_post_candidate_job_count,
        v_job_state_hash_after is not distinct from v_job_state_hash_before,
        v_post_candidate_classification_count, v_post_candidate_cache_count
      );
  end if;
end;
$phase5_resume_cutover$;

commit;
