-- Operational stop: return classification ingress to the exact Phase-2 v3
-- shadow contract. Candidate jobs/classifications remain immutable history.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;

do $treatment_shadow_operational_rollback_precondition$
begin
  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow'
         and p.active and p.mode = 'shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
         and q.active
     )
     or exists (
       select 1 from public.request_segmentation_jobs
       where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and (status = 'processing' or lock_owner is not null or locked_at is not null)
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_operational_rollback_not_safe';
  end if;
end;
$treatment_shadow_operational_rollback_precondition$;

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v6_20260821_treatment_shadow' and active;

update public.segment_quality_gate_versions
set active = false
where version = 'nt_quality_gate_v6_20260821_treatment_shadow' and active;

update public.segment_quality_gate_versions
set active = true
where version = 'nt_quality_gate_v2_20260819_cx8' and not active;

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v2_20260819_cx8_shadow' and not active;

do $treatment_shadow_operational_rollback_postcondition$
begin
  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v2_20260819_cx8_shadow'
         and p.active and p.mode = 'shadow'
         and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
         and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
         and q.version = 'nt_quality_gate_v2_20260819_cx8'
         and q.active
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_operational_rollback_postcondition_failed';
  end if;
end;
$treatment_shadow_operational_rollback_postcondition$;

commit;
