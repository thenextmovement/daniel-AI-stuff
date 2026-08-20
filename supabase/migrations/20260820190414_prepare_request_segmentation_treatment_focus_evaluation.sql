-- Prepare the additive NEONTRIP Treatment-focus Phase-7 privacy-safe research pilot.
--
-- This migration is intentionally DB-first and non-operational:
--   * Phase-2 policy/gate remain the sole active contract.
--   * Treatment-focus Phase-7 policy/gate and all eight rules are inserted inactive/inert.
--   * No request, Gold row, job, classification, cache row, or master value is
--     inserted or changed here.
--   * The only new worker surface is an exact service-role-only evaluation
--     lane for four separately held immutable-Gold jobs.
--   * The existing 18- and 19-argument Record RPCs and the cache writer are untouched.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Freeze the complete configuration and candidate-runtime cut in the same
-- order used by the held rollout. SHARE ROW EXCLUSIVE blocks concurrent
-- configuration writes; SHARE blocks candidate job/classification/cache and
-- approval inserts while leaving ordinary reads available.
lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share mode;
lock table public.request_segment_classifications in share mode;
lock table public.segment_research_cache in share mode;
lock table public.request_segmentation_activation_approvals in share mode;

do $treatment_base_precondition$
declare
  v_active_policy_count integer;
  v_active_gate_count integer;
  v_phase2_policy_count integer;
  v_phase2_gate_count integer;
  v_phase2_inert_rule_count integer;
  v_candidate_object_count integer;
  v_candidate_job_count integer;
  v_candidate_classification_count integer;
  v_candidate_cache_count integer;
  v_candidate_approval_count integer;
begin
  select count(*) into v_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_active_gate_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_phase2_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v2_20260819_cx8_shadow'
    and p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8';

  select count(*) into v_phase2_gate_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
    and q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_phase2_inert_rule_count
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
    (select count(*) from public.segment_quality_gate_versions
      where version = 'nt_quality_gate_v5_20260820_treatment_focus')
    + (select count(*) from public.segment_policy_versions
      where version = 'nt_policy_v5_20260820_treatment_focus_shadow')
  into v_candidate_object_count;

  select count(*) into v_candidate_job_count
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_classification_count
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_cache_count
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_approval_count
  from public.request_segmentation_activation_approvals a
  where a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
     or a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus';

  if v_active_policy_count <> 1
     or v_active_gate_count <> 1
     or v_phase2_policy_count <> 1
     or v_phase2_gate_count <> 1
     or v_phase2_inert_rule_count <> 8 then
    raise exception using
      errcode = '55000',
      message = 'treatment_base_requires_exact_active_phase2_shadow_contract',
      detail = format(
        'active_policies=%s active_gates=%s phase2_policy=%s phase2_gate=%s inert_rules=%s',
        v_active_policy_count, v_active_gate_count, v_phase2_policy_count,
        v_phase2_gate_count, v_phase2_inert_rule_count
      );
  end if;

  if v_candidate_object_count <> 0 then
    raise exception 'treatment_candidate_contract_already_exists';
  end if;

  if v_candidate_job_count <> 0
     or v_candidate_classification_count <> 0
     or v_candidate_cache_count <> 0
     or v_candidate_approval_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'treatment_base_requires_pristine_candidate_runtime',
      detail = format(
        'jobs=%s classifications=%s cache=%s approvals=%s',
        v_candidate_job_count, v_candidate_classification_count,
        v_candidate_cache_count, v_candidate_approval_count
      );
  end if;
end;
$treatment_base_precondition$;

insert into public.segment_quality_gate_versions (
  version, taxonomy_version, classifier_version, prompt_version, active,
  min_unique_gold_total, min_gold_per_segment,
  min_precision_per_predicted_class, min_recall_per_actual_class,
  min_accepted_coverage, critical_segments, min_critical_precision,
  required_mapping_integrity, max_provenance_violations,
  manual_activation_required, created_by, notes
)
select
  'nt_quality_gate_v5_20260820_treatment_focus',
  q.taxonomy_version,
  'segment_classifier_v6_20260820_treatment_focus',
  'segment_prompt_v6_20260820_treatment_focus',
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
  'codex-treatment-focus',
  concat(
    'Evaluation-only privacy-safe two-stage candidate. Research contract ',
    'segment_research_v2_20260820_domain_filter; research model ',
    'gpt-4o-mini-2024-07-18; classifier model gpt-5.5-2026-04-23 ',
    'with medium reasoning; validator n8n_cx8_validator_v3. Thresholds ',
    'remain unchanged and the four-Gold pilot is diagnostic only.'
  )
from public.segment_quality_gate_versions q
where q.version = 'nt_quality_gate_v2_20260819_cx8';

insert into public.segment_policy_versions (
  version, active, mode, created_by, notes,
  taxonomy_version, classifier_version, prompt_version, quality_gate_version
) values (
  'nt_policy_v5_20260820_treatment_focus_shadow',
  false,
  'shadow',
  'codex-treatment-focus',
  concat(
    'Evaluation-only Treatment-focus Phase-7 candidate. It is not a normal ingress policy; ',
    'master projection, cache writes, pricing, follow-ups and all customer ',
    'actions remain prohibited.'
  ),
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v6_20260820_treatment_focus',
  'segment_prompt_v6_20260820_treatment_focus',
  'nt_quality_gate_v5_20260820_treatment_focus'
);

insert into public.segment_policy_rules (
  policy_version, segment, s_kategorie, min_confidence, price_factor,
  max_followups, first_call_after_minutes, call_sequence,
  email_sequence, sales_priority, needs_human_review,
  automation_enabled, taxonomy_version
)
select
  'nt_policy_v5_20260820_treatment_focus_shadow',
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

create function public.neontrip_treatment_evaluation_contract_is_exact()
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select
    (select count(*) from public.segment_policy_versions where active) = 1
    and (select count(*) from public.segment_quality_gate_versions where active) = 1
    and (
      select count(*) = 1
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
        and q.min_unique_gold_total = 300
        and q.min_gold_per_segment = 25
        and q.min_precision_per_predicted_class = 0.90
        and q.min_recall_per_actual_class = 0.85
        and q.min_accepted_coverage = 0.80
        and q.critical_segments = array['NT-8', 'NT-10']::text[]
        and q.min_critical_precision = 0.95
        and q.required_mapping_integrity = 1.0
        and q.max_provenance_violations = 0
        and q.manual_activation_required
    )
    and (
      select count(*) = 1
      from public.segment_policy_versions p
      join public.segment_quality_gate_versions q
        on q.version = p.quality_gate_version
       and q.taxonomy_version = p.taxonomy_version
       and q.classifier_version = p.classifier_version
       and q.prompt_version = p.prompt_version
      where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
        and not p.active
        and p.mode = 'shadow'
        and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and p.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
        and p.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
        and q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
        and not q.active
        and q.min_unique_gold_total = 300
        and q.min_gold_per_segment = 25
        and q.min_precision_per_predicted_class = 0.90
        and q.min_recall_per_actual_class = 0.85
        and q.min_accepted_coverage = 0.80
        and q.critical_segments = array['NT-8', 'NT-10']::text[]
        and q.min_critical_precision = 0.95
        and q.required_mapping_integrity = 1.0
        and q.max_provenance_violations = 0
        and q.manual_activation_required
    )
    and (
      select count(*) = 8
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
        and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    )
    and not exists (
      select 1
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
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
    )
    and (
      select jsonb_object_agg(
        r.segment,
        jsonb_build_array(r.s_kategorie, r.min_confidence, r.sales_priority)
        order by r.segment
      ) = '{
        "NT-1": ["S2", 0.82, 50],
        "NT-10": ["S4", 0.85, 50],
        "NT-3": ["S1", 0.80, 50],
        "NT-4": ["S2", 0.82, 50],
        "NT-5": ["S2", 0.85, 50],
        "NT-6": ["S2", 0.85, 50],
        "NT-8": ["S3", 0.85, 50],
        "NT-9": ["S3", 0.82, 50]
      }'::jsonb
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
        and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    )
    and (
      select count(*) = 8
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
        and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    )
    and not exists (
      select 1
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
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
    )
    and (
      select jsonb_object_agg(
        r.segment,
        jsonb_build_array(r.s_kategorie, r.min_confidence, r.sales_priority)
        order by r.segment
      ) = '{
        "NT-1": ["S2", 0.82, 50],
        "NT-10": ["S4", 0.85, 50],
        "NT-3": ["S1", 0.80, 50],
        "NT-4": ["S2", 0.82, 50],
        "NT-5": ["S2", 0.85, 50],
        "NT-6": ["S2", 0.85, 50],
        "NT-8": ["S3", 0.85, 50],
        "NT-9": ["S3", 0.82, 50]
      }'::jsonb
      from public.segment_policy_rules r
      where r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
        and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    )
    and (
      select count(*) = 8
      from public.segment_taxonomy_definitions d
      where d.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and d.active
    )
    and (
      select jsonb_object_agg(
        d.segment,
        jsonb_build_array(
          d.default_s_kategorie,
          d.review_threshold,
          d.priority,
          d.required_evidence_code
        )
        order by d.segment
      ) = '{
        "NT-1": ["S2", 0.82, 90, "verified_physical_project_supplier"],
        "NT-10": ["S4", 0.85, 100, "verified_public_or_institutional_entity"],
        "NT-3": ["S1", 0.80, 70, "verified_event_or_media_operator"],
        "NT-4": ["S2", 0.82, 80, "verified_client_project_intermediary"],
        "NT-5": ["S2", 0.85, 60, "verified_multisite_or_franchise"],
        "NT-6": ["S2", 0.85, 50, "verified_enterprise"],
        "NT-8": ["S3", 0.85, 40, "explicit_private_use"],
        "NT-9": ["S3", 0.82, 30, "verified_direct_business"]
      }'::jsonb
      from public.segment_taxonomy_definitions d
      where d.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and d.active
    );
$function$;

comment on function public.neontrip_treatment_evaluation_contract_is_exact() is
  'Single fail-closed runtime guard shared by Treatment-focus Phase-7 Claim, Payload and Record: exact sole active Phase-2 contract plus exact inactive Treatment-focus Phase-7 contract and eight fully inert candidate rules.';

revoke all on function public.neontrip_treatment_evaluation_contract_is_exact()
  from public, anon, authenticated, service_role;

