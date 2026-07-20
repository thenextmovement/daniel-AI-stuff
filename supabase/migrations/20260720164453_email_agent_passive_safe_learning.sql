create or replace view public.email_agent_auto_style_eligibility_v1
with (security_invoker = true)
as
with feedback_context as (
  select
    feedback.id as feedback_id,
    feedback.is_valid,
    feedback.learning_status,
    feedback.collected_at,
    feedback.edit_ratio,
    feedback.edit_labels,
    feedback.edit_summary,
    feedback.change_profile,
    feedback.review_reason_codes,
    feedback.sent_body_text,
    matched_log.draft_body_text,
    coalesce(matched_log.message_source, 'external_email') as channel,
    coalesce(matched_log.category, 'general') as category,
    coalesce(matched_log.reply_length_class, 'simple') as reply_length_class,
    coalesce(matched_log.risk_level, 'low') as risk_level
  from public.email_agent_feedback as feedback
  join lateral (
    select
      log.message_source,
      log.category,
      log.reply_length_class,
      log.risk_level,
      log.draft_body_text
    from public.email_agent_log as log
    where log.message_id = feedback.source_message_id
      and log.draft_created = true
    order by log.created_at desc
    limit 1
  ) as matched_log on true
), evaluated as (
  select
    context.*,
    coalesce(
      case
        when context.change_profile#>>'{semantic_deltas,question_delta}' ~ '^-?[0-9]+$'
          then (context.change_profile#>>'{semantic_deltas,question_delta}')::integer
        else 0
      end,
      0
    ) as question_delta,
    lower(coalesce(context.change_profile#>>'{semantic_deltas,amounts_changed}', 'false')) = 'true' as amounts_changed,
    lower(coalesce(context.change_profile#>>'{semantic_deltas,dates_changed}', 'false')) = 'true' as dates_changed,
    lower(coalesce(context.change_profile#>>'{semantic_deltas,attachment_references_changed}', 'false')) = 'true' as attachments_changed,
    lower(coalesce(context.change_profile#>>'{semantic_deltas,commitment_changed}', 'false')) = 'true' as commitment_changed,
    lower(coalesce(context.change_profile#>>'{semantic_deltas,internal_detail_removed}', 'false')) = 'true' as internal_detail_removed,
    coalesce(
      case
        when context.edit_summary->>'sent_words' ~ '^[1-9][0-9]{0,3}$'
          then (context.edit_summary->>'sent_words')::integer
        else null
      end,
      0
    ) as sent_words,
    greatest(1, least(8, coalesce(
      case
        when context.edit_summary->>'sent_paragraphs' ~ '^[1-8]$'
          then (context.edit_summary->>'sent_paragraphs')::integer
        else null
      end,
      1
    ))) as sent_paragraphs,
    case
      when context.sent_body_text ~* E'Beste Gr[uü][sß]e[[:space:],.!]*$' then 'beste_gruesse'
      when context.sent_body_text ~* E'Viele Gr[uü][sß]e[[:space:],.!]*$' then 'viele_gruesse'
      when context.sent_body_text ~* E'Best regards[[:space:],.!]*$' then 'best_regards'
      else 'other'
    end as closing_style,
    context.draft_body_text ~* E'(intern.{0,30}(prüfen|klären|abklären)|melden uns (?:anschließend|später|danach)|get back to you)' as draft_has_deferral,
    context.sent_body_text ~* E'(intern.{0,30}(prüfen|klären|abklären)|melden uns (?:anschließend|später|danach)|get back to you)' as sent_has_deferral,
    context.sent_body_text ~* E'(garantiert|definitiv|auf jeden fall|wir garantieren|wir liefern am|kommt sicher am|wir erstatten|gutschrift erstellt|kostenlos|gratis|[0-9]+[[:space:]]*%[[:space:]]*rabatt|kulanz gewährt)' as sent_has_unsafe_commitment,
    coalesce(context.edit_labels, '{}'::text[]) && array[
      'question_added', 'question_removed', 'amount_changed', 'date_changed',
      'attachment_reference_changed', 'commitment_changed', 'internal_detail_removed',
      'factual_correction', 'manual_rewrite'
    ]::text[] as has_semantic_or_rewrite_label
  from feedback_context as context
), classified as (
  select
    evaluated.*,
    evaluated.is_valid
      and evaluated.collected_at >= now() - interval '90 days'
      and evaluated.learning_status = 'pending'
      and evaluated.risk_level <> 'high'
      and evaluated.edit_ratio <= 0.65
      and not evaluated.has_semantic_or_rewrite_label
      and evaluated.question_delta = 0
      and not evaluated.amounts_changed
      and not evaluated.dates_changed
      and not evaluated.attachments_changed
      and not evaluated.commitment_changed
      and not evaluated.internal_detail_removed
      and evaluated.sent_words > 0
      and not evaluated.draft_has_deferral
      and not evaluated.sent_has_deferral
      and not evaluated.sent_has_unsafe_commitment
      as automatic_style_eligible,
    evaluated.is_valid
      and evaluated.collected_at >= now() - interval '90 days'
      and evaluated.learning_status = 'approved'
      and evaluated.risk_level <> 'high'
      and evaluated.edit_ratio <= 0.65
      and not evaluated.has_semantic_or_rewrite_label
      and evaluated.question_delta = 0
      and not evaluated.amounts_changed
      and not evaluated.dates_changed
      and not evaluated.attachments_changed
      and not evaluated.commitment_changed
      and not evaluated.internal_detail_removed
      and evaluated.sent_words > 0
      and not evaluated.draft_has_deferral
      and not evaluated.sent_has_deferral
      and not evaluated.sent_has_unsafe_commitment
      as human_style_eligible
  from evaluated
)
select
  classified.feedback_id,
  classified.channel,
  classified.category,
  classified.reply_length_class,
  classified.risk_level,
  classified.collected_at,
  classified.sent_words,
  classified.sent_paragraphs,
  classified.closing_style,
  coalesce(classified.edit_labels, '{}'::text[]) @> array['shortened']::text[] as shortened,
  coalesce(classified.edit_labels, '{}'::text[]) @> array['expanded']::text[] as expanded,
  coalesce(classified.edit_labels, '{}'::text[]) @> array['unchanged']::text[] as unchanged,
  coalesce(classified.review_reason_codes, '{}'::text[]) @> array['direct_answer_first']::text[] as direct_answer_first,
  coalesce(classified.review_reason_codes, '{}'::text[]) @> array['avoid_repetition']::text[] as avoid_repetition,
  classified.automatic_style_eligible,
  classified.human_style_eligible,
  classified.automatic_style_eligible or classified.human_style_eligible as eligible,
  case
    when classified.human_style_eligible then 'human_approved'
    when classified.automatic_style_eligible then 'automatic_safe_style'
    else null
  end as sample_source,
  array_remove(array[
    case when not classified.is_valid then 'invalid_feedback' end,
    case when classified.learning_status in ('rejected', 'ignored') then 'manual_exclusion' end,
    case when classified.collected_at < now() - interval '90 days' then 'outside_window' end,
    case when classified.risk_level = 'high' then 'high_risk' end,
    case when classified.edit_ratio > 0.65 then 'edit_too_large' end,
    case when classified.has_semantic_or_rewrite_label then 'semantic_or_rewrite_change' end,
    case when classified.question_delta <> 0 then 'question_change' end,
    case when classified.amounts_changed then 'amount_change' end,
    case when classified.dates_changed then 'date_change' end,
    case when classified.attachments_changed then 'attachment_change' end,
    case when classified.commitment_changed then 'commitment_change' end,
    case when classified.internal_detail_removed then 'internal_detail_change' end,
    case when classified.sent_words <= 0 then 'missing_structure_metrics' end,
    case when classified.draft_has_deferral or classified.sent_has_deferral then 'unsafe_deferral' end,
    case when classified.sent_has_unsafe_commitment then 'unsafe_commitment' end,
    case
      when classified.learning_status = 'pending'
        and not classified.automatic_style_eligible
        and classified.risk_level <> 'high'
        and classified.is_valid
        and classified.collected_at >= now() - interval '90 days'
      then 'automatic_gate_not_met'
    end
  ], null)::text[] as block_reasons,
  'email-auto-style-eligibility-v1'::text as eligibility_version,
  false as facts_or_customer_content_included,
  false as automatic_prompt_rewrite_allowed,
  true as customer_send_human_approval_required
from classified;

revoke all on public.email_agent_auto_style_eligibility_v1
  from public, anon, authenticated;
grant select on public.email_agent_auto_style_eligibility_v1
  to service_role;

comment on view public.email_agent_auto_style_eligibility_v1 is
  'Deterministic, content-free eligibility projection for passive email style learning. It exposes only aggregate-safe structure and bounded reason codes.';

create or replace function public.get_email_agent_style_profile_v4(
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
    where nullif(p_channel, '') is not null
      and nullif(p_reply_length_class, '') is not null
    union all
    select 'global', true, 3
    where nullif(p_reply_length_class, '') is not null
    union all
    select 'channel', false, 4
    where nullif(p_channel, '') is not null
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
      from public.email_agent_auto_style_eligibility_v1 as signal
      where signal.eligible = true
        and (scope.scope_key = 'global' or signal.channel = p_channel)
        and (scope.scope_key <> 'category' or signal.category = p_category)
        and (not scope.length_specific or signal.reply_length_class = p_reply_length_class)
    ) as stats
    order by (stats.sample_count >= 3) desc, scope.priority
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

  if sample_count >= 3 and median_words is not null then
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
    'version', 'email-style-profile-v4-passive-safe',
    'learning_mode', 'passive_deterministic',
    'eligible', sample_count >= 3,
    'minimum_safe_samples', 3,
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
    'prefer_shorter', sample_count >= 3 and shortened_share >= 0.40,
    'prefer_direct_answer', sample_count >= 3 and direct_first_share >= 0.40,
    'avoid_restatement', sample_count >= 3 and repetition_share >= 0.40,
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

revoke all on function public.get_email_agent_style_profile_v4(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile_v4(text, text, text)
  to service_role;

create or replace function public.get_email_agent_learning_quality_v4()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with feedback_counts as (
    select
      count(*) filter (where is_valid = true)::integer as total,
      count(*) filter (where is_valid = true and learning_status = 'pending')::integer as pending,
      count(*) filter (where is_valid = true and learning_status = 'approved')::integer as approved,
      count(*) filter (where is_valid = true and learning_status = 'rejected')::integer as rejected,
      count(*) filter (where is_valid = true and learning_status = 'ignored')::integer as ignored
    from public.email_agent_feedback
  ), passive_counts as (
    select
      count(*)::integer as evaluated,
      count(*) filter (where eligible = true)::integer as safe_samples,
      count(*) filter (where automatic_style_eligible = true)::integer as automatic_samples,
      count(*) filter (where human_style_eligible = true)::integer as human_samples,
      count(*) filter (where eligible = false)::integer as blocked_samples
    from public.email_agent_auto_style_eligibility_v1
  ), block_counts as (
    select coalesce(jsonb_object_agg(reason, reason_count), '{}'::jsonb) as values
    from (
      select reason, count(*)::integer as reason_count
      from public.email_agent_auto_style_eligibility_v1 as signal
      cross join lateral unnest(signal.block_reasons) as reason
      where signal.eligible = false
      group by reason
      order by reason
    ) grouped
  ), improvement_counts as (
    select
      count(*) filter (where status = 'pending')::integer as pending,
      count(*) filter (where status = 'pending' and candidate_type = 'knowledge')::integer as knowledge,
      count(*) filter (where status = 'pending' and candidate_type = 'resolver')::integer as resolver,
      count(*) filter (where status = 'pending' and candidate_type = 'policy')::integer as policy,
      count(*) filter (where status = 'pending' and candidate_type = 'manual_review')::integer as manual_review
    from public.email_agent_improvement_candidates
  ), quality_counts as (
    select
      count(*)::integer as evaluated,
      count(*) filter (
        where coalesce((context_snapshot#>>'{quality_gate,passed}')::boolean, false) = true
      )::integer as passed,
      count(*) filter (
        where jsonb_array_length(
          case when jsonb_typeof(context_snapshot#>'{quality_gate,soft_flags}') = 'array'
            then context_snapshot#>'{quality_gate,soft_flags}' else '[]'::jsonb end
        ) > 0
      )::integer as soft_flagged
    from public.email_agent_log
    where created_at >= now() - interval '7 days'
      and context_snapshot#>>'{quality_gate,version}' = 'email-draft-quality-gate-v3'
  )
  select jsonb_build_object(
    'version', 'email-agent-learning-quality-v4',
    'feedback', jsonb_build_object(
      'total', feedback_counts.total,
      'pending_manual_reviews', feedback_counts.pending,
      'approved', feedback_counts.approved,
      'rejected', feedback_counts.rejected,
      'ignored', feedback_counts.ignored,
      'manual_reviews_required_for_safe_style', false
    ),
    'passive_learning', jsonb_build_object(
      'version', 'email-auto-style-eligibility-v1',
      'evaluated', passive_counts.evaluated,
      'safe_samples', passive_counts.safe_samples,
      'automatic_samples', passive_counts.automatic_samples,
      'human_samples', passive_counts.human_samples,
      'blocked_samples', passive_counts.blocked_samples,
      'block_reason_counts', block_counts.values,
      'customer_content_stored', false
    ),
    'style_profile', public.get_email_agent_style_profile_v4(null, null, null),
    'improvement_candidates', jsonb_build_object(
      'pending', improvement_counts.pending,
      'knowledge', improvement_counts.knowledge,
      'resolver', improvement_counts.resolver,
      'policy', improvement_counts.policy,
      'manual_review', improvement_counts.manual_review,
      'customer_content_stored', false
    ),
    'quality_gate_7d', jsonb_build_object(
      'evaluated', quality_counts.evaluated,
      'passed', quality_counts.passed,
      'soft_flagged', quality_counts.soft_flagged
    ),
    'automatic_prompt_rewrite_allowed', false,
    'fact_learning_allowed', false,
    'manual_review_required_for_safe_style', false,
    'automatic_send_allowed', false,
    'customer_send_human_approval_required', true
  )
  from feedback_counts, passive_counts, block_counts, improvement_counts, quality_counts;
$function$;

revoke all on function public.get_email_agent_learning_quality_v4()
  from public, anon, authenticated;
grant execute on function public.get_email_agent_learning_quality_v4()
  to service_role;

comment on function public.get_email_agent_learning_quality_v4() is
  'Aggregate, content-free metrics for passive deterministic style learning. Customer sending remains human-approved.';
