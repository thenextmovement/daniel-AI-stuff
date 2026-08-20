-- Prepare the additive NEONTRIP Phase-5 forced-research shadow contract.
-- This migration deliberately does not activate the candidate policy/quality
-- gate, enqueue any job, mutate immutable Gold, or enable customer automation.
-- The prompt and CX8 taxonomy remain byte-identical; only the classifier/runtime
-- contract advances so the same Gold inputs can be evaluated in separate rows.

begin;

do $phase5_base_precondition$
declare
  v_old_quality_count integer;
  v_old_policy_count integer;
  v_old_rule_count integer;
  v_candidate_object_count integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_old_quality_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and q.active;

  select count(*) into v_old_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v2_20260819_cx8_shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8'
    and p.mode = 'shadow'
    and p.active;

  select count(*) into v_old_rule_count
  from public.segment_policy_rules r
  where r.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
    and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and not r.automation_enabled
    and not r.needs_human_review
    and r.price_factor is null
    and r.max_followups = 0
    and r.first_call_after_minutes is null
    and r.call_sequence = '[]'::jsonb
    and r.email_sequence = '[]'::jsonb;

  select
    (select count(*) from public.segment_quality_gate_versions where version = 'nt_quality_gate_v3_20260820_cx8')
    + (select count(*) from public.segment_policy_versions where version = 'nt_policy_v3_20260820_cx8_shadow')
  into v_candidate_object_count;

  if v_old_quality_count <> 1
     or v_old_policy_count <> 1
     or v_old_rule_count <> 8
     or v_global_active_policy_count <> 1
     or v_global_active_quality_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'phase5_base_requires_exact_active_phase2_shadow_contract',
      detail = format(
        'quality=%s policy=%s inert_rules=%s active_policies=%s active_gates=%s',
        v_old_quality_count, v_old_policy_count, v_old_rule_count,
        v_global_active_policy_count, v_global_active_quality_count
      );
  end if;

  if v_candidate_object_count <> 0 then
    raise exception 'phase5_candidate_contract_already_exists';
  end if;
end;
$phase5_base_precondition$;

insert into public.segment_quality_gate_versions (
  version, taxonomy_version, classifier_version, prompt_version, active,
  min_unique_gold_total, min_gold_per_segment,
  min_precision_per_predicted_class, min_recall_per_actual_class,
  min_accepted_coverage, critical_segments, min_critical_precision,
  required_mapping_integrity, max_provenance_violations,
  manual_activation_required, created_by, notes
)
select
  'nt_quality_gate_v3_20260820_cx8',
  q.taxonomy_version,
  'segment_classifier_v4_20260820_cx8',
  'segment_prompt_v4_20260819_cx8',
  false,
  q.min_unique_gold_total,
  q.min_gold_per_segment,
  q.min_precision_per_predicted_class,
  q.min_recall_per_actual_class,
  q.min_accepted_coverage,
  q.critical_segments,
  q.min_critical_precision,
  q.required_mapping_integrity,
  q.max_provenance_violations,
  q.manual_activation_required,
  'codex-phase5',
  'Forced-research classifier candidate. Thresholds remain identical to Phase 2; four pilot Gold cases are diagnostic only.'
from public.segment_quality_gate_versions q
where q.version = 'nt_quality_gate_v2_20260819_cx8';

insert into public.segment_policy_versions (
  version, active, mode, created_by, notes,
  taxonomy_version, classifier_version, prompt_version, quality_gate_version
) values (
  'nt_policy_v3_20260820_cx8_shadow',
  false,
  'shadow',
  'codex-phase5',
  'Forced-research evaluation candidate. Shadow only; every automation and pricing rule remains inert.',
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v4_20260820_cx8',
  'segment_prompt_v4_20260819_cx8',
  'nt_quality_gate_v3_20260820_cx8'
);

insert into public.segment_policy_rules (
  policy_version, segment, s_kategorie, min_confidence, price_factor,
  max_followups, first_call_after_minutes, call_sequence,
  email_sequence, sales_priority, needs_human_review,
  automation_enabled, taxonomy_version
)
select
  'nt_policy_v3_20260820_cx8_shadow',
  r.segment,
  r.s_kategorie,
  r.min_confidence,
  null,
  0,
  null,
  '[]'::jsonb,
  '[]'::jsonb,
  r.sales_priority,
  false,
  false,
  r.taxonomy_version
from public.segment_policy_rules r
where r.policy_version = 'nt_policy_v2_20260819_cx8_shadow';

create function public.neontrip_get_request_segmentation_gold_target_contract()
returns table (
  taxonomy_version text,
  classifier_version text,
  prompt_version text,
  quality_gate_version text
)
language sql
stable
set search_path to 'public'
as $function$
  select
    p.taxonomy_version,
    p.classifier_version,
    p.prompt_version,
    p.quality_gate_version
  from public.segment_policy_versions p
  join public.segment_quality_gate_versions q
    on q.version = p.quality_gate_version
   and q.taxonomy_version = p.taxonomy_version
   and q.classifier_version = p.classifier_version
   and q.prompt_version = p.prompt_version
  where p.active
    and q.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and (
      (
        p.version = 'nt_policy_v2_20260819_cx8_shadow'
        and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
        and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8'
      )
      or (
        p.version = 'nt_policy_v3_20260820_cx8_shadow'
        and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
        and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8'
      )
    )
  order by p.created_at desc
  limit 1;
$function$;

comment on function public.neontrip_get_request_segmentation_gold_target_contract() is
  'Internal allowlist resolver for the one active CX8 Gold evaluation contract during the Phase-2 to Phase-5 transition.';

revoke all on function public.neontrip_get_request_segmentation_gold_target_contract()
  from public, anon, authenticated, service_role;

