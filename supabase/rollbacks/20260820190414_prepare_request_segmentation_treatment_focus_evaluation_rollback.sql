-- Full pre-runtime rollback for the Treatment-focus Phase-7 additive database contract.
-- This is intentionally valid only before any v5 job/classification/cache or
-- candidate approval exists. It preserves Phase 2 and the existing 18- and
-- 19-argument Record RPCs byte-for-byte.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_activation_approvals in share mode;

do $treatment_base_rollback_precondition$
declare
  v_jobs integer;
  v_classifications integer;
  v_cache integer;
  v_approvals integer;
begin
  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v2_20260819_cx8_shadow'
         and p.active and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
         and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
         and q.version = 'nt_quality_gate_v2_20260819_cx8'
         and q.active
     )
     or not exists (
       select 1 from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
         and not p.active and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
         and p.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
         and q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
         and not q.active
     ) then
    raise exception 'treatment_base_rollback_contract_state_mismatch';
  end if;

  select count(*) into v_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_classifications
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_cache
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_approvals
  from public.request_segmentation_activation_approvals a
  where a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
     or a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus';

  if v_jobs <> 0 or v_classifications <> 0 or v_cache <> 0 or v_approvals <> 0 then
    raise exception using
      errcode = '55000',
      message = 'treatment_base_rollback_requires_zero_candidate_runtime',
      detail = format(
        'jobs=%s classifications=%s cache=%s approvals=%s',
        v_jobs, v_classifications, v_cache, v_approvals
      );
  end if;
end;
$treatment_base_rollback_precondition$;

drop view public.request_segmentation_v5_production_readiness;
drop view public.request_segmentation_v5_activation_approval_status;
drop view public.request_segmentation_v5_activation_gate_status;
drop view public.request_segmentation_v5_mapping_integrity;
drop view public.request_segmentation_v5_quality_summary;
drop view public.request_segmentation_v5_segment_quality;
drop view public.request_segmentation_v5_confusion_matrix;
drop view public.request_segmentation_v5_gold_evaluation;

drop function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
);
drop function public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid);
drop function public.neontrip_claim_request_segmentation_treatment_evaluation(integer, text, integer);
drop function public.neontrip_treatment_evaluation_research_context(uuid);
drop function public.neontrip_treatment_redact_segmentation_text(text, integer, text[]);
drop function public.neontrip_treatment_evaluation_contract_is_exact();

delete from public.segment_policy_rules
where policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow';

delete from public.segment_policy_versions
where version = 'nt_policy_v5_20260820_treatment_focus_shadow'
  and not active;

delete from public.segment_quality_gate_versions
where version = 'nt_quality_gate_v5_20260820_treatment_focus'
  and not active;

do $treatment_base_rollback_postcondition$
begin
  if to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text)') is null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)') is null
     or exists (select 1 from public.segment_policy_versions where version = 'nt_policy_v5_20260820_treatment_focus_shadow')
     or exists (select 1 from public.segment_quality_gate_versions where version = 'nt_quality_gate_v5_20260820_treatment_focus')
     or (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1 from public.segment_policy_versions
       where version = 'nt_policy_v2_20260819_cx8_shadow' and active
     ) then
    raise exception 'treatment_base_rollback_postcondition_failed';
  end if;
end;
$treatment_base_rollback_postcondition$;

notify pgrst, 'reload schema';

commit;
