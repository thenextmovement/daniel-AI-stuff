-- HOLD: do not apply until the exact Phase-5 n8n graph has been published,
-- read back, and approved. This artifact is deliberately outside migrations.
-- It atomically stages exactly the four frozen pilot Gold inputs, then flips
-- only the active shadow classifier contract. It never changes Gold, master
-- authority, research cache, policy rules, approvals, or customer automation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Match the established Phase-2 lock order so enqueue/claim cannot cross the
-- semantic cutover. Keep this transaction free of network or other I/O.
lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in access exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share mode;
lock table public.request_segmentation_gold_adjudications in share mode;

do $phase5_activation_precondition$
declare
  v_old_policy_count integer;
  v_candidate_policy_count integer;
  v_old_quality_count integer;
  v_candidate_quality_count integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
  v_candidate_rule_count integer;
  v_non_inert_candidate_rule_count integer;
  v_old_claimable_jobs integer;
  v_old_processing_jobs integer;
  v_candidate_jobs integer;
  v_candidate_classifications integer;
  v_pilot_cohort_count integer;
  v_current_gold_count integer;
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

  select count(*) into v_candidate_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_candidate_classifications
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and c.prompt_version = 'segment_prompt_v4_20260819_cx8';

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
  )
  select count(*) into v_pilot_cohort_count from pilot_cohort;

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
  )
  select count(*) into v_current_gold_count
  from pilot_cohort pc
  join public.request_segmentation_gold_adjudications g
    on g.request_id = pc.request_id
   and g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
   and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
   and g.input_hash = public.neontrip_compute_request_segment_input_hash(g.request_id);

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
      message = 'phase5_activation_contract_precondition_failed',
      detail = format(
        'old_policy=%s candidate_policy=%s old_quality=%s candidate_quality=%s active_policies=%s active_gates=%s rules=%s non_inert=%s',
        v_old_policy_count, v_candidate_policy_count, v_old_quality_count,
        v_candidate_quality_count, v_global_active_policy_count,
        v_global_active_quality_count, v_candidate_rule_count,
        v_non_inert_candidate_rule_count
      );
  end if;

  if v_old_claimable_jobs <> 0 or v_old_processing_jobs <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_old_contract_jobs_not_drained',
      detail = format(
        'claimable_old_jobs=%s processing_old_jobs=%s',
        v_old_claimable_jobs, v_old_processing_jobs
      );
  end if;

  if v_candidate_jobs <> 0 or v_candidate_classifications <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_requires_pristine_candidate_lane',
      detail = format(
        'candidate_jobs=%s candidate_classifications=%s',
        v_candidate_jobs, v_candidate_classifications
      );
  end if;

  if v_pilot_cohort_count <> 4 or v_current_gold_count <> 4 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_requires_exact_four_current_pilot_gold',
      detail = format(
        'pilot_cohort=%s current_gold=%s',
        v_pilot_cohort_count, v_current_gold_count
      );
  end if;
end;
$phase5_activation_precondition$;

do $phase5_stage_four_gold_jobs$
declare
  v_gold record;
  v_job_id uuid;
  v_staged_count integer := 0;
begin
  for v_gold in
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
    )
    select g.request_id, g.input_hash, g.taxonomy_version
    from pilot_cohort pc
    join public.request_segmentation_gold_adjudications g
      on g.request_id = pc.request_id
     and g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
     and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
     and g.input_hash = public.neontrip_compute_request_segment_input_hash(g.request_id)
    order by pc.first_job_created_at, pc.request_id
  loop
    v_job_id := public.neontrip_enqueue_request_segmentation_evaluation(
      v_gold.request_id,
      v_gold.input_hash,
      v_gold.taxonomy_version,
      'segment_classifier_v4_20260820_cx8',
      'segment_prompt_v4_20260819_cx8',
      'gold_re_evaluation_phase5'
    );

    if v_job_id is null then
      raise exception 'phase5_activation_candidate_job_id_missing';
    end if;
    v_staged_count := v_staged_count + 1;
  end loop;

  if v_staged_count <> 4 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_did_not_stage_exactly_four_jobs',
      detail = format('staged_jobs=%s', v_staged_count);
  end if;
end;
$phase5_stage_four_gold_jobs$;

do $phase5_staged_job_postcondition$
declare
  v_job_count integer;
  v_invalid_job_count integer;
begin
  select
    count(*),
    count(*) filter (
      where j.status <> 'pending'
         or j.attempts <> 0
         or j.source <> 'gold_re_evaluation_phase5'
         or lower(coalesce(j.metadata->>'evaluation_only', 'false')) <> 'true'
         or lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) <> 'false'
         or j.metadata->>'quality_gate_version' <> 'nt_quality_gate_v3_20260820_cx8'
    )
  into v_job_count, v_invalid_job_count
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8';

  if v_job_count <> 4 or v_invalid_job_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_staged_job_contract_invalid',
      detail = format('jobs=%s invalid_jobs=%s', v_job_count, v_invalid_job_count);
  end if;
end;
$phase5_staged_job_postcondition$;

update public.segment_quality_gate_versions
set active = false
where version = 'nt_quality_gate_v2_20260819_cx8';

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v2_20260819_cx8_shadow';

update public.segment_quality_gate_versions
set active = true
where version = 'nt_quality_gate_v3_20260820_cx8';

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v3_20260820_cx8_shadow';

do $phase5_activation_postcondition$
declare
  v_active_quality_count integer;
  v_active_policy_count integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
  v_candidate_job_count integer;
  v_candidate_classification_count integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_active_quality_count
  from public.segment_quality_gate_versions q
  where q.active
    and q.version = 'nt_quality_gate_v3_20260820_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_active_policy_count
  from public.segment_policy_versions p
  where p.active
    and p.version = 'nt_policy_v3_20260820_cx8_shadow'
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8';

  select count(*) into v_candidate_job_count
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
    and lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) = 'false';

  select count(*) into v_candidate_classification_count
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and c.prompt_version = 'segment_prompt_v4_20260819_cx8';

  if v_active_quality_count <> 1
     or v_active_policy_count <> 1
     or v_global_active_policy_count <> 1
     or v_global_active_quality_count <> 1
     or v_candidate_job_count <> 4
     or v_candidate_classification_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_activation_postcondition_failed',
      detail = format(
        'active_quality=%s active_policy=%s all_active_policies=%s all_active_gates=%s candidate_jobs=%s candidate_classifications=%s',
        v_active_quality_count, v_active_policy_count,
        v_global_active_policy_count, v_global_active_quality_count,
        v_candidate_job_count, v_candidate_classification_count
      );
  end if;
end;
$phase5_activation_postcondition$;

commit;
