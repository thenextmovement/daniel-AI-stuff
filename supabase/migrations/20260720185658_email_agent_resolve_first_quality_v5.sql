create table if not exists public.email_agent_feedback_analysis_v1 (
  feedback_id bigint not null references public.email_agent_feedback(id) on delete cascade,
  analyzer_version text not null,
  classification text not null,
  semantic_equivalent boolean not null,
  reusable_style_candidate boolean not null,
  candidate_type text,
  defect_codes text[] not null default '{}'::text[],
  signal_summary jsonb not null default '{}'::jsonb,
  contains_customer_content boolean not null default false,
  analyzed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (feedback_id, analyzer_version),
  constraint email_agent_feedback_analysis_v1_version_check
    check (analyzer_version = 'email-feedback-analyzer-v5'),
  constraint email_agent_feedback_analysis_v1_classification_check
    check (classification in (
      'style_safe', 'resolver_gap', 'policy_gap', 'knowledge_gap', 'unsafe_or_ambiguous'
    )),
  constraint email_agent_feedback_analysis_v1_candidate_check
    check (candidate_type is null or candidate_type in ('knowledge', 'resolver', 'policy', 'manual_review')),
  constraint email_agent_feedback_analysis_v1_defects_check
    check (
      cardinality(defect_codes) <= 12
      and defect_codes <@ array[
        'invalid_feedback_match', 'unnecessary_internal_deferral',
        'missing_customer_question', 'unnecessary_customer_question',
        'attachment_missed', 'attachment_reference_changed',
        'price_or_offer_error', 'date_or_timeline_error',
        'unsupported_commitment', 'internal_information_exposed',
        'factual_change', 'large_rewrite_unclassified', 'high_risk_change'
      ]::text[]
    ),
  constraint email_agent_feedback_analysis_v1_no_content_check
    check (contains_customer_content = false),
  constraint email_agent_feedback_analysis_v1_signal_size_check
    check (octet_length(signal_summary::text) <= 8000)
);

create index if not exists email_agent_feedback_analysis_v1_classification_idx
  on public.email_agent_feedback_analysis_v1 (classification, analyzed_at desc);

alter table public.email_agent_feedback_analysis_v1 enable row level security;

drop policy if exists email_agent_feedback_analysis_v1_service_role_all
  on public.email_agent_feedback_analysis_v1;
create policy email_agent_feedback_analysis_v1_service_role_all
  on public.email_agent_feedback_analysis_v1
  for all to service_role using (true) with check (true);

revoke all on table public.email_agent_feedback_analysis_v1
  from public, anon, authenticated;
grant select, insert, update on table public.email_agent_feedback_analysis_v1
  to service_role;

comment on table public.email_agent_feedback_analysis_v1 is
  'Deterministic metadata-only analysis of draft-to-sent changes. It stores bounded defect signals, never customer or message text, and never changes prompts or sends messages.';