create function public.neontrip_treatment_redact_segmentation_text(
  p_value text,
  p_max_length integer,
  p_sensitive_values text[] default '{}'
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_output text := coalesce(p_value, '');
  v_sensitive text;
  v_position integer;
  v_limit integer := greatest(1, least(coalesce(p_max_length, 1), 2000));
begin
  foreach v_sensitive in array coalesce(p_sensitive_values, '{}'::text[])
  loop
    v_sensitive := btrim(coalesce(v_sensitive, ''));
    if length(v_sensitive) >= 2 and v_sensitive <> '[#]' then
      loop
        v_position := strpos(lower(v_output), lower(v_sensitive));
        exit when v_position = 0;
        v_output := overlay(v_output placing '[#]' from v_position for length(v_sensitive));
      end loop;
    end if;
  end loop;

  v_output := regexp_replace(
    v_output,
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
    '[EMAIL]',
    'gi'
  );
  v_output := regexp_replace(v_output, '(https?://|www\.)[^[:space:]]+', '[URL]', 'gi');
  v_output := regexp_replace(
    v_output,
    '\m[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\M',
    '[UUID]',
    'gi'
  );
  v_output := regexp_replace(
    v_output,
    '(\+|00)?[0-9][0-9() ./-]{6,}[0-9]',
    '[PHONE]',
    'g'
  );
  v_output := regexp_replace(v_output, '\m[[:alnum:]_-]{24,}\M', '[OPAQUE-ID]', 'g');
  v_output := btrim(regexp_replace(v_output, '[[:space:]]+', ' ', 'g'));

  return nullif(left(v_output, v_limit), '');
end;
$function$;

comment on function public.neontrip_treatment_redact_segmentation_text(text, integer, text[]) is
  'Internal Treatment-focus Phase-7 minimizer: removes known contact values and generic email, URL, phone, UUID and opaque-ID patterns before a hard text bound. It is not a general anonymizer and is exposed only through the exact evaluation payload RPC.';

revoke all on function public.neontrip_treatment_redact_segmentation_text(text, integer, text[])
  from public, anon, authenticated, service_role;

-- Internal single source of truth for every value that may authorize a public
-- research lookup. It returns only a screened company, deterministic domain
-- facts and the exact allowed query; it never returns names, contact details or
-- IDs. Payload and Record both call this helper so query authorization cannot
-- drift between the two RPCs.
create function public.neontrip_treatment_evaluation_research_context(p_job_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path to 'public'
as $function$
  with exact_job as (
    select j.*
    from public.request_segmentation_jobs j
    where j.id = p_job_id
      and j.source = 'gold_re_evaluation_phase7_treatment'
      and j.status = 'processing'
      and j.lock_owner = 'n8n-request-segmenter-v6'
      and j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and j.attempts > 0
      and j.attempts <= j.max_attempts
      and lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
      and lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) = 'false'
      and j.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and j.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
      and j.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and j.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
      and j.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
      and j.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and j.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and j.metadata->>'classifier_reasoning_effort' = 'medium'
      and public.neontrip_treatment_evaluation_contract_is_exact()
      and public.neontrip_lock_request_segmentation_input_hash(j.request_id) = j.input_hash
      and exists (
        select 1
        from public.request_segmentation_gold_adjudications g
        where g.request_id = j.request_id
          and g.input_hash = j.input_hash
          and g.taxonomy_version = j.taxonomy_version
          and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      )
  ), raw_lookup as (
    select
      nullif(
        btrim(regexp_replace(
          regexp_replace(
            normalize(coalesce(c.company_name, c.company, ''), NFKC),
            '[[:cntrl:]]+', ' ', 'g'
          ),
          '[[:space:]]+', ' ', 'g'
        )),
        ''
      ) as raw_company,
      nullif(split_part(lower(btrim(coalesce(c.email, ''))), '@', 2), '') as raw_email_domain,
      lower(btrim(coalesce(c.first_name, ''))) as first_name,
      lower(btrim(coalesce(c.last_name, ''))) as last_name,
      lower(btrim(coalesce(c.name, ''))) as contact_name
    from exact_job j
    join public.master_requests r on r.id = j.request_id
    join public.master_customers c on c.id = r.customer_id
  ), company_screen as (
    select
      rl.*,
      case
        when rl.raw_company is null then null
        when length(rl.raw_company) not between 2 and 120 then null
        when rl.raw_company ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then null
        when rl.raw_company ~* '(https?://|www\.)' then null
        when rl.raw_company ~* '(\+|00)?[0-9][0-9() ./-]{6,}[0-9]' then null
        when rl.raw_company ~* '\m[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\M' then null
        when rl.raw_company ~* '([?&[:space:]])?(utm_[a-z_]+|gclid|fbclid|gbraid|wbraid)([[:space:]]*=|\M)' then null
        when rl.raw_company ~ '\m[0-9]{5,}\M' then null
        when rl.raw_company !~ '^[[:alnum:]ÄÖÜäöüß .,&''()+/_-]+$' then null
        when cardinality(regexp_split_to_array(rl.raw_company, '[[:space:]]+')) not between 2 and 10 then null
        when exists (
          select 1
          from unnest(regexp_split_to_array(rl.raw_company, '[[:space:]]+')) company_token(token)
          where length(company_token.token) > 40
        ) then null
        when exists (
          select 1
          from unnest(regexp_split_to_array(rl.raw_company, '[[:space:]]+')) company_token(token)
          where length(company_token.token) >= 24
            and company_token.token ~ '^[[:alnum:]_-]+$'
            and company_token.token ~ '[0-9_-]'
        ) then null
        when rl.raw_company ~ '^[[:upper:]ÄÖÜ][[:lower:]äöüß''-]{1,30} [[:upper:]ÄÖÜ][[:lower:]äöüß''-]{1,30}$'
          and rl.raw_company !~* '\m(gmbh|ag|ug|ohg|kg|gbr|inc|ltd|llc|group|holding|studio|agentur|agency|media|production|productions|event|events|hotel|restaurant|praxis|klinik|shop|store|design|solutions|systems|technik|bau|service|services)\M'
          then null
        when exists (
          select 1
          from unnest(regexp_split_to_array(lower(rl.raw_company), '[^[:alnum:]äöüß]+')) company_word(word)
          where length(company_word.word) >= 3
            and company_word.word in (rl.first_name, rl.last_name, rl.contact_name)
        ) then null
        else rl.raw_company
      end as safe_company
    from raw_lookup rl
  ), screened as (
    select
      cs.*,
      (
        cs.safe_company is not null
        and cs.safe_company ~* '\m(gmbh|ag|ug|ohg|kg|gbr|e\.?[[:space:]]?v\.?|inc|ltd|llc|group|holding|studio|agentur|agency|media|production|productions|event|events|hotel|restaurant|praxis|klinik|shop|store|design|solutions|systems|technik|bau|service|services)\M'
        and length(concat(
          cs.safe_company,
          ' offizielle Website Unternehmen Leistungen Kundenprojekte Standorte'
        )) between 1 and 240
      ) as company_lookup_allowed,
      public.neontrip_request_segmentation_domain_facts(cs.raw_email_domain) as domain_facts
    from company_screen cs
  ), plan as (
    select
      s.*,
      coalesce((s.domain_facts->>'is_valid_dns_host')::boolean, false)
        and coalesce((s.domain_facts->>'email_domain_cache_allowed')::boolean, false)
        and not coalesce((s.domain_facts->>'is_freemail')::boolean, false)
        and not coalesce((s.domain_facts->>'is_shared_provider')::boolean, false)
        and length(concat(
          'site:', s.domain_facts->>'email_domain',
          ' Unternehmen Leistungen Kundenprojekte Standorte Impressum'
        )) between 1 and 240
        as domain_lookup_allowed
    from screened s
  ), exact_plan as (
    select
      p.*,
      p.domain_lookup_allowed as external_research_required,
      case
        when p.domain_lookup_allowed then concat(
          'site:', p.domain_facts->>'email_domain',
          ' Unternehmen Leistungen Kundenprojekte Standorte Impressum'
        )
        else null
      end as expected_research_query
    from plan p
  )
  select coalesce(
    (
      select jsonb_build_object(
        'context_valid', true,
        -- A screened company value may inform the classifier, but it never
        -- authorizes a name-based search. The only web lookup is the exact
        -- non-freemail business domain.
        'company', ep.safe_company,
        'company_lookup_allowed', false,
        'email_domain', ep.domain_facts->>'email_domain',
        'domain_facts', jsonb_build_object(
          'is_valid_dns_host', coalesce((ep.domain_facts->>'is_valid_dns_host')::boolean, false),
          'is_freemail', coalesce((ep.domain_facts->>'is_freemail')::boolean, false),
          'is_shared_provider', coalesce((ep.domain_facts->>'is_shared_provider')::boolean, false),
          'email_domain_cache_allowed', coalesce((ep.domain_facts->>'email_domain_cache_allowed')::boolean, false),
          'domain_lookup_allowed', ep.domain_lookup_allowed
        ),
        'external_research_required', ep.external_research_required,
        'research_blocked', ep.external_research_required and ep.expected_research_query is null,
        'expected_research_query', ep.expected_research_query
      )
      from exact_plan ep
    ),
    jsonb_build_object('context_valid', false)
  );
$function$;

comment on function public.neontrip_treatment_evaluation_research_context(uuid) is
  'Internal, ID-free treatment lookup planner shared by Payload and Record. Only an exact non-freemail business domain can authorize research; company names are never used as search queries. The deterministic query is never caller supplied.';

revoke all on function public.neontrip_treatment_evaluation_research_context(uuid)
  from public, anon, authenticated, service_role;

create function public.neontrip_claim_request_segmentation_treatment_evaluation(
  p_limit integer default 1,
  p_lock_owner text default 'n8n-request-segmenter-v6',
  p_stale_minutes integer default 15
)
returns setof public.request_segmentation_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_owner constant text := 'n8n-request-segmenter-v6';
begin
  if p_limit is distinct from 1 then
    raise exception 'treatment_evaluation_claim_limit_must_equal_1';
  end if;

  if coalesce(nullif(btrim(p_lock_owner), ''), v_lock_owner) <> v_lock_owner then
    raise exception 'treatment_evaluation_claim_lock_owner_mismatch';
  end if;

  if coalesce(p_stale_minutes, 0) < 1 or p_stale_minutes > 60 then
    raise exception 'treatment_evaluation_claim_stale_minutes_must_be_between_1_and_60';
  end if;

  if not public.neontrip_treatment_evaluation_contract_is_exact() then
    raise exception 'treatment_evaluation_runtime_contract_drift';
  end if;

  return query
  with picked as (
    select j.id
    from public.request_segmentation_jobs j
    where j.source = 'gold_re_evaluation_phase7_treatment'
      and j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
      and lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) = 'false'
      and j.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and j.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
      and j.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and j.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
      and j.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
      and j.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and j.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and j.metadata->>'classifier_reasoning_effort' = 'medium'
      and j.attempts < j.max_attempts
      and public.neontrip_compute_request_segment_input_hash(j.request_id) = j.input_hash
      and exists (
        select 1
        from public.request_segmentation_gold_adjudications g
        where g.request_id = j.request_id
          and g.input_hash = j.input_hash
          and g.taxonomy_version = j.taxonomy_version
          and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      )
      and (
        j.status = 'pending'
        or (
          j.status = 'processing'
          and j.locked_at < now() - make_interval(mins => p_stale_minutes)
        )
        or j.status = 'failed'
      )
      and j.next_attempt_at <= now()
    order by j.priority desc, j.created_at asc, j.id
    limit p_limit
    for update of j skip locked
  )
  update public.request_segmentation_jobs j
  set
    status = 'processing',
    lock_owner = v_lock_owner,
    locked_at = now(),
    attempts = attempts + 1,
    updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$function$;

comment on function public.neontrip_claim_request_segmentation_treatment_evaluation(integer, text, integer) is
  'Claims exactly one item per call from the four-job Treatment-focus Phase-7 immutable-Gold evaluation lane while the candidate remains inactive and Phase 2 remains the sole active contract. It cannot claim normal ingress.';

revoke all on function public.neontrip_claim_request_segmentation_treatment_evaluation(integer, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.neontrip_claim_request_segmentation_treatment_evaluation(integer, text, integer)
  to service_role;

create function public.neontrip_get_request_segmentation_treatment_evaluation_payload(
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
  exact_job as (
    select j.*
    from job j
    where j.source = 'gold_re_evaluation_phase7_treatment'
      and j.status = 'processing'
      and j.lock_owner = 'n8n-request-segmenter-v6'
      and j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and j.attempts > 0
      and j.attempts <= j.max_attempts
      and lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
      and lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) = 'false'
      and j.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and j.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
      and j.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and j.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
      and j.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
      and j.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and j.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and j.metadata->>'classifier_reasoning_effort' = 'medium'
      and public.neontrip_lock_request_segmentation_input_hash(j.request_id) = j.input_hash
      and exists (
        select 1
        from public.request_segmentation_gold_adjudications g
        where g.request_id = j.request_id
          and g.input_hash = j.input_hash
          and g.taxonomy_version = j.taxonomy_version
          and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      )
  ),
  candidate_contract as (
    select p.*, q.version as exact_quality_gate_version
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q
      on q.version = p.quality_gate_version
     and q.taxonomy_version = p.taxonomy_version
     and q.classifier_version = p.classifier_version
     and q.prompt_version = p.prompt_version
    where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and not p.active
      and p.mode = 'shadow'
      and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and p.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and p.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
      and not q.active
  ),
  active_phase2 as (
    select p.version
    from public.segment_policy_versions p
    join public.segment_quality_gate_versions q on q.version = p.quality_gate_version
    where p.version = 'nt_policy_v2_20260819_cx8_shadow'
      and p.active
      and q.version = 'nt_quality_gate_v2_20260819_cx8'
      and q.active
  ),
  runtime_contract as (
    select public.neontrip_treatment_evaluation_contract_is_exact() as valid
  ),
  req as (
    select mr.*
    from public.master_requests mr
    join exact_job j on j.request_id = mr.id
  ),
  customer as (
    select mc.*
    from public.master_customers mc
    join req r on r.customer_id = mc.id
  ),
  raw_lookup as (
    select
      array_remove(array[
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
  research_context as (
    select public.neontrip_treatment_evaluation_research_context(j.id) as value
    from exact_job j
  ),
  minimized_input as (
    select jsonb_build_object(
      'title', public.neontrip_treatment_redact_segmentation_text(r.title, 240, rl.sensitive_values),
      'description', public.neontrip_treatment_redact_segmentation_text(r.description, 1600, rl.sensitive_values),
      -- The four Treatment-focus Phase-7 Gold inputs have no raw first-party customer-type
      -- provenance. Three landing-page rows contain a synthetic B2B default;
      -- exposing it would anchor the model to evidence the customer never
      -- supplied. Keep both fields explicit and fail closed.
      'declared_customer_type', 'unknown',
      'declared_customer_type_first_party_verified', false,
      'application', public.neontrip_treatment_redact_segmentation_text(r.application, 160, rl.sensitive_values),
      'country', public.neontrip_treatment_redact_segmentation_text(coalesce(r.country, c.country), 80, rl.sensitive_values),
      'company', rc.value->'company',
      'company_lookup_allowed', coalesce((rc.value->>'company_lookup_allowed')::boolean, false),
      'email_domain', rc.value->'email_domain',
      'domain_facts', rc.value->'domain_facts'
    ) as value
    from req r
    join customer c on true
    join raw_lookup rl on true
    join research_context rc on coalesce((rc.value->>'context_valid')::boolean, false)
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
        'context_tag', cd.context_tag,
        'label', cd.label,
        'description', cd.description
      ) order by cd.context_tag
    ), '[]'::jsonb) as items
    from public.segment_context_definitions cd
    where cd.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and cd.active
  )
  select case
    when not exists (select 1 from job) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_evaluation_job_not_found'))
    when not exists (select 1 from exact_job) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_evaluation_job_contract_mismatch'))
    when not coalesce((select valid from runtime_contract), false)
      or not exists (select 1 from candidate_contract)
      or not exists (select 1 from active_phase2) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_evaluation_runtime_contract_drift'))
    when not exists (select 1 from req) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_request_not_found'))
    when not exists (select 1 from customer) then
      jsonb_build_object('payload_error', jsonb_build_object('code', 'treatment_customer_not_found'))
    else jsonb_build_object(
      'contract', jsonb_build_object(
        'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
        'classifier_version', 'segment_classifier_v6_20260820_treatment_focus',
        'prompt_version', 'segment_prompt_v6_20260820_treatment_focus',
        'policy_version', 'nt_policy_v5_20260820_treatment_focus_shadow',
        'quality_gate_version', 'nt_quality_gate_v5_20260820_treatment_focus',
        'research_contract', 'segment_research_v2_20260820_domain_filter',
        'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special',
        'source', 'gold_re_evaluation_phase7_treatment',
        'evaluation_only', true,
        'master_projection_authorized', false,
        'validator_version', 'n8n_cx8_validator_v3',
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
      'organization_scale_values', '[]'::jsonb || jsonb_build_array(
        'solo', 'micro', 'small', 'medium', 'large', 'enterprise'
      )
    )
  end
  from public.segment_taxonomy_versions tv
  where tv.version = 'nt_taxonomy_v2_20260819_cx8';
$function$;

comment on function public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid) is
  'Returns an ID-free, no-cache, no-history, no-Gold Treatment-focus Phase-7 model payload. The caller must retain job_id/request_id/input_hash from Normalize Claim through per-item n8n lineage; exact claim-to-payload pairing is a mandatory release proof.';

revoke all on function public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)
  to service_role;

