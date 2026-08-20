-- Aggregate-only, PII-free prechange snapshot for the Treatment-focus Phase-7 evaluation lane.
-- Read-only: this file contains SELECT statements only and deliberately emits
-- no request/customer/job/classification/Gold IDs or free text.

select
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  now() as captured_at;

select
  'active_contract_counts'::text as snapshot,
  (select count(*)::integer from public.segment_policy_versions where active)
    as global_active_policy_count,
  (select count(*)::integer from public.segment_quality_gate_versions where active)
    as global_active_gate_count,
  (
    select count(*)::integer
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q
      on q.version = p.quality_gate_version
     and q.taxonomy_version = p.taxonomy_version
     and q.classifier_version = p.classifier_version
     and q.prompt_version = p.prompt_version
    where p.version = 'nt_policy_v2_20260819_cx8_shadow'
      and p.active
      and q.version = 'nt_quality_gate_v2_20260819_cx8'
      and q.active
  ) as exact_active_phase2_pair,
  (
    select count(*)::integer
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q
      on q.version = p.quality_gate_version
     and q.taxonomy_version = p.taxonomy_version
     and q.classifier_version = p.classifier_version
     and q.prompt_version = p.prompt_version
    where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and not p.active
      and q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
      and not q.active
  ) as exact_inactive_treatment_pair;

select
  q.version,
  q.active,
  q.taxonomy_version,
  q.classifier_version,
  q.prompt_version,
  q.min_unique_gold_total,
  q.min_gold_per_segment,
  q.min_precision_per_predicted_class,
  q.min_recall_per_actual_class,
  q.min_accepted_coverage,
  q.critical_segments,
  q.min_critical_precision,
  q.required_mapping_integrity,
  q.max_provenance_violations,
  q.manual_activation_required
from public.segment_quality_gate_versions q
where q.version in (
  'nt_quality_gate_v2_20260819_cx8',
  'nt_quality_gate_v5_20260820_treatment_focus'
)
order by q.version;

select
  r.policy_version,
  count(*)::integer as rule_count,
  count(*) filter (
    where r.automation_enabled
       or r.needs_human_review
       or r.price_factor is not null
       or r.max_followups <> 0
       or r.first_call_after_minutes is not null
       or r.call_sequence <> '[]'::jsonb
       or r.email_sequence <> '[]'::jsonb
  )::integer as non_inert_rule_count,
  jsonb_object_agg(
    r.segment,
    jsonb_build_array(r.s_kategorie, r.min_confidence, r.sales_priority)
    order by r.segment
  ) as mapping
from public.segment_policy_rules r
where r.policy_version in (
  'nt_policy_v2_20260819_cx8_shadow',
  'nt_policy_v5_20260820_treatment_focus_shadow'
)
group by r.policy_version
order by r.policy_version;

with latest_current_gold as (
  select distinct on (g.request_id)
    g.request_id,
    g.labeled_segment,
    g.labeled_s_kategorie
  from public.request_segmentation_gold_adjudications g
  where g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
    and public.neontrip_compute_request_segment_input_hash(g.request_id) = g.input_hash
  order by g.request_id, g.created_at desc, g.id desc
)
select
  labeled_segment,
  labeled_s_kategorie,
  count(*)::integer as current_gold_count
from latest_current_gold
group by labeled_segment, labeled_s_kategorie
order by labeled_segment, labeled_s_kategorie;

select
  j.classifier_version,
  j.prompt_version,
  j.status,
  count(*)::integer as job_count,
  count(*) filter (
    where lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
  )::integer as evaluation_only_count,
  min(j.attempts)::integer as minimum_attempts,
  max(j.attempts)::integer as maximum_attempts
from public.request_segmentation_jobs j
where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
  and j.classifier_version in (
    'segment_classifier_v4_20260820_cx8',
    'segment_classifier_v5_20260820_cx8',
    'segment_classifier_v6_20260820_treatment_focus'
  )
group by j.classifier_version, j.prompt_version, j.status
order by j.classifier_version, j.prompt_version, j.status;

