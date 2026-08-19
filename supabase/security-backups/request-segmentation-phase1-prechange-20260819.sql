-- Read-only rollback snapshot captured from Supabase project klibiejfisijpagzkxls.
-- Captured at: 2026-08-19T12:25:06.796359+00:00
-- No customer rows, domains, email addresses, or other PII are included.
--
-- Safe aggregate state at capture time:
-- active policy: nt_policy_v1_20260520_shadow, mode=shadow, rules=18,
--   automation_enabled_rules=0, human_review_rules=3
-- production readiness: followup_pricing_activation_allowed=false,
--   technical_quality_gate_passed=false, has_manual_activation_approval=false
-- master_requests: total=6745, manual_source=16, manual_accepted=16,
--   pending_like_nt8_nt9=13, accepted_nt8_nt9=152, null_segment_pending_like=5505
-- Supplemental read-only preapply aggregate (2026-08-19): manual_ops_import
--   nonempty_keys=0, duplicate_groups=0, duplicate_extra_rows=0;
--   master_requests_manual_ops_import_idempotency_key_uidx absent
-- request_segment_classifications: accepted=817, needs_review=362, rejected=5
-- request_segmentation_jobs: completed=817, needs_review=362, failed=20, cancelled=5
-- segment_research_cache: total=1730, expired=1078, shared_provider_keys=15
-- followup delivery: eligible_pending_non_payment=0, existing_attempts=2, processing=0
--
-- Relevant live trigger/row-policy state:
-- master_requests.trg_master_requests_enqueue_segmentation:
--   AFTER INSERT EXECUTE FUNCTION neontrip_enqueue_request_segmentation_trigger(), enabled
-- master_requests RLS enabled; org-scoped SELECT and ALL policies remain unchanged.
-- request_segment_classifications, request_segmentation_jobs,
-- segment_research_cache: RLS enabled, service_role ALL policy.
-- followup_delivery_attempts/events: RLS enabled, no row policies, service_role table ACL.
-- followup_queue: RLS enabled; payment-reminder exclusion is in the claim function below.
-- workflow_audit_log: RLS enabled; two existing AFTER INSERT reconciliation triggers.
--
-- Execute the restore atomically so a failed function/ACL replacement cannot leave
-- the database on a partially restored contract.
begin;
set local check_function_bodies = off;

-- Objects introduced by Phase 1 did not exist at capture time.
drop index if exists public.master_requests_manual_ops_import_idempotency_key_uidx;
alter table public.master_requests
  drop constraint if exists master_requests_manual_ops_import_idempotency_key_len_check;
drop function if exists public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text);