-- A 20-argument overload keeps the existing 18-argument production and
-- 19-argument Phase-6 Record functions byte-identical. PostgREST resolves
-- this pilot-only overload by the two additional named contract arguments.
create function public.neontrip_record_request_segment_classification(
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
  p_accepted_by text,
  p_research_contract text,
  p_treatment_contract text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_candidate_policy public.segment_policy_versions%rowtype;
  v_policy_rule public.segment_policy_rules%rowtype;
  v_job public.request_segmentation_jobs%rowtype;
  v_request public.master_requests%rowtype;
  v_terminal_classification public.request_segment_classifications%rowtype;
  v_candidate_policy_found boolean := false;
  v_treatment_job_identity_valid boolean := false;
  v_hard_contract_valid boolean := false;
  v_current_input_hash text;
  v_input_hash_current boolean := false;
  v_effective_status text;
  v_effective_segment text;
  v_effective_risk_flags text[] := '{}';
  v_classifier_risk_flags text[] := '{}';
  v_classifier_json jsonb := coalesce(p_classifier_json, '{}'::jsonb);
  v_classification_id uuid;
  v_context_tags text[] := '{}';
  v_context_shape_valid boolean := false;
  v_context_tags_valid boolean := false;
  v_organization_scale text;
  v_organization_scale_valid boolean := false;
  v_scale_evidence_valid boolean := false;
  v_required_positive_code text;
  v_required_role_use text;
  v_positive_codes text[] := '{}';
  v_positive_codes_shape_valid boolean := false;
  v_provenance jsonb := '{}';
  v_provenance_shape_valid boolean := false;
  v_verified_sources jsonb := '[]'::jsonb;
  v_verified_source_count integer := 0;
  v_verified_source_shape_valid boolean := false;
  v_evidence_json_shape_valid boolean := false;
  v_evidence_semantics_shape_valid boolean := false;
  v_all_external_evidence_source_bound boolean := false;
  v_positive_evidence_bound boolean := false;
  v_nt9_higher_role_conflict boolean := false;
  v_research_performed boolean := false;
  v_research_response_id text;
  v_research_call_id text;
  v_research_query text;
  v_research_context jsonb := '{}'::jsonb;
  v_expected_research_query text;
  v_external_research_required boolean := false;
  v_research_plan_blocked boolean := false;
  v_research_binding_valid boolean := false;
  v_evidence_provenance_valid boolean := false;
  v_mapping_integrity boolean := false;
  v_private_declaration_evidence_valid boolean := false;
  v_standard_request_evidence_valid boolean := false;
  v_external_positive_evidence_bound boolean := false;
  v_special_handling_required boolean := false;
  v_expected_treatment_tier text := 'standard';
  v_treatment_metadata_valid boolean := false;
  v_job_status text;
begin
  if p_job_id is null then
    raise exception 'treatment_evaluation_record_requires_job_id';
  end if;

  if p_status not in ('accepted', 'needs_review') then
    raise exception 'invalid_status: %', p_status;
  end if;

  if p_segment is not null and p_segment not in (
    'NT-10', 'NT-1', 'NT-4', 'NT-3', 'NT-5', 'NT-6', 'NT-8', 'NT-9'
  ) then
    raise exception 'invalid_segment: %', p_segment;
  end if;

  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'invalid_confidence: %', p_confidence;
  end if;

  if nullif(btrim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'input_hash_required';
  end if;

  if pg_column_size(v_classifier_json) > 262144
     or pg_column_size(coalesce(p_evidence_json, '[]'::jsonb)) > 131072
     or pg_column_size(coalesce(p_firmographic_json, '{}'::jsonb)) > 32768
     or length(coalesce(p_reasoning_short, '')) > 4000
     or length(coalesce(p_evidence_grade, '')) > 40
     or cardinality(coalesce(p_reason_codes, '{}')) > 20
     or cardinality(coalesce(p_risk_flags, '{}')) > 20
     or exists (
       select 1 from unnest(coalesce(p_reason_codes, '{}')) as reason_codes(reason_code)
       where length(coalesce(reason_code, '')) > 120
     )
     or exists (
       select 1 from unnest(coalesce(p_risk_flags, '{}')) as risk_flags(risk_flag)
       where length(coalesce(risk_flag, '')) > 120
     )
     or (
       jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
       and jsonb_array_length(coalesce(p_evidence_json, '[]'::jsonb)) > 12
     ) then
    raise exception 'treatment_evaluation_record_input_bounds_exceeded';
  end if;

  select * into v_job
  from public.request_segmentation_jobs j
  where j.id = p_job_id;

  if not found then
    raise exception 'treatment_evaluation_job_not_found';
  end if;

  v_treatment_job_identity_valid :=
    v_job.source = 'gold_re_evaluation_phase7_treatment'
    and v_job.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and v_job.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and v_job.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and v_job.attempts > 0
    and v_job.attempts <= v_job.max_attempts
    and lower(coalesce(v_job.metadata->>'evaluation_only', 'false')) = 'true'
    and lower(coalesce(v_job.metadata->>'master_projection_authorized', 'true')) = 'false'
    and v_job.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and v_job.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
    and v_job.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
    and v_job.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
    and v_job.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
    and v_job.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
    and v_job.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
    and v_job.metadata->>'classifier_reasoning_effort' = 'medium';

  -- A dedicated evaluation RPC must never mutate a foreign/version-mismatched
  -- job. Caller-supplied request/hash mismatches are identity mismatches too.
  if not v_treatment_job_identity_valid
     or v_job.request_id is distinct from p_request_id
     or v_job.input_hash is distinct from p_input_hash then
    raise exception using
      errcode = '22023',
      message = 'treatment_evaluation_record_job_identity_mismatch';
  end if;

  select * into v_request
  from public.master_requests mr
  where mr.id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  perform 1
  from public.master_customers mc
  where mc.id = v_request.customer_id
  for share;

  -- Preserve the established request -> customer -> job lock order used by
  -- the existing Record implementation, then repeat the complete identity
  -- check under the job lock.
  select * into v_job
  from public.request_segmentation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception 'treatment_evaluation_job_not_found_after_lock';
  end if;

  v_treatment_job_identity_valid :=
    v_job.source = 'gold_re_evaluation_phase7_treatment'
    and v_job.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and v_job.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and v_job.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and v_job.attempts > 0
    and v_job.attempts <= v_job.max_attempts
    and lower(coalesce(v_job.metadata->>'evaluation_only', 'false')) = 'true'
    and lower(coalesce(v_job.metadata->>'master_projection_authorized', 'true')) = 'false'
    and v_job.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and v_job.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
    and v_job.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
    and v_job.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
    and v_job.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
    and v_job.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
    and v_job.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
    and v_job.metadata->>'classifier_reasoning_effort' = 'medium';

  if not v_treatment_job_identity_valid
     or v_job.request_id is distinct from p_request_id
     or v_job.input_hash is distinct from p_input_hash then
    raise exception using
      errcode = '22023',
      message = 'treatment_evaluation_record_job_identity_changed_before_lock';
  end if;

  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);
  v_input_hash_current := v_current_input_hash is not distinct from p_input_hash;

  if not v_input_hash_current then
    raise exception using
      errcode = '55000',
      message = 'treatment_evaluation_record_current_input_hash_mismatch';
  end if;

  -- Lost HTTP responses may replay the same Record call after the first call
  -- committed. A matching terminal job is immutable and returns its existing
  -- classification instead of being downgraded to failed.
  if v_job.status in ('completed', 'needs_review') then
    if v_job.lock_owner is not null
       or not public.neontrip_treatment_evaluation_contract_is_exact()
       or p_prompt_version <> 'segment_prompt_v6_20260820_treatment_focus'
       or p_classifier_version <> 'segment_classifier_v6_20260820_treatment_focus'
       or p_accepted_by <> 'n8n-request-segmenter-v6'
       or p_research_contract <> 'segment_research_v2_20260820_domain_filter'
       or p_treatment_contract <> 'treatment_focus_v1_20260820_standard_vs_special'
       or p_model <> 'gpt-5.5-2026-04-23'
       or p_model_version <> 'gpt-5.5-2026-04-23'
       or jsonb_typeof(v_classifier_json) <> 'object'
       or v_classifier_json->>'taxonomy_version' <> 'nt_taxonomy_v2_20260819_cx8'
       or v_classifier_json->>'classifier_version' <> 'segment_classifier_v6_20260820_treatment_focus'
       or v_classifier_json->>'prompt_version' <> 'segment_prompt_v6_20260820_treatment_focus'
       or v_classifier_json->>'research_contract' <> 'segment_research_v2_20260820_domain_filter'
       or v_classifier_json->>'treatment_contract' <> 'treatment_focus_v1_20260820_standard_vs_special'
       or v_classifier_json->>'treatment_tier' not in ('standard', 'special')
       or jsonb_typeof(v_classifier_json->'special_handling_required') <> 'boolean'
       or jsonb_typeof(v_classifier_json->'external_evidence_required') <> 'boolean'
       or jsonb_typeof(v_classifier_json->'standard_request_evidence_valid') <> 'boolean'
       or v_job.last_classification_id is null then
      raise exception 'treatment_evaluation_record_terminal_replay_mismatch';
    end if;

    select c.* into v_terminal_classification
    from public.request_segment_classifications c
    where c.id = v_job.last_classification_id
      and c.request_id = v_job.request_id
      and c.input_hash = v_job.input_hash
      and c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and c.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and c.classifier_json->>'submitted_status' = p_status
      and c.classifier_json->>'proposed_segment' is not distinct from p_segment
      and c.classifier_json->>'submitted_confidence' is not distinct from p_confidence::text
      and (
        (v_job.status = 'needs_review' and c.status = 'needs_review')
        or (v_job.status = 'completed' and c.status = 'accepted')
      )
    for share;

    if not found then
      raise exception 'treatment_evaluation_record_terminal_classification_mismatch';
    end if;

    return jsonb_build_object(
      'classification_id', v_terminal_classification.id,
      'job_id', p_job_id,
      'request_id', p_request_id,
      'submitted_status', v_terminal_classification.classifier_json->>'submitted_status',
      'proposed_segment', v_terminal_classification.classifier_json->>'proposed_segment',
      'effective_status', v_terminal_classification.status,
      'effective_segment', case when v_terminal_classification.status = 'accepted'
        then v_terminal_classification.segment else null end,
      'policy_version', 'nt_policy_v5_20260820_treatment_focus_shadow',
      'policy_mode', 'shadow',
      'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
      'classifier_version', 'segment_classifier_v6_20260820_treatment_focus',
      'prompt_version', 'segment_prompt_v6_20260820_treatment_focus',
      'research_contract', 'segment_research_v2_20260820_domain_filter',
      'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special',
      'treatment_tier', v_terminal_classification.classifier_json->>'treatment_tier',
      'special_handling_required',
        case
          when jsonb_typeof(v_terminal_classification.classifier_json->'special_handling_required') = 'boolean'
            then (v_terminal_classification.classifier_json->>'special_handling_required')::boolean
          else false
        end,
      'job_status', v_job.status,
      'input_hash_current', true,
      'contract_match', true,
      'idempotent_replay', true,
      'evaluation_only', true,
      'master_projection_authorized', false,
      'research_cache_written', false,
      'projection', jsonb_build_object(
        'applied', false,
        'reason', 'evaluation_only_terminal_replay_no_projection',
        'authoritative_segment', v_request.segment,
        'authoritative_s_kategorie', v_request.s_kategorie,
        'authoritative_status', v_request.segment_status,
        'authoritative_source', v_request.segment_source,
        'authoritative_taxonomy_version', v_request.segment_taxonomy_version
      )
    );
  end if;

  if v_job.status <> 'processing'
     or v_job.lock_owner <> 'n8n-request-segmenter-v6' then
    raise exception 'treatment_evaluation_record_job_not_processing';
  end if;

  select p.* into v_candidate_policy
  from public.segment_policy_versions p
  join public.segment_quality_gate_versions q
    on q.version = p.quality_gate_version
   and q.taxonomy_version = p.taxonomy_version
   and q.classifier_version = p.classifier_version
   and q.prompt_version = p.prompt_version
  where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and not p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and p.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
  for share of p, q;

  v_candidate_policy_found := found;

  v_provenance := coalesce(v_classifier_json->'evidence_provenance', '{}'::jsonb);
  v_research_context := public.neontrip_treatment_evaluation_research_context(p_job_id);
  v_expected_research_query := nullif(v_research_context->>'expected_research_query', '');
  v_external_research_required := coalesce(
    (v_research_context->>'external_research_required')::boolean,
    false
  );
  v_research_plan_blocked := coalesce(
    (v_research_context->>'research_blocked')::boolean,
    false
  );

  v_hard_contract_valid :=
    v_candidate_policy_found
    and v_treatment_job_identity_valid
    and public.neontrip_treatment_evaluation_contract_is_exact()
    and v_input_hash_current
    and coalesce((v_research_context->>'context_valid')::boolean, false)
    and v_job.status = 'processing'
    and v_job.lock_owner = 'n8n-request-segmenter-v6'
    and v_job.attempts > 0
    and v_job.attempts <= v_job.max_attempts
    and p_prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and p_classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and p_accepted_by = 'n8n-request-segmenter-v6'
    and p_research_contract = 'segment_research_v2_20260820_domain_filter'
    and p_treatment_contract = 'treatment_focus_v1_20260820_standard_vs_special'
    and p_model = 'gpt-5.5-2026-04-23'
    and p_model_version = 'gpt-5.5-2026-04-23'
    and jsonb_typeof(v_classifier_json) = 'object'
    and v_classifier_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and v_classifier_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and v_classifier_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus'
    and v_classifier_json->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
    and v_classifier_json->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
    and v_classifier_json->>'treatment_tier' in ('standard', 'special')
    and jsonb_typeof(v_classifier_json->'special_handling_required') = 'boolean'
    and jsonb_typeof(v_classifier_json->'external_evidence_required') = 'boolean'
    and jsonb_typeof(v_classifier_json->'standard_request_evidence_valid') = 'boolean'
    and v_classifier_json->>'validator_version' = 'n8n_cx8_validator_v3'
    and v_classifier_json->>'research_model' = 'gpt-4o-mini-2024-07-18'
    and v_classifier_json->>'classifier_model' = 'gpt-5.5-2026-04-23'
    and v_classifier_json->>'classifier_reasoning_effort' = 'medium'
    and jsonb_typeof(v_provenance) = 'object'
    and v_provenance->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
    and v_provenance->>'validator_version' = 'n8n_cx8_validator_v3'
    and v_provenance->>'research_model' = 'gpt-4o-mini-2024-07-18'
    and v_provenance->>'classifier_model' = 'gpt-5.5-2026-04-23'
    and v_provenance->>'classifier_reasoning_effort' = 'medium'
    and exists (
      select 1
      from public.request_segmentation_gold_adjudications g
      where g.request_id = v_job.request_id
        and g.input_hash = v_job.input_hash
        and g.taxonomy_version = v_job.taxonomy_version
        and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
    );

  if not v_hard_contract_valid then
    update public.request_segmentation_jobs
    set
      status = 'failed',
      completed_at = null,
      last_error_code = 'treatment_evaluation_record_contract_mismatch',
      last_error_message = 'Treatment-focus Phase-7 evaluation Record rejected a lane, worker, model, research, validator, Gold, or runtime-contract mismatch.',
      updated_at = now(),
      lock_owner = null,
      locked_at = null
    where id = p_job_id
      and request_id = p_request_id
      and input_hash = p_input_hash
      and source = 'gold_re_evaluation_phase7_treatment'
      and status = 'processing'
      and lock_owner = 'n8n-request-segmenter-v6'
      and taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
      and prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
      and attempts > 0
      and attempts <= max_attempts
      and lower(coalesce(metadata->>'evaluation_only', 'false')) = 'true'
      and lower(coalesce(metadata->>'master_projection_authorized', 'true')) = 'false'
      and metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
      and metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
      and metadata->>'validator_version' = 'n8n_cx8_validator_v3'
      and metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and metadata->>'classifier_reasoning_effort' = 'medium'
      and public.neontrip_compute_request_segment_input_hash(request_id) = input_hash
      and exists (
        select 1
        from public.request_segmentation_gold_adjudications g
        where g.request_id = request_segmentation_jobs.request_id
          and g.input_hash = request_segmentation_jobs.input_hash
          and g.taxonomy_version = request_segmentation_jobs.taxonomy_version
          and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
      );

    return jsonb_build_object(
      'classification_id', null,
      'job_id', p_job_id,
      'request_id', p_request_id,
      'effective_status', 'error',
      'effective_segment', null,
      'job_status', 'failed',
      'contract_match', false,
      'error_code', 'treatment_evaluation_record_contract_mismatch',
      'evaluation_only', true,
      'master_projection_authorized', false,
      'research_cache_written', false,
      'projection', jsonb_build_object(
        'applied', false,
        'reason', 'evaluation_contract_mismatch_no_classification'
      )
    );
  end if;

  if p_segment is not null then
    select r.* into v_policy_rule
    from public.segment_policy_rules r
    join public.segment_taxonomy_definitions d
      on d.taxonomy_version = r.taxonomy_version
     and d.segment = r.segment
     and d.active
    where r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
      and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and r.segment = p_segment
    limit 1;

    if found then
      select d.required_evidence_code
      into v_required_positive_code
      from public.segment_taxonomy_definitions d
      where d.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
        and d.segment = p_segment
        and d.active;
    end if;
  end if;

  v_required_role_use := case
    when p_segment = 'NT-10' then 'institution_status'
    when p_segment in ('NT-1', 'NT-3', 'NT-4', 'NT-5', 'NT-6', 'NT-9') then 'segment_role'
    when p_segment = 'NT-8' then 'private_use'
    else null
  end;

  v_context_shape_valid :=
    jsonb_typeof(v_classifier_json->'context_tags') = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(v_classifier_json->'context_tags') = 'array'
          then v_classifier_json->'context_tags' else '[]'::jsonb end
      ) item(value)
      where jsonb_typeof(item.value) <> 'string'
         or nullif(btrim(item.value #>> '{}'), '') is null
    );

  if v_context_shape_valid then
    select coalesce(array_agg(distinct btrim(item.value #>> '{}') order by btrim(item.value #>> '{}')), '{}')
    into v_context_tags
    from jsonb_array_elements(v_classifier_json->'context_tags') item(value);
  end if;

  v_context_tags_valid := v_context_shape_valid
    and cardinality(v_context_tags) <= 10
    and not exists (
      select 1
      from unnest(v_context_tags) tag(value)
      where not exists (
        select 1
        from public.segment_context_definitions cd
        where cd.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
          and cd.context_tag = tag.value
          and cd.active
      )
    );

  v_organization_scale := case
    when jsonb_typeof(v_classifier_json->'organization_scale') = 'string'
      then btrim(v_classifier_json->>'organization_scale')
    else null
  end;
  v_organization_scale_valid := case
    when not (v_classifier_json ? 'organization_scale') then false
    when jsonb_typeof(v_classifier_json->'organization_scale') = 'null' then true
    when jsonb_typeof(v_classifier_json->'organization_scale') = 'string'
      then v_organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise')
    else false
  end;

  select coalesce(array_agg(distinct lower(btrim(item.value #>> '{}')) order by lower(btrim(item.value #>> '{}'))), '{}')
  into v_classifier_risk_flags
  from jsonb_array_elements(
    case when jsonb_typeof(v_classifier_json->'risk_flags') = 'array'
      then v_classifier_json->'risk_flags' else '[]'::jsonb end
  ) item(value)
  where jsonb_typeof(item.value) = 'string'
    and nullif(btrim(item.value #>> '{}'), '') is not null;

  select coalesce(array_agg(distinct lower(btrim(flag)) order by lower(btrim(flag))), '{}')
  into v_effective_risk_flags
  from unnest(coalesce(p_risk_flags, '{}') || v_classifier_risk_flags) as flags(flag)
  where nullif(btrim(flag), '') is not null;

  v_provenance_shape_valid := case
    when jsonb_typeof(v_provenance) = 'object' then (
      select count(*) = 15
        and coalesce(bool_and(provenance_key in (
          'valid',
          'research_contract',
          'validator_version',
          'research_model',
          'classifier_model',
          'classifier_reasoning_effort',
          'research_performed',
          'research_response_id',
          'research_call_id',
          'research_call_count',
          'research_call_status',
          'research_query',
          'classifier_tool_call_count',
          'validated_positive_evidence_codes',
          'verified_sources'
        )), false)
      from jsonb_object_keys(v_provenance) as provenance_keys(provenance_key)
    )
    else false
  end;

  v_positive_codes_shape_valid :=
    jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
    and jsonb_array_length(
      case when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
        then v_provenance->'validated_positive_evidence_codes' else '[]'::jsonb end
    ) <= 8
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
          then v_provenance->'validated_positive_evidence_codes' else '[]'::jsonb end
      ) item(value)
      where jsonb_typeof(item.value) <> 'string'
         or item.value #>> '{}' not in (
           'verified_public_or_institutional_entity',
           'verified_physical_project_supplier',
           'verified_client_project_intermediary',
           'verified_event_or_media_operator',
           'verified_multisite_or_franchise',
           'verified_enterprise',
           'explicit_private_use',
           'verified_direct_business'
         )
    )
    and jsonb_array_length(
      case when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
        then v_provenance->'validated_positive_evidence_codes' else '[]'::jsonb end
    ) = (
      select count(distinct item.value #>> '{}')
      from jsonb_array_elements(
        case when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
          then v_provenance->'validated_positive_evidence_codes' else '[]'::jsonb end
      ) item(value)
    );

  select coalesce(array_agg(distinct item.value #>> '{}' order by item.value #>> '{}'), '{}')
  into v_positive_codes
  from jsonb_array_elements(
    case when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
      then v_provenance->'validated_positive_evidence_codes' else '[]'::jsonb end
  ) item(value)
  where jsonb_typeof(item.value) = 'string'
    and item.value #>> '{}' in (
      'verified_public_or_institutional_entity',
      'verified_physical_project_supplier',
      'verified_client_project_intermediary',
      'verified_event_or_media_operator',
      'verified_multisite_or_franchise',
      'verified_enterprise',
      'explicit_private_use',
      'verified_direct_business'
    );

  v_research_performed := case
    when jsonb_typeof(v_provenance->'research_performed') = 'boolean'
      then (v_provenance->>'research_performed')::boolean
    else false
  end;
  v_research_response_id := nullif(btrim(coalesce(v_provenance->>'research_response_id', '')), '');
  v_research_call_id := nullif(btrim(coalesce(v_provenance->>'research_call_id', '')), '');
  v_research_query := case
    when jsonb_typeof(v_provenance->'research_query') = 'string'
      then v_provenance->>'research_query'
    else null
  end;
  if jsonb_typeof(v_provenance->'verified_sources') = 'array' then
    v_verified_sources := v_provenance->'verified_sources';
  end if;

  select
    count(*)::integer,
    coalesce(bool_and(
      case when jsonb_typeof(source.value) = 'object' then
      (select count(*) = 5 from jsonb_object_keys(source.value))
      and source.value ?& array[
        'url', 'source_type', 'source_ref', 'research_response_ref',
        'validated_positive_evidence_codes'
      ]
      and jsonb_typeof(source.value->'url') = 'string'
      and source.value->>'url' ~* '^https?://'
      and length(source.value->>'url') between 10 and 2048
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
      and source.value->>'source_type' = 'web_search_call'
      and jsonb_typeof(source.value->'source_ref') = 'string'
      and nullif(btrim(source.value->>'source_ref'), '') is not null
      and length(source.value->>'source_ref') <= 320
      and jsonb_typeof(source.value->'research_response_ref') = 'string'
      and nullif(btrim(source.value->>'research_response_ref'), '') is not null
      and length(source.value->>'research_response_ref') <= 320
      and jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
      and jsonb_array_length(
        case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
          then source.value->'validated_positive_evidence_codes' else '[]'::jsonb end
      ) <= 8
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
            then source.value->'validated_positive_evidence_codes' else '[]'::jsonb end
        ) source_code(value)
        where jsonb_typeof(source_code.value) <> 'string'
           or source_code.value #>> '{}' not in (
             'verified_public_or_institutional_entity',
             'verified_physical_project_supplier',
             'verified_client_project_intermediary',
             'verified_event_or_media_operator',
             'verified_multisite_or_franchise',
             'verified_enterprise',
             'explicit_private_use',
             'verified_direct_business'
           )
      )
      and jsonb_array_length(
        case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
          then source.value->'validated_positive_evidence_codes' else '[]'::jsonb end
      ) = (
        select count(distinct source_code.value #>> '{}')
        from jsonb_array_elements(
          case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
            then source.value->'validated_positive_evidence_codes' else '[]'::jsonb end
        ) source_code(value)
      )
      else false end
    ), true)
  into v_verified_source_count, v_verified_source_shape_valid
  from jsonb_array_elements(v_verified_sources) source(value);

  v_verified_source_shape_valid :=
    v_verified_source_shape_valid
    and v_verified_source_count <= 20
    and v_verified_source_count = (
      select count(distinct source.value->>'url')
      from jsonb_array_elements(v_verified_sources) source(value)
    );

  v_evidence_json_shape_valid :=
    jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
          then p_evidence_json else '[]'::jsonb end
      ) evidence(value)
      where jsonb_typeof(evidence.value) <> 'object'
    );

  v_evidence_semantics_shape_valid := v_evidence_json_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
    ) evidence(value)
    where not (evidence.value ?& array['type', 'url', 'used_for', 'evidence_code'])
       or (select count(*) from jsonb_object_keys(evidence.value)) <> 4
       or evidence.value->>'type' not in ('web_search', 'customer_declared', 'request')
       or length(coalesce(evidence.value->>'type', '')) > 40
       or evidence.value->>'used_for' not in (
         'private_use', 'segment_role', 'organization_scale',
         'institution_status', 'context_tag', 'conflict'
       )
       or evidence.value->>'evidence_code' not in (
         'verified_public_or_institutional_entity',
         'verified_physical_project_supplier',
         'verified_client_project_intermediary',
         'verified_event_or_media_operator',
         'verified_multisite_or_franchise',
         'verified_enterprise',
         'explicit_private_use',
         'verified_direct_business'
       )
       or length(coalesce(evidence.value->>'used_for', '')) > 120
       or length(coalesce(evidence.value->>'evidence_code', '')) > 120
       or jsonb_typeof(evidence.value->'url') not in ('string', 'null')
       or (evidence.value->>'type' = 'web_search' and coalesce(evidence.value->>'url', '') !~* '^https?://')
       or (evidence.value->>'type' = 'web_search' and length(coalesce(evidence.value->>'url', '')) > 2048)
       or (evidence.value->>'type' in ('customer_declared', 'request')
         and jsonb_typeof(evidence.value->'url') <> 'null')
  );

  v_all_external_evidence_source_bound := v_evidence_semantics_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
    ) evidence(value)
    where evidence.value->>'type' = 'web_search'
      and not exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(value)
        where source.value->>'url' = evidence.value->>'url'
          and source.value->>'source_type' = 'web_search_call'
          and source.value->>'source_ref' = v_research_call_id
          and source.value->>'research_response_ref' = v_research_response_id
      )
  );

  v_research_binding_valid :=
    v_provenance_shape_valid
    and v_positive_codes_shape_valid
    and case
    when v_research_performed then
      v_provenance->'research_performed' = 'true'::jsonb
      and v_external_research_required
      and not v_research_plan_blocked
      and v_expected_research_query is not null
      and jsonb_typeof(v_provenance->'research_query') = 'string'
      and v_research_query = v_expected_research_query
      and length(v_research_query) between 1 and 240
      and v_provenance->'research_call_count' = '1'::jsonb
      and v_provenance->>'research_call_status' = 'completed'
      and v_provenance->'classifier_tool_call_count' = '0'::jsonb
      and jsonb_typeof(v_provenance->'research_response_id') = 'string'
      and v_research_response_id is not null
      and length(v_research_response_id) <= 320
      and jsonb_typeof(v_provenance->'research_call_id') = 'string'
      and v_research_call_id is not null
      and length(v_research_call_id) <= 320
      and v_verified_source_shape_valid
      and not exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(value)
        where source.value->>'source_ref' <> v_research_call_id
           or source.value->>'research_response_ref' <> v_research_response_id
      )
      and not exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(value)
        where v_expected_research_query like 'site:%'
          and not (
            (public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'email_domain'
              = v_research_context->>'email_domain'
            or right(
              (public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'email_domain',
              length(v_research_context->>'email_domain') + 1
            ) = '.' || (v_research_context->>'email_domain')
          )
      )
    else
      v_provenance->'research_performed' = 'false'::jsonb
      and v_expected_research_query is null
      and (not v_external_research_required or v_research_plan_blocked)
      and v_provenance->'research_response_id' = 'null'::jsonb
      and v_provenance->'research_call_id' = 'null'::jsonb
      and v_provenance->'research_call_status' = 'null'::jsonb
      and v_provenance->'research_query' = 'null'::jsonb
      and v_provenance->'research_call_count' = '0'::jsonb
      and v_provenance->'classifier_tool_call_count' = '0'::jsonb
      and v_research_response_id is null
      and v_research_call_id is null
      and v_verified_source_count = 0
      and v_verified_source_shape_valid
  end;

  -- The treatment pilot may use the customer's minimized request wording as
  -- first-party request evidence. A synthetic database customer-type default
  -- remains excluded and can never satisfy this check.
  v_private_declaration_evidence_valid := p_segment = 'NT-8'
    and v_required_positive_code = 'explicit_private_use'
    and exists (
      select 1
      from jsonb_array_elements(
        case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
      ) evidence(value)
      where evidence.value->>'type' in ('request', 'customer_declared')
        and evidence.value->>'used_for' = 'private_use'
        and evidence.value->>'evidence_code' = 'explicit_private_use'
        and jsonb_typeof(evidence.value->'url') = 'null'
    );

  v_standard_request_evidence_valid :=
    v_required_positive_code is not null
    and v_required_role_use is not null
    and exists (
      select 1
      from jsonb_array_elements(
        case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
      ) evidence(value)
      where evidence.value->>'type' in ('request', 'customer_declared')
        and evidence.value->>'used_for' = v_required_role_use
        and evidence.value->>'evidence_code' = v_required_positive_code
        and jsonb_typeof(evidence.value->'url') = 'null'
    );

  -- NT-9 is the lowest-priority direct-business role. It may rely on external
  -- evidence without a customer-type declaration, but a higher positive role
  -- in an evidence-bearing role slot must force review. Context/conflict-only
  -- mentions are deliberately not treated as competing positive roles.
  v_nt9_higher_role_conflict := p_segment = 'NT-9' and exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
    ) evidence(value)
    where evidence.value->>'type' in ('web_search', 'request', 'customer_declared')
      and evidence.value->>'used_for' in (
        'institution_status', 'segment_role', 'organization_scale'
      )
      and evidence.value->>'evidence_code' in (
        'verified_public_or_institutional_entity',
        'verified_physical_project_supplier',
        'verified_client_project_intermediary',
        'verified_event_or_media_operator',
        'verified_multisite_or_franchise',
        'verified_enterprise'
      )
  );

  v_external_positive_evidence_bound :=
    v_required_positive_code is not null
    and v_required_positive_code = any(v_positive_codes)
    and cardinality(v_positive_codes) = 1
    and not v_nt9_higher_role_conflict
    and v_required_role_use is not null
    and exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(value)
        join jsonb_array_elements(
          case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
        ) evidence(value)
          on evidence.value->>'url' = source.value->>'url'
         and evidence.value->>'type' = 'web_search'
         and evidence.value->>'evidence_code' = v_required_positive_code
         and evidence.value->>'used_for' = v_required_role_use
        where exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
              then source.value->'validated_positive_evidence_codes' else '[]'::jsonb end
          ) source_code(value)
          where jsonb_typeof(source_code.value) = 'string'
            and source_code.value #>> '{}' = v_required_positive_code
        )
      );

  v_special_handling_required := coalesce(
    p_segment in ('NT-10', 'NT-5', 'NT-6')
      or v_organization_scale in ('large', 'enterprise'),
    false
  );
  v_expected_treatment_tier := case
    when v_special_handling_required then 'special'
    else 'standard'
  end;
  v_treatment_metadata_valid :=
    v_classifier_json->>'treatment_contract'
      = 'treatment_focus_v1_20260820_standard_vs_special'
    and v_classifier_json->>'treatment_tier' = v_expected_treatment_tier
    and case
      when jsonb_typeof(v_classifier_json->'special_handling_required') = 'boolean'
        then (v_classifier_json->>'special_handling_required')::boolean
          = v_special_handling_required
      else false
    end
    and case
      when jsonb_typeof(v_classifier_json->'external_evidence_required') = 'boolean'
        then (v_classifier_json->>'external_evidence_required')::boolean
          = v_special_handling_required
      else false
    end
    and case
      when jsonb_typeof(v_classifier_json->'standard_request_evidence_valid') = 'boolean'
        then (v_classifier_json->>'standard_request_evidence_valid')::boolean
          = v_standard_request_evidence_valid
      else false
    end;

  v_positive_evidence_bound :=
    v_required_positive_code is not null
    and v_required_positive_code = any(v_positive_codes)
    and cardinality(v_positive_codes) = 1
    and not v_nt9_higher_role_conflict
    and case
      when v_special_handling_required then v_external_positive_evidence_bound
      else v_standard_request_evidence_valid or v_external_positive_evidence_bound
    end;

  v_scale_evidence_valid := case
    when p_segment not in ('NT-5', 'NT-6')
      and (
        v_organization_scale is null
        or v_organization_scale not in ('large', 'enterprise')
      ) then true
    else exists (
      select 1
      from jsonb_array_elements(v_verified_sources) source(value)
      join jsonb_array_elements(
        case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end
      ) evidence(value)
        on evidence.value->>'url' = source.value->>'url'
       and evidence.value->>'type' = 'web_search'
       and evidence.value->>'evidence_code' = v_required_positive_code
       and evidence.value->>'used_for' = 'organization_scale'
    )
  end;

  v_mapping_integrity :=
    p_segment is not null
    and v_policy_rule.segment = p_segment
    and v_policy_rule.s_kategorie is not null
    and v_classifier_json->>'segment' = p_segment
    and v_classifier_json->>'s_kategorie' = v_policy_rule.s_kategorie;

  v_evidence_provenance_valid :=
    v_provenance_shape_valid
    and v_provenance->'valid' = 'true'::jsonb
    and v_positive_codes_shape_valid
    and v_verified_source_shape_valid
    and v_evidence_semantics_shape_valid
    and v_all_external_evidence_source_bound
    and v_research_binding_valid
    and v_positive_evidence_bound
    and v_treatment_metadata_valid;

  v_effective_status := p_status;

  if p_status = 'accepted' and (
    p_segment is null
    or p_confidence is null
    or v_policy_rule.segment is null
    or v_required_positive_code is null
    or p_confidence < v_policy_rule.min_confidence
  ) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['insufficient_segment_evidence'];
  end if;

  if p_status = 'accepted' and not (v_context_shape_valid and v_context_tags_valid) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['invalid_context_tags'];
  end if;

  if p_status = 'accepted' and not v_organization_scale_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['invalid_organization_scale'];
  end if;

  if p_status = 'accepted' and p_segment = 'NT-8' and v_organization_scale is not null then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['invalid_organization_scale'];
  end if;

  if p_status = 'accepted' and p_segment in ('NT-5', 'NT-6') and (
    v_organization_scale is null
    or (p_segment = 'NT-6' and v_organization_scale <> 'enterprise')
    or not v_scale_evidence_valid
  ) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['organization_scale_unverified'];
  end if;

  if p_status = 'accepted' and v_special_handling_required and not v_research_performed then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['external_research_required'];
  end if;

  if p_status = 'accepted' and not v_treatment_metadata_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['taxonomy_contract_mismatch'];
  end if;

  if p_status = 'accepted' and not v_evidence_provenance_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['evidence_provenance_unverified'];
  end if;

  if p_status = 'accepted' and v_nt9_higher_role_conflict then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['conflicting_evidence'];
  end if;

  if p_status = 'accepted'
     and not v_positive_evidence_bound
     and not v_nt9_higher_role_conflict then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['missing_validated_positive_evidence'];
  end if;

  if p_status = 'accepted' and not v_mapping_integrity then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags || array['segment_mapping_integrity_failed'];
  end if;

  -- Caller/model risk flags never authorize an accepted result. Keep the
  -- canonical CX8 deterministic blocker set aligned with the existing Record
  -- path, including segment-dependent scale/institution blockers.
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

  select coalesce(array_agg(distinct lower(btrim(flag)) order by lower(btrim(flag))), '{}')
  into v_effective_risk_flags
  from unnest(v_effective_risk_flags) as flags(flag)
  where nullif(btrim(flag), '') is not null;

  v_effective_segment := case when v_effective_status = 'accepted' then p_segment else null end;

  v_classifier_json := v_classifier_json || jsonb_build_object(
    'submitted_status', p_status,
    'proposed_segment', p_segment,
    'submitted_confidence', p_confidence,
    'effective_status', v_effective_status,
    'effective_segment', v_effective_segment,
    'risk_flags', to_jsonb(v_effective_risk_flags),
    'db_validation', jsonb_build_object(
      'runtime_contract_exact', true,
      'input_hash_current', v_input_hash_current,
      'declared_customer_type_first_party_verified', false,
      'context_tags_valid', v_context_shape_valid and v_context_tags_valid,
      'organization_scale_valid', v_organization_scale_valid,
      'organization_scale_evidence_valid', v_scale_evidence_valid,
      'treatment_contract_valid', v_treatment_metadata_valid,
      'treatment_tier', v_expected_treatment_tier,
      'special_handling_required', v_special_handling_required,
      'standard_request_evidence_valid', v_standard_request_evidence_valid,
      'external_positive_evidence_valid', v_external_positive_evidence_bound,
      'research_contract_valid', v_research_binding_valid,
      'research_query_contract_exact', v_research_binding_valid,
      'external_research_required', v_external_research_required,
      'research_plan_blocked', v_research_plan_blocked,
      'evidence_provenance_valid', v_evidence_provenance_valid,
      'required_positive_evidence_code', v_required_positive_code,
      'positive_evidence_valid', v_positive_evidence_bound,
      'mapping_integrity', v_mapping_integrity,
      'master_projection_authorized', false,
      'cache_write_authorized', false
    )
  );

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
    v_policy_rule.s_kategorie,
    p_confidence,
    p_evidence_grade,
    left(coalesce(p_reasoning_short, ''), 1000),
    coalesce(p_reason_codes, '{}'),
    case when v_evidence_json_shape_valid then p_evidence_json else '[]'::jsonb end,
    jsonb_build_object(
      'research_contract', 'segment_research_v2_20260820_domain_filter',
      'research_performed', v_research_performed,
      'research_model', 'gpt-4o-mini-2024-07-18',
      'classifier_model', 'gpt-5.5-2026-04-23',
      'classifier_reasoning_effort', 'medium'
    ),
    v_classifier_json,
    coalesce(to_jsonb(v_policy_rule), '{}'::jsonb) || jsonb_build_object(
      'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
      'classifier_version', 'segment_classifier_v6_20260820_treatment_focus',
      'prompt_version', 'segment_prompt_v6_20260820_treatment_focus',
      'policy_version', 'nt_policy_v5_20260820_treatment_focus_shadow',
      'quality_gate_version', 'nt_quality_gate_v5_20260820_treatment_focus',
      'research_contract', 'segment_research_v2_20260820_domain_filter',
      'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special',
      'treatment_tier', v_expected_treatment_tier,
      'special_handling_required', v_special_handling_required,
      'validator_version', 'n8n_cx8_validator_v3',
      'research_model', 'gpt-4o-mini-2024-07-18',
      'classifier_model', 'gpt-5.5-2026-04-23',
      'classifier_reasoning_effort', 'medium',
      'evaluation_only', true,
      'master_projection_authorized', false
    ),
    v_effective_risk_flags,
    p_model,
    p_model_version,
    p_prompt_version,
    p_classifier_version,
    'nt_policy_v5_20260820_treatment_focus_shadow',
    case when v_effective_status = 'accepted' then now() else null end,
    case when v_effective_status = 'accepted' then p_accepted_by else null end,
    'nt_taxonomy_v2_20260819_cx8',
    case when v_context_tags_valid then v_context_tags else '{}'::text[] end,
    case when v_organization_scale_valid then v_organization_scale else null end,
    v_evidence_provenance_valid,
    v_mapping_integrity
  )
  on conflict (
    request_id, input_hash, taxonomy_version, classifier_version, prompt_version
  ) where taxonomy_version is not null
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

  v_job_status := case
    when v_effective_status = 'needs_review' then 'needs_review'
    else 'completed'
  end;

  update public.request_segmentation_jobs
  set
    status = v_job_status,
    last_classification_id = v_classification_id,
    completed_at = case when v_job_status <> 'failed' then now() else completed_at end,
    last_error_code = case when v_job_status = 'failed' then 'treatment_classifier_error' else null end,
    last_error_message = case when v_job_status = 'failed' then left(coalesce(p_reasoning_short, 'classifier returned error'), 1000) else null end,
    updated_at = now(),
    lock_owner = null,
    locked_at = null
  where id = p_job_id;

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
    'policy_version', 'nt_policy_v5_20260820_treatment_focus_shadow',
    'policy_mode', 'shadow',
    'taxonomy_version', 'nt_taxonomy_v2_20260819_cx8',
    'classifier_version', 'segment_classifier_v6_20260820_treatment_focus',
    'prompt_version', 'segment_prompt_v6_20260820_treatment_focus',
    'research_contract', 'segment_research_v2_20260820_domain_filter',
    'treatment_contract', 'treatment_focus_v1_20260820_standard_vs_special',
    'treatment_tier', v_expected_treatment_tier,
    'special_handling_required', v_special_handling_required,
    'job_status', v_job_status,
    'input_hash_current', v_input_hash_current,
    'contract_match', true,
    'context_tags', to_jsonb(case when v_context_tags_valid then v_context_tags else '{}'::text[] end),
    'organization_scale', case when v_organization_scale_valid then v_organization_scale else null end,
    'evidence_provenance_valid', v_evidence_provenance_valid,
    'mapping_integrity', v_mapping_integrity,
    'evaluation_only', true,
    'master_projection_authorized', false,
    'research_cache_written', false,
    'projection', jsonb_build_object(
      'applied', false,
      'reason', 'evaluation_only_no_projection',
      'authoritative_segment', v_request.segment,
      'authoritative_s_kategorie', v_request.s_kategorie,
      'authoritative_status', v_request.segment_status,
      'authoritative_source', v_request.segment_source,
      'authoritative_taxonomy_version', v_request.segment_taxonomy_version
    )
  );
