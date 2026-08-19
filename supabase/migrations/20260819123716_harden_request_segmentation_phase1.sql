-- Phase 1 keeps classification evidence/jobs useful while making every operational
-- projection fail closed. The live pre-change definitions are captured in
-- supabase/security-backups/request-segmentation-phase1-prechange-20260819.sql.

begin;

-- Manual-import idempotency must be enforced by the database, not by the
-- read-before-write application lookup alone. Keep the exact opaque key small
-- enough for a deterministic B-tree entry; current callers generate UUID-size
-- values, and NULL/blank legacy rows intentionally remain outside the contract.
do $manual_import_idempotency_precondition$
declare
  v_duplicate_groups bigint;
  v_duplicate_extra_rows bigint;
  v_max_key_bytes integer;
begin
  with import_keys as (
    select nullif(btrim(attribution_raw->>'idempotency_key'), '') as idempotency_key
    from public.master_requests
    where form_id = 'manual_ops_import'
  ),
  nonempty_keys as (
    select idempotency_key
    from import_keys
    where idempotency_key is not null
  ),
  duplicate_keys as (
    select idempotency_key, count(*) as row_count
    from nonempty_keys
    group by idempotency_key
    having count(*) > 1
  )
  select
    (select count(*) from duplicate_keys),
    coalesce((select sum(row_count - 1) from duplicate_keys), 0),
    coalesce((select max(octet_length(idempotency_key)) from nonempty_keys), 0)
  into v_duplicate_groups, v_duplicate_extra_rows, v_max_key_bytes;

  if v_duplicate_groups > 0 then
    raise exception using
      errcode = '23505',
      message = 'manual_ops_import_idempotency_precondition_failed',
      detail = format(
        'duplicate_groups=%s duplicate_extra_rows=%s',
        v_duplicate_groups,
        v_duplicate_extra_rows
      );
  end if;

  if v_max_key_bytes > 512 then
    raise exception using
      errcode = '22001',
      message = 'manual_ops_import_idempotency_key_too_long_precondition',
      detail = format('max_key_bytes=%s limit_bytes=512', v_max_key_bytes);
  end if;
end;
$manual_import_idempotency_precondition$;

alter table public.master_requests
  add constraint master_requests_manual_ops_import_idempotency_key_len_check
  check (
    form_id is distinct from 'manual_ops_import'
    or nullif(btrim(attribution_raw->>'idempotency_key'), '') is null
    or octet_length(btrim(attribution_raw->>'idempotency_key')) <= 512
  );

create unique index master_requests_manual_ops_import_idempotency_key_uidx
  on public.master_requests ((btrim(attribution_raw->>'idempotency_key')))
  where form_id = 'manual_ops_import'
    and nullif(btrim(attribution_raw->>'idempotency_key'), '') is not null;

comment on index public.master_requests_manual_ops_import_idempotency_key_uidx is
  'Atomically reserves each nonempty manual_ops_import idempotency key so concurrent retries cannot create duplicate requests or Trello projections.';

