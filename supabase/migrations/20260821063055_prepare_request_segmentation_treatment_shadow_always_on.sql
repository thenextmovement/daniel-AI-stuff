-- Prepare the permanent, simplified NEONTRIP treatment classifier in shadow.
--
-- The migration itself is non-operational:
--   * Phase-2 remains the sole active policy and quality gate.
--   * The new v7 treatment policy is inserted inactive with eight inert rules.
--   * A service-role-only payload RPC exposes only bounded/redacted request
--     facts plus a screened email domain; it never exposes contact identities,
--     request IDs, Gold, cache or related-history data to the model path.
--   * The canonical 18-argument Record RPC gains exactly one new worker/version
--     allowlist branch. In shadow mode it still cannot project to master data,
--     cache, pricing, follow-ups, Trello or customer communication.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_activation_approvals in share mode;

do $treatment_shadow_base_precondition$
declare
  v_record_definition text;
  v_candidate_objects integer;
  v_candidate_jobs integer;
  v_candidate_classifications integer;
  v_candidate_cache integer;
  v_candidate_approvals integer;
begin
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
       where p.version = 'nt_policy_v2_20260819_cx8_shadow'
         and p.active
         and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
         and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
         and q.version = 'nt_quality_gate_v2_20260819_cx8'
         and q.active
     )
     or (select count(*) from public.segment_policy_rules
         where policy_version = 'nt_policy_v2_20260819_cx8_shadow') <> 8
     or exists (
       select 1 from public.segment_policy_rules
       where policy_version = 'nt_policy_v2_20260819_cx8_shadow'
         and (
           taxonomy_version is distinct from 'nt_taxonomy_v2_20260819_cx8'
           or automation_enabled
           or needs_human_review
           or price_factor is not null
           or max_followups <> 0
           or first_call_after_minutes is not null
           or call_sequence <> '[]'::jsonb
           or email_sequence <> '[]'::jsonb
         )
     ) then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_base_requires_exact_active_phase2_contract';
  end if;

  select
    (select count(*) from public.segment_quality_gate_versions
      where version = 'nt_quality_gate_v6_20260821_treatment_shadow')
    + (select count(*) from public.segment_policy_versions
      where version = 'nt_policy_v6_20260821_treatment_shadow')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'neontrip_get_request_segmentation_treatment_shadow_payload')
  into v_candidate_objects;

  select count(*) into v_candidate_jobs
  from public.request_segmentation_jobs
  where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
    and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow';

  select count(*) into v_candidate_classifications
  from public.request_segment_classifications
  where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
    and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow';

  select count(*) into v_candidate_cache
  from public.segment_research_cache
  where summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and summary_json->>'classifier_version' = 'segment_classifier_v7_20260821_treatment_shadow'
    and summary_json->>'prompt_version' = 'segment_prompt_v7_20260821_treatment_shadow';

  select count(*) into v_candidate_approvals
  from public.request_segmentation_activation_approvals
  where policy_version = 'nt_policy_v6_20260821_treatment_shadow'
     or quality_gate_version = 'nt_quality_gate_v6_20260821_treatment_shadow';

  if v_candidate_objects <> 0
     or v_candidate_jobs <> 0
     or v_candidate_classifications <> 0
     or v_candidate_cache <> 0
     or v_candidate_approvals <> 0 then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_base_requires_pristine_candidate',
      detail = format(
        'objects=%s jobs=%s classifications=%s cache=%s approvals=%s',
        v_candidate_objects, v_candidate_jobs, v_candidate_classifications,
        v_candidate_cache, v_candidate_approvals
      );
  end if;

  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_record_definition;

  if md5(v_record_definition) <> '0ab12d2ba650117b1151eb4729949547' then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_record_function_baseline_drift',
      detail = format('actual_md5=%s', md5(v_record_definition));
  end if;
end;
$treatment_shadow_base_precondition$;

insert into public.segment_quality_gate_versions (
  version, taxonomy_version, classifier_version, prompt_version, active,
  min_unique_gold_total, min_gold_per_segment,
  min_precision_per_predicted_class, min_recall_per_actual_class,
  min_accepted_coverage, critical_segments, min_critical_precision,
  required_mapping_integrity, max_provenance_violations,
  manual_activation_required, created_by, notes
)
select
  'nt_quality_gate_v6_20260821_treatment_shadow',
  q.taxonomy_version,
  'segment_classifier_v7_20260821_treatment_shadow',
  'segment_prompt_v7_20260821_treatment_shadow',
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
  'codex-treatment-shadow',
  concat(
    'Permanent simplified shadow classifier. Business domains use one exact ',
    'site query; freemail/shared providers are classified from bounded request ',
    'use only. Treatment is standard unless public, multisite or enterprise ',
    'status is positively source-bound. Customer actions remain disabled.'
  )
from public.segment_quality_gate_versions q
where q.version = 'nt_quality_gate_v2_20260819_cx8';