create or replace function public.neontrip_upsert_segment_research_cache_from_classification(
  p_request_id uuid,
  p_effective_status text,
  p_policy_mode text,
  p_evidence_grade text,
  p_evidence_json jsonb,
  p_firmographic_json jsonb,
  p_classifier_json jsonb,
  p_model text,
  p_classifier_version text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_name text;
  v_customer_company text;
  v_website text;
  v_website_domain text;
  v_email_domain text;
  v_email_facts jsonb;
  v_website_facts jsonb;
  v_has_matching_evidence_url boolean;
  v_verified_company_identity boolean;
  v_email_matches_website boolean;
  v_summary jsonb;
  v_written boolean := false;
  v_taxonomy_version text := nullif(btrim(coalesce(p_classifier_json->>'taxonomy_version', '')), '');
  v_prompt_version text := nullif(btrim(coalesce(p_classifier_json->>'prompt_version', '')), '');
  v_classifier_version_json text := nullif(btrim(coalesce(p_classifier_json->>'classifier_version', '')), '');
  v_effective_segment text := nullif(btrim(coalesce(p_classifier_json->>'effective_segment', '')), '');
  v_provenance jsonb := coalesce(p_classifier_json->'evidence_provenance', '{}'::jsonb);
  v_verified_sources jsonb := '[]'::jsonb;
  v_required_evidence_code text;
  v_required_role_use text;
  v_cache_evidence_json jsonb := '[]'::jsonb;
  v_cache_evidence_count integer := 0;
  v_has_required_role_evidence boolean := false;
  v_has_required_scale_evidence boolean := false;
  v_cx8_contract_valid boolean := false;
begin
  v_company_name := nullif(trim(coalesce(p_firmographic_json->>'company_name', '')), '');
  select nullif(trim(coalesce(mc.company_name, mc.company, '')), '')
  into v_customer_company
  from public.master_requests mr
  join public.master_customers mc on mc.id = mr.customer_id
  where mr.id = p_request_id;

  v_website := nullif(trim(coalesce(p_firmographic_json->>'website', '')), '');
  v_email_facts := public.neontrip_request_segmentation_domain_facts(
    p_firmographic_json->>'email_domain'
  );
  v_website_facts := public.neontrip_request_segmentation_domain_facts(v_website);
  v_email_domain := v_email_facts->>'email_domain';
  v_website_domain := v_website_facts->>'email_domain';

  if v_taxonomy_version is null then
    -- Exact Phase-1 compatibility until the held activation migration runs.
    v_cache_evidence_json := coalesce(p_evidence_json, '[]'::jsonb);
  elsif v_taxonomy_version = 'nt_taxonomy_v2_20260819_cx8' then
    if jsonb_typeof(v_provenance->'verified_sources') = 'array' then
      v_verified_sources := v_provenance->'verified_sources';
    end if;

    select d.required_evidence_code
    into v_required_evidence_code
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = v_taxonomy_version
      and d.segment = v_effective_segment
      and d.active
    limit 1;

    v_required_role_use := case
      when v_effective_segment = 'NT-10' then 'institution_status'
      when v_effective_segment in ('NT-1', 'NT-3', 'NT-4', 'NT-5', 'NT-6', 'NT-9') then 'segment_role'
      else null
    end;

    v_cx8_contract_valid :=
      p_effective_status = 'accepted'
      and (
        (
          p_classifier_version = 'segment_classifier_v3_20260819_cx8'
          and v_classifier_version_json = 'segment_classifier_v3_20260819_cx8'
          and v_prompt_version = 'segment_prompt_v4_20260819_cx8'
        )
        or (
          p_classifier_version = 'segment_classifier_v4_20260820_cx8'
          and v_classifier_version_json = 'segment_classifier_v4_20260820_cx8'
          and v_prompt_version = 'segment_prompt_v4_20260819_cx8'
        )
      )
      and v_required_evidence_code is not null
      and v_required_role_use is not null
      and jsonb_typeof(v_provenance) = 'object'
      and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'
      and jsonb_typeof(v_provenance->'valid') = 'boolean'
      and lower(coalesce(v_provenance->>'valid', 'false')) = 'true'
      and jsonb_typeof(p_classifier_json->'db_validation'->'evidence_provenance_valid') = 'boolean'
      and lower(coalesce(p_classifier_json->'db_validation'->>'evidence_provenance_valid', 'false')) = 'true'
      and jsonb_typeof(p_classifier_json->'db_validation'->'positive_evidence_valid') = 'boolean'
      and lower(coalesce(p_classifier_json->'db_validation'->>'positive_evidence_valid', 'false')) = 'true'
      and exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
              then v_provenance->'validated_positive_evidence_codes'
            else '[]'::jsonb
          end
        ) code(value)
        where code.value = v_required_evidence_code
      );

    if not v_cx8_contract_valid then
      return false;
    end if;

    select
      coalesce(jsonb_agg(evidence.item order by evidence.ordinality), '[]'::jsonb),
      count(*)::integer,
      coalesce(bool_or(evidence.item->>'used_for' = v_required_role_use), false),
      coalesce(bool_or(evidence.item->>'used_for' = 'organization_scale'), false)
    into
      v_cache_evidence_json,
      v_cache_evidence_count,
      v_has_required_role_evidence,
      v_has_required_scale_evidence
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_evidence_json) = 'array' then p_evidence_json
        else '[]'::jsonb
      end
    ) with ordinality evidence(item, ordinality)
    where jsonb_typeof(evidence.item) = 'object'
      and evidence.item ?& array['type', 'url', 'used_for', 'evidence_code']
      and evidence.item->>'type' in ('web_search', 'research_cache')
      and evidence.item->>'evidence_code' = v_required_evidence_code
      and (
        evidence.item->>'used_for' = v_required_role_use
        or (
          v_effective_segment in ('NT-5', 'NT-6')
          and evidence.item->>'used_for' = 'organization_scale'
        )
      )
      and coalesce(evidence.item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(evidence.item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
      and exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(item)
        where jsonb_typeof(source.item) = 'object'
          and jsonb_typeof(source.item->'url') = 'string'
          and jsonb_typeof(source.item->'source_type') = 'string'
          and jsonb_typeof(source.item->'source_ref') = 'string'
          and source.item->>'url' = evidence.item->>'url'
          and nullif(btrim(coalesce(source.item->>'source_ref', '')), '') is not null
          and (
            (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
            or (
              source.item->>'source_type' = 'verified_db_cache'
              and evidence.item->>'type' = 'research_cache'
              and exists (
                select 1
                from public.segment_research_cache cached
                where cached.cache_key = source.item->>'source_ref'
                  and cached.status = 'ok'
                  and cached.expires_at > now()
                  and cached.summary_json->>'taxonomy_version' = v_taxonomy_version
                  and cached.summary_json->>'classifier_version' = v_classifier_version_json
                  and cached.summary_json->>'prompt_version' = v_prompt_version
                  and cached.summary_json->>'evidence_contract_valid' = 'true'
                  and cached.summary_json->>'required_evidence_code' = v_required_evidence_code
                  and exists (
                    select 1
                    from jsonb_array_elements(
                      case
                        when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                        else '[]'::jsonb
                      end
                    ) cached_evidence(item)
                    where cached_evidence.item->>'url' = evidence.item->>'url'
                      and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                      and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
                  )
              )
            )
          )
          and jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(source.item->'validated_positive_evidence_codes') source_code(value)
            where source_code.value = v_required_evidence_code
          )
      );

    if v_cache_evidence_count = 0
       or not v_has_required_role_evidence
       or (v_effective_segment in ('NT-5', 'NT-6') and not v_has_required_scale_evidence) then
      return false;
    end if;
  else
    -- An unknown future taxonomy must define its own writer instead of silently
    -- inheriting either the legacy or CX8 trust contract.
    return false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_cache_evidence_json) = 'array' then v_cache_evidence_json
        else '[]'::jsonb
      end
    ) as evidence(item)
    cross join lateral (
      select public.neontrip_request_segmentation_domain_facts(evidence.item->>'url') as facts
    ) as evidence_domain
    where coalesce(evidence.item->>'url', '') ~* '^https?://'
      and evidence_domain.facts->>'email_domain' is not null
      and coalesce(
        (evidence_domain.facts->>'email_domain_cache_allowed')::boolean,
        false
      )
      and (
        evidence_domain.facts->>'email_domain' = v_website_domain
        or right(
          evidence_domain.facts->>'email_domain',
          length(v_website_domain) + 1
        ) = '.' || v_website_domain
        or right(
          v_website_domain,
          length(evidence_domain.facts->>'email_domain') + 1
        ) = '.' || (evidence_domain.facts->>'email_domain')
      )
  ) into v_has_matching_evidence_url;

  v_verified_company_identity :=
    p_effective_status = 'accepted'
    and p_policy_mode in ('followup_live', 'pricing_live')
    and lower(coalesce(p_evidence_grade, '')) = 'strong'
    and lower(coalesce(p_firmographic_json->>'is_company', 'false')) = 'true'
    and v_company_name is not null
    and v_customer_company is not null
    and regexp_replace(lower(v_company_name), '\s+', ' ', 'g')
      = regexp_replace(lower(v_customer_company), '\s+', ' ', 'g')
    and coalesce(v_website ~* '^https?://', false)
    and v_website_domain is not null
    and coalesce((v_website_facts->>'email_domain_cache_allowed')::boolean, false)
    and v_has_matching_evidence_url;

  if v_verified_company_identity is not true then
    return false;
  end if;

  v_email_matches_website :=
    coalesce((v_email_facts->>'email_domain_cache_allowed')::boolean, false)
    and (
      v_email_domain = v_website_domain
      or right(v_email_domain, length(v_website_domain) + 1) = '.' || v_website_domain
      or right(v_website_domain, length(v_email_domain) + 1) = '.' || v_email_domain
    );

  v_summary := jsonb_build_object(
    'request_id', p_request_id,
    'firmographic', coalesce(p_firmographic_json, '{}'::jsonb),
    'taxonomy_version', v_taxonomy_version,
    'classifier_version', p_classifier_version,
    'prompt_version', v_prompt_version,
    'model', p_model,
    'classifier_segment', coalesce(v_effective_segment, p_classifier_json->>'segment'),
    'classifier_confidence', p_classifier_json->>'confidence',
    'effective_status', p_effective_status,
    'policy_mode', p_policy_mode,
    'evidence_grade', p_evidence_grade,
    'verified_company_identity', true,
    'evidence_website_domain_verified', true,
    'evidence_contract_valid', case when v_taxonomy_version is null then null else v_cx8_contract_valid end,
    'required_evidence_code', v_required_evidence_code,
    'validated_evidence_count', v_cache_evidence_count,
    'validated_evidence_uses', coalesce(
      (
        select to_jsonb(array_agg(uses.used_for order by uses.used_for))
        from (
          select distinct evidence.item->>'used_for' as used_for
          from jsonb_array_elements(v_cache_evidence_json) evidence(item)
          where nullif(evidence.item->>'used_for', '') is not null
        ) uses
      ),
      '[]'::jsonb
    ),
    'cached_from', 'request_segmentation_classification',
    'cached_at', now()
  );

  if v_email_matches_website then
    insert into public.segment_research_cache (
      cache_key, lookup_type, lookup_value, provider, status, evidence_json,
      summary_json, fetched_at, expires_at
    ) values (
      public.neontrip_segment_research_cache_key('email_domain', v_email_domain),
      'email_domain', v_email_domain, 'openai_web_search', 'ok',
      v_cache_evidence_json, v_summary, now(), now() + interval '30 days'
    )
    on conflict (cache_key) do update set
      provider = excluded.provider,
      status = excluded.status,
      evidence_json = excluded.evidence_json,
      summary_json = excluded.summary_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at;
    v_written := true;
  end if;

  insert into public.segment_research_cache (
    cache_key, lookup_type, lookup_value, provider, status, evidence_json,
    summary_json, fetched_at, expires_at
  ) values (
    public.neontrip_segment_research_cache_key('domain', v_website_domain),
    'domain', v_website_domain, 'openai_web_search', 'ok',
    v_cache_evidence_json, v_summary, now(), now() + interval '30 days'
  )
  on conflict (cache_key) do update set
    provider = excluded.provider,
    status = excluded.status,
    evidence_json = excluded.evidence_json,
    summary_json = excluded.summary_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
  v_written := true;

  insert into public.segment_research_cache (
    cache_key, lookup_type, lookup_value, provider, status, evidence_json,
    summary_json, fetched_at, expires_at
  ) values (
    public.neontrip_segment_research_cache_key('company_name', v_customer_company),
    'company_name', regexp_replace(lower(v_customer_company), '\s+', ' ', 'g'),
    'openai_web_search', 'ok', v_cache_evidence_json,
    v_summary, now(), now() + interval '30 days'
  )
  on conflict (cache_key) do update set
    provider = excluded.provider,
    status = excluded.status,
    evidence_json = excluded.evidence_json,
    summary_json = excluded.summary_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
  v_written := true;

  return v_written;
end;
$function$;

comment on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) is
  'Preserves the Phase-1 cache contract; CX8 cache writes remain limited to the two explicitly supported classifier contracts, exact prompt/provenance binding, canonical evidence semantics, and live policy modes. Shadow and evaluation-only paths remain non-writing.';

revoke all on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) to service_role;