end;
$function$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) is
  'Treatment-focused 20-argument Record overload. Exact inactive eval lane, immutable Gold, worker, model, research, treatment, validator and provenance markers are mandatory. Standard cases may use request evidence; special-handling cases require bound external evidence. It can write only the candidate classification and terminal job state.';

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text, text, text
) to service_role;

create view public.request_segmentation_v5_gold_evaluation
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.min_unique_gold_total = 300
    and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1.0
    and q.max_provenance_violations = 0
    and q.manual_activation_required
), latest_gold_per_request as (
  select distinct on (g.request_id) g.*
  from public.request_segmentation_gold_adjudications g
  cross join target_contract tc
  where g.taxonomy_version = tc.taxonomy_version
    and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
    and public.neontrip_compute_request_segment_input_hash(g.request_id) = g.input_hash
  order by g.request_id, g.created_at desc, g.id desc
), research_lookup_raw as (
  select
    g.request_id,
    g.input_hash,
    nullif(
      btrim(regexp_replace(
        regexp_replace(
          normalize(coalesce(c.company_name, c.company, ''), NFKC),
          '[[:cntrl:]]+', ' ', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )),
      ''
    ) as raw_company,
    nullif(split_part(lower(btrim(coalesce(c.email, ''))), '@', 2), '') as raw_email_domain,
    lower(btrim(coalesce(c.first_name, ''))) as first_name,
    lower(btrim(coalesce(c.last_name, ''))) as last_name,
    lower(btrim(coalesce(c.name, ''))) as contact_name
  from latest_gold_per_request g
  join public.master_requests r on r.id = g.request_id
  join public.master_customers c on c.id = r.customer_id
), research_company_screen as (
  select
    lr.*,
    case
      when lr.raw_company is null then null
      when length(lr.raw_company) not between 2 and 120 then null
      when lr.raw_company ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then null
      when lr.raw_company ~* '(https?://|www\.)' then null
      when lr.raw_company ~* '(\+|00)?[0-9][0-9() ./-]{6,}[0-9]' then null
      when lr.raw_company ~* '\m[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\M' then null
      when lr.raw_company ~* '([?&[:space:]])?(utm_[a-z_]+|gclid|fbclid|gbraid|wbraid)([[:space:]]*=|\M)' then null
      when lr.raw_company ~ '\m[0-9]{5,}\M' then null
      when lr.raw_company !~ '^[[:alnum:]ÄÖÜäöüß .,&''()+/_-]+$' then null
      when cardinality(regexp_split_to_array(lr.raw_company, '[[:space:]]+')) not between 2 and 10 then null
      when exists (
        select 1
        from unnest(regexp_split_to_array(lr.raw_company, '[[:space:]]+')) company_token(token)
        where length(company_token.token) > 40
           or (
             length(company_token.token) >= 24
             and company_token.token ~ '^[[:alnum:]_-]+$'
             and company_token.token ~ '[0-9_-]'
           )
      ) then null
      when lr.raw_company ~ '^[[:upper:]ÄÖÜ][[:lower:]äöüß''-]{1,30} [[:upper:]ÄÖÜ][[:lower:]äöüß''-]{1,30}$'
        and lr.raw_company !~* '\m(gmbh|ag|ug|ohg|kg|gbr|e\.?[[:space:]]?v\.?|inc|ltd|llc|group|holding|studio|agentur|agency|media|production|productions|event|events|hotel|restaurant|praxis|klinik|shop|store|design|solutions|systems|technik|bau|service|services)\M'
        then null
      when exists (
        select 1
        from unnest(regexp_split_to_array(lower(lr.raw_company), '[^[:alnum:]äöüß]+')) company_word(word)
        where length(company_word.word) >= 3
          and company_word.word in (lr.first_name, lr.last_name, lr.contact_name)
      ) then null
      else lr.raw_company
    end as safe_company
  from research_lookup_raw lr
), research_screened as (
  select
    cs.*,
    (
      cs.safe_company is not null
      and cs.safe_company ~* '\m(gmbh|ag|ug|ohg|kg|gbr|e\.?[[:space:]]?v\.?|inc|ltd|llc|group|holding|studio|agentur|agency|media|production|productions|event|events|hotel|restaurant|praxis|klinik|shop|store|design|solutions|systems|technik|bau|service|services)\M'
      and length(concat(
        cs.safe_company,
        ' offizielle Website Unternehmen Leistungen Kundenprojekte Standorte'
      )) between 1 and 240
    ) as company_lookup_allowed,
    public.neontrip_request_segmentation_domain_facts(cs.raw_email_domain) as domain_facts
  from research_company_screen cs
), research_plan as (
  select
    rs.*,
    coalesce((rs.domain_facts->>'is_valid_dns_host')::boolean, false)
      and coalesce((rs.domain_facts->>'email_domain_cache_allowed')::boolean, false)
      and not coalesce((rs.domain_facts->>'is_freemail')::boolean, false)
      and not coalesce((rs.domain_facts->>'is_shared_provider')::boolean, false)
      and length(concat(
        'site:', rs.domain_facts->>'email_domain',
        ' Unternehmen Leistungen Kundenprojekte Standorte Impressum'
      )) between 1 and 240
      as domain_lookup_allowed
  from research_screened rs
), expected_research_plan as (
  select
    rp.request_id,
    rp.input_hash,
    rp.domain_facts->>'email_domain' as email_domain,
    rp.domain_lookup_allowed as external_research_required,
    case
      when rp.domain_lookup_allowed then concat(
        'site:', rp.domain_facts->>'email_domain',
        ' Unternehmen Leistungen Kundenprojekte Standorte Impressum'
      )
      else null
    end as expected_research_query
  from research_plan rp
), bound_research_plan as (
  select
    erp.*,
    erp.external_research_required and erp.expected_research_query is null
      as research_blocked
  from expected_research_plan erp
), exact_evaluation as (
  select
    g.id as gold_adjudication_id,
    g.request_id,
    g.input_hash,
    g.taxonomy_version,
    g.labeling_version,
    g.labeled_segment as actual_segment,
    g.labeled_s_kategorie as actual_s_kategorie,
    g.organization_scale as actual_organization_scale,
    case
      when g.labeled_segment in ('NT-10', 'NT-5', 'NT-6')
        or g.organization_scale in ('large', 'enterprise') then 'special'
      else 'standard'
    end as actual_treatment_tier,
    g.created_at as adjudicated_at,
    j.id as evaluation_job_id,
    c.id as classification_id,
    c.status as classifier_status,
    c.segment as proposed_segment,
    case when c.status = 'accepted' then c.segment end as accepted_predicted_segment,
    c.s_kategorie as proposed_s_kategorie,
    case when c.status = 'accepted' then c.s_kategorie end as accepted_predicted_s_kategorie,
    c.organization_scale as proposed_organization_scale,
    c.classifier_json->>'treatment_tier' as proposed_treatment_tier,
    case when c.status = 'accepted' then c.classifier_json->>'treatment_tier' end
      as accepted_treatment_tier,
    c.confidence as predicted_confidence,
    c.evidence_grade,
    c.risk_flags,
    c.evidence_provenance_valid,
    c.mapping_integrity,
    c.policy_version,
    c.classifier_version,
    c.prompt_version,
    c.model,
    c.model_version,
    c.classifier_json,
    c.created_at as classified_at,
    coalesce(
      j.id is not null
      and c.model = 'gpt-5.5-2026-04-23'
      and c.model_version = 'gpt-5.5-2026-04-23'
      and c.classifier_json->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and c.classifier_json->>'classifier_reasoning_effort' = 'medium'
      and c.classifier_json->'evidence_provenance'->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and c.classifier_json->'evidence_provenance'->>'classifier_reasoning_effort' = 'medium',
      false
    ) as model_contract_integrity,
    coalesce(
      c.classifier_json->>'treatment_contract'
        = 'treatment_focus_v1_20260820_standard_vs_special'
      and c.classifier_json->>'treatment_tier' in ('standard', 'special')
      and jsonb_typeof(c.classifier_json->'special_handling_required') = 'boolean'
      and jsonb_typeof(c.classifier_json->'external_evidence_required') = 'boolean'
      and jsonb_typeof(c.classifier_json->'standard_request_evidence_valid') = 'boolean'
      and c.classifier_json->'special_handling_required'
        = c.classifier_json->'external_evidence_required'
      and c.classifier_json->'db_validation'->'treatment_contract_valid' = 'true'::jsonb
      and c.classifier_json->'db_validation'->>'treatment_tier'
        = c.classifier_json->>'treatment_tier'
      and c.classifier_json->'db_validation'->'special_handling_required'
        = c.classifier_json->'special_handling_required',
      false
    ) as treatment_contract_integrity,
    coalesce(
      c.classifier_json->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and c.classifier_json->>'validator_version' = 'n8n_cx8_validator_v3'
      and c.classifier_json->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and c.classifier_json->'evidence_provenance'->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
      and c.classifier_json->'evidence_provenance'->>'validator_version' = 'n8n_cx8_validator_v3'
      and c.classifier_json->'evidence_provenance'->>'research_model' = 'gpt-4o-mini-2024-07-18'
      and c.classifier_json->'evidence_provenance'->>'classifier_model' = 'gpt-5.5-2026-04-23'
      and c.classifier_json->'evidence_provenance'->>'classifier_reasoning_effort' = 'medium'
      and c.classifier_json->'db_validation'->'runtime_contract_exact' = 'true'::jsonb
      and c.classifier_json->'db_validation'->'research_contract_valid' = 'true'::jsonb
      and c.classifier_json->'db_validation'->'research_query_contract_exact' = 'true'::jsonb
      and c.classifier_json->'db_validation'->'cache_write_authorized' = 'false'::jsonb
      and c.classifier_json->'db_validation'->'declared_customer_type_first_party_verified' = 'false'::jsonb
      and case
        when jsonb_typeof(c.classifier_json->'evidence_provenance') = 'object' then (
          select count(*) = 15
            and coalesce(bool_and(provenance_key in (
              'valid', 'research_contract', 'validator_version',
              'research_model', 'classifier_model', 'classifier_reasoning_effort',
              'research_performed', 'research_response_id', 'research_call_id',
              'research_call_count', 'research_call_status', 'research_query',
              'classifier_tool_call_count', 'validated_positive_evidence_codes',
              'verified_sources'
            )), false)
          from jsonb_object_keys(c.classifier_json->'evidence_provenance')
            as provenance_keys(provenance_key)
        )
        else false
      end
      and c.classifier_json->'evidence_provenance'->'classifier_tool_call_count' = '0'::jsonb
      and jsonb_typeof(c.classifier_json->'evidence_provenance'->'valid') = 'boolean'
      and jsonb_typeof(c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes') = 'array'
      and jsonb_array_length(
        case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes') = 'array'
          then c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes'
          else '[]'::jsonb end
      ) <= 8
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes') = 'array'
            then c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes'
            else '[]'::jsonb end
        ) code(value)
        where jsonb_typeof(code.value) <> 'string'
           or code.value #>> '{}' not in (
             'verified_public_or_institutional_entity',
             'verified_physical_project_supplier',
             'verified_client_project_intermediary',
             'verified_event_or_media_operator',
             'verified_multisite_or_franchise',
             'verified_enterprise',
             'explicit_private_use',
             'verified_direct_business'
           )
      )
      and jsonb_array_length(
        case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes') = 'array'
          then c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes'
          else '[]'::jsonb end
      ) = (
        select count(distinct code.value #>> '{}')
        from jsonb_array_elements(
          case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes') = 'array'
            then c.classifier_json->'evidence_provenance'->'validated_positive_evidence_codes'
            else '[]'::jsonb end
        ) code(value)
      )
      and jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
      and jsonb_array_length(
        case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
          then c.classifier_json->'evidence_provenance'->'verified_sources'
          else '[]'::jsonb end
      ) <= 20
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
            then c.classifier_json->'evidence_provenance'->'verified_sources'
            else '[]'::jsonb end
        ) source(value)
        where not (
          case when jsonb_typeof(source.value) = 'object' then
            (select count(*) = 5 from jsonb_object_keys(source.value))
            and source.value ?& array[
              'url', 'source_type', 'source_ref', 'research_response_ref',
              'validated_positive_evidence_codes'
            ]
            and source.value->>'source_type' = 'web_search_call'
            and source.value->>'url' ~* '^https?://'
            and length(source.value->>'url') between 10 and 2048
            and coalesce(
              ((public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'is_valid_dns_host')::boolean,
              false
            )
            and jsonb_typeof(source.value->'source_ref') = 'string'
            and length(coalesce(source.value->>'source_ref', '')) between 1 and 320
            and jsonb_typeof(source.value->'research_response_ref') = 'string'
            and length(coalesce(source.value->>'research_response_ref', '')) between 1 and 320
            and jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
            and jsonb_array_length(
              case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
                then source.value->'validated_positive_evidence_codes'
                else '[]'::jsonb end
            ) <= 8
            and not exists (
              select 1
              from jsonb_array_elements(
                case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
                  then source.value->'validated_positive_evidence_codes'
                  else '[]'::jsonb end
              ) source_code(value)
              where jsonb_typeof(source_code.value) <> 'string'
                 or source_code.value #>> '{}' not in (
                   'verified_public_or_institutional_entity',
                   'verified_physical_project_supplier',
                   'verified_client_project_intermediary',
                   'verified_event_or_media_operator',
                   'verified_multisite_or_franchise',
                   'verified_enterprise',
                   'explicit_private_use',
                   'verified_direct_business'
                 )
            )
            and jsonb_array_length(
              case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
                then source.value->'validated_positive_evidence_codes'
                else '[]'::jsonb end
            ) = (
              select count(distinct source_code.value #>> '{}')
              from jsonb_array_elements(
                case when jsonb_typeof(source.value->'validated_positive_evidence_codes') = 'array'
                  then source.value->'validated_positive_evidence_codes'
                  else '[]'::jsonb end
              ) source_code(value)
            )
          else false end
        )
      )
      and jsonb_array_length(
        case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
          then c.classifier_json->'evidence_provenance'->'verified_sources'
          else '[]'::jsonb end
      ) = (
        select count(distinct source.value->>'url')
        from jsonb_array_elements(
          case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
            then c.classifier_json->'evidence_provenance'->'verified_sources'
            else '[]'::jsonb end
        ) source(value)
      )
      and (
        (
          c.classifier_json->'evidence_provenance'->'research_performed' = 'true'::jsonb
          and ep.external_research_required
          and not ep.research_blocked
          and ep.expected_research_query is not null
          and jsonb_typeof(c.classifier_json->'evidence_provenance'->'research_query') = 'string'
          and c.classifier_json->'evidence_provenance'->>'research_query'
                = ep.expected_research_query
          and c.classifier_json->'evidence_provenance'->'research_call_count' = '1'::jsonb
          and c.classifier_json->'evidence_provenance'->>'research_call_status' = 'completed'
          and nullif(btrim(c.classifier_json->'evidence_provenance'->>'research_response_id'), '') is not null
          and nullif(btrim(c.classifier_json->'evidence_provenance'->>'research_call_id'), '') is not null
          and jsonb_typeof(c.classifier_json->'evidence_provenance'->'research_response_id') = 'string'
          and jsonb_typeof(c.classifier_json->'evidence_provenance'->'research_call_id') = 'string'
          and length(c.classifier_json->'evidence_provenance'->>'research_response_id') between 1 and 320
          and length(c.classifier_json->'evidence_provenance'->>'research_call_id') between 1 and 320
          and length(coalesce(c.classifier_json->'evidence_provenance'->>'research_query', '')) between 1 and 240
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
                then c.classifier_json->'evidence_provenance'->'verified_sources'
                else '[]'::jsonb end
            ) source(value)
            where source.value->>'source_ref'
                    <> c.classifier_json->'evidence_provenance'->>'research_call_id'
               or source.value->>'research_response_ref'
                    <> c.classifier_json->'evidence_provenance'->>'research_response_id'
          )
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
                then c.classifier_json->'evidence_provenance'->'verified_sources'
                else '[]'::jsonb end
            ) source(value)
            where ep.expected_research_query like 'site:%'
              and not (
                (public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'email_domain'
                  = ep.email_domain
                or right(
                  (public.neontrip_request_segmentation_domain_facts(source.value->>'url'))->>'email_domain',
                  length(ep.email_domain) + 1
                ) = '.' || ep.email_domain
              )
          )
        )
        or (
          c.classifier_json->'evidence_provenance'->'research_performed' = 'false'::jsonb
          and ep.expected_research_query is null
          and (
            not ep.external_research_required
            or ep.research_blocked
          )
          and c.classifier_json->'evidence_provenance'->'research_call_count' = '0'::jsonb
          and c.classifier_json->'evidence_provenance'->'research_response_id' = 'null'::jsonb
          and c.classifier_json->'evidence_provenance'->'research_call_id' = 'null'::jsonb
          and c.classifier_json->'evidence_provenance'->'research_call_status' = 'null'::jsonb
          and c.classifier_json->'evidence_provenance'->'research_query' = 'null'::jsonb
          and jsonb_array_length(
            case when jsonb_typeof(c.classifier_json->'evidence_provenance'->'verified_sources') = 'array'
              then c.classifier_json->'evidence_provenance'->'verified_sources'
              else '[]'::jsonb end
          ) = 0
        )
      ),
      false
    ) as research_contract_integrity
  from latest_gold_per_request g
  cross join target_contract tc
  join bound_research_plan ep
    on ep.request_id = g.request_id
   and ep.input_hash = g.input_hash
  left join public.request_segment_classifications c
    on c.request_id = g.request_id
   and c.input_hash = g.input_hash
   and c.taxonomy_version = g.taxonomy_version
   and c.classifier_version = tc.classifier_version
   and c.prompt_version = tc.prompt_version
   and c.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
  left join public.request_segmentation_jobs j
    on j.last_classification_id = c.id
   and j.request_id = g.request_id
   and j.input_hash = g.input_hash
   and j.source = 'gold_re_evaluation_phase7_treatment'
   and j.status in ('completed', 'needs_review')
   and j.taxonomy_version = g.taxonomy_version
   and j.classifier_version = tc.classifier_version
   and j.prompt_version = tc.prompt_version
   and j.attempts > 0
   and j.attempts <= j.max_attempts
   and lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
   and lower(coalesce(j.metadata->>'master_projection_authorized', 'true')) = 'false'
   and j.metadata->>'policy_version' = 'nt_policy_v5_20260820_treatment_focus_shadow'
   and j.metadata->>'quality_gate_version' = 'nt_quality_gate_v5_20260820_treatment_focus'
   and j.metadata->>'research_contract' = 'segment_research_v2_20260820_domain_filter'
   and j.metadata->>'treatment_contract' = 'treatment_focus_v1_20260820_standard_vs_special'
   and j.metadata->>'validator_version' = 'n8n_cx8_validator_v3'
   and j.metadata->>'research_model' = 'gpt-4o-mini-2024-07-18'
   and j.metadata->>'classifier_model' = 'gpt-5.5-2026-04-23'
   and j.metadata->>'classifier_reasoning_effort' = 'medium'
)
select
  e.*,
  case
    when e.classification_id is null then 'missing_prediction'
    when e.classifier_status <> 'accepted' then 'not_accepted'
    when not e.model_contract_integrity then 'model_contract_violation'
    when not e.research_contract_integrity then 'research_contract_violation'
    when not e.treatment_contract_integrity then 'treatment_contract_violation'
    when e.accepted_predicted_segment = e.actual_segment then 'correct'
    else 'wrong_segment'
  end as evaluation_status,
  case
    when e.classification_id is null then 'missing_prediction'
    when e.classifier_status <> 'accepted' then 'not_accepted'
    when not e.model_contract_integrity then 'model_contract_violation'
    when not e.research_contract_integrity then 'research_contract_violation'
    when not e.treatment_contract_integrity then 'treatment_contract_violation'
    when e.accepted_treatment_tier = e.actual_treatment_tier then 'correct_treatment'
    else 'wrong_treatment'
  end as treatment_evaluation_status,
  coalesce(
    e.classifier_status = 'accepted'
    and e.model_contract_integrity
    and e.research_contract_integrity
    and e.treatment_contract_integrity
    and e.accepted_predicted_segment = e.actual_segment,
    false
  ) as segment_match,
  coalesce(
    e.classifier_status = 'accepted'
    and e.model_contract_integrity
    and e.research_contract_integrity
    and e.treatment_contract_integrity
    and e.accepted_predicted_s_kategorie = e.actual_s_kategorie,
    false
  ) as s_kategorie_match,
  coalesce(
    e.classifier_status = 'accepted'
    and e.model_contract_integrity
    and e.research_contract_integrity
    and e.treatment_contract_integrity
    and e.accepted_treatment_tier = e.actual_treatment_tier,
    false
  ) as treatment_match
