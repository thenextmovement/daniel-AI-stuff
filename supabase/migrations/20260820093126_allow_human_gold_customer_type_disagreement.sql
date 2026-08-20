-- Allow independent human Gold to disagree with classifier input.
-- The current landing-page intake supplied a synthetic B2B default even though
-- the form did not collect that choice. This migration changes only immutable
-- human evaluation Gold; it does not mutate customer_type, master segmentation,
-- classifier acceptance, policy projection, pricing or follow-up automation.

begin;

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
  v_classifier_version constant text := 'segment_classifier_v3_20260819_cx8';
  v_prompt_version constant text := 'segment_prompt_v4_20260819_cx8';
  v_current_input_hash text;
  v_s_kategorie text;
  v_context_tags text[];
  v_evidence_urls text[];
  v_actor text := btrim(coalesce(p_adjudicated_by, ''));
  v_reason text := btrim(coalesce(p_adjudication_reason, ''));
  v_adjudication public.request_segmentation_gold_adjudications%rowtype;
  v_created boolean := false;
  v_job_id uuid;
begin
  if p_taxonomy_version is distinct from v_expected_taxonomy then
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
      v_classifier_version,
      v_prompt_version,
      'gold_re_evaluation'
    );
  end if;

  if not v_created then
    select j.id into v_job_id
    from public.request_segmentation_jobs j
    where j.request_id = p_request_id
      and j.input_hash = p_input_hash
      and j.taxonomy_version = p_taxonomy_version
      and j.classifier_version = v_classifier_version
      and j.prompt_version = v_prompt_version
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
  'Creates insert-once explicit human CX8 gold for the exact current input. A documented human label may disagree with stored customer_type without mutating request authority; classifier and automation gates remain separate. Identical retry is idempotent and divergent retry conflicts.';

revoke all on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) to service_role;

commit;