-- The Phase-1 record function changes its return type from uuid to jsonb, so rollback
-- must drop the replacement before restoring this exact definition.
drop function if exists public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
);

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
  p_accepted_by text default 'n8n-request-segmenter'::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy_version text;
  v_policy public.segment_policy_rules%rowtype;
  v_effective_status text;
  v_effective_risk_flags text[];
  v_effective_classifier_json jsonb;
  v_classification_id uuid;
  v_customer_id uuid;
  v_research_required boolean;
  v_has_external_url boolean;
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

  select version into v_policy_version
  from public.segment_policy_versions
  where active
  order by created_at desc
  limit 1;

  if v_policy_version is null then
    raise exception 'no_active_segment_policy';
  end if;

  if p_segment is not null then
    select * into v_policy
    from public.segment_policy_rules
    where policy_version = v_policy_version and segment = p_segment;
  end if;

  v_effective_status := p_status;
  v_effective_risk_flags := coalesce(p_risk_flags, '{}');
  v_effective_classifier_json := coalesce(p_classifier_json, '{}'::jsonb);
  v_research_required := coalesce(
    nullif(p_classifier_json #>> '{research_policy,external_research_required}', '')::boolean,
    false
  );
  v_has_external_url :=
    coalesce(jsonb_path_exists(coalesce(p_evidence_json, '[]'::jsonb), '$[*] ? (@.url like_regex "^https?://")'), false)
    or coalesce(p_firmographic_json->>'website', '') ~* '^https?://';

  if p_status = 'accepted' and v_research_required and not v_has_external_url then
    v_effective_status := 'needs_review';
    if not ('missing_external_company_evidence' = any(v_effective_risk_flags)) then
      v_effective_risk_flags := array_append(v_effective_risk_flags, 'missing_external_company_evidence');
    end if;
    if not ('external_research_required' = any(v_effective_risk_flags)) then
      v_effective_risk_flags := array_append(v_effective_risk_flags, 'external_research_required');
    end if;
    v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
      'risk_flags', to_jsonb(v_effective_risk_flags),
      'db_validation', coalesce(v_effective_classifier_json->'db_validation', '{}'::jsonb) || jsonb_build_object(
        'research_evidence_gate_applied', true,
        'reason', 'external_research_required_without_external_url_evidence'
      )
    );
  end if;

  if p_status = 'accepted' then
    if p_segment is null or p_confidence is null or not found then
      v_effective_status := 'needs_review';
    elsif p_confidence < v_policy.min_confidence or v_policy.needs_human_review then
      v_effective_status := 'needs_review';
    end if;
  end if;

  select customer_id into v_customer_id
  from public.master_requests
  where id = p_request_id;

  insert into public.request_segment_classifications (
    request_id, customer_id, input_hash, status, segment, s_kategorie,
    confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
    firmographic_json, classifier_json, policy_json, risk_flags, model,
    model_version, prompt_version, classifier_version, policy_version,
    accepted_at, accepted_by
  ) values (
    p_request_id, v_customer_id, p_input_hash, v_effective_status, p_segment,
    case when p_segment is null then null else v_policy.s_kategorie end,
    p_confidence, p_evidence_grade, left(coalesce(p_reasoning_short, ''), 1000),
    coalesce(p_reason_codes, '{}'), coalesce(p_evidence_json, '[]'::jsonb),
    coalesce(p_firmographic_json, '{}'::jsonb), v_effective_classifier_json,
    case when p_segment is null then '{}'::jsonb else to_jsonb(v_policy) end,
    v_effective_risk_flags, p_model, p_model_version, p_prompt_version,
    p_classifier_version, v_policy_version,
    case when v_effective_status = 'accepted' then now() else null end,
    case when v_effective_status = 'accepted' then coalesce(nullif(p_accepted_by, ''), 'n8n-request-segmenter') else null end
  )
  on conflict (request_id, input_hash, classifier_version) do update set
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
    accepted_by = excluded.accepted_by
  returning id into v_classification_id;

  perform public.neontrip_upsert_segment_research_cache_from_classification(
    p_request_id,
    coalesce(p_evidence_json, '[]'::jsonb),
    coalesce(p_firmographic_json, '{}'::jsonb),
    v_effective_classifier_json,
    p_model,
    p_classifier_version
  );

  if v_effective_status = 'accepted' then
    update public.master_requests set
      segment = p_segment,
      s_kategorie = v_policy.s_kategorie,
      segment_status = 'accepted',
      segment_confidence = p_confidence,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_policy_version,
      commercial_playbook = jsonb_build_object(
        'policy_version', v_policy_version,
        'segment', p_segment,
        's_kategorie', v_policy.s_kategorie,
        'price_factor', v_policy.price_factor,
        'max_followups', v_policy.max_followups,
        'first_call_after_minutes', v_policy.first_call_after_minutes,
        'sales_priority', v_policy.sales_priority,
        'automation_enabled', v_policy.automation_enabled,
        'mode', (select mode from public.segment_policy_versions where version = v_policy_version)
      ),
      updated_at = now()
    where id = p_request_id;
  else
    update public.master_requests set
      segment_status = case
        when v_effective_status = 'needs_review' then 'needs_review'
        when v_effective_status = 'error' then 'error'
        else segment_status
      end,
      segment_confidence = p_confidence,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_policy_version,
      updated_at = now()
    where id = p_request_id;
  end if;

  if p_job_id is not null then
    update public.request_segmentation_jobs set
      status = case
        when v_effective_status = 'accepted' then 'completed'
        when v_effective_status = 'needs_review' then 'needs_review'
        when v_effective_status = 'error' then 'failed'
        else 'completed'
      end,
      last_classification_id = v_classification_id,
      completed_at = case when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then now() else completed_at end,
      last_error_code = case when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null else last_error_code end,
      last_error_message = case when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null else last_error_message end,
      updated_at = now(),
      lock_owner = null,
      locked_at = null
    where id = p_job_id;
  end if;

  return v_classification_id;