create or replace function public.neontrip_record_request_segment_classification(
  p_job_id uuid,
  p_request_id uuid,
  p_input_hash text,
  p_status text,
  p_segment text,
  p_confidence numeric,
  p_evidence_grade text,
  p_reasoning_short text,
  p_reason_codes text[],
  p_evidence_json jsonb,
  p_firmographic_json jsonb,
  p_classifier_json jsonb,
  p_risk_flags text[],
  p_model text,
  p_model_version text,
  p_prompt_version text,
  p_classifier_version text,
  p_accepted_by text default 'n8n-request-segmenter'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_active_policy public.segment_policy_versions%rowtype;
  v_policy_rule public.segment_policy_rules%rowtype;
  v_job public.request_segmentation_jobs%rowtype;
  v_request public.master_requests%rowtype;
  v_policy_found boolean := false;
  v_definition_found boolean := false;
  v_is_versioned boolean := false;
  v_job_identity_valid boolean := false;
  v_contract_match boolean := false;
  v_current_input_hash text;
  v_input_hash_current boolean := false;
  v_effective_status text;
  v_effective_segment text;
  v_effective_risk_flags text[] := '{}';
  v_classifier_risk_flags text[] := '{}';
  v_effective_classifier_json jsonb;
  v_classification_id uuid;
  v_context_tags text[] := '{}';
  v_context_shape_valid boolean := false;
  v_context_tags_valid boolean := false;
  v_organization_scale text;
  v_organization_scale_valid boolean := false;
  v_provenance jsonb;
  v_verified_sources jsonb := '[]'::jsonb;
  v_verified_source_count integer := 0;
  v_verified_source_shape_valid boolean := false;
  v_evidence_json_shape_valid boolean := false;
  v_evidence_semantics_shape_valid boolean := false;
  v_all_evidence_urls_verified boolean := false;
  v_request_evidence_used boolean := false;
  v_positive_codes text[] := '{}';
  v_positive_codes_shape_valid boolean := false;
  v_required_positive_code text;
  v_positive_code_top_level boolean := false;
  v_positive_code_source_bound boolean := false;
  v_explicit_private_choice_claimed boolean := false;
  v_explicit_business_choice_claimed boolean := false;
  v_first_party_private_choice_valid boolean := false;
  v_first_party_business_choice_valid boolean := false;
  v_private_declaration_evidence_valid boolean := false;
  v_business_declaration_evidence_valid boolean := false;
  v_organization_scale_evidence_valid boolean := false;
  v_positive_evidence_valid boolean := false;
  v_evidence_provenance_valid boolean := false;
  v_mapping_integrity boolean := false;
  v_research_required boolean := false;
  v_has_external_url boolean := false;
  v_research_cache_written boolean := false;
  v_evaluation_only boolean := false;
  v_master_projection_authorized boolean := false;
  v_manual_authoritative boolean := false;
  v_existing_authoritative boolean := false;
  v_projection_applied boolean := false;
  v_projection_reason text;
  v_job_status text;
begin
  if p_status not in ('accepted', 'needs_review', 'rejected', 'error', 'shadow') then
    raise exception 'invalid_status: %', p_status;
  end if;

  if p_segment is not null and p_segment !~ '^NT-(1[0-8]|[1-9])$' then
    raise exception 'invalid_segment: %', p_segment;
  end if;

  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'invalid_confidence: %', p_confidence;
  end if;

  if nullif(trim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'input_hash_required';
  end if;

  if nullif(trim(coalesce(p_prompt_version, '')), '') is null then
    raise exception 'prompt_version_required';
  end if;

  if nullif(trim(coalesce(p_classifier_version, '')), '') is null then
    raise exception 'classifier_version_required';
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  perform 1
  from public.master_customers
  where id = v_request.customer_id
  for share;

  if p_job_id is not null then
    select * into v_job
    from public.request_segmentation_jobs j
    where j.id = p_job_id
    for update;

    v_job_identity_valid := found
      and v_job.request_id = p_request_id
      and v_job.input_hash = p_input_hash;

    if not v_job_identity_valid then
      raise exception 'segmentation_job_request_or_hash_mismatch: %', p_job_id;
    end if;
  end if;

  select * into v_active_policy
  from public.segment_policy_versions p
  where p.active
  order by p.created_at desc
  limit 1
  for share;

  if not found then
    raise exception 'no_active_segment_policy';
  end if;

  v_is_versioned := v_active_policy.taxonomy_version is not null;
  v_effective_classifier_json := coalesce(p_classifier_json, '{}'::jsonb);
  v_evaluation_only := case
    when p_job_id is null then false
    else lower(coalesce(v_job.metadata->>'evaluation_only', 'false')) = 'true'
  end;
  v_master_projection_authorized := case
    when not v_is_versioned then true
    when p_job_id is null then false
    else lower(coalesce(v_job.metadata->>'master_projection_authorized', 'false')) = 'true'
  end;

  -- A claimed job never changes semantic lane merely because the active policy
  -- flipped while n8n was processing it. Contract drift is a technical job
  -- failure and must not create a classification, cache entry, or master write.
  v_contract_match := case
    when p_job_id is null then not v_is_versioned
    when not v_is_versioned then
      v_job.taxonomy_version is null
      and v_job.classifier_version is null
      and v_job.prompt_version is null
    else
      v_job.taxonomy_version = v_active_policy.taxonomy_version
      and v_job.classifier_version = v_active_policy.classifier_version
      and v_job.prompt_version = v_active_policy.prompt_version
      and p_classifier_version = v_active_policy.classifier_version
      and p_prompt_version = v_active_policy.prompt_version
      and v_active_policy.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
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
      )
      and jsonb_typeof(v_effective_classifier_json) = 'object'
      and v_effective_classifier_json->>'taxonomy_version' = v_active_policy.taxonomy_version
  end;

  if not v_contract_match then
    if p_job_id is not null then
      update public.request_segmentation_jobs
      set
        status = 'failed',
        completed_at = null,
        last_error_code = 'segmentation_job_active_contract_mismatch',
        last_error_message = 'Claimed job contract no longer matches the active segmentation policy contract.',
        updated_at = now(),
        lock_owner = null,
        locked_at = null
      where id = p_job_id;
    end if;

    return jsonb_build_object(
      'classification_id', null,
      'job_id', p_job_id,
      'request_id', p_request_id,
      'submitted_status', p_status,
      'proposed_segment', p_segment,
      'effective_status', 'error',
      'effective_segment', null,
      'policy_version', v_active_policy.version,
      'policy_mode', v_active_policy.mode,
      'taxonomy_version', v_active_policy.taxonomy_version,
      'classifier_version', p_classifier_version,
      'prompt_version', p_prompt_version,
      'job_status', 'failed',
      'input_hash_current', null,
      'contract_match', false,
      'error_code', 'segmentation_job_active_contract_mismatch',
      'research_cache_written', false,
      'projection', jsonb_build_object(
        'applied', false,
        'reason', 'active_contract_mismatch_no_classification',
        'authoritative_segment', v_request.segment,
        'authoritative_s_kategorie', v_request.s_kategorie,
        'authoritative_status', v_request.segment_status,
        'authoritative_source', v_request.segment_source,
        'authoritative_taxonomy_version', v_request.segment_taxonomy_version,
        'manual_authoritative_preserved', false
      )
    );
  end if;

  select public.neontrip_compute_request_segment_input_hash(p_request_id)
  into v_current_input_hash;
  v_input_hash_current := v_current_input_hash is not distinct from p_input_hash;

  if p_segment is not null then
    select * into v_policy_rule
    from public.segment_policy_rules r
    where r.policy_version = v_active_policy.version
      and r.segment = p_segment
      and (
        not v_is_versioned
        or r.taxonomy_version = v_active_policy.taxonomy_version
      )
    limit 1;
    v_policy_found := found;
  end if;

  if v_is_versioned and p_segment is not null then
    select d.required_evidence_code
    into v_required_positive_code
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = v_active_policy.taxonomy_version
      and d.segment = p_segment
      and d.active
    limit 1;
    v_definition_found := found;
  else
    v_definition_found := v_policy_found;
  end if;

  select coalesce(array_agg(flag), '{}'::text[])
  into v_classifier_risk_flags
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(v_effective_classifier_json->'risk_flags') = 'array'
        then v_effective_classifier_json->'risk_flags'
      else '[]'::jsonb
    end
  ) as classifier_flags(flag);

  select coalesce(
    array_agg(distinct lower(trim(flag)) order by lower(trim(flag))),
    '{}'::text[]
  )
  into v_effective_risk_flags
  from unnest(coalesce(p_risk_flags, '{}'::text[]) || v_classifier_risk_flags) as flags(flag)
  where nullif(trim(flag), '') is not null;

  v_context_shape_valid :=
    jsonb_typeof(v_effective_classifier_json->'context_tags') = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_effective_classifier_json->'context_tags') = 'array'
            then v_effective_classifier_json->'context_tags'
          else '[]'::jsonb
        end
      ) context_value(item)
      where jsonb_typeof(context_value.item) <> 'string'
         or nullif(btrim(context_value.item #>> '{}'), '') is null
    );
  if v_context_shape_valid then
    select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
    into v_context_tags
    from jsonb_array_elements_text(v_effective_classifier_json->'context_tags') tags(tag)
    where nullif(btrim(tag), '') is not null;
  end if;

  if v_is_versioned and v_context_shape_valid then
    select not exists (
      select 1
      from unnest(v_context_tags) tags(tag)
      where not exists (
        select 1
        from public.segment_context_definitions cd
        where cd.taxonomy_version = v_active_policy.taxonomy_version
          and cd.context_tag = tags.tag
          and cd.active
      )
    ) into v_context_tags_valid;
  else
    v_context_tags_valid := not v_is_versioned;
  end if;

  v_organization_scale := case
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'string'
      then btrim(v_effective_classifier_json->>'organization_scale')
    else null
  end;
  v_organization_scale_valid := case
    when not v_is_versioned then true
    when not (v_effective_classifier_json ? 'organization_scale') then false
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'null' then true
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'string'
      then v_organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise')
    else false
  end;

  v_provenance := coalesce(v_effective_classifier_json->'evidence_provenance', '{}'::jsonb);
  if jsonb_typeof(v_provenance->'verified_sources') = 'array' then
    v_verified_sources := v_provenance->'verified_sources';
  end if;

  v_positive_codes_shape_valid :=
    jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array';
  if v_positive_codes_shape_valid then
    select coalesce(array_agg(distinct code order by code), '{}'::text[])
    into v_positive_codes
    from jsonb_array_elements_text(v_provenance->'validated_positive_evidence_codes') codes(code)
    where code in (
      'verified_public_or_institutional_entity',
      'verified_physical_project_supplier',
      'verified_client_project_intermediary',
      'verified_event_or_media_operator',
      'verified_multisite_or_franchise',
      'verified_enterprise',
      'explicit_private_use',
      'verified_direct_business'
    );

    v_positive_codes_shape_valid := not exists (
      select 1
      from jsonb_array_elements_text(v_provenance->'validated_positive_evidence_codes') codes(code)
      where code is null
         or code not in (
        'verified_public_or_institutional_entity',
        'verified_physical_project_supplier',
        'verified_client_project_intermediary',
        'verified_event_or_media_operator',
        'verified_multisite_or_franchise',
        'verified_enterprise',
        'explicit_private_use',
        'verified_direct_business'
      )
    );
  end if;

  v_positive_code_top_level := v_required_positive_code is not null
    and v_required_positive_code = any(v_positive_codes);
  v_explicit_private_choice_claimed := case
    when jsonb_typeof(v_provenance->'explicit_private_choice_verified') = 'boolean'
      then (v_provenance->>'explicit_private_choice_verified')::boolean
    else false
  end;
  v_explicit_business_choice_claimed := case
    when jsonb_typeof(v_provenance->'explicit_business_choice_verified') = 'boolean'
      then (v_provenance->>'explicit_business_choice_verified')::boolean
    else false
  end;
  v_first_party_private_choice_valid :=
    lower(btrim(coalesce(v_request.customer_type, ''))) = 'privat';
  v_first_party_business_choice_valid :=
    lower(btrim(coalesce(v_request.customer_type, ''))) in ('gewerblich', 'b2b');

  select
    count(*)::integer,
    coalesce(bool_and(
      jsonb_typeof(item) = 'object'
      and item ?& array['url', 'source_type', 'source_ref', 'validated_positive_evidence_codes']
      and jsonb_typeof(item->'url') = 'string'
      and jsonb_typeof(item->'source_type') = 'string'
      and jsonb_typeof(item->'source_ref') = 'string'
      and coalesce(item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
      and item->>'source_type' in ('web_search_call', 'verified_db_cache')
      and nullif(btrim(coalesce(item->>'source_ref', '')), '') is not null
      and jsonb_typeof(item->'validated_positive_evidence_codes') = 'array'
    ), true)
  into v_verified_source_count, v_verified_source_shape_valid
  from jsonb_array_elements(v_verified_sources) sources(item);

  v_verified_source_shape_valid := v_verified_source_shape_valid and not exists (
    select 1
    from jsonb_array_elements(v_verified_sources) source(item)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          then source.item->'validated_positive_evidence_codes'
        else '[]'::jsonb
      end
    ) source_code(code)
    where source_code.code is null
       or source_code.code not in (
      'verified_public_or_institutional_entity',
      'verified_physical_project_supplier',
      'verified_client_project_intermediary',
      'verified_event_or_media_operator',
      'verified_multisite_or_franchise',
      'verified_enterprise',
      'explicit_private_use',
      'verified_direct_business'
    )
  );

  v_evidence_json_shape_valid :=
    jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
            then coalesce(p_evidence_json, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) evidence(item)
      where jsonb_typeof(evidence.item) <> 'object'
    );
  v_evidence_semantics_shape_valid := v_evidence_json_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where not (evidence.item ?& array['type', 'url', 'used_for', 'evidence_code'])
       or evidence.item->>'type' not in (
         'request', 'customer_declared', 'related_history', 'web_search', 'research_cache'
       )
       or evidence.item->>'used_for' not in (
         'private_use', 'company_identity', 'segment_role', 'organization_scale',
         'institution_status', 'context_tag', 'conflict'
       )
       or evidence.item->>'evidence_code' not in (
         'verified_public_or_institutional_entity',
         'verified_physical_project_supplier',
         'verified_client_project_intermediary',
         'verified_event_or_media_operator',
         'verified_multisite_or_franchise',
         'verified_enterprise',
         'explicit_private_use',
         'verified_direct_business'
       )
       or jsonb_typeof(evidence.item->'url') not in ('string', 'null')
  );
  v_all_evidence_urls_verified := v_evidence_json_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where nullif(btrim(coalesce(item->>'url', '')), '') is not null
      and (
        coalesce(item->>'url', '') !~* '^https?://'
        or not coalesce(
          ((public.neontrip_request_segmentation_domain_facts(item->>'url'))->>'is_valid_dns_host')::boolean,
          false
        )
        or not exists (
          select 1
          from jsonb_array_elements(v_verified_sources) source(item)
          where source.item->>'url' = evidence.item->>'url'
        )
      )
  );
  v_request_evidence_used := case
    when jsonb_typeof(v_provenance->'request_evidence_used') = 'boolean'
      then (v_provenance->>'request_evidence_used')::boolean
    else false
  end;

  v_positive_code_source_bound := exists (
    select 1
    from jsonb_array_elements(v_verified_sources) source(item)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          then source.item->'validated_positive_evidence_codes'
        else '[]'::jsonb
      end
    ) source_code(code)
    join jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
      on evidence.item->>'url' = source.item->>'url'
     and evidence.item->>'evidence_code' = source_code.code
    where source_code.code = v_required_positive_code
      and (
        (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
        or (
          source.item->>'source_type' = 'verified_db_cache'
          and evidence.item->>'type' = 'research_cache'
          and exists (
            select 1
            from public.segment_research_cache cached
            where cached.cache_key = source.item->>'source_ref'
              and cached.status = 'ok'
              and cached.expires_at > now()
              and cached.summary_json->>'taxonomy_version' = v_active_policy.taxonomy_version
              and cached.summary_json->>'classifier_version' = v_active_policy.classifier_version
              and cached.summary_json->>'prompt_version' = v_active_policy.prompt_version
              and cached.summary_json->>'evidence_contract_valid' = 'true'
              and cached.summary_json->>'required_evidence_code' = v_required_positive_code
              and exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_evidence(item)
                where cached_evidence.item->>'url' = evidence.item->>'url'
                  and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                  and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
              )
          )
        )
      )
      and case
        when p_segment = 'NT-10' then evidence.item->>'used_for' = 'institution_status'
        when p_segment in ('NT-1', 'NT-4', 'NT-3', 'NT-5', 'NT-6', 'NT-9')
          then evidence.item->>'used_for' = 'segment_role'
        else false
      end
  );

  v_private_declaration_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where evidence.item->>'type' = 'customer_declared'
      and jsonb_typeof(evidence.item->'url') = 'null'
      and evidence.item->>'used_for' = 'private_use'
      and evidence.item->>'evidence_code' = 'explicit_private_use'
  );

  v_business_declaration_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where evidence.item->>'type' = 'customer_declared'
      and jsonb_typeof(evidence.item->'url') = 'null'
      and evidence.item->>'used_for' = 'segment_role'
      and evidence.item->>'evidence_code' = 'verified_direct_business'
  );

  v_organization_scale_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    join jsonb_array_elements(v_verified_sources) source(item)
      on source.item->>'url' = evidence.item->>'url'
    where evidence.item->>'used_for' = 'organization_scale'
      and evidence.item->>'evidence_code' = v_required_positive_code
      and jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(source.item->'validated_positive_evidence_codes') source_code(code)
        where source_code.code = v_required_positive_code
      )
      and (
        (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
        or (
          source.item->>'source_type' = 'verified_db_cache'
          and evidence.item->>'type' = 'research_cache'
          and exists (
            select 1
            from public.segment_research_cache cached
            where cached.cache_key = source.item->>'source_ref'
              and cached.status = 'ok'
              and cached.expires_at > now()
              and cached.summary_json->>'taxonomy_version' = v_active_policy.taxonomy_version
              and cached.summary_json->>'classifier_version' = v_active_policy.classifier_version
              and cached.summary_json->>'prompt_version' = v_active_policy.prompt_version
              and cached.summary_json->>'evidence_contract_valid' = 'true'
              and cached.summary_json->>'required_evidence_code' = v_required_positive_code
              and exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_evidence(item)
                where cached_evidence.item->>'url' = evidence.item->>'url'
                  and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                  and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
              )
          )
        )
      )
  );

  v_positive_evidence_valid := case
    when not v_is_versioned then true
    when p_segment = 'NT-8' then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_request_evidence_used
      and v_explicit_private_choice_claimed
      and v_first_party_private_choice_valid
      and v_private_declaration_evidence_valid
    when p_segment = 'NT-9' then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
      and v_explicit_business_choice_claimed
      and v_first_party_business_choice_valid
      and v_business_declaration_evidence_valid
    when p_segment in ('NT-5', 'NT-6') then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
      and v_organization_scale_evidence_valid
    else
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
  end;

  v_evidence_provenance_valid := not v_is_versioned or (
    jsonb_typeof(v_provenance) = 'object'
    and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'
    and jsonb_typeof(v_provenance->'valid') = 'boolean'
    and lower(coalesce(v_provenance->>'valid', 'false')) = 'true'
    and jsonb_typeof(v_provenance->'verified_sources') = 'array'
    and v_verified_source_shape_valid
    and v_evidence_semantics_shape_valid
    and v_all_evidence_urls_verified
    and v_positive_evidence_valid
    and case
      when p_segment = 'NT-8' then v_request_evidence_used and v_first_party_private_choice_valid
      else v_verified_source_count > 0
    end
  );

  v_mapping_integrity := v_policy_found
    and v_definition_found
    and (
      not v_is_versioned
      or exists (
        select 1
        from public.segment_taxonomy_definitions d
        where d.taxonomy_version = v_active_policy.taxonomy_version
          and d.segment = p_segment
          and d.default_s_kategorie = v_policy_rule.s_kategorie
          and d.active
      )
    );

  v_research_required := case
    when v_is_versioned then p_segment is distinct from 'NT-8'
    else lower(coalesce(v_effective_classifier_json #>> '{research_policy,external_research_required}', 'false')) = 'true'
  end;

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) evidence(item)
    where coalesce(evidence.item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(evidence.item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
  ) into v_has_external_url;

  v_effective_status := p_status;

  if p_status = 'accepted' and not v_input_hash_current then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'stale_input_hash');
  end if;

  if p_status = 'accepted' and v_research_required and not v_has_external_url then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags
      || array['missing_external_company_evidence', 'external_research_required'];
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_contract_match then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'taxonomy_contract_mismatch');
  end if;

  if p_status = 'accepted' and v_is_versioned and not (v_context_shape_valid and v_context_tags_valid) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_context_tags');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_organization_scale_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_organization_scale');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and p_segment = 'NT-8'
     and v_organization_scale is not null then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_organization_scale');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and (
       (p_segment = 'NT-5' and v_organization_scale is null)
       or (p_segment = 'NT-6' and v_organization_scale is distinct from 'enterprise')
       or (p_segment in ('NT-5', 'NT-6') and not v_organization_scale_evidence_valid)
     ) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'organization_scale_unverified');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and v_first_party_private_choice_valid
     and p_segment is distinct from 'NT-8' then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'conflicting_evidence');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_evidence_provenance_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'evidence_provenance_unverified');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_positive_evidence_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'missing_validated_positive_evidence');
  end if;

  if p_status = 'accepted' and not v_mapping_integrity then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'segment_mapping_integrity_failed');
  end if;

  if p_status = 'accepted' and (
    p_segment is null
    or p_confidence is null
    or not v_policy_found
    or not v_definition_found
  ) then
    v_effective_status := 'needs_review';
  elsif p_status = 'accepted' and (
    p_confidence < v_policy_rule.min_confidence
    or v_policy_rule.needs_human_review
  ) then
    v_effective_status := 'needs_review';
  end if;

  if p_status = 'accepted' and v_effective_risk_flags && array[
    'conflicting_evidence',
    'ambiguous_segment',
    'insufficient_segment_evidence',
    'invalid_external_evidence',
    'missing_external_company_evidence',
    'prompt_injection_seen',
    'freemail_business_unclear',
    'missing_company_identity',
    'taxonomy_contract_mismatch',
    'invalid_context_tags',
    'invalid_organization_scale',
    'evidence_provenance_unverified',
    'missing_validated_positive_evidence',
    'segment_mapping_integrity_failed',
    'stale_input_hash',
    case when p_segment in ('NT-5', 'NT-6') then 'organization_scale_unverified' else null end,
    case when p_segment = 'NT-10' then 'institution_status_unverified' else null end
  ]::text[] then
    v_effective_status := 'needs_review';
  end if;

  select coalesce(
    array_agg(distinct lower(btrim(flag)) order by lower(btrim(flag))),
    '{}'::text[]
  )
  into v_effective_risk_flags
  from unnest(v_effective_risk_flags) flags(flag)
  where nullif(btrim(flag), '') is not null;

  v_effective_segment := case
    when v_effective_status = 'accepted' then p_segment
    else null
  end;

  v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
    'risk_flags', to_jsonb(v_effective_risk_flags),
    'db_validation', case
        when jsonb_typeof(v_effective_classifier_json->'db_validation') = 'object'
          then v_effective_classifier_json->'db_validation'
        else '{}'::jsonb
      end
      || jsonb_build_object(
        'active_policy_version', v_active_policy.version,
        'expected_taxonomy_version', v_active_policy.taxonomy_version,
        'expected_classifier_version', v_active_policy.classifier_version,
        'expected_prompt_version', v_active_policy.prompt_version,
        'contract_match', v_contract_match,
        'input_hash_current', v_input_hash_current,
        'context_tags_valid', v_context_shape_valid and v_context_tags_valid,
        'organization_scale_valid', v_organization_scale_valid,
        'organization_scale_evidence_valid', v_organization_scale_evidence_valid,
        'evidence_semantics_shape_valid', v_evidence_semantics_shape_valid,
        'evidence_provenance_valid', v_evidence_provenance_valid,
        'required_positive_evidence_code', v_required_positive_code,
        'positive_evidence_valid', v_positive_evidence_valid,
        'first_party_private_choice_valid', v_first_party_private_choice_valid,
        'first_party_business_choice_valid', v_first_party_business_choice_valid,
        'private_declaration_evidence_valid', v_private_declaration_evidence_valid,
        'business_declaration_evidence_valid', v_business_declaration_evidence_valid,
        'mapping_integrity', v_mapping_integrity
      )
  );

  if v_is_versioned then
    v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
      'taxonomy_version', v_active_policy.taxonomy_version,
      'classifier_version', v_active_policy.classifier_version,
      'prompt_version', v_active_policy.prompt_version,
      'effective_status', v_effective_status,
      'effective_segment', v_effective_segment
    );
  end if;

  if v_is_versioned then
    insert into public.request_segment_classifications (
      request_id, customer_id, input_hash, status, segment, s_kategorie,
      confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
      firmographic_json, classifier_json, policy_json, risk_flags, model,
      model_version, prompt_version, classifier_version, policy_version,
      accepted_at, accepted_by, taxonomy_version, context_tags,
      organization_scale, evidence_provenance_valid, mapping_integrity
    ) values (
      p_request_id,
      v_request.customer_id,
      p_input_hash,
      v_effective_status,
      p_segment,
      case when v_policy_found then v_policy_rule.s_kategorie else null end,
      p_confidence,
      p_evidence_grade,
      left(coalesce(p_reasoning_short, ''), 1000),
      coalesce(p_reason_codes, '{}'),
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      case when v_policy_found then to_jsonb(v_policy_rule) else '{}'::jsonb end
        || jsonb_build_object(
          'taxonomy_version', v_active_policy.taxonomy_version,
          'classifier_version', v_active_policy.classifier_version,
          'prompt_version', v_active_policy.prompt_version
        ),
      v_effective_risk_flags,
      p_model,
      p_model_version,
      p_prompt_version,
      p_classifier_version,
      v_active_policy.version,
      case when v_effective_status = 'accepted' then now() else null end,
      case when v_effective_status = 'accepted'
        then p_accepted_by
        else null end,
      v_active_policy.taxonomy_version,
      case when v_context_shape_valid and v_context_tags_valid then v_context_tags else '{}'::text[] end,
      case when v_organization_scale_valid then v_organization_scale else null end,
      v_evidence_provenance_valid,
      v_mapping_integrity
    )
    on conflict (
      request_id, input_hash, taxonomy_version, classifier_version, prompt_version
    )
      where taxonomy_version is not null
    do update set
      status = excluded.status,
      segment = excluded.segment,
      s_kategorie = excluded.s_kategorie,
      confidence = excluded.confidence,
      evidence_grade = excluded.evidence_grade,
      reasoning_short = excluded.reasoning_short,
      reason_codes = excluded.reason_codes,
      evidence_json = excluded.evidence_json,
      firmographic_json = excluded.firmographic_json,
      classifier_json = excluded.classifier_json,
      policy_json = excluded.policy_json,
      risk_flags = excluded.risk_flags,
      model = excluded.model,
      model_version = excluded.model_version,
      policy_version = excluded.policy_version,
      accepted_at = excluded.accepted_at,
      accepted_by = excluded.accepted_by,
      context_tags = excluded.context_tags,
      organization_scale = excluded.organization_scale,
      evidence_provenance_valid = excluded.evidence_provenance_valid,
      mapping_integrity = excluded.mapping_integrity,
      created_at = now()
    returning id into v_classification_id;
  else
    insert into public.request_segment_classifications (
      request_id, customer_id, input_hash, status, segment, s_kategorie,
      confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
      firmographic_json, classifier_json, policy_json, risk_flags, model,
      model_version, prompt_version, classifier_version, policy_version,
      accepted_at, accepted_by, taxonomy_version, context_tags,
      organization_scale, evidence_provenance_valid, mapping_integrity
    ) values (
      p_request_id,
      v_request.customer_id,
      p_input_hash,
      v_effective_status,
      p_segment,
      case when v_policy_found then v_policy_rule.s_kategorie else null end,
      p_confidence,
      p_evidence_grade,
      left(coalesce(p_reasoning_short, ''), 1000),
      coalesce(p_reason_codes, '{}'),
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      case when v_policy_found then to_jsonb(v_policy_rule) else '{}'::jsonb end,
      v_effective_risk_flags,
      p_model,
      p_model_version,
      p_prompt_version,
      p_classifier_version,
      v_active_policy.version,
      case when v_effective_status = 'accepted' then now() else null end,
      case when v_effective_status = 'accepted'
        then coalesce(nullif(p_accepted_by, ''), 'n8n-request-segmenter')
        else null end,
      null,
      '{}',
      null,
      false,
      v_mapping_integrity
    )
    on conflict (request_id, input_hash, classifier_version)
      where taxonomy_version is null
    do update set
      status = excluded.status,
      segment = excluded.segment,
      s_kategorie = excluded.s_kategorie,
      confidence = excluded.confidence,
      evidence_grade = excluded.evidence_grade,
      reasoning_short = excluded.reasoning_short,
      reason_codes = excluded.reason_codes,
      evidence_json = excluded.evidence_json,
      firmographic_json = excluded.firmographic_json,
      classifier_json = excluded.classifier_json,
      policy_json = excluded.policy_json,
      risk_flags = excluded.risk_flags,
      model = excluded.model,
      model_version = excluded.model_version,
      prompt_version = excluded.prompt_version,
      policy_version = excluded.policy_version,
      accepted_at = excluded.accepted_at,
      accepted_by = excluded.accepted_by,
      mapping_integrity = excluded.mapping_integrity,
      created_at = now()
    returning id into v_classification_id;
  end if;

  if v_effective_status = 'accepted'
     and not v_evaluation_only
     and v_master_projection_authorized then
    select public.neontrip_upsert_segment_research_cache_from_classification(
      p_request_id,
      v_effective_status,
      v_active_policy.mode,
      p_evidence_grade,
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      p_model,
      p_classifier_version
    ) into v_research_cache_written;
  end if;

  v_manual_authoritative := v_request.segment_status = 'accepted'
    and coalesce(v_request.segment_source, '') ~ '^manual_';
  v_existing_authoritative := v_request.segment_status = 'accepted'
    and v_request.segment ~ '^NT-(1[0-8]|[1-9])$';

  if v_evaluation_only or not v_master_projection_authorized then
    v_projection_reason := 'evaluation_only_no_projection';
  elsif v_active_policy.mode = 'shadow' then
    v_projection_reason := 'policy_mode_shadow';
  elsif v_manual_authoritative then
    v_projection_reason := 'manual_authoritative_preserved';
  elsif not v_input_hash_current then
    v_projection_reason := 'stale_input_hash';
  elsif v_effective_status = 'accepted' and (not v_is_versioned or v_contract_match) then
    update public.master_requests
    set
      segment = v_effective_segment,
      s_kategorie = v_policy_rule.s_kategorie,
      segment_status = 'accepted',
      segment_confidence = p_confidence,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_active_policy.version,
      segment_taxonomy_version = case when v_is_versioned then v_active_policy.taxonomy_version else null end,
      segment_context_tags = case when v_is_versioned then v_context_tags else '{}'::text[] end,
      segment_organization_scale = case when v_is_versioned then v_organization_scale else null end,
      commercial_playbook = jsonb_build_object(
        'policy_version', v_active_policy.version,
        'taxonomy_version', v_active_policy.taxonomy_version,
        'segment', v_effective_segment,
        's_kategorie', v_policy_rule.s_kategorie,
        'price_factor', v_policy_rule.price_factor,
        'max_followups', v_policy_rule.max_followups,
        'first_call_after_minutes', v_policy_rule.first_call_after_minutes,
        'sales_priority', v_policy_rule.sales_priority,
        'automation_enabled', v_policy_rule.automation_enabled,
        'mode', v_active_policy.mode
      ),
      updated_at = now()
    where id = p_request_id;
    v_projection_applied := true;
    v_projection_reason := 'accepted_projected';
  elsif v_existing_authoritative then
    v_projection_reason := 'existing_authoritative_preserved';
  elsif v_effective_status in ('needs_review', 'rejected', 'error') then
    update public.master_requests
    set
      segment = null,
      s_kategorie = null,
      segment_status = v_effective_status,
      segment_confidence = null,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_active_policy.version,
      segment_taxonomy_version = case when v_is_versioned then v_active_policy.taxonomy_version else null end,
      segment_context_tags = '{}',
      segment_organization_scale = null,
      commercial_playbook = '{}'::jsonb,
      updated_at = now()
    where id = p_request_id;
    v_projection_reason := 'classification_not_accepted';
  else
    v_projection_reason := 'classification_not_accepted';
  end if;

  v_job_status := case
    when v_effective_status = 'accepted' then 'completed'
    when v_effective_status = 'needs_review' then 'needs_review'
    when v_effective_status = 'error' then 'failed'
    else 'completed'
  end;

  if p_job_id is not null then
    update public.request_segmentation_jobs
    set
      status = v_job_status,
      last_classification_id = v_classification_id,
      completed_at = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then now()
        else completed_at
      end,
      last_error_code = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null
        else last_error_code
      end,
      last_error_message = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null
        else last_error_message
      end,
      updated_at = now(),
      lock_owner = null,
      locked_at = null
    where id = p_job_id;
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id;

  return jsonb_build_object(
    'classification_id', v_classification_id,
    'job_id', p_job_id,
    'request_id', p_request_id,
    'submitted_status', p_status,
    'proposed_segment', p_segment,
    'effective_status', v_effective_status,
    'effective_segment', v_effective_segment,
    'policy_version', v_active_policy.version,
    'policy_mode', v_active_policy.mode,
    'taxonomy_version', v_active_policy.taxonomy_version,
    'classifier_version', p_classifier_version,
    'prompt_version', p_prompt_version,
    'job_status', v_job_status,
    'input_hash_current', v_input_hash_current,
    'contract_match', v_contract_match,
    'context_tags', to_jsonb(case when v_context_tags_valid then v_context_tags else '{}'::text[] end),
    'organization_scale', case when v_organization_scale_valid then v_organization_scale else null end,
    'evidence_provenance_valid', v_evidence_provenance_valid,
    'mapping_integrity', v_mapping_integrity,
    'evaluation_only', v_evaluation_only,
    'master_projection_authorized', v_master_projection_authorized,
    'research_cache_written', v_research_cache_written,
    'projection', jsonb_build_object(
      'applied', v_projection_applied,
      'reason', v_projection_reason,
      'authoritative_segment', v_request.segment,
      'authoritative_s_kategorie', v_request.s_kategorie,
      'authoritative_status', v_request.segment_status,
      'authoritative_source', v_request.segment_source,
      'authoritative_taxonomy_version', v_request.segment_taxonomy_version,
      'manual_authoritative_preserved', v_manual_authoritative
    )
  );
