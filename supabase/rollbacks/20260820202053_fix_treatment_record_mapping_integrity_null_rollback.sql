-- Emergency code rollback for the treatment-only Record hotfix. This restores
-- the exact pre-fix 20-argument function and therefore also restores its known
-- NULL-on-needs-review defect. Keep the candidate lane paused while applying.

begin;

do $treatment_mapping_integrity_null_rollback$
declare
  v_signature constant text :=
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)';
  v_function_oid oid;
  v_function_definition text;
  v_overload_18_md5_before text;
  v_overload_19_md5_before text;
  v_fixed_fragment constant text := $fixed_fragment$
  v_mapping_integrity := coalesce((
    p_segment is not null
    and v_policy_rule.segment = p_segment
    and v_policy_rule.s_kategorie is not null
    and v_classifier_json->>'segment' = p_segment
    and v_classifier_json->>'s_kategorie' = v_policy_rule.s_kategorie
  ), false);
$fixed_fragment$;
  v_previous_fragment constant text := $previous_fragment$
  v_mapping_integrity :=
    p_segment is not null
    and v_policy_rule.segment = p_segment
    and v_policy_rule.s_kategorie is not null
    and v_classifier_json->>'segment' = p_segment
    and v_classifier_json->>'s_kategorie' = v_policy_rule.s_kategorie;
$previous_fragment$;
begin
  v_function_oid := to_regprocedure(v_signature);
  if v_function_oid is null then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_rollback_missing_20_arg_function';
  end if;

  if exists (
    select 1
    from public.segment_policy_versions
    where version = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and active
  ) or exists (
    select 1
    from public.segment_quality_gate_versions
    where version = 'nt_quality_gate_v5_20260820_treatment_focus'
      and active
  ) or exists (
    select 1
    from public.request_segmentation_jobs
    where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and (status = 'processing' or locked_at is not null or lock_owner is not null)
  ) then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_rollback_runtime_not_paused';
  end if;

  select md5(pg_get_functiondef(to_regprocedure(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'
  ))) into v_overload_18_md5_before;

  select md5(pg_get_functiondef(to_regprocedure(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text)'
  ))) into v_overload_19_md5_before;

  if v_overload_18_md5_before is null or v_overload_19_md5_before is null then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_rollback_neighbor_overload_missing';
  end if;

  v_function_definition := pg_get_functiondef(v_function_oid);
  if md5(v_function_definition) <> 'dd0202c8ed45e3568631f4ab02014961'
     or (length(v_function_definition) - length(replace(
       v_function_definition, v_fixed_fragment, ''
     ))) / length(v_fixed_fragment) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_rollback_source_drift';
  end if;

  execute replace(v_function_definition, v_fixed_fragment, v_previous_fragment);
  v_function_oid := to_regprocedure(v_signature);

  if md5(pg_get_functiondef(v_function_oid)) <> 'd044af0edef486594b5869bc5575163a'
     or md5(pg_get_functiondef(to_regprocedure(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'
     ))) is distinct from v_overload_18_md5_before
     or md5(pg_get_functiondef(to_regprocedure(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text)'
     ))) is distinct from v_overload_19_md5_before
     or not has_function_privilege('service_role', v_function_oid, 'EXECUTE')
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_rollback_postcondition_failed';
  end if;
end;
$treatment_mapping_integrity_null_rollback$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) is
  'Treatment-focused 20-argument Record overload restored to the pre-hotfix definition. The candidate evaluation lane must remain paused until the mapping-integrity NULL defect is repaired again.';

commit;
