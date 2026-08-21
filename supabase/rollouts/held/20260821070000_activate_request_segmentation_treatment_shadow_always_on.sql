-- HELD: activate the permanent simplified treatment classifier in shadow.
-- Apply only after the exact candidate n8n graph is published, Draft=Active,
-- and a natural candidate-version Claim returns zero while Phase-2 is active.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_activation_approvals in share mode;

do $treatment_shadow_activation_precondition$
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
         and q.version = 'nt_quality_gate_v2_20260819_cx8' and q.active
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_requires_exact_phase2_active';
  end if;

  if not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow'
         and not p.active and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
         and not q.active
         and q.taxonomy_version = p.taxonomy_version
         and q.classifier_version = p.classifier_version
         and q.prompt_version = p.prompt_version
     )
     or (select count(*) from public.segment_policy_rules
         where policy_version = 'nt_policy_v6_20260821_treatment_shadow') <> 8
     or exists (
       select 1 from public.segment_policy_rules
       where policy_version = 'nt_policy_v6_20260821_treatment_shadow'
         and (
           taxonomy_version is distinct from 'nt_taxonomy_v2_20260819_cx8'
           or automation_enabled or needs_human_review or price_factor is not null
           or max_followups <> 0 or first_call_after_minutes is not null
           or call_sequence <> '[]'::jsonb or email_sequence <> '[]'::jsonb
         )
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_candidate_contract_drift';
  end if;

  if exists (
       select 1 from public.request_segmentation_jobs
       where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and classifier_version = 'segment_classifier_v3_20260819_cx8'
         and prompt_version = 'segment_prompt_v4_20260819_cx8'
         and (
           status in ('pending', 'processing')
           or (status = 'failed' and attempts < max_attempts)
         )
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_old_contract_not_drained';
  end if;

  if exists (
       select 1 from public.request_segmentation_jobs
       where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
     )
     or exists (
       select 1 from public.request_segment_classifications
       where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
     )
     or exists (
       select 1 from public.segment_research_cache
       where summary_json->>'classifier_version' = 'segment_classifier_v7_20260821_treatment_shadow'
         and summary_json->>'prompt_version' = 'segment_prompt_v7_20260821_treatment_shadow'
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_candidate_runtime_not_pristine';
  end if;

  if md5(pg_get_functiondef(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
     )) <> '4dfc1d420a265ee7c13aa4658dec4e6a'
     or to_regprocedure('public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)') is null then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_runtime_surface_drift';
  end if;
end;
$treatment_shadow_activation_precondition$;

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v2_20260819_cx8_shadow' and active;

update public.segment_quality_gate_versions
set active = false
where version = 'nt_quality_gate_v2_20260819_cx8' and active;

update public.segment_quality_gate_versions
set active = true
where version = 'nt_quality_gate_v6_20260821_treatment_shadow' and not active;

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v6_20260821_treatment_shadow' and not active;

do $treatment_shadow_activation_postcondition$
begin
  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow'
         and p.active and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
         and q.active
     )
     or exists (
       select 1 from public.segment_policy_rules
       where policy_version = 'nt_policy_v6_20260821_treatment_shadow'
         and (
           automation_enabled or needs_human_review or price_factor is not null
           or max_followups <> 0 or first_call_after_minutes is not null
           or call_sequence <> '[]'::jsonb or email_sequence <> '[]'::jsonb
         )
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_activation_postcondition_failed';
  end if;
end;
$treatment_shadow_activation_postcondition$;

commit;