end;
$function$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) is
  'Records request segment classifications and enforces DB-side research evidence gate before accepted status can persist.';

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

create or replace function public.neontrip_enqueue_request_segmentation(
  p_request_id uuid,
  p_source text default 'manual'::text,
  p_priority integer default 100
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_job_id uuid;
  v_public_id text;
begin
  select public.neontrip_compute_request_segment_input_hash(p_request_id) into v_hash;
  if v_hash is null then raise exception 'request_not_found: %', p_request_id; end if;

  select request_id into v_public_id from public.master_requests where id = p_request_id;

  insert into public.request_segmentation_jobs (
    request_id, request_public_id, input_hash, source, priority, status,
    next_attempt_at, metadata
  ) values (
    p_request_id, v_public_id, v_hash, coalesce(nullif(p_source, ''), 'manual'),
    greatest(0, least(1000, coalesce(p_priority, 100))), 'pending', now(),
    jsonb_build_object('enqueued_by', p_source, 'enqueued_at', now())
  )
  on conflict (request_id, input_hash) do update set
    updated_at = now(),
    source = excluded.source,
    priority = greatest(public.request_segmentation_jobs.priority, excluded.priority),
    next_attempt_at = case when public.request_segmentation_jobs.status in ('failed', 'cancelled') then now() else public.request_segmentation_jobs.next_attempt_at end,
    status = case when public.request_segmentation_jobs.status in ('failed', 'cancelled') then 'pending' else public.request_segmentation_jobs.status end
  returning id into v_job_id;

  update public.master_requests set
    segment_status = case when segment_status is null then 'pending' else segment_status end,
    segment_source = coalesce(segment_source, 'segmentation_queue')
  where id = p_request_id
    and (segment_status is null or segment_status in ('pending', 'legacy', 'error'));

  return v_job_id;
end;
$function$;

comment on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) is null;

revoke all on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) to service_role;

