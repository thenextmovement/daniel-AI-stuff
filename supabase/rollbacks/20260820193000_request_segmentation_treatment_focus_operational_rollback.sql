-- History-preserving operational stop for Treatment-focus Phase 7 after staging/runtime.
-- It revokes only the three service-role execution surfaces. It does not
-- delete, retry, reset or rewrite jobs, classifications, Gold, cache, master
-- authority, policies, gates, approvals or evaluation views.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_quality_gate_versions in share mode;
lock table public.segment_policy_versions in share mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_gold_adjudications in share mode;

do $treatment_operational_stop_precondition$
declare
  v_processing integer;
  v_history_hash text;
begin
  if not public.neontrip_treatment_evaluation_contract_is_exact() then
    raise exception 'treatment_operational_stop_requires_exact_inactive_evaluation_contract';
  end if;

  select count(*) into v_processing
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and j.status = 'processing';

  if v_processing <> 0 then
    raise exception 'treatment_operational_stop_requires_zero_processing_jobs: %', v_processing;
  end if;

  if to_regprocedure('public.neontrip_claim_request_segmentation_treatment_evaluation(integer,text,integer)') is null
     or to_regprocedure('public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)') is null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)') is null then
    raise exception 'treatment_operational_stop_rpc_missing';
  end if;

  select md5(concat_ws('|',
    coalesce((
      select string_agg(to_jsonb(j)::text, '|' order by j.id)
      from public.request_segmentation_jobs j
      where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
        and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(c)::text, '|' order by c.id)
      from public.request_segment_classifications c
      where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
        and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(g)::text, '|' order by g.id)
      from public.request_segmentation_gold_adjudications g
      where g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(c)::text, '|' order by c.cache_key)
      from public.segment_research_cache c
      where c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    ), '')
  )) into v_history_hash;

  perform set_config('neontrip.treatment_history_hash', v_history_hash, true);
end;
$treatment_operational_stop_precondition$;

revoke execute on function public.neontrip_claim_request_segmentation_treatment_evaluation(integer, text, integer)
  from service_role;
revoke execute on function public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)
  from service_role;
revoke execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) from service_role;

do $treatment_operational_stop_postcondition$
declare
  v_history_hash text;
begin
  if has_function_privilege(
       'service_role',
       'public.neontrip_claim_request_segmentation_treatment_evaluation(integer,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)',
       'EXECUTE'
     ) then
    raise exception 'treatment_operational_stop_execute_revoke_failed';
  end if;

  select md5(concat_ws('|',
    coalesce((
      select string_agg(to_jsonb(j)::text, '|' order by j.id)
      from public.request_segmentation_jobs j
      where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
        and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(c)::text, '|' order by c.id)
      from public.request_segment_classifications c
      where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
        and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(g)::text, '|' order by g.id)
      from public.request_segmentation_gold_adjudications g
      where g.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    ), ''),
    coalesce((
      select string_agg(to_jsonb(c)::text, '|' order by c.cache_key)
      from public.segment_research_cache c
      where c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    ), '')
  )) into v_history_hash;

  if v_history_hash is distinct from current_setting('neontrip.treatment_history_hash', true)
     or not public.neontrip_treatment_evaluation_contract_is_exact() then
    raise exception 'treatment_operational_stop_history_or_contract_changed';
  end if;
end;
$treatment_operational_stop_postcondition$;

notify pgrst, 'reload schema';

commit;