from exact_evaluation e;

comment on view public.request_segmentation_v5_gold_evaluation is
  'Exact Treatment-focus Phase-7 classifier-v6 evaluation. Gold/prediction join on request, current immutable input hash, taxonomy, classifier, prompt and candidate policy; model, research, treatment and validator drift is explicit and fail closed.';

create view public.request_segmentation_v5_confusion_matrix
with (security_invoker = true)
as
select
  actual_segment,
  actual_treatment_tier,
  case
    when classifier_status = 'accepted'
      and model_contract_integrity
      and research_contract_integrity
      and treatment_contract_integrity
      then accepted_predicted_segment
    else '__ABSTAIN__'
  end as predicted_outcome,
  case
    when classifier_status = 'accepted'
      and model_contract_integrity
      and research_contract_integrity
      and treatment_contract_integrity
      then accepted_treatment_tier
    else '__ABSTAIN__'
  end as predicted_treatment_outcome,
  classifier_status,
  count(*)::integer as examples,
  count(*) filter (where evaluation_status = 'correct')::integer as correct_examples
from public.request_segmentation_v5_gold_evaluation
group by
  actual_segment,
  actual_treatment_tier,
  case
    when classifier_status = 'accepted'
      and model_contract_integrity
      and research_contract_integrity
      and treatment_contract_integrity
      then accepted_predicted_segment
    else '__ABSTAIN__'
  end,
  case
    when classifier_status = 'accepted'
      and model_contract_integrity
      and research_contract_integrity
      and treatment_contract_integrity
      then accepted_treatment_tier
    else '__ABSTAIN__'
  end,
  classifier_status;