end;
$function$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) is
  'Preserves the 18-parameter n8n call and admits only the exact CX8 v3/v3-worker or CX8 v4/v4-worker runtime pair under the matching active policy. Cross-lane jobs fail without a classification; evaluation-only jobs may classify but never project to master/cache.';

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;


create or replace function public.neontrip_adjudicate_request_segmentation_gold(
  p_request_id uuid,
  p_input_hash text,
  p_taxonomy_version text,
  p_segment text,
  p_context_tags text[],
  p_organization_scale text,
  p_adjudicated_by text,
  p_adjudication_reason text,
  p_evidence_urls text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected_taxonomy constant text := 'nt_taxonomy_v2_20260819_cx8';
  v_labeling_version constant text := 'gold_labeling_v2_20260819_cx8';
  v_current_input_hash text;
  v_target_contract record;
  v_s_kategorie text;
  v_context_tags text[];
  v_evidence_urls text[];
  v_actor text := btrim(coalesce(p_adjudicated_by, ''));
  v_reason text := btrim(coalesce(p_adjudication_reason, ''));
  v_adjudication public.request_segmentation_gold_adjudications%rowtype;
  v_created boolean := false;
  v_job_id uuid;
begin
  select *
  into v_target_contract
  from public.neontrip_get_request_segmentation_gold_target_contract();

  if not found then
    raise exception 'gold_evaluation_contract_unavailable';
  end if;

  if p_taxonomy_version is distinct from v_expected_taxonomy
     or p_taxonomy_version is distinct from v_target_contract.taxonomy_version then
    raise exception 'gold_taxonomy_not_supported: %', p_taxonomy_version;
  end if;

  if nullif(btrim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'gold_input_hash_required';
  end if;

  if length(v_actor) < 3 then
    raise exception 'gold_adjudicator_required';
  end if;

  if length(v_actor) > 320 then
    raise exception 'gold_adjudicator_too_long';
  end if;

  if length(v_reason) < 20 then
    raise exception 'gold_adjudication_reason_too_short';
  end if;

  if length(v_reason) > 4000 then
    raise exception 'gold_adjudication_reason_too_long';
  end if;

  if p_organization_scale is not null
     and p_organization_scale not in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise') then
    raise exception 'invalid_gold_organization_scale: %', p_organization_scale;
  end if;

  select d.default_s_kategorie
  into v_s_kategorie
  from public.segment_taxonomy_definitions d
  where d.taxonomy_version = p_taxonomy_version
    and d.segment = p_segment
    and d.active
  limit 1;

  if not found then
    raise exception 'invalid_gold_segment: %', p_segment;
  end if;

  select coalesce(array_agg(distinct btrim(tag) order by btrim(tag)), '{}'::text[])
  into v_context_tags
  from unnest(coalesce(p_context_tags, '{}'::text[])) tags(tag)
  where nullif(btrim(tag), '') is not null;

  if cardinality(v_context_tags) > 10 then
    raise exception 'gold_context_tags_above_10';
  end if;

  if exists (
    select 1
    from unnest(v_context_tags) tags(tag)
    where length(tag) > 80
  ) then
    raise exception 'gold_context_tag_too_long';
  end if;

  if exists (
    select 1
    from unnest(v_context_tags) tags(tag)
    where not exists (
      select 1
      from public.segment_context_definitions cd
      where cd.taxonomy_version = p_taxonomy_version
        and cd.context_tag = tags.tag
        and cd.active
    )
  ) then
    raise exception 'invalid_gold_context_tags';
  end if;

  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);

  -- The immutable input lock remains authoritative. Human Gold may disagree
  -- with customer_type because that field is classifier input, not ground truth.
  if not exists (
    select 1
    from public.master_requests mr
    where mr.id = p_request_id
  ) then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  if v_current_input_hash is distinct from p_input_hash then
    raise exception 'gold_input_hash_not_current';
  end if;

  if p_segment = 'NT-8' and p_organization_scale is not null then
    raise exception 'gold_private_organization_scale_must_be_null';
  end if;

  if p_segment = 'NT-5' and p_organization_scale is null then
    raise exception 'gold_multisite_organization_scale_required';
  end if;

  if p_segment = 'NT-6' and p_organization_scale is distinct from 'enterprise' then
    raise exception 'gold_enterprise_scale_required';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_evidence_urls, '{}'::text[])) urls(url)
    where nullif(btrim(url), '') is not null
      and length(btrim(url)) > 2048
  ) then
    raise exception 'gold_evidence_url_too_long';
  end if;

  select coalesce(array_agg(distinct btrim(url) order by btrim(url)), '{}'::text[])
  into v_evidence_urls
  from unnest(coalesce(p_evidence_urls, '{}'::text[])) urls(url)
  where nullif(btrim(url), '') is not null;

  if cardinality(v_evidence_urls) > 12 then
    raise exception 'gold_evidence_urls_above_12';
  end if;

  if exists (
    select 1 from unnest(v_evidence_urls) urls(url)
    where url !~* '^https?://'
       or not coalesce(
         ((public.neontrip_request_segmentation_domain_facts(url))->>'is_valid_dns_host')::boolean,
         false
       )
  ) then
    raise exception 'invalid_gold_evidence_url';
  end if;

  if cardinality(v_evidence_urls) = 0 and p_segment <> 'NT-8' then
    raise exception 'gold_external_evidence_required_for_non_private_segment';
  end if;

  insert into public.request_segmentation_gold_adjudications (
    request_id, input_hash, taxonomy_version, labeling_version,
    labeled_segment, labeled_s_kategorie, context_tags, organization_scale,
    adjudicated_by, adjudication_reason, evidence_urls
  ) values (
    p_request_id,
    p_input_hash,
    p_taxonomy_version,
    v_labeling_version,
    p_segment,
    v_s_kategorie,
    v_context_tags,
    p_organization_scale,
    v_actor,
    v_reason,
    v_evidence_urls
  )
  on conflict (request_id, input_hash, taxonomy_version) do nothing
  returning * into v_adjudication;

  v_created := found;

  if not v_created then
    select * into v_adjudication
    from public.request_segmentation_gold_adjudications g
    where g.request_id = p_request_id
      and g.input_hash = p_input_hash
      and g.taxonomy_version = p_taxonomy_version
    for update;

    if v_adjudication.labeling_version is distinct from v_labeling_version
       or v_adjudication.labeled_segment is distinct from p_segment
       or v_adjudication.labeled_s_kategorie is distinct from v_s_kategorie
       or v_adjudication.context_tags is distinct from v_context_tags
       or v_adjudication.organization_scale is distinct from p_organization_scale
       or v_adjudication.adjudicated_by is distinct from v_actor
       or v_adjudication.adjudication_reason is distinct from v_reason
       or v_adjudication.evidence_urls is distinct from v_evidence_urls then
      raise exception using
        errcode = '23505',
        message = 'gold_adjudication_conflict_requires_explicit_superseding_revision',
        detail = 'Existing insert-once gold differs; ordinary retries cannot mutate adjudicated truth.';
    end if;
  else
    v_job_id := public.neontrip_enqueue_request_segmentation_evaluation(
      p_request_id,
      p_input_hash,
      p_taxonomy_version,
      v_target_contract.classifier_version,
      v_target_contract.prompt_version,
      'gold_re_evaluation'
    );
  end if;

  if not v_created then
    select j.id into v_job_id
    from public.request_segmentation_jobs j
    where j.request_id = p_request_id
      and j.input_hash = p_input_hash
      and j.taxonomy_version = p_taxonomy_version
      and j.classifier_version = v_target_contract.classifier_version
      and j.prompt_version = v_target_contract.prompt_version
    order by j.created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'gold_adjudication_id', v_adjudication.id,
    'request_id', p_request_id,
    'input_hash', p_input_hash,
    'taxonomy_version', p_taxonomy_version,
    'labeling_version', v_labeling_version,
    'labeled_segment', p_segment,
    'labeled_s_kategorie', v_s_kategorie,
    'context_tags', to_jsonb(v_context_tags),
    'organization_scale', p_organization_scale,
    'created', v_created,
    'idempotent_retry', not v_created,
    'evaluation_job_id', v_job_id,
    'master_segment_mutated', false
  );