create or replace function public.neontrip_request_segmentation_domain_facts(p_value text)
returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  with source as (
    select lower(trim(
      case
        when lower(trim(coalesce(p_value, ''))) ~ '^https?://'
          then coalesce(p_value, '')
        when position('@' in coalesce(p_value, '')) > 0
          then split_part(coalesce(p_value, ''), '@', 2)
        else coalesce(p_value, '')
      end
    )) as value
  ),
  without_scheme as (
    select regexp_replace(value, '^https?://', '') as value
    from source
  ),
  without_www as (
    select regexp_replace(value, '^www\.', '') as value
    from without_scheme
  ),
  host_part as (
    select split_part(split_part(split_part(value, '/', 1), '?', 1), '#', 1) as value
    from without_www
  ),
  normalized as (
    select nullif(
      regexp_replace(
        regexp_replace(value, ':[0-9]+$', ''),
        '\.$',
        ''
      ),
      ''
    ) as email_domain
    from host_part
  ),
  validated as (
    select
      email_domain,
      coalesce(
        length(email_domain) <= 253
        and email_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$',
        false
      ) as is_valid_dns_host
    from normalized
  ),
  facts as (
    select
      email_domain,
      is_valid_dns_host,
      coalesce(
        is_valid_dns_host and exists (
          select 1
          from unnest(array[
            'gmail.com', 'googlemail.com', 'web.de',
            'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com',
            'hotmail.com', 'hotmail.de', 'hotmail.co.uk', 'hotmail.fr',
            'hotmail.it', 'hotmail.es', 'outlook.com', 'outlook.de',
            'live.com', 'live.de', 'live.co.uk', 'msn.com',
            'icloud.com', 'icloud.de', 'me.com', 'mac.com',
            'yahoo.com', 'yahoo.de', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.it',
            'yahoo.es', 'ymail.com', 'rocketmail.com', 'aol.com', 'aol.de',
            't-online.de', 'freenet.de', 'arcor.de', 'online.de',
            'kabelmail.de', 'bluewin.ch', 'sunrise.ch', 'hispeed.ch',
            'aon.at', 'chello.at', 'magenta.at', 'vodafone.de', 'o2online.de',
            '1und1.de', 'proton.me', 'protonmail.com', 'pm.me',
            'mail.de', 'mail.com', 'email.com', 'email.de', 'posteo.de',
            'mailbox.org', 'fastmail.com', 'hey.com', 'zoho.com',
            'yandex.com', 'yandex.ru', 'gmail.con'
          ]::text[]) as providers(domain)
          where email_domain = providers.domain
             or right(email_domain, length(providers.domain) + 1) = '.' || providers.domain
        ),
        false
      ) as is_freemail,
      coalesce(
        is_valid_dns_host and exists (
          select 1
          from unnest(array[
            'gmail.com', 'googlemail.com', 'web.de',
            'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com',
            'hotmail.com', 'hotmail.de', 'hotmail.co.uk', 'hotmail.fr',
            'hotmail.it', 'hotmail.es', 'outlook.com', 'outlook.de',
            'live.com', 'live.de', 'live.co.uk', 'msn.com',
            'icloud.com', 'icloud.de', 'me.com', 'mac.com',
            'yahoo.com', 'yahoo.de', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.it',
            'yahoo.es', 'ymail.com', 'rocketmail.com', 'aol.com', 'aol.de',
            't-online.de', 'freenet.de', 'arcor.de', 'online.de',
            'kabelmail.de', 'bluewin.ch', 'sunrise.ch', 'hispeed.ch',
            'aon.at', 'chello.at', 'magenta.at', 'vodafone.de', 'o2online.de',
            '1und1.de', 'proton.me', 'protonmail.com', 'pm.me',
            'mail.de', 'mail.com', 'email.com', 'email.de', 'posteo.de',
            'mailbox.org', 'fastmail.com', 'hey.com', 'zoho.com',
            'yandex.com', 'yandex.ru', 'gmail.con', 'onmicrosoft.com',
            'privaterelay.appleid.com', 'duck.com', 'simplelogin.com',
            'simplelogin.co', 'aleeas.com', 'slmail.me', 'mozmail.com',
            'anonaddy.me'
          ]::text[]) as providers(domain)
          where email_domain = providers.domain
             or right(email_domain, length(providers.domain) + 1) = '.' || providers.domain
        ),
        false
      ) as is_shared_provider
    from validated
  )
  select jsonb_build_object(
    'email_domain', email_domain,
    'is_valid_dns_host', is_valid_dns_host,
    'is_freemail', is_freemail,
    'is_shared_provider', is_shared_provider,
    'email_domain_cache_allowed', is_valid_dns_host and not is_shared_provider
  )
  from facts;
$function$;

comment on function public.neontrip_request_segmentation_domain_facts(text) is
  'Normalizes an email/domain and deterministically blocks freemail, shared-provider, and privacy-relay domains from domain-keyed research reuse.';

revoke all on function public.neontrip_request_segmentation_domain_facts(text) from public, anon, authenticated;
grant execute on function public.neontrip_request_segmentation_domain_facts(text) to service_role;

drop function if exists public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, jsonb, jsonb, jsonb, text, text
);

create function public.neontrip_upsert_segment_research_cache_from_classification(
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

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_evidence_json) = 'array' then p_evidence_json
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
    'classifier_version', p_classifier_version,
    'model', p_model,
    'classifier_segment', p_classifier_json->>'segment',
    'classifier_confidence', p_classifier_json->>'confidence',
    'effective_status', p_effective_status,
    'policy_mode', p_policy_mode,
    'evidence_grade', p_evidence_grade,
    'verified_company_identity', true,
    'evidence_website_domain_verified', true,
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
      coalesce(p_evidence_json, '[]'::jsonb), v_summary, now(), now() + interval '30 days'
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
    coalesce(p_evidence_json, '[]'::jsonb), v_summary, now(), now() + interval '30 days'
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
    'openai_web_search', 'ok', coalesce(p_evidence_json, '[]'::jsonb),
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
  'Caches only effective accepted live-mode classifications with strong same-domain external evidence and an AI identity matching the stored customer company.';