select
  c.classifier_version,
  c.prompt_version,
  c.status,
  count(*)::integer as classification_count,
  count(*) filter (where c.evidence_provenance_valid)::integer as provenance_valid_count,
  count(*) filter (where c.mapping_integrity)::integer as mapping_integrity_count
from public.request_segment_classifications c
where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
  and c.classifier_version in (
    'segment_classifier_v4_20260820_cx8',
    'segment_classifier_v5_20260820_cx8',
    'segment_classifier_v6_20260820_treatment_focus'
  )
group by c.classifier_version, c.prompt_version, c.status
order by c.classifier_version, c.prompt_version, c.status;

select
  coalesce(c.summary_json->>'classifier_version', '__missing__') as classifier_version,
  count(*)::integer as research_cache_count
from public.segment_research_cache c
where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
group by coalesce(c.summary_json->>'classifier_version', '__missing__')
order by classifier_version;

select
  'master_authority_baseline'::text as snapshot,
  count(*)::integer as master_request_count,
  md5(coalesce(string_agg(
    concat_ws('|',
      r.id::text, r.segment, r.s_kategorie, r.segment_status,
      r.segment_source, r.segment_taxonomy_version,
      array_to_string(r.segment_context_tags, ','), r.segment_organization_scale
    ),
    '|' order by r.id
  ), '')) as master_authority_hash
from public.master_requests r;

select
  'activation_approval_counts'::text as snapshot,
  count(*)::integer as all_activation_approvals,
  count(*) filter (
    where a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
       or a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus'
  )::integer as treatment_activation_approvals
from public.request_segmentation_activation_approvals a;

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  md5(pg_get_functiondef(p.oid)) as definition_md5,
  p.prosecdef as security_definer,
  coalesce(array_length(p.proacl, 1), 0)::integer as acl_entry_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'neontrip_treatment_evaluation_contract_is_exact',
    'neontrip_treatment_redact_segmentation_text',
    'neontrip_treatment_evaluation_research_context',
    'neontrip_claim_request_segmentation_treatment_evaluation',
    'neontrip_get_request_segmentation_treatment_evaluation_payload',
    'neontrip_record_request_segment_classification'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select
  count(*) filter (
    where pg_get_function_identity_arguments(p.oid)
      = 'p_job_id uuid, p_request_id uuid, p_input_hash text, p_status text, p_segment text, p_confidence numeric, p_evidence_grade text, p_reasoning_short text, p_reason_codes text[], p_evidence_json jsonb, p_firmographic_json jsonb, p_classifier_json jsonb, p_risk_flags text[], p_model text, p_model_version text, p_prompt_version text, p_classifier_version text, p_accepted_by text'
  )::integer as existing_record_18_argument_overload,
  count(*) filter (
    where pg_get_function_identity_arguments(p.oid)
      = 'p_job_id uuid, p_request_id uuid, p_input_hash text, p_status text, p_segment text, p_confidence numeric, p_evidence_grade text, p_reasoning_short text, p_reason_codes text[], p_evidence_json jsonb, p_firmographic_json jsonb, p_classifier_json jsonb, p_risk_flags text[], p_model text, p_model_version text, p_prompt_version text, p_classifier_version text, p_accepted_by text, p_research_contract text'
  )::integer as existing_record_19_argument_overload,
  count(*) filter (
    where pg_get_function_identity_arguments(p.oid)
      = 'p_job_id uuid, p_request_id uuid, p_input_hash text, p_status text, p_segment text, p_confidence numeric, p_evidence_grade text, p_reasoning_short text, p_reason_codes text[], p_evidence_json jsonb, p_firmographic_json jsonb, p_classifier_json jsonb, p_risk_flags text[], p_model text, p_model_version text, p_prompt_version text, p_classifier_version text, p_accepted_by text, p_research_contract text, p_treatment_contract text'
  )::integer as treatment_record_20_argument_overload
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'neontrip_record_request_segment_classification';
