-- HOLD: do not apply until the exact n8n-v6 graph and treatment-evaluation RPCs
-- have been published, read back and approved. This artifact only
-- stages four immutable-current-Gold evaluation jobs. It never flips a policy
-- or gate, changes Gold, updates a master record, writes research cache, or
-- authorizes a customer action.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.master_requests in share mode;
lock table public.master_customers in share mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_gold_adjudications in share mode;
lock table public.request_segmentation_activation_approvals in share mode;

do $treatment_stage_precondition$
declare
  v_current_gold_count integer;
  v_candidate_jobs integer;
  v_candidate_classifications integer;
  v_candidate_cache integer;
  v_candidate_approvals integer;
  v_master_hash text;
begin
  if not public.neontrip_treatment_evaluation_contract_is_exact() then
    raise exception 'treatment_stage_requires_exact_inactive_evaluation_contract';
  end if;

  with current_gold as (
    select distinct on (g.request_id) g.request_id, g.input_hash
    from public.request_segmentation_gold_adjudications g
    where g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      and public.neontrip_compute_request_segment_input_hash(g.request_id) = g.input_hash
    order by g.request_id, g.created_at desc, g.id desc
  )
  select count(*) into v_current_gold_count from current_gold;

  select count(*) into v_candidate_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_classifications
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_cache
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_approvals
  from public.request_segmentation_activation_approvals a
  where a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
     or a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus';

  if v_current_gold_count <> 4
     or v_candidate_jobs <> 0
     or v_candidate_classifications <> 0
     or v_candidate_cache <> 0
     or v_candidate_approvals <> 0 then
    raise exception using
      errcode = '55000',
      message = 'treatment_stage_requires_four_current_gold_and_pristine_lane',
      detail = format(
        'gold=%s jobs=%s classifications=%s cache=%s approvals=%s',
        v_current_gold_count, v_candidate_jobs, v_candidate_classifications,
        v_candidate_cache, v_candidate_approvals
      );
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|',
      r.id::text, r.segment, r.s_kategorie, r.segment_status,
      r.segment_source, r.segment_taxonomy_version,
      array_to_string(r.segment_context_tags, ','), r.segment_organization_scale
    ),
    '|' order by r.id
  ), ''))
  into v_master_hash
  from public.master_requests r;

  perform set_config('neontrip.treatment_master_hash', v_master_hash, true);
end;
$treatment_stage_precondition$;

do $treatment_stage_four_current_gold_jobs$
declare
  v_inserted integer;
begin
  with current_gold as (
    select distinct on (g.request_id)
      g.request_id,
      g.input_hash,
      r.request_id as request_public_id
    from public.request_segmentation_gold_adjudications g
    join public.master_requests r on r.id = g.request_id
    where g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      and public.neontrip_compute_request_segment_input_hash(g.request_id) = g.input_hash
    order by g.request_id, g.created_at desc, g.id desc
  ), inserted as (
    insert into public.request_segmentation_jobs (
      request_id, request_public_id, input_hash, source, status, priority,
      attempts, max_attempts, next_attempt_at, metadata,
      taxonomy_version, classifier_version, prompt_version
    )
    select
      cg.request_id,
      cg.request_public_id,
      cg.input_hash,
      'gold_re_evaluation_phase7_treatment',
      'pending',
      900,
      0,
      3,
      now(),
      jsonb_build_object(
        'evaluation_only', true,
        'master_projection_authorized', false,
        'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
        'classifier_version', 'segment_classifier_v6_20260820_treatment_focus',
        'prompt_version', 'segment_prompt_v6_20260820_treatment_focus',
        'policy_version', 'nt_policy_v5_20260820_treatment_focus_shadow',
        'quality_gate_version', 'nt_quality_gate_v5_20260820_treatment_focus',
        'research_contract', 'segment_research_v2_20260820_domain_filter',
        'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special',
        'validator_version', 'n8n_cx8_validator_v3',
        'research_model', 'gpt-4o-mini-2024-07-18',
        'classifier_model', 'gpt-5.5-2026-04-23',
        'classifier_reasoning_effort', 'medium',
        'staged_by', 'phase7-treatment-held-four-current-gold',
        'staged_at', now()
      ),
      'nt_taxonomy_v2_20260819_cx8',
      'segment_classifier_v6_20260820_treatment_focus',
      'segment_prompt_v6_20260820_treatment_focus'
    from current_gold cg
    returning id
  )
  select count(*) into v_inserted from inserted;

  if v_inserted <> 4 then
    raise exception 'treatment_stage_did_not_insert_exactly_four_jobs: %', v_inserted;
  end if;
end;
$treatment_stage_four_current_gold_jobs$;

do $treatment_stage_postcondition$
declare
  v_job_count integer;
  v_invalid_job_count integer;
  v_candidate_classifications integer;
  v_candidate_cache integer;
  v_master_hash text;
begin
  select
    count(*),
    count(*) filter (
      where j.source <> 'gold_re_evaluation_phase7_treatment'
         or j.status <> 'pending'
         or j.priority <> 900
         or j.attempts <> 0
         or j.max_attempts <> 3
         or j.lock_owner is not null
         or j.locked_at is not null
         or j.last_classification_id is not null
         or lower(coalesce(j.metadata->>'evaluation_only', 'false')) <> 'true'
         or lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) <> 'false'
         or j.metadata->>'policy_version' <> 'nt_policy_v5_20260820_treatment_focus_shadow'
         or j.metadata->>'quality_gate_version' <> 'nt_quality_gate_v5_20260820_treatment_focus'
         or j.metadata->>'research_contract' <> 'segment_research_v2_20260820_domain_filter'
         or j.metadata->>'treatment_contract' <> 'treatment_focus_v1_20260820_standard_vs_special'
         or j.metadata->>'validator_version' <> 'n8n_cx8_validator_v3'
         or j.metadata->>'research_model' <> 'gpt-4o-mini-2024-07-18'
         or j.metadata->>'classifier_model' <> 'gpt-5.5-2026-04-23'
         or j.metadata->>'classifier_reasoning_effort' <> 'medium'
         or public.neontrip_compute_request_segment_input_hash(j.request_id) <> j.input_hash
         or not exists (
           select 1
           from public.request_segmentation_gold_adjudications g
           where g.request_id = j.request_id
             and g.input_hash = j.input_hash
             and g.taxonomy_version = j.taxonomy_version
             and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
         )
    )
  into v_job_count, v_invalid_job_count
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_classifications
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_cache
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus';

  select md5(coalesce(string_agg(
    concat_ws('|',
      r.id::text, r.segment, r.s_kategorie, r.segment_status,
      r.segment_source, r.segment_taxonomy_version,
      array_to_string(r.segment_context_tags, ','), r.segment_organization_scale
    ),
    '|' order by r.id
  ), ''))
  into v_master_hash
  from public.master_requests r;

  if v_job_count <> 4
     or v_invalid_job_count <> 0
     or v_candidate_classifications <> 0
     or v_candidate_cache <> 0
     or v_master_hash is distinct from current_setting('neontrip.treatment_master_hash', true)
     or not public.neontrip_treatment_evaluation_contract_is_exact() then
    raise exception using
      errcode = '55000',
      message = 'treatment_stage_postcondition_failed',
      detail = format(
        'jobs=%s invalid=%s classifications=%s cache=%s master_unchanged=%s',
        v_job_count, v_invalid_job_count, v_candidate_classifications,
        v_candidate_cache,
        v_master_hash is not distinct from current_setting('neontrip.treatment_master_hash', true)
      );
  end if;
end;
$treatment_stage_postcondition$;

commit;
