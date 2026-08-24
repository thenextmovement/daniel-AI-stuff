-- Add a deliberately narrow live consumer for the permanent NEONTRIP
-- treatment-shadow classifier.
--
-- The classifier itself remains shadow-only and all commercial policy rules
-- remain inert. This migration only permits a one-way communication effect:
-- a deterministically verified special case may suppress the single automatic
-- unopened-offer email and route the offer to personal follow-up instead.
-- Missing, stale, malformed, standard or review classifications preserve the
-- existing one-email reminder path. No classification is projected to master
-- data and this function performs no writes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share row exclusive mode;

do $reminder_treatment_precondition$
begin
  if to_regprocedure(
       'public.neontrip_get_request_reminder_treatment_decision(uuid)'
     ) is not null then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_decision_already_exists';
  end if;

  if (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q
         on q.version = p.quality_gate_version
        and q.taxonomy_version = p.taxonomy_version
        and q.classifier_version = p.classifier_version
        and q.prompt_version = p.prompt_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow'
         and p.active
         and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
         and q.active
     )
     or (select count(*) from public.segment_policy_rules
         where policy_version = 'nt_policy_v6_20260821_treatment_shadow') <> 8
     or exists (
       select 1
       from public.segment_policy_rules r
       where r.policy_version = 'nt_policy_v6_20260821_treatment_shadow'
         and (
           r.taxonomy_version is distinct from 'nt_taxonomy_v2_20260819_cx8'
           or r.automation_enabled
           or r.needs_human_review
           or r.price_factor is not null
           or r.max_followups <> 0
           or r.first_call_after_minutes is not null
           or r.call_sequence <> '[]'::jsonb
           or r.email_sequence <> '[]'::jsonb
         )
     ) then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_active_contract_drift';
  end if;

  if exists (
    select 1
    from public.request_segmentation_jobs j
    where j.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
      and (
        j.status = 'processing'
        or j.lock_owner is not null
        or j.locked_at is not null
      )
  ) then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_requires_idle_classifier';
  end if;

  if md5(pg_get_functiondef(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
     )) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_record_function_drift';
  end if;
end;
$reminder_treatment_precondition$;

-- The canonical record function already validates source binding, positive
-- evidence, organization-scale evidence and mapping integrity. Its validator
-- version check still named the older v1 worker, however, so every v7 row was
-- marked provenance-invalid even when the same deterministic checks passed.
-- Change only that single version selector; all other classifiers retain v1.
do $reminder_treatment_patch_provenance$
declare
  v_definition text;
  v_replaced text;
  v_expected_md5 text;
  v_old text := $old$    and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'$old$;
  v_new text := $new$    and v_provenance->>'validator_version' = case
      when v_active_policy.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
        and v_active_policy.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
        and v_active_policy.mode = 'shadow'
        then 'n8n_cx8_validator_v4'
      else 'n8n_cx8_validator_v1'
    end$new$;