insert into public.segment_policy_versions (
  version, active, mode, created_by, notes,
  taxonomy_version, classifier_version, prompt_version, quality_gate_version
) values (
  'nt_policy_v6_20260821_treatment_shadow',
  false,
  'shadow',
  'codex-treatment-shadow',
  concat(
    'Always-on classification shadow only. Stores model proposal and ',
    'standard/special treatment metadata; never authorizes master projection, ',
    'cache, pricing, follow-up, Trello or customer communication.'
  ),
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v7_20260821_treatment_shadow',
  'segment_prompt_v7_20260821_treatment_shadow',
  'nt_quality_gate_v6_20260821_treatment_shadow'
);

insert into public.segment_policy_rules (
  policy_version, segment, s_kategorie, min_confidence, price_factor,
  max_followups, first_call_after_minutes, call_sequence,
  email_sequence, sales_priority, needs_human_review,
  automation_enabled, taxonomy_version
)
select
  'nt_policy_v6_20260821_treatment_shadow',
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

create function public.neontrip_get_request_segmentation_treatment_shadow_payload(
  p_job_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with job as (
    select j.*
    from public.request_segmentation_jobs j
    where j.id = p_job_id
  ),
  exact_active_contract as (
    select p.*
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
      and (select count(*) from public.segment_policy_rules
           where policy_version = p.version) = 8
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
  exact_job as (
    select j.*
    from job j
    join exact_active_contract p
      on j.taxonomy_version = p.taxonomy_version
     and j.classifier_version = p.classifier_version
     and j.prompt_version = p.prompt_version
    where j.status = 'processing'
      and j.lock_owner = 'n8n-request-segmenter-v7-treatment-shadow'
      and j.attempts > 0
      and j.attempts <= j.max_attempts
      and nullif(btrim(j.source), '') is not null
      and length(j.source) <= 120
      and lower(coalesce(j.metadata->>'evaluation_only', 'true')) = 'false'
      and lower(coalesce(j.metadata->>'master_projection_authorized', 'false')) = 'true'
      and j.metadata->>'policy_version' = p.version
      and j.metadata->>'quality_gate_version' = p.quality_gate_version
      and public.neontrip_lock_request_segmentation_input_hash(j.request_id) = j.input_hash
  ),
  req as (
    select r.*
    from public.master_requests r
    join exact_job j on j.request_id = r.id
  ),
  customer as (
    select c.*
    from public.master_customers c
    join req r on r.customer_id = c.id
  ),
  sensitive as (
    select array_remove(array[
      c.id::text,
      c.email,
      c.phone,
      c.first_name,
      c.last_name,
      c.name,
      c.street,
      c.city,
      c.postal_code,
      c.vat_id,
      c.billing_email,
      c.original_email,
      c.original_phone,
      c.ac_contact_id::text,
      c.shopify_customer_id,
      c.pandadoc_contact_id,
      c.outlook_contact_id,
      c.request_id,
      r.id::text,
      r.customer_id::text,
      r.request_id,
      r.ac_deal_id::text,
      r.trello_card_id,
      r.form_id
    ], null) || coalesce(c.cc_emails, '{}'::text[]) as sensitive_values
    from customer c
    join req r on true
  ),
  domain_context as (
    select public.neontrip_request_segmentation_domain_facts(
      nullif(split_part(lower(btrim(coalesce(c.email, ''))), '@', 2), '')
    ) as facts
    from customer c
  ),
  minimized_input as (
    select jsonb_build_object(
      'title', public.neontrip_treatment_redact_segmentation_text(r.title, 240, s.sensitive_values),
      'description', public.neontrip_treatment_redact_segmentation_text(r.description, 1600, s.sensitive_values),
      'declared_customer_type', 'unknown',
      'declared_customer_type_first_party_verified', false,
      'application', public.neontrip_treatment_redact_segmentation_text(r.application, 160, s.sensitive_values),
      'country', public.neontrip_treatment_redact_segmentation_text(coalesce(r.country, c.country), 80, s.sensitive_values),
      'company', null,
      'company_lookup_allowed', false,
      'email_domain', d.facts->>'email_domain',
      'domain_facts', jsonb_build_object(
        'is_valid_dns_host', coalesce((d.facts->>'is_valid_dns_host')::boolean, false),
        'is_freemail', coalesce((d.facts->>'is_freemail')::boolean, false),
        'is_shared_provider', coalesce((d.facts->>'is_shared_provider')::boolean, false),
        'email_domain_cache_allowed', coalesce((d.facts->>'email_domain_cache_allowed')::boolean, false),
        'domain_lookup_allowed',
          coalesce((d.facts->>'is_valid_dns_host')::boolean, false)
          and coalesce((d.facts->>'email_domain_cache_allowed')::boolean, false)
          and not coalesce((d.facts->>'is_freemail')::boolean, false)
          and not coalesce((d.facts->>'is_shared_provider')::boolean, false)
      )
    ) as value
    from req r
    join customer c on true
    join sensitive s on true
    join domain_context d on true
  ),
  definitions as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'segment', d.segment,
        'label', d.label,
        'default_s_kategorie', d.default_s_kategorie,
        'description', d.description,
        'inclusion_criteria', d.inclusion_criteria,
        'required_evidence', d.required_evidence,
        'required_evidence_code', d.required_evidence_code,
        'exclusion_criteria', d.exclusion_criteria,
        'tie_breaker', d.tie_breaker,
        'priority', d.priority,
        'review_threshold', d.review_threshold
      ) order by d.priority desc, d.segment
    ), '[]'::jsonb) as items
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and d.active
  ),
  contexts as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'context_tag', c.context_tag,
        'label', c.label,
        'description', c.description
      ) order by c.context_tag
    ), '[]'::jsonb) as items
    from public.segment_context_definitions c
    where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and c.active
  )
  select case
    when not exists (select 1 from job) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_shadow_job_not_found'))
    when not exists (select 1 from exact_active_contract) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_shadow_active_contract_mismatch'))
    when not exists (select 1 from exact_job) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_shadow_job_contract_mismatch'))
    when not exists (select 1 from req) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_shadow_request_not_found'))
    when not exists (select 1 from customer) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_shadow_customer_not_found'))
    else jsonb_build_object(
      'contract', jsonb_build_object(
        'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
        'classifier_version', 'segment_classifier_v7_20260821_treatment_shadow',
        'prompt_version', 'segment_prompt_v7_20260821_treatment_shadow',
        'policy_version', 'nt_policy_v6_20260821_treatment_shadow',
        'quality_gate_version', 'nt_quality_gate_v6_20260821_treatment_shadow',
        'research_contract', 'segment_research_v2_20260820_domain_filter',
        'treatment_contract', 'treatment_focus_v2_20260821_always_on',
        'source', (select source from exact_job),
        'evaluation_only', false,
        'master_projection_authorized', true,
        'validator_version', 'n8n_cx8_validator_v4',
        'research_model', 'gpt-4o-mini-2024-07-18',
        'classifier_model', 'gpt-5.5-2026-04-23',
        'classifier_reasoning_effort', 'medium'
      ),
      'input', (select value from minimized_input),
      'taxonomy', jsonb_build_object(
        'version', tv.version,
        'lifecycle_status', tv.lifecycle_status,
        'decision_unit', tv.decision_unit,
        'default_outcome', tv.default_outcome,
        'definitions', (select items from definitions),
        'tie_break_order', (
          select coalesce(jsonb_agg(d.segment order by d.priority desc, d.segment), '[]'::jsonb)
          from public.segment_taxonomy_definitions d
          where d.taxonomy_version = tv.version and d.active
        )
      ),
      'context_definitions', (select items from contexts),
      'organization_scale_values', '["solo","micro","small","medium","large","enterprise"]'::jsonb
    )
  end
  from public.segment_taxonomy_versions tv
  where tv.version = 'nt_taxonomy_v2_20260819_cx8';