revoke all on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) to service_role;

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
    select j.*
    from input i
    left join public.request_segmentation_jobs j on j.id = i.id
  ),
  req as (
    select mr.*
    from public.master_requests mr
    join job j on j.request_id = mr.id
    where j.id is not null
  ),
  customer as (
    select mc.*
    from public.master_customers mc
    join req r on r.customer_id = mc.id
  ),
  lookup_context as (
    select
      nullif(trim(coalesce(c.company_name, c.company, '')), '') as company_name,
      nullif(split_part(lower(coalesce(c.email, '')), '@', 2), '') as email_domain
    from customer c
  ),
  domain_facts as (
    select public.neontrip_request_segmentation_domain_facts(lc.email_domain) as facts
    from lookup_context lc
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
      )
      order by src.lookup_type, src.fetched_at desc
    ) as items
    from public.segment_research_cache src
    join lookup_context lc on true
    join domain_facts df on true
    where src.status = 'ok'
      and src.expires_at > now()
      and src.summary_json->>'effective_status' = 'accepted'
      and src.summary_json->>'verified_company_identity' = 'true'
      and src.summary_json->>'evidence_website_domain_verified' = 'true'
      and (
        (
          lc.company_name is not null
          and src.cache_key = public.neontrip_segment_research_cache_key('company_name', lc.company_name)
        )
        or (
          coalesce((df.facts->>'email_domain_cache_allowed')::boolean, false)
          and src.cache_key in (
            public.neontrip_segment_research_cache_key('email_domain', lc.email_domain),
            public.neontrip_segment_research_cache_key('domain', lc.email_domain)
          )
        )
      )
  ),
  related_history_rows as (
    select mr.*
    from public.master_requests mr
    join customer c on mr.customer_id = c.id
    where mr.id <> (select id from req)
    order by mr.created_at desc, mr.id
    limit 10
  ),
  related_history as (
    select jsonb_agg(
      jsonb_build_object(
        'id', mr.id,
        'request_id', mr.request_id,
        'title', mr.title,
        'description', left(coalesce(mr.description, ''), 1000),
        'segment', mr.segment,
        's_kategorie', mr.s_kategorie,
        'status', mr.status,
        'estimated_value', mr.estimated_value,
        'final_value', mr.final_value,
        'created_at', mr.created_at
      )
      order by mr.created_at desc
    ) as items
    from related_history_rows mr
  ),
  definitions as (
    select jsonb_agg(
      jsonb_build_object(
        'segment', segment,
        'label', label,
        'default_s_kategorie', default_s_kategorie,
        'description', description,
        'positive_signals', positive_signals,
        'negative_signals', negative_signals,
        'review_threshold', review_threshold
      )
      order by segment
    ) as items
    from public.segment_definitions
    where active
  ),
  policy as (
    select jsonb_agg(
      jsonb_build_object(
        'segment', r.segment,
        's_kategorie', r.s_kategorie,
        'min_confidence', r.min_confidence,
        'price_factor', r.price_factor,
        'max_followups', r.max_followups,
        'first_call_after_minutes', r.first_call_after_minutes,
        'sales_priority', r.sales_priority,
        'needs_human_review', r.needs_human_review,
        'automation_enabled', r.automation_enabled
      )
      order by r.segment
    ) as rules
    from public.segment_policy_rules r
    join public.segment_policy_versions v on v.version = r.policy_version
    where v.active
  )
  select case
    when not exists (select 1 from job where id is not null) then
      jsonb_build_object(
        'job', null,
        'payload_error', jsonb_build_object(
          'code', 'segmentation_job_not_found',
          'message', 'Request segmentation job was not found for the supplied job id.',
          'job_id', p_job_id
        )
      )
    when not exists (select 1 from req) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_request_not_found',
          'message', 'Request segmentation job has no matching master_requests row.',
          'job_id', p_job_id,
          'request_id', (select request_id from job)
        )
      )
    when not exists (select 1 from customer) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'request', (select to_jsonb(req) from req),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_customer_not_found',
          'message', 'Request segmentation payload has no matching master_customers row.',
          'job_id', p_job_id,
          'request_id', (select request_id from job)
        )
      )
    else
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'request', (select to_jsonb(req) from req),
        'customer', coalesce((select to_jsonb(customer) from customer), '{}'::jsonb),
        'domain_facts', coalesce(
          (select facts from domain_facts),
          jsonb_build_object(
            'email_domain', null,
            'is_valid_dns_host', false,
            'is_freemail', false,
            'is_shared_provider', false,
            'email_domain_cache_allowed', false
          )
        ),
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
  'Returns deterministic domain facts and only verified accepted research cache entries; shared-provider domain keys are never read.';

revoke all on function public.neontrip_get_request_segmentation_payload(uuid) from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_payload(uuid) to service_role;

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

  if v_hash is null then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  select request_id into v_public_id
  from public.master_requests
  where id = p_request_id;

  insert into public.request_segmentation_jobs (
    request_id, request_public_id, input_hash, source, priority, status,
    next_attempt_at, metadata
  ) values (
    p_request_id,
    v_public_id,
    v_hash,
    coalesce(nullif(p_source, ''), 'manual'),
    greatest(0, least(1000, coalesce(p_priority, 100))),
    'pending',
    now(),
    jsonb_build_object('enqueued_by', p_source, 'enqueued_at', now())
  )
  on conflict (request_id, input_hash) do update set
    updated_at = now(),
    source = excluded.source,
    priority = greatest(public.request_segmentation_jobs.priority, excluded.priority),
    next_attempt_at = case
      when public.request_segmentation_jobs.status in ('failed', 'cancelled') then now()
      else public.request_segmentation_jobs.next_attempt_at
    end,
    status = case
      when public.request_segmentation_jobs.status in ('failed', 'cancelled') then 'pending'
      else public.request_segmentation_jobs.status
    end
  returning id into v_job_id;

  update public.master_requests
  set
    segment = case when segment in ('NT-8', 'NT-9') then null else segment end,
    s_kategorie = case when segment in ('NT-8', 'NT-9') then null else s_kategorie end,
    segment_status = 'pending',
    segment_confidence = case when segment in ('NT-8', 'NT-9') then null else segment_confidence end,
    segment_source = 'segmentation_queue',
    segment_classified_at = case when segment in ('NT-8', 'NT-9') then null else segment_classified_at end,
    segment_policy_version = case when segment in ('NT-8', 'NT-9') then null else segment_policy_version end,
    commercial_playbook = case when segment in ('NT-8', 'NT-9') then '{}'::jsonb else commercial_playbook end,
    updated_at = now()
  where id = p_request_id
    and coalesce(segment_source, '') !~ '^manual_'
    and coalesce(segment_status, 'pending') in ('pending', 'legacy', 'error');

  return v_job_id;