begin
  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;

  if md5(v_definition) <> '4dfc1d420a265ee7c13aa4658dec4e6a'
     or (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_provenance_patch_precondition_failed';
  end if;

  v_replaced := replace(v_definition, v_old, v_new);
  v_expected_md5 := md5(v_replaced);
  execute v_replaced;

  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;

  if md5(v_definition) <> v_expected_md5
     or strpos(v_definition, v_new) = 0
     or strpos(v_definition, v_old) <> 0 then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_provenance_patch_postcondition_failed';
  end if;
end;
$reminder_treatment_patch_provenance$;

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

create function public.neontrip_get_request_reminder_treatment_decision(
  p_request_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $function$
  with exact_contract as (
    select p.version, p.taxonomy_version, p.classifier_version, p.prompt_version
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q
      on q.version = p.quality_gate_version
     and q.taxonomy_version = p.taxonomy_version
     and q.classifier_version = p.classifier_version
     and q.prompt_version = p.prompt_version
    where p.version = 'nt_policy_v6_20260821_treatment_shadow'
      and p.active
      and p.mode = 'shadow'
      and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
      and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
      and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
      and q.active
      and (select count(*) from public.segment_policy_versions where active) = 1
      and (select count(*) from public.segment_quality_gate_versions where active) = 1
      and (select count(*) from public.segment_policy_rules r
           where r.policy_version = p.version) = 8
      and not exists (
        select 1
        from public.segment_policy_rules r
        where r.policy_version = p.version
          and (
            r.taxonomy_version is distinct from p.taxonomy_version
            or r.automation_enabled
            or r.needs_human_review
            or r.price_factor is not null
            or r.max_followups <> 0
            or r.first_call_after_minutes is not null
            or r.call_sequence <> '[]'::jsonb
            or r.email_sequence <> '[]'::jsonb
          )
      )
  ),
  request_state as (
    select
      mr.id,
      mr.segment,
      mr.segment_status,
      mr.segment_source,
      mr.segment_taxonomy_version,
      mr.segment_organization_scale,
      public.neontrip_compute_request_segment_input_hash(mr.id) as current_input_hash,
      (
        mr.segment_status = 'accepted'
        and mr.segment_source ~ '^manual_[a-z0-9_]+$'
        and mr.segment_taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and exists (
          select 1
          from public.segment_taxonomy_definitions d
          where d.taxonomy_version = mr.segment_taxonomy_version
            and d.segment = mr.segment
            and d.active
        )
      ) as manual_authoritative
    from public.master_requests mr
    where mr.id = p_request_id
  ),
  latest_current_classification as (
    select c.*
    from public.request_segment_classifications c
    join request_state rs
      on rs.id = c.request_id
     and rs.current_input_hash = c.input_hash
    join exact_contract ec
      on ec.version = c.policy_version
     and ec.taxonomy_version = c.taxonomy_version
     and ec.classifier_version = c.classifier_version
     and ec.prompt_version = c.prompt_version
    order by c.created_at desc, c.id desc
    limit 1
  ),
  facts as (
    select
      rs.id is not null as request_found,
      ec.version is not null as contract_exact,
      coalesce(rs.manual_authoritative, false) as manual_authoritative,
      rs.segment as manual_segment,
      rs.segment_organization_scale as manual_organization_scale,
      rs.current_input_hash,
      c.id as classification_id,
      c.input_hash as classification_input_hash,
      c.status as classification_status,
      c.segment as classification_segment,
      c.organization_scale as classification_organization_scale,
      c.policy_version,
      c.taxonomy_version,
      c.classifier_version,
      c.prompt_version,
      coalesce(
        c.status = 'shadow'
        and c.segment is not null
        and (
          c.segment in ('NT-5', 'NT-6', 'NT-10')
          or c.organization_scale in ('large', 'enterprise')
        )
        and c.evidence_provenance_valid
        and c.mapping_integrity
        and cardinality(coalesce(c.risk_flags, '{}'::text[])) = 0
        and c.classifier_json->>'taxonomy_version' = ec.taxonomy_version
        and c.classifier_json->>'classifier_version' = ec.classifier_version
        and c.classifier_json->>'prompt_version' = ec.prompt_version
        and c.classifier_json->>'validator_version' = 'n8n_cx8_validator_v4'
        and c.classifier_json->>'treatment_contract' = 'treatment_focus_v2_20260821_always_on'
        and c.classifier_json->>'treatment_tier' = 'special'
        and c.classifier_json->'special_handling_required' = 'true'::jsonb
        and c.classifier_json->'external_evidence_required' = 'true'::jsonb
        and c.classifier_json->'model_special_handling_candidate' = 'true'::jsonb
        and c.classifier_json->'operational_default_applied' = 'false'::jsonb
        and c.classifier_json->>'effective_status' = 'shadow'
        and c.classifier_json->'effective_segment' = 'null'::jsonb
        and c.classifier_json->>'segment' = c.segment
        and c.classifier_json->'evidence_provenance'->'valid' = 'true'::jsonb
        and c.classifier_json->'evidence_provenance'->>'validator_version'
          = 'n8n_cx8_validator_v4'
        and c.classifier_json->'db_validation'->'contract_match' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'input_hash_current' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'organization_scale_valid' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'evidence_provenance_valid' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'positive_evidence_valid' = 'true'::jsonb
        and c.classifier_json->'db_validation'->'mapping_integrity' = 'true'::jsonb
        and case
          when c.segment = 'NT-10' then
            c.classifier_json->'db_validation'->>'required_positive_evidence_code'
              = 'verified_public_or_institutional_entity'
          when c.segment = 'NT-5' then
            c.classifier_json->'db_validation'->>'required_positive_evidence_code'
              = 'verified_multisite_or_franchise'
            and c.classifier_json->'db_validation'->'organization_scale_evidence_valid'
              = 'true'::jsonb
          when c.segment = 'NT-6' then
            c.classifier_json->'db_validation'->>'required_positive_evidence_code'
              = 'verified_enterprise'
            and c.classifier_json->'db_validation'->'organization_scale_evidence_valid'
              = 'true'::jsonb
          when c.organization_scale in ('large', 'enterprise') then
            c.classifier_json->'db_validation'->'organization_scale_evidence_valid'
              = 'true'::jsonb
          else false
        end,
        false
      ) as ai_special_authorized
    from (select 1) anchor
    left join request_state rs on true
    left join exact_contract ec on true
    left join latest_current_classification c on true
  ),
  decision as (
    select
      facts.*,
      case
        when manual_authoritative then (
          manual_segment in ('NT-5', 'NT-6', 'NT-10')
          or manual_organization_scale in ('large', 'enterprise')
        )
        else ai_special_authorized
      end as personal_followup,
      case
        when manual_authoritative then 'manual'
        when ai_special_authorized then 'ai_shadow'
        else 'none'
      end as source_authority
    from facts
  )
  select jsonb_build_object(
    'decision_contract_version', 'reminder_treatment_suppression_v1_20260824',
    'request_id', p_request_id,
    'request_found', request_found,
    'contract_exact', contract_exact,
    'treatment', case when personal_followup then 'personal_followup' else 'standard' end,
    'automatic_email_allowed', not personal_followup,
    'max_automatic_reminders', case when personal_followup then 0 else 1 end,
    'suppression_only', true,
    'source_authority', source_authority,
    'reason', case
      when not request_found then 'request_not_found'
      when manual_authoritative and personal_followup then 'manual_special'
      when manual_authoritative then 'manual_standard'
      when not contract_exact then 'contract_unavailable'
      when ai_special_authorized then 'verified_special'
      when classification_id is null then 'classification_missing_or_stale'
      else 'classification_not_authorized'
    end,
    'segment', case
      when manual_authoritative then manual_segment
      else classification_segment
    end,
    'organization_scale', case
      when manual_authoritative then manual_organization_scale
      else classification_organization_scale
    end,
    'classification_id', classification_id,
    'classification_status', classification_status,
    'input_hash_current', classification_input_hash is not null
      and classification_input_hash = current_input_hash,
    'policy_version', policy_version,
    'taxonomy_version', taxonomy_version,
    'classifier_version', classifier_version,
    'prompt_version', prompt_version
  )
  from decision;
$function$;

comment on function public.neontrip_get_request_reminder_treatment_decision(uuid) is
  'Service-role-only, read-only NEONTRIP reminder treatment decision. A current authoritative manual special segment or a current strictly source-validated v7 special shadow classification may suppress the single automatic unopened-offer email. Every other state preserves the standard one-email path.';

revoke all on function public.neontrip_get_request_reminder_treatment_decision(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.neontrip_get_request_reminder_treatment_decision(uuid)
  to service_role;

do $reminder_treatment_postcondition$
declare
  v_probe jsonb;
  v_record_definition text;
begin
  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_record_definition;

  if strpos(v_record_definition, $needle$then 'n8n_cx8_validator_v4'$needle$) = 0
     or strpos(v_record_definition, $needle$else 'n8n_cx8_validator_v1'$needle$) = 0
     or to_regprocedure(
       'public.neontrip_get_request_reminder_treatment_decision(uuid)'
     ) is null then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_postcondition_failed';
  end if;

  select public.neontrip_get_request_reminder_treatment_decision(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) into v_probe;

  if v_probe->>'decision_contract_version'
       <> 'reminder_treatment_suppression_v1_20260824'
     or v_probe->>'treatment' <> 'standard'
     or v_probe->'automatic_email_allowed' <> 'true'::jsonb
     or v_probe->'max_automatic_reminders' <> '1'::jsonb
     or v_probe->'suppression_only' <> 'true'::jsonb
     or v_probe->>'reason' <> 'request_not_found'
     or v_probe->'request_found' <> 'false'::jsonb then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_safe_default_failed';
  end if;

  if has_function_privilege(
       'anon',
       'public.neontrip_get_request_reminder_treatment_decision(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.neontrip_get_request_reminder_treatment_decision(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.neontrip_get_request_reminder_treatment_decision(uuid)',
       'EXECUTE'
     ) then
    raise exception using errcode = '42501',
      message = 'request_reminder_treatment_function_acl_failed';
  end if;
end;
$reminder_treatment_postcondition$;

notify pgrst, 'reload schema';

commit;