end;
$function$;

comment on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) is
  'Creates insert-once explicit human CX8 gold for the exact current input and enqueues only the allowlisted active Gold evaluation contract. Taxonomy and labeling remain pinned; human Gold may disagree with stored customer_type without mutating request authority. Identical retry is idempotent and divergent retry conflicts.';

revoke all on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) to service_role;


create or replace function public.neontrip_get_request_segmentation_review_context(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_input_hash text;
  v_result jsonb;
begin
  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);

  if not exists (
    select 1 from public.master_requests mr where mr.id = p_request_id
  ) then
    return jsonb_build_object(
      'request_id', p_request_id,
      'payload_error', jsonb_build_object(
        'code', 'request_not_found',
        'message', 'No master request exists for this review context.'
      )
    );
  end if;

  with target_contract as (
    select *
    from public.neontrip_get_request_segmentation_gold_target_contract()
  ),
  request_row as (
    select
      mr.id,
      mr.request_id as public_request_id,
      v_current_input_hash as current_input_hash,
      case lower(btrim(coalesce(mr.customer_type, '')))
        when 'privat' then 'privat'
        when 'gewerblich' then 'gewerblich'
        when 'b2b' then 'b2b'
        else null
      end as normalized_customer_type
    from public.master_requests mr
    where mr.id = p_request_id
  ),
  latest_classification as (
    select c.*
    from public.request_segment_classifications c
    cross join target_contract tc
    where c.request_id = p_request_id
      and c.taxonomy_version = tc.taxonomy_version
      and c.classifier_version = tc.classifier_version
      and c.prompt_version = tc.prompt_version
    order by c.created_at desc, c.id desc
    limit 1
  ),
  current_gold as (
    select g.*
    from public.request_segmentation_gold_adjudications g
    cross join request_row rr
    cross join target_contract tc
    where g.request_id = rr.id
      and g.input_hash = rr.current_input_hash
      and g.taxonomy_version = tc.taxonomy_version
    limit 1
  )
  select case
    when not exists (select 1 from request_row) then
      jsonb_build_object(
        'request_id', p_request_id,
        'payload_error', jsonb_build_object(
          'code', 'request_not_found',
          'message', 'No master request exists for this review context.'
        )
      )
    when not exists (select 1 from target_contract) then
      jsonb_build_object(
        'request_id', p_request_id,
        'payload_error', jsonb_build_object(
          'code', 'cx8_review_contract_missing',
          'message', 'The exact CX8 evaluation contract is not configured.'
        )
      )
    else jsonb_build_object(
      'request_id', p_request_id,
      'public_request_id', (select public_request_id from request_row),
      'current_input_hash', (select current_input_hash from request_row),
      'taxonomy_version', (select taxonomy_version from target_contract),
      'classifier_version', (select classifier_version from target_contract),
      'prompt_version', (select prompt_version from target_contract),
      'quality_gate_version', (select quality_gate_version from target_contract),
      'gold_eligibility', jsonb_build_object(
        'normalized_customer_type', (select normalized_customer_type from request_row),
        'nt8_first_party_eligible', coalesce(
          (select normalized_customer_type = 'privat' from request_row),
          false
        ),
        'nt9_first_party_eligible', coalesce(
          (select normalized_customer_type in ('gewerblich', 'b2b') from request_row),
          false
        ),
        'nt8_requires_null_organization_scale', true,
        'nt5_requires_nonnull_organization_scale', true,
        'nt6_required_organization_scale', 'enterprise',
        'non_nt8_requires_external_evidence_url', true
      ),
      'latest_classification', case
        when not exists (select 1 from latest_classification) then null
        else jsonb_build_object(
          'classification_id', (select id from latest_classification),
          'input_hash', (select input_hash from latest_classification),
          'input_hash_current', (
            select lc.input_hash = rr.current_input_hash
            from latest_classification lc cross join request_row rr
          ),
          'status', (select status from latest_classification),
          'proposed_segment', (select segment from latest_classification),
          's_kategorie', (select s_kategorie from latest_classification),
          'confidence', (select confidence from latest_classification),
          'evidence_grade', (select evidence_grade from latest_classification),
          'reasoning_short', (select reasoning_short from latest_classification),
          'reason_codes', (select reason_codes from latest_classification),
          'evidence_json', (select evidence_json from latest_classification),
          'risk_flags', (select risk_flags from latest_classification),
          'context_tags', (select context_tags from latest_classification),
          'organization_scale', (select organization_scale from latest_classification),
          'evidence_provenance_valid', (select evidence_provenance_valid from latest_classification),
          'mapping_integrity', (select mapping_integrity from latest_classification),
          'classified_at', (select created_at from latest_classification)
        )
      end,
      'current_gold_adjudication', case
        when not exists (select 1 from current_gold) then null
        else jsonb_build_object(
          'gold_adjudication_id', (select id from current_gold),
          'input_hash', (select input_hash from current_gold),
          'labeled_segment', (select labeled_segment from current_gold),
          'labeled_s_kategorie', (select labeled_s_kategorie from current_gold),
          'context_tags', (select context_tags from current_gold),
          'organization_scale', (select organization_scale from current_gold),
          'labeling_version', (select labeling_version from current_gold),
          'created_at', (select created_at from current_gold)
        )
      end
    )
  end
  into v_result;

  return v_result;