create or replace function public.analyze_email_agent_feedback_v5(p_feedback_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  feedback_row public.email_agent_feedback%rowtype;
  draft_text text := '';
  draft_category text := 'general';
  draft_channel text := 'external_email';
  draft_risk text := 'low';
  draft_length_class text := 'simple';
  target_match boolean := true;
  question_delta integer := 0;
  amounts_changed boolean := false;
  dates_changed boolean := false;
  attachments_changed boolean := false;
  commitment_changed boolean := false;
  internal_detail_removed boolean := false;
  draft_attachment_refs jsonb := '[]'::jsonb;
  sent_attachment_refs jsonb := '[]'::jsonb;
  attachment_added boolean := false;
  draft_has_deferral boolean := false;
  sent_has_deferral boolean := false;
  deferral_removed boolean := false;
  draft_has_internal_detail boolean := false;
  sent_has_internal_detail boolean := false;
  internal_exposed boolean := false;
  high_risk boolean := false;
  large_rewrite boolean := false;
  semantic_equivalent_value boolean := false;
  reusable_style_value boolean := false;
  classification_value text := 'unsafe_or_ambiguous';
  candidate_type_value text := 'manual_review';
  defects text[] := '{}'::text[];
  result_row public.email_agent_feedback_analysis_v1%rowtype;
begin
  select feedback.* into feedback_row
  from public.email_agent_feedback as feedback
  where feedback.id = p_feedback_id;

  if not found then
    raise exception 'feedback row was not found';
  end if;

  select
    coalesce(log.draft_body_text, ''),
    coalesce(log.category, 'general'),
    coalesce(log.message_source, 'external_email'),
    coalesce(log.risk_level, 'low'),
    coalesce(log.reply_length_class, 'simple')
  into draft_text, draft_category, draft_channel, draft_risk, draft_length_class
  from public.email_agent_log as log
  where log.message_id = feedback_row.source_message_id
    and log.draft_created = true
  order by log.created_at desc
  limit 1;

  if not found then
    draft_text := '';
  end if;

  target_match := lower(coalesce(feedback_row.change_profile#>>'{match,target_recipient_present}', 'true')) = 'true';
  question_delta := case
    when feedback_row.change_profile#>>'{semantic_deltas,question_delta}' ~ '^-?[0-9]+$'
      then (feedback_row.change_profile#>>'{semantic_deltas,question_delta}')::integer
    else 0
  end;
  amounts_changed := lower(coalesce(feedback_row.change_profile#>>'{semantic_deltas,amounts_changed}', 'false')) = 'true';
  dates_changed := lower(coalesce(feedback_row.change_profile#>>'{semantic_deltas,dates_changed}', 'false')) = 'true';
  attachments_changed := lower(coalesce(feedback_row.change_profile#>>'{semantic_deltas,attachment_references_changed}', 'false')) = 'true';
  commitment_changed := lower(coalesce(feedback_row.change_profile#>>'{semantic_deltas,commitment_changed}', 'false')) = 'true';
  internal_detail_removed := lower(coalesce(feedback_row.change_profile#>>'{semantic_deltas,internal_detail_removed}', 'false')) = 'true';
  draft_attachment_refs := case
    when jsonb_typeof(feedback_row.change_profile#>'{semantic_deltas,draft_attachment_references}') = 'array'
      then feedback_row.change_profile#>'{semantic_deltas,draft_attachment_references}'
    else '[]'::jsonb
  end;
  sent_attachment_refs := case
    when jsonb_typeof(feedback_row.change_profile#>'{semantic_deltas,sent_attachment_references}') = 'array'
      then feedback_row.change_profile#>'{semantic_deltas,sent_attachment_references}'
    else '[]'::jsonb
  end;
  attachment_added := attachments_changed
    and jsonb_array_length(sent_attachment_refs) > jsonb_array_length(draft_attachment_refs);

  draft_has_deferral := draft_text ~* E'(intern.{0,50}(prüf|klär|abklär|nachfrag|abstimm|rücksprach)|meld(en)? (uns|mich).{0,50}(später|danach|anschließend)|get back to you|check internally|review internally)';
  sent_has_deferral := coalesce(feedback_row.sent_body_text, '') ~* E'(intern.{0,50}(prüf|klär|abklär|nachfrag|abstimm|rücksprach)|meld(en)? (uns|mich).{0,50}(später|danach|anschließend)|get back to you|check internally|review internally)';
  deferral_removed := draft_has_deferral and not sent_has_deferral;
  draft_has_internal_detail := draft_text ~* E'(angesehen|geöffnet|gelesen|aufgerufen|viewed|opened|read|accessed)';
  sent_has_internal_detail := coalesce(feedback_row.sent_body_text, '') ~* E'(angesehen|geöffnet|gelesen|aufgerufen|viewed|opened|read|accessed)';
  internal_exposed := not draft_has_internal_detail and sent_has_internal_detail;
  high_risk := draft_risk = 'high' or feedback_row.review_priority = 'high';
  large_rewrite := coalesce(feedback_row.edit_ratio, 1) > 0.35
    or coalesce(feedback_row.edit_labels, '{}'::text[]) && array['manual_rewrite']::text[];

  defects := array_remove(array[
    case when not feedback_row.is_valid or not target_match or draft_text = '' then 'invalid_feedback_match' end,
    case when deferral_removed then 'unnecessary_internal_deferral' end,
    case when question_delta > 0 then 'missing_customer_question' end,
    case when question_delta < 0 then 'unnecessary_customer_question' end,
    case when attachment_added then 'attachment_missed' end,
    case when attachments_changed and not attachment_added then 'attachment_reference_changed' end,
    case when amounts_changed then 'price_or_offer_error' end,
    case when dates_changed then 'date_or_timeline_error' end,
    case when commitment_changed then 'unsupported_commitment' end,
    case when internal_detail_removed or internal_exposed then 'internal_information_exposed' end,
    case when coalesce(feedback_row.edit_labels, '{}'::text[]) && array['factual_correction']::text[] then 'factual_change' end,
    case when large_rewrite then 'large_rewrite_unclassified' end,
    case when high_risk then 'high_risk_change' end
  ], null)::text[];

  select coalesce(array_agg(distinct defect order by defect), '{}'::text[])
    into defects
  from unnest(defects) as defect;

  semantic_equivalent_value := feedback_row.is_valid
    and target_match
    and draft_text <> ''
    and not high_risk
    and coalesce(feedback_row.edit_ratio, 1) <= 0.35
    and question_delta = 0
    and not amounts_changed
    and not dates_changed
    and not attachments_changed
    and not commitment_changed
    and not internal_detail_removed
    and not internal_exposed
    and not deferral_removed
    and not large_rewrite;
  reusable_style_value := semantic_equivalent_value
    and feedback_row.learning_status in ('pending', 'approved')
    and feedback_row.collected_at >= now() - interval '90 days';

  if semantic_equivalent_value then
    classification_value := 'style_safe';
    candidate_type_value := null;
    defects := '{}'::text[];
  elsif defects && array[
    'unnecessary_internal_deferral', 'missing_customer_question',
    'unnecessary_customer_question', 'unsupported_commitment', 'internal_information_exposed'
  ]::text[] then
    classification_value := 'policy_gap';
    candidate_type_value := 'policy';
  elsif defects && array[
    'attachment_missed', 'attachment_reference_changed',
    'price_or_offer_error', 'date_or_timeline_error'
  ]::text[] then
    classification_value := 'resolver_gap';
    candidate_type_value := 'resolver';
  elsif defects && array['factual_change']::text[] then
    classification_value := 'knowledge_gap';
    candidate_type_value := 'knowledge';
  else
    classification_value := 'unsafe_or_ambiguous';
    candidate_type_value := 'manual_review';
  end if;

  insert into public.email_agent_feedback_analysis_v1 (
    feedback_id, analyzer_version, classification, semantic_equivalent,
    reusable_style_candidate, candidate_type, defect_codes, signal_summary,
    contains_customer_content, analyzed_at, updated_at
  ) values (
    feedback_row.id,
    'email-feedback-analyzer-v5',
    classification_value,
    semantic_equivalent_value,
    reusable_style_value,
    candidate_type_value,
    defects,
    jsonb_build_object(
      'category', draft_category,
      'channel', draft_channel,
      'risk_level', draft_risk,
      'reply_length_class', draft_length_class,
      'edit_ratio', feedback_row.edit_ratio,
      'question_delta', question_delta,
      'attachment_reference_delta', jsonb_array_length(sent_attachment_refs) - jsonb_array_length(draft_attachment_refs),
      'deferral_removed', deferral_removed,
      'automatic_prompt_rewrite_allowed', false,
      'automatic_send_allowed', false
    ),
    false,
    now(),
    now()
  )
  on conflict (feedback_id, analyzer_version) do update
  set classification = excluded.classification,
      semantic_equivalent = excluded.semantic_equivalent,
      reusable_style_candidate = excluded.reusable_style_candidate,
      candidate_type = excluded.candidate_type,
      defect_codes = excluded.defect_codes,
      signal_summary = excluded.signal_summary,
      contains_customer_content = false,
      updated_at = now()
  returning * into result_row;

  return jsonb_build_object(
    'feedback_id', result_row.feedback_id,
    'analyzer_version', result_row.analyzer_version,
    'classification', result_row.classification,
    'semantic_equivalent', result_row.semantic_equivalent,
    'reusable_style_candidate', result_row.reusable_style_candidate,
    'candidate_type', result_row.candidate_type,
    'defect_codes', to_jsonb(result_row.defect_codes),
    'contains_customer_content', false,
    'automatic_prompt_rewrite_allowed', false,
    'automatic_send_allowed', false
  );
end;
$function$;

revoke all on function public.analyze_email_agent_feedback_v5(bigint)
  from public, anon, authenticated;
grant execute on function public.analyze_email_agent_feedback_v5(bigint)
  to service_role;

create or replace function public.trigger_analyze_email_agent_feedback_v5()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  perform public.analyze_email_agent_feedback_v5(new.id);
  return new;
end;
$function$;

revoke all on function public.trigger_analyze_email_agent_feedback_v5()
  from public, anon, authenticated;
grant execute on function public.trigger_analyze_email_agent_feedback_v5()
  to service_role;

drop trigger if exists email_agent_feedback_analyze_v5 on public.email_agent_feedback;
create trigger email_agent_feedback_analyze_v5
after insert or update of
  is_valid, edit_ratio, edit_labels, change_profile, sent_body_text,
  review_priority, learning_status
on public.email_agent_feedback
for each row execute function public.trigger_analyze_email_agent_feedback_v5();

do $function$
declare
  feedback_record record;
begin
  for feedback_record in select id from public.email_agent_feedback loop
    perform public.analyze_email_agent_feedback_v5(feedback_record.id);
  end loop;
end;
$function$;

create or replace view public.email_agent_feedback_defect_summary_v1
with (security_invoker = true)
as
select
  analysis.candidate_type,
  defect.defect_code,
  count(*)::integer as occurrence_count,
  min(analysis.analyzed_at) as first_seen_at,
  max(analysis.updated_at) as last_seen_at,
  count(*) >= 3 as implementation_signal_ready,
  'email-feedback-analyzer-v5'::text as analyzer_version,
  false as contains_customer_content,
  false as automatic_prompt_rewrite_allowed
from public.email_agent_feedback_analysis_v1 as analysis
cross join lateral unnest(analysis.defect_codes) as defect(defect_code)
where analysis.analyzer_version = 'email-feedback-analyzer-v5'
group by analysis.candidate_type, defect.defect_code;

revoke all on public.email_agent_feedback_defect_summary_v1
  from public, anon, authenticated;
grant select on public.email_agent_feedback_defect_summary_v1
  to service_role;

create or replace view public.email_agent_auto_style_eligibility_v2
with (security_invoker = true)
as
select
  signal.feedback_id,
  signal.channel,
  signal.category,
  signal.reply_length_class,
  signal.risk_level,
  signal.collected_at,
  signal.sent_words,
  signal.sent_paragraphs,
  signal.closing_style,
  signal.shortened,
  signal.expanded,
  signal.unchanged,
  signal.direct_answer_first,
  signal.avoid_repetition,
  signal.automatic_style_eligible and analysis.reusable_style_candidate as automatic_style_eligible,
  signal.human_style_eligible and analysis.reusable_style_candidate as human_style_eligible,
  signal.eligible and analysis.reusable_style_candidate as eligible,
  case
    when signal.human_style_eligible and analysis.reusable_style_candidate then 'human_approved'
    when signal.automatic_style_eligible and analysis.reusable_style_candidate then 'automatic_safe_style'
    else null
  end as sample_source,
  case
    when analysis.reusable_style_candidate then signal.block_reasons
    else array_append(signal.block_reasons, 'semantic_equivalence_not_proven')
  end::text[] as block_reasons,
  'email-auto-style-eligibility-v2'::text as eligibility_version,
  false as facts_or_customer_content_included,
  false as automatic_prompt_rewrite_allowed,
  true as customer_send_human_approval_required
from public.email_agent_auto_style_eligibility_v1 as signal
join public.email_agent_feedback_analysis_v1 as analysis
  on analysis.feedback_id = signal.feedback_id
 and analysis.analyzer_version = 'email-feedback-analyzer-v5';

revoke all on public.email_agent_auto_style_eligibility_v2
  from public, anon, authenticated;
grant select on public.email_agent_auto_style_eligibility_v2
  to service_role;

create or replace function public.get_email_agent_style_profile_v5(
  p_channel text default null,
  p_category text default null,
  p_reply_length_class text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  selected_scope text := 'global';
  selected_length_specific boolean := false;
  sample_count integer := 0;
  automatic_count integer := 0;
  human_count integer := 0;
  median_words integer := null;
  median_paragraphs integer := null;
  shortened_share numeric := 0;
  expanded_share numeric := 0;
  unchanged_share numeric := 0;
  direct_first_share numeric := 0;
  repetition_share numeric := 0;
  viele_gruesse_share numeric := 0;
  beste_gruesse_share numeric := 0;
  recommended_max_words integer := null;
  recommended_max_paragraphs integer := null;
  preferred_closing text := null;
begin
  with scopes as (
    select 'category'::text as scope_key, true as length_specific, 1 as priority
    where nullif(p_channel, '') is not null
      and nullif(p_category, '') is not null
      and nullif(p_reply_length_class, '') is not null
    union all
    select 'channel', true, 2
    where nullif(p_channel, '') is not null and nullif(p_reply_length_class, '') is not null
    union all
    select 'global', true, 3 where nullif(p_reply_length_class, '') is not null
    union all
    select 'channel', false, 4 where nullif(p_channel, '') is not null
    union all
    select 'global', false, 5
  ), selected as (
    select scope.scope_key, scope.length_specific, scope.priority, stats.*
    from scopes as scope
    cross join lateral (
      select
        count(*)::integer as sample_count,
        count(*) filter (where signal.sample_source = 'automatic_safe_style')::integer as automatic_count,
        count(*) filter (where signal.sample_source = 'human_approved')::integer as human_count,
        percentile_disc(0.5) within group (order by signal.sent_words)::integer as median_words,
        percentile_disc(0.5) within group (order by signal.sent_paragraphs)::integer as median_paragraphs,
        coalesce(avg(signal.shortened::integer), 0) as shortened_share,
        coalesce(avg(signal.expanded::integer), 0) as expanded_share,
        coalesce(avg(signal.unchanged::integer), 0) as unchanged_share,
        coalesce(avg(signal.direct_answer_first::integer), 0) as direct_first_share,
        coalesce(avg(signal.avoid_repetition::integer), 0) as repetition_share,
        coalesce(avg((signal.closing_style = 'viele_gruesse')::integer), 0) as viele_gruesse_share,
        coalesce(avg((signal.closing_style = 'beste_gruesse')::integer), 0) as beste_gruesse_share
      from public.email_agent_auto_style_eligibility_v2 as signal
      where signal.eligible = true
        and (scope.scope_key = 'global' or signal.channel = p_channel)
        and (scope.scope_key <> 'category' or signal.category = p_category)
        and (not scope.length_specific or signal.reply_length_class = p_reply_length_class)
    ) as stats
    order by (stats.sample_count >= 10) desc, scope.priority
    limit 1
  )
  select
    scope_key, length_specific, selected.sample_count, selected.automatic_count,
    selected.human_count, selected.median_words, selected.median_paragraphs,
    selected.shortened_share, selected.expanded_share, selected.unchanged_share,
    selected.direct_first_share, selected.repetition_share,
    selected.viele_gruesse_share, selected.beste_gruesse_share
  into
    selected_scope, selected_length_specific, sample_count, automatic_count,
    human_count, median_words, median_paragraphs,
    shortened_share, expanded_share, unchanged_share,
    direct_first_share, repetition_share,
    viele_gruesse_share, beste_gruesse_share
  from selected;

  if sample_count >= 10 and median_words is not null then
    recommended_max_words := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(8, least(70, median_words + 5))
      when 'complex' then greatest(120, least(360, median_words + 20))
      else greatest(25, least(160, median_words + 10))
    end;
    recommended_max_paragraphs := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(1, least(2, coalesce(median_paragraphs, 1)))
      when 'complex' then greatest(2, least(5, coalesce(median_paragraphs, 2) + 1))
      else greatest(1, least(3, coalesce(median_paragraphs, 1)))
    end;
    preferred_closing := case
      when beste_gruesse_share >= 0.60 then 'Beste Grüße'
      when viele_gruesse_share >= 0.60 then 'Viele Grüße'
      else null
    end;
  end if;

  return jsonb_build_object(
    'version', 'email-style-profile-v5-passive-safe',
    'analyzer_version', 'email-feedback-analyzer-v5',
    'learning_mode', 'passive_deterministic',
    'eligible', sample_count >= 10,
    'minimum_safe_samples', 10,
    'safe_sample_count', sample_count,
    'automatic_sample_count', automatic_count,
    'human_sample_count', human_count,
    'window_days', 90,
    'scope', selected_scope,
    'length_specific', selected_length_specific,
    'channel', nullif(p_channel, ''),
    'category', nullif(p_category, ''),
    'reply_length_class', nullif(p_reply_length_class, ''),
    'median_sent_words', median_words,
    'median_sent_paragraphs', median_paragraphs,
    'recommended_max_words', recommended_max_words,
    'recommended_max_paragraphs', recommended_max_paragraphs,
    'preferred_closing', preferred_closing,
    'prefer_shorter', sample_count >= 10 and shortened_share >= 0.40,
    'prefer_direct_answer', sample_count >= 10 and direct_first_share >= 0.40,
    'avoid_restatement', sample_count >= 10 and repetition_share >= 0.40,
    'shortened_share', round(shortened_share, 4),
    'expanded_share', round(expanded_share, 4),
    'unchanged_share', round(unchanged_share, 4),
    'facts_or_customer_content_included', false,
    'fact_learning_allowed', false,
    'automatic_prompt_rewrite_allowed', false,
    'manual_review_required_for_safe_style', false,
    'customer_send_human_approval_required', true,
    'automatic_send_allowed', false
  );
end;
$function$;

revoke all on function public.get_email_agent_style_profile_v5(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile_v5(text, text, text)
  to service_role;

create or replace function public.get_email_agent_learning_quality_v5()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with base as (
    select public.get_email_agent_learning_quality_v4() as value
  ), analysis_counts as (
    select
      count(*)::integer as evaluated,
      count(*) filter (where classification = 'style_safe')::integer as style_safe,
      count(*) filter (where classification = 'resolver_gap')::integer as resolver_gap,
      count(*) filter (where classification = 'policy_gap')::integer as policy_gap,
      count(*) filter (where classification = 'knowledge_gap')::integer as knowledge_gap,
      count(*) filter (where classification = 'unsafe_or_ambiguous')::integer as unsafe_or_ambiguous
    from public.email_agent_feedback_analysis_v1
    where analyzer_version = 'email-feedback-analyzer-v5'
  ), defects as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_type', summary.candidate_type,
      'defect_code', summary.defect_code,
      'occurrence_count', summary.occurrence_count,
      'implementation_signal_ready', summary.implementation_signal_ready
    ) order by summary.occurrence_count desc, summary.defect_code), '[]'::jsonb) as values
    from (
      select * from public.email_agent_feedback_defect_summary_v1
      order by occurrence_count desc, defect_code
      limit 12
    ) as summary
  ), category_quality as (
    select coalesce(jsonb_object_agg(category, metrics), '{}'::jsonb) as values
    from (
      select
        coalesce(analysis.signal_summary->>'category', 'general') as category,
        jsonb_build_object(
          'samples', count(*)::integer,
          'style_safe', count(*) filter (where analysis.classification = 'style_safe')::integer,
          'resolver_gaps', count(*) filter (where analysis.classification = 'resolver_gap')::integer,
          'policy_gaps', count(*) filter (where analysis.classification = 'policy_gap')::integer
        ) as metrics
      from public.email_agent_feedback_analysis_v1 as analysis
      where analysis.analyzer_version = 'email-feedback-analyzer-v5'
      group by coalesce(analysis.signal_summary->>'category', 'general')
    ) grouped
  ), quality_counts as (
    select
      count(*)::integer as evaluated,
      count(*) filter (where coalesce((context_snapshot#>>'{quality_gate,passed}')::boolean, false))::integer as passed,
      count(*) filter (where coalesce((context_snapshot#>>'{quality_gate,model_json_valid}')::boolean, true) = false)::integer as deterministic_fallbacks,
      count(*) filter (
        where jsonb_array_length(case
          when jsonb_typeof(context_snapshot#>'{quality_gate,soft_flags}') = 'array'
            then context_snapshot#>'{quality_gate,soft_flags}'
          else '[]'::jsonb end) > 0
      )::integer as soft_flagged
    from public.email_agent_log
    where created_at >= now() - interval '7 days'
      and context_snapshot#>>'{quality_gate,version}' = 'email-draft-quality-gate-v4'
  )
  select
    (base.value - 'version' - 'passive_learning' - 'style_profile' - 'improvement_candidates' - 'quality_gate_7d')
    || jsonb_build_object(
      'version', 'email-agent-learning-quality-v5',
      'automatic_analysis', jsonb_build_object(
        'version', 'email-feedback-analyzer-v5',
        'evaluated', analysis_counts.evaluated,
        'style_safe', analysis_counts.style_safe,
        'resolver_gap', analysis_counts.resolver_gap,
        'policy_gap', analysis_counts.policy_gap,
        'knowledge_gap', analysis_counts.knowledge_gap,
        'unsafe_or_ambiguous', analysis_counts.unsafe_or_ambiguous,
        'top_defects', defects.values,
        'category_quality', category_quality.values,
        'customer_content_stored', false,
        'automatic_prompt_rewrite_allowed', false
      ),
      'passive_learning', jsonb_build_object(
        'version', 'email-auto-style-eligibility-v2',
        'evaluated', analysis_counts.evaluated,
        'safe_samples', analysis_counts.style_safe,
        'automatic_samples', (select count(*)::integer from public.email_agent_auto_style_eligibility_v2 where automatic_style_eligible),
        'human_samples', (select count(*)::integer from public.email_agent_auto_style_eligibility_v2 where human_style_eligible),
        'blocked_samples', analysis_counts.evaluated - analysis_counts.style_safe,
        'block_reason_counts', '{}'::jsonb,
        'customer_content_stored', false
      ),
      'style_profile', public.get_email_agent_style_profile_v5(null, null, null),
      'quality_gate_7d', jsonb_build_object(
        'evaluated', quality_counts.evaluated,
        'passed', quality_counts.passed,
        'soft_flagged', quality_counts.soft_flagged,
        'deterministic_fallbacks', quality_counts.deterministic_fallbacks
      )
    )
  from base, analysis_counts, defects, category_quality, quality_counts;
$function$;

revoke all on function public.get_email_agent_learning_quality_v5()
  from public, anon, authenticated;
grant execute on function public.get_email_agent_learning_quality_v5()
  to service_role;

create or replace function public.get_email_agent_rollout_gate_v2()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  base jsonb := public.get_email_agent_rollout_gate_v1();
  current_total integer := 0;
  safety_count integer := 0;
  rewrite_count integer := 0;
  median_edit numeric := 0;
  safety_share numeric := 0;
  rewrite_share numeric := 0;
  minimum_samples integer := coalesce((base#>>'{draft_quality_gate,minimum_samples}')::integer, 30);
  max_safety numeric := coalesce((base#>>'{draft_quality_gate,thresholds,max_safety_correction_share}')::numeric, 0.02);
  max_rewrite numeric := coalesce((base#>>'{draft_quality_gate,thresholds,max_manual_rewrite_share}')::numeric, 0.25);
  max_edit numeric := coalesce((base#>>'{draft_quality_gate,thresholds,max_median_edit_ratio}')::numeric, 0.35);
  category_counts jsonb := '{}'::jsonb;
  category_coverage_passed boolean := false;
  quality_passed boolean := false;
  quality_status text := 'observing';
  decision_passed boolean := coalesce((base#>>'{decision_gate,passed}')::boolean, false);
  effective_stage text := 'review_only';
begin
  with feedback_scope as (
    select feedback.*
    from public.email_agent_feedback as feedback
    join lateral (
      select log.context_snapshot
      from public.email_agent_log as log
      where log.message_id = feedback.source_message_id
        and log.draft_created = true
      order by log.created_at desc
      limit 1
    ) as latest_log on true
    where feedback.is_valid = true
      and feedback.collected_at >= now() - interval '90 days'
      and latest_log.context_snapshot#>>'{evidence_card,version}' = 'email-evidence-card-v2'
      and coalesce(
        latest_log.context_snapshot#>>'{evidence_card,facts_package_version}',
        latest_log.context_snapshot#>>'{facts_package,version}'
      ) = 'email-facts-package-v2'
  )
  select
    count(*)::integer,
    count(*) filter (where edit_labels && array[
      'amount_changed', 'date_changed', 'attachment_reference_changed',
      'commitment_changed', 'internal_detail_removed', 'factual_correction'
    ]::text[])::integer,
    count(*) filter (where edit_labels && array['manual_rewrite']::text[])::integer,
    coalesce(round(percentile_disc(0.5) within group (order by edit_ratio)::numeric, 6), 0)
  into current_total, safety_count, rewrite_count, median_edit
  from feedback_scope;

  with required(category) as (
    values ('general'::text), ('product'), ('invoice'), ('shipping'), ('complaint')
  ), observed as (
    select
      required.category,
      count(feedback.id) filter (
        where coalesce(
          latest_log.context_snapshot#>>'{evidence_card,facts_package_version}',
          latest_log.context_snapshot#>>'{facts_package,version}'
        ) = 'email-facts-package-v2'
      )::integer as samples
    from required
    left join public.email_agent_feedback_analysis_v1 as analysis
      on analysis.signal_summary->>'category' = required.category
     and analysis.analyzer_version = 'email-feedback-analyzer-v5'
    left join public.email_agent_feedback as feedback
      on feedback.id = analysis.feedback_id
     and feedback.is_valid = true
     and feedback.collected_at >= now() - interval '90 days'
    left join lateral (
      select log.context_snapshot
      from public.email_agent_log as log
      where log.message_id = feedback.source_message_id
        and log.draft_created = true
      order by log.created_at desc
      limit 1
    ) as latest_log on true
    group by required.category
  )
  select
    coalesce(jsonb_object_agg(category, samples order by category), '{}'::jsonb),
    coalesce(bool_and(samples >= 3), false)
  into category_counts, category_coverage_passed
  from observed;

  safety_share := case when current_total = 0 then 0 else round(safety_count::numeric / current_total, 6) end;
  rewrite_share := case when current_total = 0 then 0 else round(rewrite_count::numeric / current_total, 6) end;
  quality_passed := current_total >= minimum_samples
    and category_coverage_passed
    and safety_share <= max_safety
    and rewrite_share <= max_rewrite
    and median_edit <= max_edit;
  quality_status := case
    when current_total < minimum_samples or not category_coverage_passed then 'observing'
    when quality_passed then 'passed'
    else 'blocked'
  end;
  effective_stage := case
    when base->>'requested_stage' = 'shadow' then 'shadow'
    when base->>'requested_stage' = 'routing_gate' and decision_passed and quality_passed then 'routing_gate'
    else 'review_only'
  end;

  return (base - 'version' - 'draft_quality_gate' - 'effective_stage' - 'rollout_ready'
    - 'allow_action_driving_no_reply' - 'create_human_review_drafts')
    || jsonb_build_object(
      'version', 'email-agent-rollout-gate-v2',
      'effective_stage', effective_stage,
      'draft_quality_gate', jsonb_build_object(
        'status', quality_status,
        'passed', quality_passed,
        'current_version', 'email-facts-package-v2',
        'current_samples', current_total,
        'minimum_samples', minimum_samples,
        'minimum_category_samples', 3,
        'category_sample_counts', category_counts,
        'category_coverage_passed', category_coverage_passed,
        'safety_correction_count', safety_count,
        'safety_correction_share', safety_share,
        'manual_rewrite_count', rewrite_count,
        'manual_rewrite_share', rewrite_share,
        'median_edit_ratio', median_edit,
        'thresholds', jsonb_build_object(
          'max_safety_correction_share', max_safety,
          'max_manual_rewrite_share', max_rewrite,
          'max_median_edit_ratio', max_edit
        )
      ),
      'allow_action_driving_no_reply', effective_stage = 'routing_gate',
      'create_human_review_drafts', effective_stage in ('review_only', 'routing_gate'),
      'automatic_send_allowed', false,
      'human_send_approval_required', true,
      'rollout_ready', decision_passed and quality_passed
    );
end;
$function$;

revoke all on function public.get_email_agent_rollout_gate_v2()
  from public, anon, authenticated;
grant execute on function public.get_email_agent_rollout_gate_v2()
  to service_role;

comment on function public.get_email_agent_rollout_gate_v2() is
  'Review-only rollout gate for facts package v2 with per-category sample coverage. It cannot enable automatic sending.';