end;
$function$;

comment on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) is
  'Queues segmentation without synthesizing or retaining pending NT-8/NT-9 fallbacks and never mutates manual_* authority.';

revoke all on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) to service_role;

create or replace function public.neontrip_set_manual_request_segment(
  p_request_id uuid,
  p_segment text,
  p_source text default 'manual_ops_portal',
  p_actor jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.master_requests%rowtype;
  v_segment text := upper(trim(coalesce(p_segment, '')));
  v_source text := lower(trim(coalesce(p_source, '')));
  v_s_kategorie text;
  v_label text;
  v_now timestamptz := now();
  v_audit_id uuid;
  v_previous jsonb;
begin
  if v_source !~ '^manual_[a-z0-9_]+$' then
    raise exception 'invalid_manual_segment_source: %', p_source;
  end if;

  if jsonb_typeof(coalesce(p_actor, '{}'::jsonb)) <> 'object' then
    raise exception 'manual_segment_actor_must_be_object';
  end if;

  select default_s_kategorie, label
  into v_s_kategorie, v_label
  from public.segment_definitions
  where segment = v_segment
    and active
  limit 1;

  if not found then
    raise exception 'invalid_segment: %', p_segment;
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  -- An import retry carries the operator choice frozen at initial insert time.
  -- Under this row lock it may promote only neutral/non-manual state. A portal
  -- correction remains an explicit last writer, while a stale import can at
  -- most fail and be retried after the application re-reads current authority.
  if v_source = 'manual_ops_import'
     and lower(btrim(coalesce(v_request.segment_source, ''))) ~ '^manual_[a-z0-9_]+$' then
    raise exception using
      errcode = 'P0001',
      message = 'manual_ops_import_existing_manual_authority',
      detail = 'manual_ops_import cannot overwrite an existing manual_* segment authority';
  end if;

  v_previous := jsonb_build_object(
    'segment', v_request.segment,
    's_kategorie', v_request.s_kategorie,
    'segment_status', v_request.segment_status,
    'segment_confidence', v_request.segment_confidence,
    'segment_source', v_request.segment_source,
    'segment_classified_at', v_request.segment_classified_at,
    'segment_policy_version', v_request.segment_policy_version
  );

  update public.master_requests
  set
    segment = v_segment,
    s_kategorie = v_s_kategorie,
    segment_status = 'accepted',
    segment_confidence = null,
    segment_source = v_source,
    segment_classified_at = v_now,
    segment_policy_version = 'manual_override_v1_20260819',
    commercial_playbook = '{}'::jsonb,
    updated_at = v_now
  where id = p_request_id;

  insert into public.workflow_audit_log (
    document_id, workflow_name, action, status, metadata
  ) values (
    v_request.request_id,
    'customer_records_console',
    'customer_request_segment_override',
    'success',
    jsonb_build_object(
      'request_id', v_request.request_id,
      'request_uuid', p_request_id,
      'summary', 'Segment manuell bestätigt: ' || v_label,
      'reason', nullif(left(trim(coalesce(p_reason, '')), 1000), ''),
      'changed_fields', jsonb_build_array(
        'master_requests.segment',
        'master_requests.s_kategorie',
        'master_requests.segment_status',
        'master_requests.segment_confidence',
        'master_requests.segment_source',
        'master_requests.commercial_playbook'
      ),
      'actor_label', coalesce(
        nullif(trim(coalesce(p_actor->>'operatorName', '')), ''),
        nullif(trim(coalesce(p_actor->>'mode', '')), ''),
        nullif(trim(coalesce(p_actor->>'host', '')), '')
      ),
      'actor', coalesce(p_actor, '{}'::jsonb),
      'previous_segment', v_previous,
      'next_segment', jsonb_build_object(
        'segment', v_segment,
        'label', v_label,
        's_kategorie', v_s_kategorie,
        'segment_status', 'accepted',
        'segment_confidence', null,
        'segment_source', v_source,
        'segment_classified_at', v_now,
        'segment_policy_version', 'manual_override_v1_20260819'
      )
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'public_request_id', v_request.request_id,
    'segment', v_segment,
    's_kategorie', v_s_kategorie,
    'segment_status', 'accepted',
    'segment_confidence', null,
    'segment_source', v_source,
    'segment_classified_at', v_now,
    'segment_policy_version', 'manual_override_v1_20260819',
    'authoritative', true,
    'audit_id', v_audit_id
  );
end;
$function$;

comment on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text) is
  'Atomically stores and audits a manual_* authoritative segment without representing human certainty as model confidence; manual_ops_import cannot overwrite existing manual_* authority under the request row lock.';

revoke all on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text) to service_role;

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
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy_version text;
  v_policy_mode text;
  v_policy public.segment_policy_rules%rowtype;
  v_policy_found boolean := false;
  v_effective_status text;
  v_effective_segment text;
  v_effective_risk_flags text[];
  v_classifier_risk_flags text[];
  v_effective_classifier_json jsonb;
  v_classification_id uuid;
  v_request public.master_requests%rowtype;
  v_current_input_hash text;
  v_input_hash_current boolean;
  v_research_required boolean;
  v_has_external_url boolean;
  v_research_cache_written boolean := false;
  v_manual_authoritative boolean;
  v_existing_authoritative boolean;
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

  -- The request hash also covers customer fields. Hold both source rows stable
  -- through validation/projection so a concurrently changed payload cannot win.
  perform 1
  from public.master_customers
  where id = v_request.customer_id
  for share;

  if p_job_id is not null and not exists (
    select 1
    from public.request_segmentation_jobs j
    where j.id = p_job_id
      and j.request_id = p_request_id
      and j.input_hash = p_input_hash
  ) then
    raise exception 'segmentation_job_request_or_hash_mismatch: %', p_job_id;
  end if;

  select public.neontrip_compute_request_segment_input_hash(p_request_id)
  into v_current_input_hash;
  v_input_hash_current := v_current_input_hash is not distinct from p_input_hash;

  select version, mode
  into v_policy_version, v_policy_mode
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
    where policy_version = v_policy_version
      and segment = p_segment;
    v_policy_found := found;
  end if;

  v_effective_status := p_status;
  select coalesce(array_agg(flag), '{}'::text[])
  into v_classifier_risk_flags
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(p_classifier_json->'risk_flags') = 'array'
        then p_classifier_json->'risk_flags'
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

  v_effective_classifier_json := coalesce(p_classifier_json, '{}'::jsonb);
  v_research_required := lower(
    coalesce(p_classifier_json #>> '{research_policy,external_research_required}', 'false')
  ) = 'true';
  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_evidence_json) = 'array' then p_evidence_json
        else '[]'::jsonb
      end
    ) as evidence(item)
    cross join lateral (
      select public.neontrip_request_segmentation_domain_facts(evidence.item->>'url') as facts
    ) as evidence_domain
    where coalesce(evidence.item->>'url', '') ~* '^https?://'
      and coalesce((evidence_domain.facts->>'is_valid_dns_host')::boolean, false)
  ) into v_has_external_url;

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
      'db_validation',
      coalesce(v_effective_classifier_json->'db_validation', '{}'::jsonb) || jsonb_build_object(
        'research_evidence_gate_applied', true,
        'reason', 'external_research_required_without_external_url_evidence'
      )
    );
  end if;

  if p_status = 'accepted' and not v_input_hash_current then
    v_effective_status := 'needs_review';
    if not ('stale_input_hash' = any(v_effective_risk_flags)) then
      v_effective_risk_flags := array_append(v_effective_risk_flags, 'stale_input_hash');
    end if;
    v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
      'db_validation',
      coalesce(v_effective_classifier_json->'db_validation', '{}'::jsonb) || jsonb_build_object(
        'input_hash_current', false,
        'reason', 'request_input_changed_after_job_enqueue'
      )
    );
  end if;

  if p_status = 'accepted' and v_effective_risk_flags && array[
    'conflicting_evidence',
    'missing_external_company_evidence',
    'prompt_injection_seen',
    'freemail_business_unclear',
    'missing_company_identity'
  ]::text[] then
    v_effective_status := 'needs_review';
    v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
      'db_validation',
      coalesce(v_effective_classifier_json->'db_validation', '{}'::jsonb) || jsonb_build_object(
        'blocking_risk_flag_gate_applied', true
      )
    );
  end if;

  if p_status = 'accepted' then
    if p_segment is null or p_confidence is null or not v_policy_found then
      v_effective_status := 'needs_review';
    elsif p_confidence < v_policy.min_confidence or v_policy.needs_human_review then
      v_effective_status := 'needs_review';
    end if;
  end if;

  v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
    'risk_flags', to_jsonb(v_effective_risk_flags)
  );

  v_effective_segment := case
    when v_effective_status = 'accepted' then p_segment
    else null
  end;

  insert into public.request_segment_classifications (
    request_id, customer_id, input_hash, status, segment, s_kategorie,
    confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
    firmographic_json, classifier_json, policy_json, risk_flags, model,
    model_version, prompt_version, classifier_version, policy_version,
    accepted_at, accepted_by
  ) values (
    p_request_id,
    v_request.customer_id,
    p_input_hash,
    v_effective_status,
    p_segment,
    case when v_policy_found then v_policy.s_kategorie else null end,
    p_confidence,
    p_evidence_grade,
    left(coalesce(p_reasoning_short, ''), 1000),
    coalesce(p_reason_codes, '{}'),
    coalesce(p_evidence_json, '[]'::jsonb),
    coalesce(p_firmographic_json, '{}'::jsonb),
    v_effective_classifier_json,
    case when v_policy_found then to_jsonb(v_policy) else '{}'::jsonb end,
    v_effective_risk_flags,
    p_model,
    p_model_version,
    p_prompt_version,
    p_classifier_version,
    v_policy_version,
    case when v_effective_status = 'accepted' then now() else null end,
    case
      when v_effective_status = 'accepted'
        then coalesce(nullif(p_accepted_by, ''), 'n8n-request-segmenter')
      else null
    end
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
    accepted_by = excluded.accepted_by,
    created_at = now()
  returning id into v_classification_id;

  if v_effective_status = 'accepted' then
    select public.neontrip_upsert_segment_research_cache_from_classification(
      p_request_id,
      v_effective_status,
      v_policy_mode,
      p_evidence_grade,
      coalesce(p_evidence_json, '[]'::jsonb),
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      p_model,
      p_classifier_version
    ) into v_research_cache_written;
  end if;

  v_manual_authoritative := coalesce(v_request.segment_source, '') ~ '^manual_';
  v_existing_authoritative :=
    v_request.segment_status = 'accepted'
    and v_request.segment ~ '^NT-(1[0-8]|[1-9])$';

  if v_policy_mode = 'shadow' then
    v_projection_reason := 'policy_mode_shadow';
  elsif v_manual_authoritative then
    v_projection_reason := 'manual_authoritative_preserved';
  elsif not v_input_hash_current then
    v_projection_reason := 'stale_input_hash';
  elsif v_effective_status = 'accepted' then
    update public.master_requests
    set
      segment = v_effective_segment,
      s_kategorie = v_policy.s_kategorie,
      segment_status = 'accepted',
      segment_confidence = p_confidence,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_policy_version,
      commercial_playbook = jsonb_build_object(
        'policy_version', v_policy_version,
        'segment', v_effective_segment,
        's_kategorie', v_policy.s_kategorie,
        'price_factor', v_policy.price_factor,
        'max_followups', v_policy.max_followups,
        'first_call_after_minutes', v_policy.first_call_after_minutes,
        'sales_priority', v_policy.sales_priority,
        'automation_enabled', v_policy.automation_enabled,
        'mode', v_policy_mode
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
      segment_policy_version = v_policy_version,
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
    'policy_version', v_policy_version,
    'policy_mode', v_policy_mode,
    'job_status', v_job_status,
    'input_hash_current', v_input_hash_current,
    'research_cache_written', v_research_cache_written,
    'projection', jsonb_build_object(
      'applied', v_projection_applied,
      'reason', v_projection_reason,
      'authoritative_segment', v_request.segment,
      'authoritative_s_kategorie', v_request.s_kategorie,
      'authoritative_status', v_request.segment_status,
      'authoritative_source', v_request.segment_source,
      'manual_authoritative_preserved', v_manual_authoritative
    )
  );
end;
$function$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) is
  'Records the validated proposal and job outcome, returns the effective result, and projects only accepted non-shadow results without overwriting manual_* authority.';

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