end;
$function$;

comment on function public.neontrip_get_request_segmentation_review_context(uuid) is
  'Service-role review contract for the exact locked current input, deterministic Gold eligibility, and the exact allowlisted active CX8 Gold evaluation contract; never mixes another classifier or legacy/latest classifications.';

revoke all on function public.neontrip_get_request_segmentation_review_context(uuid)
  from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_review_context(uuid)
  to service_role;


create view public.request_segmentation_v3_gold_evaluation
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
), latest_gold_per_request as (
  -- One request can acquire a later immutable input hash. Quality gates use
  -- only its latest explicit adjudication, so repeated versions cannot inflate
  -- either the 300-request total or any per-class metric.
  select distinct on (g.request_id) g.*
  from public.request_segmentation_gold_adjudications g
  cross join target_contract tc
  where g.taxonomy_version = tc.taxonomy_version
    and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
  order by g.request_id, g.created_at desc, g.id desc
), exact_evaluation as (
  select
    g.id as gold_adjudication_id,
    g.request_id,
    g.input_hash,
    g.taxonomy_version,
    g.labeling_version,
    g.labeled_segment as actual_segment,
    g.labeled_s_kategorie as actual_s_kategorie,
    g.created_at as adjudicated_at,
    c.id as classification_id,
    c.status as classifier_status,
    c.segment as proposed_segment,
    case when c.status = 'accepted' then c.segment end as accepted_predicted_segment,
    c.s_kategorie as proposed_s_kategorie,
    case when c.status = 'accepted' then c.s_kategorie end as accepted_predicted_s_kategorie,
    c.confidence as predicted_confidence,
    c.evidence_grade,
    c.risk_flags,
    c.evidence_provenance_valid,
    c.mapping_integrity,
    c.policy_version,
    c.classifier_version,
    c.prompt_version,
    c.created_at as classified_at
  from latest_gold_per_request g
  cross join target_contract tc
  left join public.request_segment_classifications c
    on c.request_id = g.request_id
   and c.input_hash = g.input_hash
   and c.taxonomy_version = g.taxonomy_version
   and c.classifier_version = tc.classifier_version
   and c.prompt_version = tc.prompt_version
)
select
  e.*,
  case
    when e.classification_id is null then 'missing_prediction'
    when e.classifier_status <> 'accepted' then 'not_accepted'
    when e.accepted_predicted_segment = e.actual_segment then 'correct'
    else 'wrong_segment'
  end as evaluation_status,
  coalesce(
    e.classifier_status = 'accepted'
    and e.accepted_predicted_segment = e.actual_segment,
    false
  ) as segment_match,
  coalesce(
    e.classifier_status = 'accepted'
    and e.accepted_predicted_s_kategorie = e.actual_s_kategorie,
    false
  ) as s_kategorie_match