create or replace function public.neontrip_get_request_segmentation_payload(p_job_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with input as (
    select p_job_id as id
  ),
  job as (
    select j.* from input i left join public.request_segmentation_jobs j on j.id = i.id
  ),
  req as (
    select mr.* from public.master_requests mr join job j on j.request_id = mr.id where j.id is not null
  ),
  customer as (
    select mc.* from public.master_customers mc join req r on r.customer_id = mc.id
  ),
  lookup_context as (
    select
      nullif(trim(coalesce(c.company_name, c.company, '')), '') as company_name,
      nullif(split_part(lower(coalesce(c.email, '')), '@', 2), '') as email_domain
    from customer c
  ),
  research_cache as (
    select jsonb_agg(
      jsonb_build_object(
        'cache_key', src.cache_key,
        'lookup_type', src.lookup_type,
        'lookup_value', src.lookup_value,
        'provider', src.provider,
        'status', src.status,
        'evidence_json', src.evidence_json,
        'summary_json', src.summary_json,
        'fetched_at', src.fetched_at,
        'expires_at', src.expires_at
      ) order by src.lookup_type, src.fetched_at desc
    ) as items
    from public.segment_research_cache src
    join lookup_context lc on true
    where src.status = 'ok'
      and src.expires_at > now()
      and src.cache_key in (
        public.neontrip_segment_research_cache_key('email_domain', lc.email_domain),
        public.neontrip_segment_research_cache_key('domain', lc.email_domain),
        public.neontrip_segment_research_cache_key('company_name', lc.company_name)
      )
  ),
  related_history as (
    select jsonb_agg(
      jsonb_build_object(
        'id', mr.id, 'request_id', mr.request_id, 'title', mr.title,
        'description', left(coalesce(mr.description, ''), 1000),
        'segment', mr.segment, 's_kategorie', mr.s_kategorie, 'status', mr.status,
        'estimated_value', mr.estimated_value, 'final_value', mr.final_value,
        'created_at', mr.created_at
      ) order by mr.created_at desc
    ) as items
    from public.master_requests mr
    join customer c on true
    where mr.id <> (select id from req)
      and (
        mr.customer_id = c.id
        or (
          c.email is not null
          and exists (
            select 1 from public.master_customers mc2
            where mc2.id = mr.customer_id
              and split_part(lower(mc2.email), '@', 2) = split_part(lower(c.email), '@', 2)
              and split_part(lower(c.email), '@', 2) not in (
                'gmail.com','googlemail.com','web.de','gmx.de','gmx.net','hotmail.com','outlook.com',
                'icloud.com','me.com','yahoo.com','aol.com','t-online.de','freenet.de','proton.me','protonmail.com'
              )
          )
        )
      )
    limit 10
  ),
  definitions as (
    select jsonb_agg(
      jsonb_build_object(
        'segment', segment, 'label', label, 'default_s_kategorie', default_s_kategorie,
        'description', description, 'positive_signals', positive_signals,
        'negative_signals', negative_signals, 'review_threshold', review_threshold
      ) order by segment
    ) as items
    from public.segment_definitions where active
  ),
  policy as (
    select jsonb_agg(
      jsonb_build_object(
        'segment', r.segment, 's_kategorie', r.s_kategorie,
        'min_confidence', r.min_confidence, 'price_factor', r.price_factor,
        'max_followups', r.max_followups,
        'first_call_after_minutes', r.first_call_after_minutes,
        'sales_priority', r.sales_priority,
        'needs_human_review', r.needs_human_review,
        'automation_enabled', r.automation_enabled
      ) order by r.segment
    ) as rules
    from public.segment_policy_rules r
    join public.segment_policy_versions v on v.version = r.policy_version
    where v.active
  )
  select case
    when not exists (select 1 from job where id is not null) then
      jsonb_build_object('job', null, 'payload_error', jsonb_build_object(
        'code', 'segmentation_job_not_found',
        'message', 'Request segmentation job was not found for the supplied job id.',
        'job_id', p_job_id
      ))
    when not exists (select 1 from req) then
      jsonb_build_object('job', (select to_jsonb(job) from job), 'payload_error', jsonb_build_object(
        'code', 'segmentation_request_not_found',
        'message', 'Request segmentation job has no matching master_requests row.',
        'job_id', p_job_id, 'request_id', (select request_id from job)
      ))
    when not exists (select 1 from customer) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'request', (select to_jsonb(req) from req),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_customer_not_found',
          'message', 'Request segmentation payload has no matching master_customers row.',
          'job_id', p_job_id, 'request_id', (select request_id from job)
        )
      )
    else jsonb_build_object(
      'job', (select to_jsonb(job) from job),
      'request', (select to_jsonb(req) from req),
      'customer', coalesce((select to_jsonb(customer) from customer), '{}'::jsonb),
      'research_cache', coalesce((select items from research_cache), '[]'::jsonb),
      'related_history', coalesce((select items from related_history), '[]'::jsonb),
      'segment_definitions', coalesce((select items from definitions), '[]'::jsonb),
      'active_policy', jsonb_build_object(
        'version', (select version from public.segment_policy_versions where active limit 1),
        'mode', (select mode from public.segment_policy_versions where active limit 1),
        'rules', coalesce((select rules from policy), '[]'::jsonb)
      )
    )
  end;
$function$;

comment on function public.neontrip_get_request_segmentation_payload(uuid) is
  'Builds the request segmentation classifier payload. Missing job/request/customer state is returned as payload_error with job context so n8n can record a durable job failure instead of sending malformed data to AI.';

revoke all on function public.neontrip_get_request_segmentation_payload(uuid) from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_payload(uuid) to service_role;

drop function if exists public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
);
drop function if exists public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, jsonb, jsonb, jsonb, text, text
);