comment on view public.request_segmentation_v5_confusion_matrix is
  'Treatment-focus Phase-7 confusion matrix. Contract-invalid accepted rows are abstentions, never valid predictions.';

create view public.request_segmentation_v5_segment_quality
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.min_unique_gold_total = 300 and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1.0
    and q.max_provenance_violations = 0 and q.manual_activation_required
), actual_stats as (
  select
    e.actual_segment as segment,
    count(*)::integer as gold_examples,
    count(*) filter (
      where e.classifier_status = 'accepted'
        and e.model_contract_integrity
        and e.research_contract_integrity
        and e.treatment_contract_integrity
    )::integer as accepted_on_actual,
    count(*) filter (where e.evaluation_status = 'correct')::integer as true_positives
  from public.request_segmentation_v5_gold_evaluation e
  group by e.actual_segment
), predicted_stats as (
  select
    e.accepted_predicted_segment as segment,
    count(*)::integer as accepted_predictions,
    count(*) filter (where e.actual_segment = e.accepted_predicted_segment)::integer as true_positives
  from public.request_segmentation_v5_gold_evaluation e
  where e.classifier_status = 'accepted'
    and e.model_contract_integrity
    and e.research_contract_integrity
    and e.treatment_contract_integrity
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
    case when d.segment = any(tc.critical_segments)
      then tc.min_critical_precision else tc.min_precision_per_predicted_class end as required_precision,
    tc.min_recall_per_actual_class as required_recall,
    tc.min_gold_per_segment
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version and d.active
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

comment on view public.request_segmentation_v5_segment_quality is
  'Per-class Treatment-focus Phase-7 precision/recall. Abstentions and contract-invalid rows lower recall/coverage.';

create view public.request_segmentation_v5_quality_summary
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.min_unique_gold_total = 300 and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1.0
    and q.max_provenance_violations = 0 and q.manual_activation_required
), evaluation as (
  select * from public.request_segmentation_v5_gold_evaluation
)
select
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  tc.version as quality_gate_version,
  'segment_research_v2_20260820_domain_filter'::text as research_contract,
  'treatment_focus_v1_20260820_standard_vs_special'::text as treatment_contract,
  'gpt-4o-mini-2024-07-18'::text as research_model,
  'gpt-5.5-2026-04-23'::text as classifier_model,
  'medium'::text as classifier_reasoning_effort,
  count(e.gold_adjudication_id)::integer as unique_gold_examples,
  count(e.gold_adjudication_id) filter (where e.classification_id is not null)::integer as evaluated_examples,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and e.model_contract_integrity
      and e.research_contract_integrity
      and e.treatment_contract_integrity
  )::integer as accepted_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::integer as correct_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'wrong_segment')::integer as wrong_segment_predictions,
  count(e.gold_adjudication_id) filter (
    where e.treatment_evaluation_status = 'correct_treatment'
  )::integer as correct_treatment_predictions,
  count(e.gold_adjudication_id) filter (
    where e.treatment_evaluation_status = 'wrong_treatment'
  )::integer as wrong_treatment_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'not_accepted')::integer as abstained_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'missing_prediction')::integer as missing_predictions,
  count(e.gold_adjudication_id) filter (
    where e.classification_id is not null and not e.model_contract_integrity
  )::integer as model_contract_violations,
  count(e.gold_adjudication_id) filter (
    where e.classification_id is not null and not e.research_contract_integrity
  )::integer as research_contract_violations,
  count(e.gold_adjudication_id) filter (
    where e.classification_id is not null and not e.treatment_contract_integrity
  )::integer as treatment_contract_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted' and not e.model_contract_integrity
  )::integer as accepted_model_contract_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted' and not e.research_contract_integrity
  )::integer as accepted_research_contract_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted' and not e.treatment_contract_integrity
  )::integer as accepted_treatment_contract_violations,
  round(
    count(e.gold_adjudication_id) filter (
      where e.classifier_status = 'accepted'
        and e.model_contract_integrity
        and e.research_contract_integrity
        and e.treatment_contract_integrity
    )::numeric / nullif(count(e.gold_adjudication_id), 0),
    4
  ) as accepted_coverage,
  round(
    count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::numeric
      / nullif(count(e.gold_adjudication_id) filter (
          where e.classifier_status = 'accepted'
            and e.model_contract_integrity
            and e.research_contract_integrity
            and e.treatment_contract_integrity
        ), 0),
    4
  ) as overall_precision_on_accepted,
  round(
    count(e.gold_adjudication_id) filter (
      where e.treatment_evaluation_status = 'correct_treatment'
    )::numeric / nullif(count(e.gold_adjudication_id) filter (
        where e.classifier_status = 'accepted'
          and e.model_contract_integrity
          and e.research_contract_integrity
          and e.treatment_contract_integrity
      ), 0),
    4
  ) as treatment_accuracy_on_accepted,
  round(
    count(e.gold_adjudication_id) filter (
      where e.classifier_status = 'accepted'
        and e.model_contract_integrity
        and e.research_contract_integrity
        and e.treatment_contract_integrity
        and e.mapping_integrity
    )::numeric / nullif(count(e.gold_adjudication_id) filter (
        where e.classifier_status = 'accepted'
          and e.model_contract_integrity
          and e.research_contract_integrity
          and e.treatment_contract_integrity
      ), 0),
    4
  ) as accepted_mapping_integrity,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and e.model_contract_integrity
      and e.research_contract_integrity
      and e.treatment_contract_integrity
      and not coalesce(e.mapping_integrity, false)
  )::integer as accepted_mapping_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and e.model_contract_integrity
      and e.research_contract_integrity
      and e.treatment_contract_integrity
      and not coalesce(e.evidence_provenance_valid, false)
  )::integer as accepted_provenance_violations