from exact_evaluation e;

comment on view public.request_segmentation_v3_gold_evaluation is
  'Exact CX8 classifier-v4 evaluation join using one latest immutable adjudication per unique request. Gold and predictions match on request, input hash, taxonomy, classifier, and prompt; legacy/latest classifications cannot leak in.';

create view public.request_segmentation_v3_confusion_matrix
with (security_invoker = true)
as
select
  actual_segment,
  case
    when classifier_status = 'accepted' then accepted_predicted_segment
    else '__ABSTAIN__'
  end as predicted_outcome,
  classifier_status,
  count(*)::integer as examples,
  count(*) filter (where evaluation_status = 'correct')::integer as correct_examples
from public.request_segmentation_v3_gold_evaluation
group by
  actual_segment,
  case
    when classifier_status = 'accepted' then accepted_predicted_segment
    else '__ABSTAIN__'
  end,
  classifier_status;

comment on view public.request_segmentation_v3_confusion_matrix is
  'True CX8 confusion matrix: only accepted classifications are predicted classes; review/reject/error/missing outcomes are explicit abstentions.';

create view public.request_segmentation_v3_segment_quality
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
), actual_stats as (
  select
    e.actual_segment as segment,
    count(*)::integer as gold_examples,
    count(*) filter (where e.classifier_status = 'accepted')::integer as accepted_on_actual,
    count(*) filter (where e.evaluation_status = 'correct')::integer as true_positives
  from public.request_segmentation_v3_gold_evaluation e
  group by e.actual_segment
), predicted_stats as (
  select
    e.accepted_predicted_segment as segment,
    count(*)::integer as accepted_predictions,
    count(*) filter (where e.actual_segment = e.accepted_predicted_segment)::integer as true_positives
  from public.request_segmentation_v3_gold_evaluation e
  where e.classifier_status = 'accepted'
    and e.accepted_predicted_segment is not null
  group by e.accepted_predicted_segment
), metrics as (
  select
    d.taxonomy_version,
    tc.classifier_version,
    tc.prompt_version,
    tc.version as quality_gate_version,
    d.segment,
    d.label,
    d.default_s_kategorie,
    d.required_evidence_code,
    coalesce(a.gold_examples, 0) as gold_examples,
    coalesce(p.accepted_predictions, 0) as accepted_predictions,
    coalesce(a.accepted_on_actual, 0) as accepted_on_actual,
    coalesce(a.true_positives, 0) as true_positives,
    greatest(coalesce(p.accepted_predictions, 0) - coalesce(p.true_positives, 0), 0) as false_positives,
    greatest(coalesce(a.gold_examples, 0) - coalesce(a.true_positives, 0), 0) as false_negatives,
    round(coalesce(a.accepted_on_actual, 0)::numeric / nullif(a.gold_examples, 0), 4) as accepted_coverage,
    round(coalesce(p.true_positives, 0)::numeric / nullif(p.accepted_predictions, 0), 4) as precision,
    round(coalesce(a.true_positives, 0)::numeric / nullif(a.gold_examples, 0), 4) as recall,
    case
      when d.segment = any(tc.critical_segments) then tc.min_critical_precision
      else tc.min_precision_per_predicted_class
    end as required_precision,
    tc.min_recall_per_actual_class as required_recall,
    tc.min_gold_per_segment
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version
   and d.active
  left join actual_stats a on a.segment = d.segment
  left join predicted_stats p on p.segment = d.segment
)
select
  m.*,
  m.gold_examples >= m.min_gold_per_segment as has_minimum_gold,
  coalesce(m.precision >= m.required_precision, false) as precision_passed,
  coalesce(m.recall >= m.required_recall, false) as recall_passed,
  (
    m.gold_examples >= m.min_gold_per_segment
    and coalesce(m.precision >= m.required_precision, false)
    and coalesce(m.recall >= m.required_recall, false)
  ) as segment_gate_passed,
  array_remove(array[
    case when m.gold_examples < m.min_gold_per_segment then 'gold_below_segment_minimum' end,
    case when not coalesce(m.precision >= m.required_precision, false) then 'precision_below_required_or_missing' end,
    case when not coalesce(m.recall >= m.required_recall, false) then 'recall_below_required_or_missing' end
  ], null) as blocking_reasons
from metrics m;

comment on view public.request_segmentation_v3_segment_quality is
  'Per-class CX8 metrics with true precision grouped by predicted class and true recall grouped by actual class. Abstentions lower recall/coverage, not precision denominators.';

create view public.request_segmentation_v3_quality_summary
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
), evaluation as (
  select * from public.request_segmentation_v3_gold_evaluation
)
select
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  tc.version as quality_gate_version,
  count(e.gold_adjudication_id)::integer as unique_gold_examples,
  count(e.gold_adjudication_id) filter (where e.classification_id is not null)::integer as evaluated_examples,
  count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted')::integer as accepted_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::integer as correct_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'wrong_segment')::integer as wrong_segment_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'not_accepted')::integer as abstained_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'missing_prediction')::integer as missing_predictions,
  round(
    count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted')::numeric
      / nullif(count(e.gold_adjudication_id), 0),
    4
  ) as accepted_coverage,
  round(
    count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::numeric
      / nullif(count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted'), 0),
    4
  ) as overall_precision_on_accepted,
  round(
    count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted' and e.mapping_integrity)::numeric
      / nullif(count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted'), 0),
    4
  ) as accepted_mapping_integrity,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and not coalesce(e.mapping_integrity, false)
  )::integer as accepted_mapping_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and not coalesce(e.evidence_provenance_valid, false)
  )::integer as accepted_provenance_violations