create or replace function public.neontrip_get_request_segmentation_automation_decision(
  p_request_id uuid
)
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
    order by c.created_at desc, c.id desc
    limit 1
  ),
  active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ),
  current_input as (
    select public.neontrip_compute_request_segment_input_hash(p_request_id) as input_hash
  ),
  current_classification as (
    select c.*
    from public.request_segment_classifications c
    cross join current_input ci
    where c.request_id = p_request_id
      and c.input_hash = ci.input_hash
    order by c.created_at desc, c.id desc
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
  authority as (
    select
      coalesce(
        (
          select
            mr.segment_status = 'accepted'
            and mr.segment ~ '^NT-(1[0-8]|[1-9])$'
            and coalesce(mr.segment_source, '') ~ '^manual_[a-z0-9_]+$'
            and exists (
              select 1
              from policy_rule pr
              where pr.s_kategorie = mr.s_kategorie
            )
          from request_row mr
        ),
        false
      ) as manual_authority,
      coalesce(
        (
          select
            mr.segment_status = 'accepted'
            and mr.segment ~ '^NT-(1[0-8]|[1-9])$'
            and mr.segment_source = 'request_segmenter'
            and cc.status = 'accepted'
            and cc.segment = mr.segment
            and cc.s_kategorie = mr.s_kategorie
            and cc.input_hash = ci.input_hash
            and cc.policy_version = ap.version
            and mr.segment_policy_version = ap.version
            and exists (
              select 1
              from policy_rule pr
              where pr.s_kategorie = mr.s_kategorie
            )
          from request_row mr
          cross join current_classification cc
          cross join current_input ci
          cross join active_policy ap
        ),
        false
      ) as ai_authority
  ),
  checks as (
    select
      exists(select 1 from request_row) as request_exists,
      exists(select 1 from latest_classification) as latest_classification_exists,
      exists(select 1 from current_classification) as current_classification_exists,
      coalesce((select status = 'accepted' from current_classification), false) as has_accepted_classification,
      coalesce((select segment_status = 'accepted' from request_row), false) as request_segment_accepted,
      coalesce((select segment is not null from request_row), false) as request_has_segment,
      coalesce((select s_kategorie in ('S1', 'S2', 'S3', 'S4') from request_row), false) as request_has_valid_s_kategorie,
      coalesce(
        (
          select pr.s_kategorie = mr.s_kategorie
          from request_row mr
          cross join policy_rule pr
        ),
        false
      ) as request_matches_active_policy_rule,
      coalesce(
        (
          select mr.segment = lc.segment and mr.s_kategorie = lc.s_kategorie
          from request_row mr
          cross join current_classification lc
          where lc.status = 'accepted'
        ),
        false
      ) as request_matches_accepted_classification,
      coalesce(
        (
          select lc.input_hash = ci.input_hash
          from latest_classification lc
          cross join current_input ci
        ),
        false
      ) as latest_classification_input_current,
      coalesce(
        (
          select lc.policy_version = ap.version
          from latest_classification lc
          cross join active_policy ap
        ),
        false
      ) as latest_classification_policy_active,
      coalesce(
        (
          select cc.policy_version = ap.version
          from current_classification cc
          cross join active_policy ap
        ),
        false
      ) as current_classification_policy_active,
      coalesce((select followup_pricing_activation_allowed from readiness), false) as readiness_allows_activation,
      coalesce((select mode from active_policy), 'missing') as policy_mode,
      coalesce(
        (select mode in ('followup_canary', 'followup_live', 'pricing_canary', 'pricing_live') from active_policy),
        false
      ) as mode_allows_followup,
      coalesce((select mode in ('pricing_canary', 'pricing_live') from active_policy), false) as mode_allows_pricing,
      coalesce((select automation_enabled from policy_rule), false) as policy_rule_automation_enabled,
      coalesce((select needs_human_review from policy_rule), true) as policy_rule_needs_human_review,
      coalesce((select max_followups > 0 from policy_rule), false) as policy_rule_has_followup,
      coalesce((select price_factor is not null from policy_rule), false) as policy_rule_has_price_factor,
      coalesce((select commercial_playbook->>'automation_enabled' = 'true' from request_row), false) as request_playbook_automation_enabled,
      coalesce((select manual_authority from authority), false) as manual_authority,
      coalesce((select ai_authority from authority), false) as ai_authority,
      coalesce((select manual_authority or ai_authority from authority), false) as authority_valid
  ),
  decisions as (
    select
      (
        request_exists
        and authority_valid
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and readiness_allows_activation
        and mode_allows_followup
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_followup
        and (manual_authority or request_playbook_automation_enabled)
      ) as can_use_for_followup,
      (
        request_exists
        and authority_valid
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and readiness_allows_activation
        and mode_allows_pricing
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_price_factor
        and (manual_authority or request_playbook_automation_enabled)
      ) as can_use_for_pricing
    from checks
  ),
  reason_codes as (
    select array_remove(array[
      case when not request_exists then 'request_not_found' end,
      case when request_exists and not authority_valid then 'no_current_authoritative_segmentation' end,
      case when request_exists and not manual_authority and not has_accepted_classification then 'no_accepted_segmentation_classification' end,
      case when request_exists and not manual_authority and not current_classification_exists then 'no_classification_for_current_input' end,
      case when request_exists and not manual_authority and current_classification_exists and not has_accepted_classification then 'current_segmentation_classification_not_accepted' end,
      case when request_exists and not manual_authority and current_classification_exists and not current_classification_policy_active then 'current_segmentation_policy_not_active' end,
      case when request_exists and not manual_authority and has_accepted_classification and not request_matches_accepted_classification then 'request_segment_mismatch_latest_accepted_classification' end,
      case when request_exists and not request_segment_accepted then 'request_segment_status_not_accepted' end,
      case when request_exists and not request_has_segment then 'request_segment_missing' end,
      case when request_exists and not request_has_valid_s_kategorie then 'request_s_kategorie_missing_or_invalid' end,
      case when request_exists and not request_matches_active_policy_rule then 'request_s_kategorie_mismatch_active_policy_rule' end,
      case when not readiness_allows_activation then 'production_readiness_or_manual_approval_blocked' end,
      case when not mode_allows_followup then 'active_policy_mode_does_not_allow_followup' end,
      case when not mode_allows_pricing then 'active_policy_mode_does_not_allow_pricing' end,
      case when request_exists and not policy_rule_automation_enabled then 'policy_rule_automation_disabled' end,
      case when request_exists and policy_rule_needs_human_review then 'policy_rule_requires_human_review' end,
      case when request_exists and not policy_rule_has_followup then 'policy_rule_has_no_followup_plan' end,
      case when request_exists and not policy_rule_has_price_factor then 'policy_rule_has_no_price_factor' end,
      case when request_exists and ai_authority and not request_playbook_automation_enabled then 'request_commercial_playbook_automation_disabled' end
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
    'authority', jsonb_build_object(
      'kind', case
        when (select manual_authority from checks) then 'manual'
        when (select ai_authority from checks) then 'ai'
        else 'none'
      end,
      'valid', (select authority_valid from checks),
      'manual_authority', (select manual_authority from checks),
      'ai_authority', (select ai_authority from checks)
    ),
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
      'segment_source', (select segment_source from request_row),
      'segment_policy_version', (select segment_policy_version from request_row),
      'segment_classified_at', (select segment_classified_at from request_row)
    ),
    'classification', jsonb_build_object(
      'latest_classification_id', (select id from latest_classification),
      'latest_status', (select status from latest_classification),
      'latest_segment', (select segment from latest_classification),
      'latest_confidence', (select confidence from latest_classification),
      'latest_evidence_grade', (select evidence_grade from latest_classification),
      'latest_input_hash_current', (select latest_classification_input_current from checks),
      'latest_policy_matches_active', (select latest_classification_policy_active from checks),
      'current_classification_id', (select id from current_classification),
      'current_status', (select status from current_classification),
      'current_segment', (select segment from current_classification),
      'current_confidence', (select confidence from current_classification),
      'current_policy_matches_active', (select current_classification_policy_active from checks),
      'accepted_classification_id', (select case when status = 'accepted' then id end from current_classification),
      'accepted_segment', (select case when status = 'accepted' then segment end from current_classification),
      'accepted_confidence', (select case when status = 'accepted' then confidence end from current_classification),
      'accepted_evidence_grade', (select case when status = 'accepted' then evidence_grade end from current_classification),
      'accepted_at', (select case when status = 'accepted' then accepted_at end from current_classification)
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
          'max_followups', case
            when (select can_use_for_followup from decisions) then (select max_followups from policy_rule)
            else 0
          end,
          'first_call_after_minutes', case
            when (select can_use_for_followup from decisions) then (select first_call_after_minutes from policy_rule)
            else null
          end,
          'pricing_enabled', (select can_use_for_pricing from decisions),
          'price_factor', case
            when (select can_use_for_pricing from decisions) then (select price_factor from policy_rule)
            else null
          end,
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
  'Canonical per-request automation authority: manual_* accepted state or only the latest current-input active-policy accepted AI classification, plus readiness/mode/rule gates.';

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
  if safe_execution_id is null then
    raise exception 'workflow_execution_id is required';
  end if;

  for stale in
    update public.followup_delivery_attempts as existing
      set status = 'delivery_unknown',
          claim_token = null,
          lease_until = null,
          last_error_code = 'stale_processing_lease',
          updated_at = now()
    where existing.status = 'processing'
      and existing.lease_until <= now()
    returning existing.*
  loop
    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          last_error = 'A prior Outlook follow-up attempt lost confirmation; manual review is required.',
          last_error_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = 'stale_followup_delivery_lease'
    where id = stale.followup_queue_id
      and status = 'processing';

    insert into public.followup_delivery_events (
      attempt_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      stale.id,
      'followup-delivery:' || stale.id::text || ':delivery-unknown:stale-lease',
      'delivery_unknown',
      safe_execution_id,
      jsonb_build_object('reason', 'stale_processing_lease')
    )
    on conflict (event_key) do nothing;
  end loop;

  select queued.*
    into candidate
  from public.followup_queue as queued
  where queued.status = 'pending'
    and queued.scheduled_for <= now()
    and queued.cancelled_at is null
    and queued.sent_at is null
    and queued.followup_type not like 'payment_reminder%'
    and not exists (
      select 1
      from public.followup_delivery_attempts as existing
      where existing.followup_queue_id = queued.id
    )
    and coalesce(
      (
        public.neontrip_get_followup_queue_segmentation_decision(queued.id)
        ->>'send_allowed'
      )::boolean,
      false
    )
  order by coalesce(queued.is_urgent, false) desc, queued.scheduled_for asc, queued.id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'no_candidate',
      'automatic_retry_allowed', false
    );
  end if;

  candidate_email := lower(btrim(coalesce(candidate.customer_email, '')));
  if candidate.request_id is null
     or candidate_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or candidate_email ~ '@(neontrip\.de|riesenobjekte\.de)$'
     or candidate_email ~ '@example\.'
     or candidate_email ~ '@neontrip\.test$' then
    insert into public.followup_delivery_attempts (
      followup_queue_id,
      status,
      claim_token,
      lease_until,
      last_execution_id,
      block_reason
    ) values (
      candidate.id,
      'blocked',
      null,
      null,
      safe_execution_id,
      'invalid_candidate_identity_or_recipient'
    )
    returning * into attempt;

    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          last_error = 'Follow-up candidate identity or recipient failed deterministic validation.',
          last_error_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = 'invalid_candidate_identity_or_recipient'
    where id = candidate.id;

    insert into public.followup_delivery_events (
      attempt_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      attempt.id,
      'followup-delivery:' || attempt.id::text || ':blocked',
      'blocked',
      safe_execution_id,
      jsonb_build_object('reason', 'invalid_candidate_identity_or_recipient')
    );

    return jsonb_build_object(
      'route', 'stop',
      'reason', 'candidate_blocked_for_review',
      'followup_queue_id', candidate.id,
      'automatic_send_allowed', false
    );
  end if;

  insert into public.followup_delivery_attempts (
    followup_queue_id,
    status,
    claim_token,
    claimed_at,
    lease_until,
    last_execution_id
  ) values (
    candidate.id,
    'processing',
    new_claim_token,
    now(),
    now() + make_interval(secs => safe_lease_seconds),
    safe_execution_id
  )
  returning * into attempt;

  update public.followup_queue
    set status = 'processing',
        processing_started_at = now(),
        last_error = null
  where id = candidate.id;

  insert into public.followup_delivery_events (
    attempt_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':claimed',
    'claimed',
    safe_execution_id,
    jsonb_build_object(
      'lease_seconds', safe_lease_seconds,
      'copy_mode', 'deterministic',
      'ai_copy_allowed', false,
      'automatic_send_allowed', true
    )
  );

  return jsonb_build_object(
    'route', 'process',
    'reason', 'claimed',
    'attempt_id', attempt.id,
    'claim_token', attempt.claim_token,
    'followup_queue_id', candidate.id,
    'candidate', to_jsonb(candidate),
    'copy_mode', 'deterministic',
    'ai_copy_allowed', false,
    'automatic_send_allowed', true,
    'automatic_retry_allowed', false
  );
end;
$function$;

comment on function public.claim_followup_delivery_candidate(text, integer) is
  'Claims only segmentation-approved non-payment follow-ups; blocked candidates stay pending and unmutated while lease/idempotency behavior remains unchanged.';

revoke all on function public.claim_followup_delivery_candidate(text, integer) from public, anon, authenticated;
grant execute on function public.claim_followup_delivery_candidate(text, integer) to service_role;

commit;