from target_contract tc
left join evaluation e on true
group by tc.taxonomy_version, tc.classifier_version, tc.prompt_version, tc.version;

comment on view public.request_segmentation_v5_quality_summary is
  'Treatment-focus Phase-7 totals with exact model/research contract violations separated from accepted metrics.';

create view public.request_segmentation_v5_mapping_integrity
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.min_unique_gold_total = 300 and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1.0
    and q.max_provenance_violations = 0 and q.manual_activation_required
), configuration as (
  select
    tc.taxonomy_version,
    count(d.segment)::integer as active_definition_count,
    count(distinct d.required_evidence_code)::integer as unique_required_evidence_codes,
    count(r.segment)::integer as matching_policy_rule_count,
    jsonb_object_agg(
      d.segment,
      jsonb_build_array(
        d.default_s_kategorie, d.review_threshold, d.priority,
        d.required_evidence_code, r.s_kategorie, r.min_confidence,
        r.sales_priority
      ) order by d.segment
    ) as exact_mapping_contract,
    count(*) filter (
      where r.segment is null
         or r.s_kategorie is distinct from d.default_s_kategorie
         or r.taxonomy_version is distinct from d.taxonomy_version
         or r.automation_enabled
         or r.needs_human_review
         or r.price_factor is not null
         or r.max_followups <> 0
         or r.first_call_after_minutes is not null
         or r.call_sequence <> '[]'::jsonb
         or r.email_sequence <> '[]'::jsonb
    )::integer as definition_rule_mismatches
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version and d.active
  left join public.segment_policy_rules r
    on r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
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
    and c.exact_mapping_contract = '{
      "NT-1": ["S2", 0.82, 90, "verified_physical_project_supplier", "S2", 0.82, 50],
      "NT-10": ["S4", 0.85, 100, "verified_public_or_institutional_entity", "S4", 0.85, 50],
      "NT-3": ["S1", 0.80, 70, "verified_event_or_media_operator", "S1", 0.80, 50],
      "NT-4": ["S2", 0.82, 80, "verified_client_project_intermediary", "S2", 0.82, 50],
      "NT-5": ["S2", 0.85, 60, "verified_multisite_or_franchise", "S2", 0.85, 50],
      "NT-6": ["S2", 0.85, 50, "verified_enterprise", "S2", 0.85, 50],
      "NT-8": ["S3", 0.85, 40, "explicit_private_use", "S3", 0.85, 50],
      "NT-9": ["S3", 0.82, 30, "verified_direct_business", "S3", 0.82, 50]
    }'::jsonb
  ) as configuration_integrity,
  qs.accepted_predictions,
  qs.accepted_mapping_violations,
  qs.accepted_mapping_integrity
