-- Full pre-runtime rollback. Valid only before any v7 job, classification,
-- cache or approval exists and while Phase-2 is still the sole active lane.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share row exclusive mode;
lock table public.segment_research_cache in share row exclusive mode;
lock table public.request_segmentation_activation_approvals in share row exclusive mode;

do $treatment_shadow_full_rollback_precondition$
begin
  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1 from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v2_20260819_cx8_shadow' and p.active
         and q.version = 'nt_quality_gate_v2_20260819_cx8' and q.active
     )
     or not exists (
       select 1 from public.segment_policy_versions p
       join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow' and not p.active
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow' and not q.active
     )
     or exists (
       select 1 from public.request_segmentation_jobs
       where classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
     )
     or exists (
       select 1 from public.request_segment_classifications
       where classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
     )
     or exists (
       select 1 from public.segment_research_cache
       where summary_json->>'classifier_version' = 'segment_classifier_v7_20260821_treatment_shadow'
          or summary_json->>'prompt_version' = 'segment_prompt_v7_20260821_treatment_shadow'
     )
     or exists (
       select 1 from public.request_segmentation_activation_approvals
       where policy_version = 'nt_policy_v6_20260821_treatment_shadow'
          or quality_gate_version = 'nt_quality_gate_v6_20260821_treatment_shadow'
     )
     or md5(pg_get_functiondef(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
     )) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_full_rollback_precondition_failed';
  end if;
end;
$treatment_shadow_full_rollback_precondition$;

drop function public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid);

delete from public.segment_policy_rules
where policy_version = 'nt_policy_v6_20260821_treatment_shadow';

delete from public.segment_policy_versions
where version = 'nt_policy_v6_20260821_treatment_shadow' and not active;

delete from public.segment_quality_gate_versions
where version = 'nt_quality_gate_v6_20260821_treatment_shadow' and not active;

do $treatment_shadow_restore_record$
declare
  v_definition text;
  v_replaced text;
  v_new text := $new$      and v_active_policy.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and (
        (
          v_active_policy.classifier_version = 'segment_classifier_v3_20260819_cx8'
          and v_active_policy.prompt_version = 'segment_prompt_v4_20260819_cx8'
          and p_accepted_by = 'n8n-request-segmenter-v3'
        )
        or (
          v_active_policy.classifier_version = 'segment_classifier_v4_20260820_cx8'
          and v_active_policy.prompt_version = 'segment_prompt_v4_20260819_cx8'
          and p_accepted_by = 'n8n-request-segmenter-v4'
        )
        or (
          v_active_policy.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
          and v_active_policy.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
          and p_accepted_by = 'n8n-request-segmenter-v7-treatment-shadow'
        )
      )$new$;
  v_old text := $old$      and v_active_policy.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and v_active_policy.prompt_version = 'segment_prompt_v4_20260819_cx8'
      and (
        (
          v_active_policy.classifier_version = 'segment_classifier_v3_20260819_cx8'
          and p_accepted_by = 'n8n-request-segmenter-v3'
        )
        or (
          v_active_policy.classifier_version = 'segment_classifier_v4_20260820_cx8'
          and p_accepted_by = 'n8n-request-segmenter-v4'
        )
      )$old$;
begin
  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;
  if md5(v_definition) <> '4dfc1d420a265ee7c13aa4658dec4e6a'
     or (length(v_definition) - length(replace(v_definition, v_new, ''))) / length(v_new) <> 1 then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_full_rollback_record_drift';
  end if;

  v_replaced := replace(v_definition, v_new, v_old);
  execute v_replaced;

  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;
  if md5(v_definition) <> '0ab12d2ba650117b1151eb4729949547' then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_full_rollback_record_postcondition_failed';
  end if;
end;
$treatment_shadow_restore_record$;

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';

commit;