create function public.neontrip_upsert_segment_research_cache_from_classification(
  p_request_id uuid,
  p_evidence_json jsonb,
  p_firmographic_json jsonb,
  p_classifier_json jsonb,
  p_model text,
  p_classifier_version text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_name text;
  v_website text;
  v_domain text;
  v_email_domain text;
  v_has_external_url boolean;
  v_summary jsonb;
begin
  v_company_name := nullif(trim(coalesce(p_firmographic_json->>'company_name', '')), '');
  v_website := nullif(trim(coalesce(p_firmographic_json->>'website', '')), '');
  v_email_domain := nullif(trim(coalesce(p_firmographic_json->>'email_domain', '')), '');

  if v_website is not null then
    v_domain := split_part(
      regexp_replace(regexp_replace(lower(v_website), '^https?://', ''), '^www\.', ''),
      '/', 1
    );
  end if;

  v_has_external_url := coalesce(
    jsonb_path_exists(coalesce(p_evidence_json, '[]'::jsonb), '$[*] ? (@.url like_regex "^https?://")'),
    false
  ) or coalesce(v_website ~* '^https?://', false);

  if not v_has_external_url then return; end if;

  v_summary := jsonb_build_object(
    'request_id', p_request_id,
    'firmographic', coalesce(p_firmographic_json, '{}'::jsonb),
    'classifier_version', p_classifier_version,
    'model', p_model,
    'classifier_segment', p_classifier_json->>'segment',
    'classifier_confidence', p_classifier_json->>'confidence',
    'cached_from', 'request_segmentation_classification',
    'cached_at', now()
  );

  if v_email_domain is not null then
    insert into public.segment_research_cache (
      cache_key, lookup_type, lookup_value, provider, status, evidence_json,
      summary_json, fetched_at, expires_at
    ) values (
      public.neontrip_segment_research_cache_key('email_domain', v_email_domain),
      'email_domain', split_part(public.neontrip_segment_research_cache_key('email_domain', v_email_domain), ':', 2),
      'openai_web_search', 'ok', coalesce(p_evidence_json, '[]'::jsonb),
      v_summary, now(), now() + interval '30 days'
    ) on conflict (cache_key) do update set
      provider=excluded.provider, status=excluded.status,
      evidence_json=excluded.evidence_json, summary_json=excluded.summary_json,
      fetched_at=excluded.fetched_at, expires_at=excluded.expires_at;
  end if;

  if v_domain is not null then
    insert into public.segment_research_cache (
      cache_key, lookup_type, lookup_value, provider, status, evidence_json,
      summary_json, fetched_at, expires_at
    ) values (
      public.neontrip_segment_research_cache_key('domain', v_domain),
      'domain', split_part(public.neontrip_segment_research_cache_key('domain', v_domain), ':', 2),
      'openai_web_search', 'ok', coalesce(p_evidence_json, '[]'::jsonb),
      v_summary, now(), now() + interval '30 days'
    ) on conflict (cache_key) do update set
      provider=excluded.provider, status=excluded.status,
      evidence_json=excluded.evidence_json, summary_json=excluded.summary_json,
      fetched_at=excluded.fetched_at, expires_at=excluded.expires_at;
  end if;

  if v_company_name is not null then
    insert into public.segment_research_cache (
      cache_key, lookup_type, lookup_value, provider, status, evidence_json,
      summary_json, fetched_at, expires_at
    ) values (
      public.neontrip_segment_research_cache_key('company_name', v_company_name),
      'company_name', regexp_replace(lower(trim(v_company_name)), '\s+', ' ', 'g'),
      'openai_web_search', 'ok', coalesce(p_evidence_json, '[]'::jsonb),
      v_summary, now(), now() + interval '30 days'
    ) on conflict (cache_key) do update set
      provider=excluded.provider, status=excluded.status,
      evidence_json=excluded.evidence_json, summary_json=excluded.summary_json,
      fetched_at=excluded.fetched_at, expires_at=excluded.expires_at;
  end if;
end;
$function$;

comment on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, jsonb, jsonb, jsonb, text, text
) is
  'Stores externally evidenced firmographic classification research so future segmenting can reuse audited company/domain evidence.';

revoke all on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, jsonb, jsonb, jsonb, text, text
) to service_role;