$function$;

comment on function public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid) is
  'Service-role-only permanent shadow payload. Returns no IDs, contact identity, Gold, cache, history or commercial fields; only redacted request use plus deterministic email-domain facts.';

revoke all on function public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)
  to service_role;

do $treatment_shadow_patch_record$
declare
  v_definition text;
  v_replaced text;
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
begin
  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;

  if md5(v_definition) <> '0ab12d2ba650117b1151eb4729949547'
     or (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_record_patch_precondition_failed';
  end if;

  v_replaced := replace(v_definition, v_old, v_new);
  execute v_replaced;

  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;
  if md5(v_definition) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_record_patch_postcondition_failed',
      detail = format('actual_md5=%s', md5(v_definition));
  end if;
end;
$treatment_shadow_patch_record$;

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

do $treatment_shadow_base_postcondition$
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
         and p.mode = 'shadow'
         and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
         and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow' and not q.active
     )
     or (select count(*) from public.segment_policy_rules
         where policy_version = 'nt_policy_v6_20260821_treatment_shadow') <> 8
     or exists (
       select 1 from public.segment_policy_rules
       where policy_version = 'nt_policy_v6_20260821_treatment_shadow'
         and (
           automation_enabled or needs_human_review or price_factor is not null
           or max_followups <> 0 or first_call_after_minutes is not null
           or call_sequence <> '[]'::jsonb or email_sequence <> '[]'::jsonb
         )
     )
     or to_regprocedure('public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)') is null
     or md5(pg_get_functiondef(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
     )) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using
      errcode = '55000',
      message = 'treatment_shadow_base_postcondition_failed';
  end if;

  if has_function_privilege('anon', 'public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.neontrip_get_request_segmentation_treatment_shadow_payload(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)', 'EXECUTE') then
    raise exception using
      errcode = '42501',
      message = 'treatment_shadow_function_acl_postcondition_failed';
  end if;
end;
$treatment_shadow_base_postcondition$;

notify pgrst, 'reload schema';

commit;