from target_contract tc
join configuration c on c.taxonomy_version = tc.taxonomy_version
join public.request_segmentation_v5_quality_summary qs
  on qs.quality_gate_version = tc.version;

comment on view public.request_segmentation_v5_mapping_integrity is
  'Exact eight-definition/eight-inert-rule mapping plus accepted-prediction integrity for Treatment-focus Phase 7.';

create view public.request_segmentation_v5_activation_gate_status
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and q.min_unique_gold_total = 300 and q.min_gold_per_segment = 25
    and q.min_precision_per_predicted_class = 0.90
    and q.min_recall_per_actual_class = 0.85
    and q.min_accepted_coverage = 0.80
    and q.critical_segments = array['NT-8', 'NT-10']::text[]
    and q.min_critical_precision = 0.95
    and q.required_mapping_integrity = 1.0
    and q.max_provenance_violations = 0 and q.manual_activation_required
), summary as (
  select * from public.request_segmentation_v5_quality_summary
), per_segment as (
  select
    count(*)::integer as active_segments,
    count(*) filter (where has_minimum_gold)::integer as segments_with_minimum_gold,
    count(*) filter (where not precision_passed)::integer as segments_below_precision,
    count(*) filter (where not recall_passed)::integer as segments_below_recall,
    coalesce(bool_and(segment_gate_passed), false) as all_segment_gates_passed
  from public.request_segmentation_v5_segment_quality
), mapping as (
  select * from public.request_segmentation_v5_mapping_integrity
)
select
  tc.version as quality_gate_version,
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  s.research_contract,
  s.treatment_contract,
  s.research_model,
  s.classifier_model,
  s.classifier_reasoning_effort,
  s.unique_gold_examples,
  s.evaluated_examples,
  s.accepted_predictions,
  s.correct_predictions,
  s.correct_treatment_predictions,
  s.wrong_treatment_predictions,
  s.accepted_coverage,
  s.overall_precision_on_accepted,
  s.treatment_accuracy_on_accepted,
  ps.active_segments,
  ps.segments_with_minimum_gold,
  ps.segments_below_precision,
  ps.segments_below_recall,
  m.configuration_integrity,
  s.accepted_mapping_integrity,
  s.accepted_mapping_violations,
  s.accepted_provenance_violations,
  s.model_contract_violations,
  s.research_contract_violations,
  s.treatment_contract_violations,
  s.accepted_model_contract_violations,
  s.accepted_research_contract_violations,
  s.accepted_treatment_contract_violations,
  s.unique_gold_examples >= tc.min_unique_gold_total as has_minimum_unique_gold,
  ps.active_segments = 8 and ps.segments_with_minimum_gold = 8 as has_minimum_gold_per_segment,
  ps.segments_below_precision = 0 as has_required_per_class_precision,
  ps.segments_below_recall = 0 as has_required_per_class_recall,
  coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false) as has_required_accepted_coverage,
  m.configuration_integrity
    and coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
    and s.accepted_mapping_violations = 0 as has_required_mapping_integrity,
  s.accepted_provenance_violations <= tc.max_provenance_violations as has_no_provenance_violations,
  s.model_contract_violations = 0 as has_exact_model_contract,
  s.research_contract_violations = 0 as has_exact_research_contract,
  s.treatment_contract_violations = 0 as has_exact_treatment_contract,
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
    and s.model_contract_violations = 0
    and s.research_contract_violations = 0
    and s.treatment_contract_violations = 0
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
    case when s.accepted_provenance_violations > tc.max_provenance_violations then 'accepted_evidence_provenance_violations_present' end,
    case when s.model_contract_violations <> 0 then 'model_contract_violations_present' end,
    case when s.research_contract_violations <> 0 then 'research_contract_violations_present' end,
    case when s.treatment_contract_violations <> 0 then 'treatment_contract_violations_present' end
  ], null) as technical_blocking_reasons,
  tc.manual_activation_required
from target_contract tc
cross join summary s
cross join per_segment ps
cross join mapping m;

comment on view public.request_segmentation_v5_activation_gate_status is
  'Fail-closed technical Treatment-focus Phase-7 gate, including exact model, research and treatment-contract integrity. Four pilot cases can never satisfy the 300/25 quality thresholds.';

create view public.request_segmentation_v5_activation_approval_status
with (security_invoker = true)
as
with active_approval as (
  select a.*
  from public.request_segmentation_activation_approvals a
  where a.approval_scope = 'followup_pricing'
    and a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and a.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus'
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
  'nt_policy_v5_20260820_treatment_focus_shadow'::text,
  'nt_taxonomy_v2_20260819_cx8'::text,
  'nt_quality_gate_v5_20260820_treatment_focus'::text,
  null::text,
  null::text,
  null::timestamptz,
  null::timestamptz,
  null::jsonb,
  false
where not exists (select 1 from active_approval);

create view public.request_segmentation_v5_production_readiness
with (security_invoker = true)
as
select
  g.quality_gate_version,
  g.taxonomy_version,
  g.classifier_version,
  g.prompt_version,
  g.research_contract,
  g.treatment_contract,
  g.research_model,
  g.classifier_model,
  g.classifier_reasoning_effort,
  g.unique_gold_examples as gold_examples,
  g.evaluated_examples,
  g.accepted_predictions,
  g.correct_predictions,
  g.correct_treatment_predictions,
  g.wrong_treatment_predictions,
  g.accepted_coverage,
  g.overall_precision_on_accepted,
  g.treatment_accuracy_on_accepted,
  g.technical_quality_gate_passed,
  a.has_active_approval as has_manual_activation_approval,
  a.approval_id as activation_approval_id,
  a.approved_by as activation_approved_by,
  a.approved_at as activation_approved_at,
  a.expires_at as activation_approval_expires_at,
  true as evaluation_pilot_only,
  false as followup_pricing_activation_allowed,
  array_remove(
    g.technical_blocking_reasons || array[
      case when g.manual_activation_required and not a.has_active_approval
        then 'manual_approval_required_before_followup_or_pricing' end,
      'treatment_evaluation_only_contract_requires_separate_global_rollout'
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
  g.accepted_provenance_violations,
  g.model_contract_violations,
  g.research_contract_violations,
  g.treatment_contract_violations,
  g.accepted_model_contract_violations,
  g.accepted_research_contract_violations,
  g.accepted_treatment_contract_violations
from public.request_segmentation_v5_activation_gate_status g
cross join public.request_segmentation_v5_activation_approval_status a;

comment on view public.request_segmentation_v5_production_readiness is
  'Treatment-focus Phase-7 is evaluation-only by construction. Even a future technical pass and approval cannot authorize follow-up or pricing without a separately approved global rollout contract.';

revoke all on table public.request_segmentation_v5_gold_evaluation from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_confusion_matrix from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_segment_quality from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_quality_summary from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_mapping_integrity from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_activation_gate_status from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_activation_approval_status from public, anon, authenticated, service_role;
revoke all on table public.request_segmentation_v5_production_readiness from public, anon, authenticated, service_role;

grant select on table public.request_segmentation_v5_gold_evaluation to service_role;
grant select on table public.request_segmentation_v5_confusion_matrix to service_role;
grant select on table public.request_segmentation_v5_segment_quality to service_role;
grant select on table public.request_segmentation_v5_quality_summary to service_role;
grant select on table public.request_segmentation_v5_mapping_integrity to service_role;
grant select on table public.request_segmentation_v5_activation_gate_status to service_role;
grant select on table public.request_segmentation_v5_activation_approval_status to service_role;
grant select on table public.request_segmentation_v5_production_readiness to service_role;

do $treatment_base_postcondition$
declare
  v_gate_count integer;
  v_policy_count integer;
  v_rule_count integer;
  v_non_inert_rule_count integer;
  v_candidate_job_count integer;
  v_candidate_classification_count integer;
  v_candidate_cache_count integer;
  v_candidate_approval_count integer;
  v_view_count integer;
begin
  select count(*) into v_gate_count
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v5_20260820_treatment_focus'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and q.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_policy_count
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and not p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and p.prompt_version = 'segment_prompt_v6_20260820_treatment_focus'
    and p.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus';

  select
    count(*)::integer,
    count(*) filter (
      where r.automation_enabled
         or r.needs_human_review
         or r.price_factor is not null
         or r.max_followups <> 0
         or r.first_call_after_minutes is not null
         or r.call_sequence <> '[]'::jsonb
         or r.email_sequence <> '[]'::jsonb
    )::integer
  into v_rule_count, v_non_inert_rule_count
  from public.segment_policy_rules r
  where r.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
    and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8';

  select count(*) into v_candidate_job_count
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and j.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_classification_count
  from public.request_segment_classifications c
  where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and c.classifier_version = 'segment_classifier_v6_20260820_treatment_focus'
    and c.prompt_version = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_cache_count
  from public.segment_research_cache c
  where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
    and c.summary_json->>'classifier_version' = 'segment_classifier_v6_20260820_treatment_focus'
    and c.summary_json->>'prompt_version' = 'segment_prompt_v6_20260820_treatment_focus';

  select count(*) into v_candidate_approval_count
  from public.request_segmentation_activation_approvals a
  where a.policy_version = 'nt_policy_v5_20260820_treatment_focus_shadow'
     or a.quality_gate_version = 'nt_quality_gate_v5_20260820_treatment_focus';

  select count(*) into v_view_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in (
      'request_segmentation_v5_gold_evaluation',
      'request_segmentation_v5_confusion_matrix',
      'request_segmentation_v5_segment_quality',
      'request_segmentation_v5_quality_summary',
      'request_segmentation_v5_mapping_integrity',
      'request_segmentation_v5_activation_gate_status',
      'request_segmentation_v5_activation_approval_status',
      'request_segmentation_v5_production_readiness'
    )
    and c.reloptions @> array['security_invoker=true'];

  if v_gate_count <> 1
     or v_policy_count <> 1
     or v_rule_count <> 8
     or v_non_inert_rule_count <> 0
     or v_candidate_job_count <> 0
     or v_candidate_classification_count <> 0
     or v_candidate_cache_count <> 0
     or v_candidate_approval_count <> 0
     or v_view_count <> 8
     or not public.neontrip_treatment_evaluation_contract_is_exact()
     or to_regprocedure('public.neontrip_treatment_evaluation_contract_is_exact()') is null
     or to_regprocedure('public.neontrip_treatment_redact_segmentation_text(text,integer,text[])') is null
     or to_regprocedure('public.neontrip_treatment_evaluation_research_context(uuid)') is null
     or to_regprocedure('public.neontrip_claim_request_segmentation_treatment_evaluation(integer,text,integer)') is null
     or to_regprocedure('public.neontrip_get_request_segmentation_treatment_evaluation_payload(uuid)') is null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text,text)') is null
     or to_regprocedure('public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)') is null then
    raise exception using
      errcode = '55000',
      message = 'treatment_base_postcondition_failed',
      detail = format(
        'gate=%s policy=%s rules=%s non_inert=%s jobs=%s classifications=%s cache=%s approvals=%s views=%s',
        v_gate_count, v_policy_count, v_rule_count,
        v_non_inert_rule_count, v_candidate_job_count,
        v_candidate_classification_count, v_candidate_cache_count,
        v_candidate_approval_count, v_view_count
      );
  end if;
end;
$treatment_base_postcondition$;

-- The new 20-argument overload must be visible to PostgREST by its complete
-- named-argument set before any held pilot job is staged.
notify pgrst, 'reload schema';

commit;