-- Exact live pre-change per-request automation-decision contract and ACL.
create or replace function public.neontrip_get_request_segmentation_automation_decision(p_request_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with request_row as (
    select mr.*
    from public.master_requests mr
    where mr.id = p_request_id
    limit 1
  ),
  latest_classification as (
    select c.*
    from public.request_segment_classifications c
    where c.request_id = p_request_id
    order by c.created_at desc
    limit 1
  ),
  accepted_classification as (
    select c.*
    from public.request_segment_classifications c
    where c.request_id = p_request_id
      and c.status = 'accepted'
    order by c.accepted_at desc nulls last, c.created_at desc
    limit 1
  ),
  active_policy as (
    select *
    from public.segment_policy_versions
    where active
    limit 1
  ),
  policy_rule as (
    select r.*
    from public.segment_policy_rules r
    join active_policy p on p.version = r.policy_version
    join request_row mr on mr.segment = r.segment
    limit 1
  ),
  readiness as (
    select *
    from public.request_segmentation_production_readiness
    limit 1
  ),
  checks as (
    select
      exists(select 1 from request_row) as request_exists,
      exists(select 1 from accepted_classification) as has_accepted_classification,
      coalesce((select segment_status = 'accepted' from request_row), false) as request_segment_accepted,
      coalesce((select segment is not null from request_row), false) as request_has_segment,
      coalesce((select s_kategorie in ('S1', 'S2', 'S3', 'S4') from request_row), false) as request_has_valid_s_kategorie,
      coalesce((select mr.segment = ac.segment from request_row mr cross join accepted_classification ac), false) as request_matches_accepted_classification,
      coalesce((select followup_pricing_activation_allowed from readiness), false) as readiness_allows_activation,
      coalesce((select mode from active_policy), 'missing') as policy_mode,
      coalesce((select mode in ('followup_canary', 'followup_live', 'pricing_canary', 'pricing_live') from active_policy), false) as mode_allows_followup,
      coalesce((select mode in ('pricing_canary', 'pricing_live') from active_policy), false) as mode_allows_pricing,
      coalesce((select automation_enabled from policy_rule), false) as policy_rule_automation_enabled,
      coalesce((select needs_human_review from policy_rule), true) as policy_rule_needs_human_review,
      coalesce((select max_followups > 0 from policy_rule), false) as policy_rule_has_followup,
      coalesce((select price_factor is not null from policy_rule), false) as policy_rule_has_price_factor,
      coalesce((select commercial_playbook->>'automation_enabled' = 'true' from request_row), false) as request_playbook_automation_enabled
  ),
  decisions as (
    select
      (
        request_exists
        and has_accepted_classification
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and request_matches_accepted_classification
        and readiness_allows_activation
        and mode_allows_followup
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_followup
        and request_playbook_automation_enabled
      ) as can_use_for_followup,
      (
        request_exists
        and has_accepted_classification
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and request_matches_accepted_classification
        and readiness_allows_activation
        and mode_allows_pricing
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_price_factor
        and request_playbook_automation_enabled
      ) as can_use_for_pricing
    from checks
  ),
  reason_codes as (
    select array_remove(array[
      case when not request_exists then 'request_not_found' end,
      case when request_exists and not has_accepted_classification then 'no_accepted_segmentation_classification' end,
      case when request_exists and not request_segment_accepted then 'request_segment_status_not_accepted' end,
      case when request_exists and not request_has_segment then 'request_segment_missing' end,
      case when request_exists and not request_has_valid_s_kategorie then 'request_s_kategorie_missing_or_invalid' end,
      case when request_exists and has_accepted_classification and not request_matches_accepted_classification then 'request_segment_mismatch_latest_accepted_classification' end,
      case when not readiness_allows_activation then 'production_readiness_or_manual_approval_blocked' end,
      case when not mode_allows_followup then 'active_policy_mode_does_not_allow_followup' end,
      case when not mode_allows_pricing then 'active_policy_mode_does_not_allow_pricing' end,
      case when request_exists and not policy_rule_automation_enabled then 'policy_rule_automation_disabled' end,
      case when request_exists and policy_rule_needs_human_review then 'policy_rule_requires_human_review' end,
      case when request_exists and not policy_rule_has_followup then 'policy_rule_has_no_followup_plan' end,
      case when request_exists and not policy_rule_has_price_factor then 'policy_rule_has_no_price_factor' end,
      case when request_exists and not request_playbook_automation_enabled then 'request_commercial_playbook_automation_disabled' end
    ], null) as items
    from checks
  )
  select jsonb_build_object(
    'request_id', p_request_id,
    'public_request_id', (select request_id from request_row),
    'generated_at', now(),
    'decision_status', case
      when (select can_use_for_followup or can_use_for_pricing from decisions) then 'allowed'
      else 'blocked'
    end,
    'can_use_for_followup', (select can_use_for_followup from decisions),
    'can_use_for_pricing', (select can_use_for_pricing from decisions),
    'reason_codes', coalesce((select to_jsonb(items) from reason_codes), '[]'::jsonb),
    'readiness', jsonb_build_object(
      'followup_pricing_activation_allowed', coalesce((select followup_pricing_activation_allowed from readiness), false),
      'blocking_reasons', coalesce((select to_jsonb(blocking_reasons) from readiness), '[]'::jsonb),
      'technical_quality_gate_passed', coalesce((select technical_quality_gate_passed from readiness), false),
      'has_manual_activation_approval', coalesce((select has_manual_activation_approval from readiness), false)
    ),
    'request_segment_state', jsonb_build_object(
      'segment_status', (select segment_status from request_row),
      'segment', (select segment from request_row),
      's_kategorie', (select s_kategorie from request_row),
      'segment_confidence', (select segment_confidence from request_row),
      'segment_policy_version', (select segment_policy_version from request_row),
      'segment_classified_at', (select segment_classified_at from request_row)
    ),
    'classification', jsonb_build_object(
      'latest_classification_id', (select id from latest_classification),
      'latest_status', (select status from latest_classification),
      'accepted_classification_id', (select id from accepted_classification),
      'accepted_segment', (select segment from accepted_classification),
      'accepted_confidence', (select confidence from accepted_classification),
      'accepted_evidence_grade', (select evidence_grade from accepted_classification),
      'accepted_at', (select accepted_at from accepted_classification)
    ),
    'policy', jsonb_build_object(
      'active_policy_version', (select version from active_policy),
      'active_policy_mode', (select mode from active_policy),
      'rule_automation_enabled', coalesce((select automation_enabled from policy_rule), false),
      'rule_needs_human_review', coalesce((select needs_human_review from policy_rule), true),
      'rule_max_followups', (select max_followups from policy_rule),
      'rule_first_call_after_minutes', (select first_call_after_minutes from policy_rule),
      'rule_sales_priority', (select sales_priority from policy_rule),
      'rule_has_price_factor', coalesce((select price_factor is not null from policy_rule), false)
    ),
    'allowed_playbook', case
      when (select can_use_for_followup or can_use_for_pricing from decisions) then
        jsonb_build_object(
          'segment', (select segment from request_row),
          's_kategorie', (select s_kategorie from request_row),
          'policy_version', (select version from active_policy),
          'mode', (select mode from active_policy),
          'sales_priority', (select sales_priority from policy_rule),
          'max_followups', case when (select can_use_for_followup from decisions) then (select max_followups from policy_rule) else 0 end,
          'first_call_after_minutes', case when (select can_use_for_followup from decisions) then (select first_call_after_minutes from policy_rule) else null end,
          'pricing_enabled', (select can_use_for_pricing from decisions),
          'price_factor', case when (select can_use_for_pricing from decisions) then (select price_factor from policy_rule) else null end,
          'automation_enabled', true
        )
      else
        jsonb_build_object(
          'automation_enabled', false,
          'pricing_enabled', false,
          'max_followups', 0,
          'price_factor', null
        )
    end
  );
$function$;

comment on function public.neontrip_get_request_segmentation_automation_decision(uuid) is
  'Service-role-only deterministic consumer contract for using request segmentation in downstream follow-up or pricing. Returns blocked decisions until production readiness, manual approval, accepted classification and deterministic policy gates all pass.';

revoke all on function public.neontrip_get_request_segmentation_automation_decision(uuid) from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_automation_decision(uuid) to service_role;

create or replace function public.claim_followup_delivery_candidate(
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 3600);
  candidate public.followup_queue%rowtype;
  attempt public.followup_delivery_attempts%rowtype;
  stale record;
  new_claim_token uuid := gen_random_uuid();
  candidate_email text;
begin
  if safe_execution_id is null then raise exception 'workflow_execution_id is required'; end if;

  for stale in
    update public.followup_delivery_attempts as existing
      set status='delivery_unknown', claim_token=null, lease_until=null,
          last_error_code='stale_processing_lease', updated_at=now()
    where existing.status='processing' and existing.lease_until<=now()
    returning existing.*
  loop
    update public.followup_queue set
      status='human_review', processing_started_at=null,
      last_error='A prior Outlook follow-up attempt lost confirmation; manual review is required.',
      last_error_at=now(), email_context_decision='human_review',
      email_context_reason='stale_followup_delivery_lease'
    where id=stale.followup_queue_id and status='processing';

    insert into public.followup_delivery_events (
      attempt_id,event_key,event_type,workflow_execution_id,metadata
    ) values (
      stale.id, 'followup-delivery:'||stale.id::text||':delivery-unknown:stale-lease',
      'delivery_unknown', safe_execution_id,
      jsonb_build_object('reason','stale_processing_lease')
    ) on conflict (event_key) do nothing;
  end loop;

  select queued.* into candidate
  from public.followup_queue as queued
  where queued.status='pending'
    and queued.scheduled_for<=now()
    and queued.cancelled_at is null
    and queued.sent_at is null
    and queued.followup_type not like 'payment_reminder%'
    and not exists (
      select 1 from public.followup_delivery_attempts as existing
      where existing.followup_queue_id=queued.id
    )
  order by coalesce(queued.is_urgent,false) desc, queued.scheduled_for asc, queued.id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('route','stop','reason','no_candidate','automatic_retry_allowed',false);
  end if;

  candidate_email := lower(btrim(coalesce(candidate.customer_email, '')));
  if candidate.request_id is null
     or candidate_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or candidate_email ~ '@(neontrip\.de|riesenobjekte\.de)$'
     or candidate_email ~ '@example\.'
     or candidate_email ~ '@neontrip\.test$' then
    insert into public.followup_delivery_attempts (
      followup_queue_id,status,claim_token,lease_until,last_execution_id,block_reason
    ) values (
      candidate.id,'blocked',null,null,safe_execution_id,'invalid_candidate_identity_or_recipient'
    ) returning * into attempt;

    update public.followup_queue set
      status='human_review', processing_started_at=null,
      last_error='Follow-up candidate identity or recipient failed deterministic validation.',
      last_error_at=now(), email_context_decision='human_review',
      email_context_reason='invalid_candidate_identity_or_recipient'
    where id=candidate.id;

    insert into public.followup_delivery_events (
      attempt_id,event_key,event_type,workflow_execution_id,metadata
    ) values (
      attempt.id,'followup-delivery:'||attempt.id::text||':blocked','blocked',
      safe_execution_id,jsonb_build_object('reason','invalid_candidate_identity_or_recipient')
    );

    return jsonb_build_object(
      'route','stop','reason','candidate_blocked_for_review',
      'followup_queue_id',candidate.id,'automatic_send_allowed',false
    );
  end if;

  insert into public.followup_delivery_attempts (
    followup_queue_id,status,claim_token,claimed_at,lease_until,last_execution_id
  ) values (
    candidate.id,'processing',new_claim_token,now(),
    now()+make_interval(secs=>safe_lease_seconds),safe_execution_id
  ) returning * into attempt;

  update public.followup_queue set
    status='processing', processing_started_at=now(), last_error=null
  where id=candidate.id;

  insert into public.followup_delivery_events (
    attempt_id,event_key,event_type,workflow_execution_id,metadata
  ) values (
    attempt.id,'followup-delivery:'||attempt.id::text||':claimed','claimed',
    safe_execution_id,jsonb_build_object(
      'lease_seconds',safe_lease_seconds,'copy_mode','deterministic',
      'ai_copy_allowed',false,'automatic_send_allowed',true
    )
  );

  return jsonb_build_object(
    'route','process','reason','claimed','attempt_id',attempt.id,
    'claim_token',attempt.claim_token,'followup_queue_id',candidate.id,
    'candidate',to_jsonb(candidate),'copy_mode','deterministic',
    'ai_copy_allowed',false,'automatic_send_allowed',true,
    'automatic_retry_allowed',false
  );
end;
$function$;

comment on function public.claim_followup_delivery_candidate(text, integer) is
  'Claims at most one due follow-up under a database row lock and returns deterministic-copy context; never selects payment reminders.';

revoke all on function public.claim_followup_delivery_candidate(text, integer) from public, anon, authenticated;
grant execute on function public.claim_followup_delivery_candidate(text, integer) to service_role;

-- Drop the Phase-1 domain helper only after every restored SQL/PLpgSQL function
-- that referenced it has been replaced, otherwise PostgreSQL can reject rollback
-- on a dependency before any restoration occurs.
drop function if exists public.neontrip_request_segmentation_domain_facts(text);

-- The per-request automation authority above is restored to its exact prechange
-- definition, ACL, and COMMENT.
-- The unchanged global diagnostic view remains a single row:
-- public.request_segmentation_production_readiness.followup_pricing_activation_allowed.

commit;