from target_contract tc
left join evaluation e on true
group by tc.taxonomy_version, tc.classifier_version, tc.prompt_version, tc.version;

comment on view public.request_segmentation_v3_quality_summary is
  'CX8 totals and accepted coverage. Mapping integrity is deliberately calculated only over accepted predictions; abstentions are not mapping violations.';

create view public.request_segmentation_v3_mapping_integrity
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
), configuration as (
  select
    tc.taxonomy_version,
    count(d.segment)::integer as active_definition_count,
    count(distinct d.required_evidence_code)::integer as unique_required_evidence_codes,
    count(r.segment)::integer as matching_policy_rule_count,
    count(*) filter (
      where r.segment is null
         or r.s_kategorie is distinct from d.default_s_kategorie
         or r.taxonomy_version is distinct from d.taxonomy_version
    )::integer as definition_rule_mismatches
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version
   and d.active
  left join public.segment_policy_rules r
    on r.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
   and r.taxonomy_version = d.taxonomy_version
   and r.segment = d.segment
  group by tc.taxonomy_version
)
select
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  tc.version as quality_gate_version,
  c.active_definition_count,
  c.unique_required_evidence_codes,
  c.matching_policy_rule_count,
  c.definition_rule_mismatches,
  (
    c.active_definition_count = 8
    and c.unique_required_evidence_codes = 8
    and c.matching_policy_rule_count = 8
    and c.definition_rule_mismatches = 0
  ) as configuration_integrity,
  qs.accepted_predictions,
  qs.accepted_mapping_violations,
  qs.accepted_mapping_integrity
from target_contract tc
join configuration c on c.taxonomy_version = tc.taxonomy_version
join public.request_segmentation_v3_quality_summary qs
  on qs.quality_gate_version = tc.version;

comment on view public.request_segmentation_v3_mapping_integrity is
  'Checks both the eight definition/rule/evidence-code mappings and accepted-prediction mapping integrity for the exact CX8 contract.';

create view public.request_segmentation_v3_activation_gate_status
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
), summary as (
  select * from public.request_segmentation_v3_quality_summary
), per_segment as (
  select
    count(*)::integer as active_segments,
    count(*) filter (where has_minimum_gold)::integer as segments_with_minimum_gold,
    count(*) filter (where not precision_passed)::integer as segments_below_precision,
    count(*) filter (where not recall_passed)::integer as segments_below_recall,
    coalesce(bool_and(segment_gate_passed), false) as all_segment_gates_passed
  from public.request_segmentation_v3_segment_quality
), mapping as (
  select * from public.request_segmentation_v3_mapping_integrity
)
select
  tc.version as quality_gate_version,
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  s.unique_gold_examples,
  s.evaluated_examples,
  s.accepted_predictions,
  s.correct_predictions,
  s.accepted_coverage,
  s.overall_precision_on_accepted,
  ps.active_segments,
  ps.segments_with_minimum_gold,
  ps.segments_below_precision,
  ps.segments_below_recall,
  m.configuration_integrity,
  s.accepted_mapping_integrity,
  s.accepted_mapping_violations,
  s.accepted_provenance_violations,
  s.unique_gold_examples >= tc.min_unique_gold_total as has_minimum_unique_gold,
  ps.active_segments = 8
    and ps.segments_with_minimum_gold = 8 as has_minimum_gold_per_segment,
  ps.segments_below_precision = 0 as has_required_per_class_precision,
  ps.segments_below_recall = 0 as has_required_per_class_recall,
  coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false) as has_required_accepted_coverage,
  m.configuration_integrity
    and coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
    and s.accepted_mapping_violations = 0 as has_required_mapping_integrity,
  s.accepted_provenance_violations <= tc.max_provenance_violations as has_no_provenance_violations,
  (
    s.unique_gold_examples >= tc.min_unique_gold_total
    and ps.active_segments = 8
    and ps.segments_with_minimum_gold = 8
    and ps.all_segment_gates_passed
    and coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false)
    and m.configuration_integrity
    and coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
    and s.accepted_mapping_violations = 0
    and s.accepted_provenance_violations <= tc.max_provenance_violations
  ) as technical_quality_gate_passed,
  array_remove(array[
    case when s.unique_gold_examples < tc.min_unique_gold_total then 'unique_gold_total_below_required' end,
    case when ps.active_segments <> 8 then 'active_taxonomy_definition_count_not_eight' end,
    case when ps.segments_with_minimum_gold <> 8 then 'gold_per_active_segment_below_required' end,
    case when ps.segments_below_precision <> 0 then 'per_predicted_class_precision_below_required' end,
    case when ps.segments_below_recall <> 0 then 'per_actual_class_recall_below_required' end,
    case when not coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false) then 'accepted_coverage_below_required' end,
    case when not m.configuration_integrity then 'taxonomy_policy_evidence_mapping_incomplete' end,
    case when not coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
           or s.accepted_mapping_violations <> 0 then 'accepted_prediction_mapping_integrity_below_required' end,
    case when s.accepted_provenance_violations > tc.max_provenance_violations then 'accepted_evidence_provenance_violations_present' end
  ], null) as technical_blocking_reasons,
  tc.manual_activation_required
from target_contract tc
cross join summary s
cross join per_segment ps
cross join mapping m;

comment on view public.request_segmentation_v3_activation_gate_status is
  'Versioned CX8 candidate gate: 300 unique gold, 25/class, predicted-class precision, actual-class recall, accepted coverage, accepted-only mapping integrity, zero provenance violations. Manual activation remains separate.';

create view public.request_segmentation_v3_activation_approval_status
with (security_invoker = true)
as
with active_approval as (
  select a.*
  from public.request_segmentation_activation_approvals a
  where a.approval_scope = 'followup_pricing'
    and a.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
    and a.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and a.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8'
    and a.revoked_at is null
    and a.expires_at > now()
  order by a.approved_at desc
  limit 1
)
select
  a.id as approval_id,
  a.approval_scope,
  a.policy_version,
  a.taxonomy_version,
  a.quality_gate_version,
  a.approved_by,
  a.approval_reason,
  a.approved_at,
  a.expires_at,
  a.gate_snapshot,
  true as has_active_approval
from active_approval a
union all
select
  null::uuid,
  'followup_pricing'::text,
  'nt_policy_v3_20260820_cx8_shadow'::text,
  'nt_taxonomy_v2_20260819_cx8'::text,
  'nt_quality_gate_v3_20260820_cx8'::text,
  null::text,
  null::text,
  null::timestamptz,
  null::timestamptz,
  null::jsonb,
  false
where not exists (select 1 from active_approval);

create view public.request_segmentation_v3_production_readiness
with (security_invoker = true)
as
select
  g.quality_gate_version,
  g.taxonomy_version,
  g.classifier_version,
  g.prompt_version,
  g.unique_gold_examples as gold_examples,
  g.evaluated_examples,
  g.accepted_predictions,
  g.correct_predictions,
  g.accepted_coverage,
  g.overall_precision_on_accepted,
  g.technical_quality_gate_passed,
  a.has_active_approval as has_manual_activation_approval,
  a.approval_id as activation_approval_id,
  a.approved_by as activation_approved_by,
  a.approved_at as activation_approved_at,
  a.expires_at as activation_approval_expires_at,
  (
    g.technical_quality_gate_passed
    and (not g.manual_activation_required or a.has_active_approval)
  ) as followup_pricing_activation_allowed,
  array_remove(
    g.technical_blocking_reasons || array[
      case
        when g.manual_activation_required and not a.has_active_approval
          then 'manual_approval_required_before_followup_or_pricing'
      end
    ],
    null
  ) as blocking_reasons,
  g.active_segments,
  g.segments_with_minimum_gold,
  g.segments_below_precision,
  g.segments_below_recall,
  g.configuration_integrity,
  g.accepted_mapping_integrity,
  g.accepted_mapping_violations,
  g.accepted_provenance_violations
from public.request_segmentation_v3_activation_gate_status g
cross join public.request_segmentation_v3_activation_approval_status a;

comment on view public.request_segmentation_v3_production_readiness is
  'Fail-closed CX8 commercial readiness. Technical gate and exact version-scoped, unexpired manual approval are both required.';



revoke all on table public.request_segmentation_v3_gold_evaluation from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_confusion_matrix from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_segment_quality from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_quality_summary from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_mapping_integrity from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_activation_gate_status from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_activation_approval_status from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v3_production_readiness from public, anon, authenticated, service_role;

grant select on table public.request_segmentation_v3_gold_evaluation to service_role;
grant select on table public.request_segmentation_v3_confusion_matrix to service_role;
grant select on table public.request_segmentation_v3_segment_quality to service_role;
grant select on table public.request_segmentation_v3_quality_summary to service_role;
grant select on table public.request_segmentation_v3_mapping_integrity to service_role;
grant select on table public.request_segmentation_v3_activation_gate_status to service_role;
grant select on table public.request_segmentation_v3_activation_approval_status to service_role;
grant select on table public.request_segmentation_v3_production_readiness to service_role;

do $phase5_base_postcondition$
declare
  v_quality_count integer;
  v_policy_count integer;
  v_rule_count integer;
  v_non_inert_rule_count integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_quality_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and not q.active;

  select count(*) into v_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v3_20260820_cx8_shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8'
    and p.mode = 'shadow'
    and not p.active;

  select
    count(*),
    count(*) filter (
      where r.automation_enabled
         or r.needs_human_review
         or r.price_factor is not null
         or r.max_followups <> 0
         or r.first_call_after_minutes is not null
         or r.call_sequence <> '[]'::jsonb
         or r.email_sequence <> '[]'::jsonb
    )
  into v_rule_count, v_non_inert_rule_count
  from public.segment_policy_rules r
  where r.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
    and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8';

  if v_quality_count <> 1
     or v_policy_count <> 1
     or v_rule_count <> 8
     or v_non_inert_rule_count <> 0
     or v_global_active_policy_count <> 1
     or v_global_active_quality_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'phase5_base_postcondition_failed',
      detail = format(
        'quality=%s policy=%s rules=%s non_inert_rules=%s active_policies=%s active_gates=%s',
        v_quality_count, v_policy_count, v_rule_count, v_non_inert_rule_count,
        v_global_active_policy_count, v_global_active_quality_count
      );
  end if;
end;
$phase5_base_postcondition$;

commit;
