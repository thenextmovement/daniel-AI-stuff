-- The treatment-only 20-argument Record overload could derive SQL NULL for
-- mapping_integrity when a needs_review proposal intentionally had no final
-- classifier segment. The target column is NOT NULL; coalesce the deterministic
-- mapping check to false without changing the 18/19-argument production paths.

begin;

do $treatment_mapping_integrity_null_fix$
declare
  v_signature constant text :=
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)';
  v_function_oid oid;
  v_function_definition text;
  v_old_definition_md5 text;
  v_new_definition_md5 text;
  v_overload_18_md5_before text;
  v_overload_19_md5_before text;
  v_old_fragment constant text := $old_fragment$
  v_mapping_integrity :=
    p_segment is not null
    and v_policy_rule.segment = p_segment
    and v_policy_rule.s_kategorie is not null
    and v_classifier_json->>'segment' = p_segment
    and v_classifier_json->>'s_kategorie' = v_policy_rule.s_kategorie;
$old_fragment$;
  v_new_fragment constant text := $new_fragment$
  v_mapping_integrity := coalesce((
    p_segment is not null
    and v_policy_rule.segment = p_segment
    and v_policy_rule.s_kategorie is not null
    and v_classifier_json->>'segment' = p_segment
    and v_classifier_json->>'s_kategorie' = v_policy_rule.s_kategorie
  ), false);
$new_fragment$;
begin
  v_function_oid := to_regprocedure(v_signature);
  if v_function_oid is null then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_fix_missing_20_arg_function';
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
      message = 'treatment_record_mapping_fix_runtime_not_paused';
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
      message = 'treatment_record_mapping_fix_neighbor_overload_missing';
  end if;

  v_function_definition := pg_get_functiondef(v_function_oid);
  v_old_definition_md5 := md5(v_function_definition);

  if v_old_definition_md5 <> 'd044af0edef486594b5869bc5575163a'
     or (length(v_function_definition) - length(replace(
       v_function_definition, v_old_fragment, ''
     ))) / length(v_old_fragment) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'treatment_record_mapping_fix_source_drift';
  end if;

  v_function_definition := replace(
    v_function_definition,
    v_old_fragment,
    v_new_fragment
  );
  execute v_function_definition;

  v_function_oid := to_regprocedure(v_signature);
  v_new_definition_md5 := md5(pg_get_functiondef(v_function_oid));

  if v_new_definition_md5 <> 'dd0202c8ed45e3568631f4ab02014961'
     or position(
       'v_mapping_integrity := coalesce((' in pg_get_functiondef(v_function_oid)
     ) = 0
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
      message = 'treatment_record_mapping_fix_postcondition_failed';
  end if;
end;
$treatment_mapping_integrity_null_fix$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) is
  'Treatment-focused 20-argument Record overload. Mapping integrity is total boolean: an incomplete needs-review proposal records false, never SQL NULL. All existing evaluation-only, projection, cache and action gates remain unchanged.';

commit;
