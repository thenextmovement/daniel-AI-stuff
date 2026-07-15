create or replace function public.get_email_agent_style_profile(
  p_channel text default null,
  p_category text default null,
  p_reply_length_class text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  sample_count integer := 0;
  median_words integer := null;
  shortened_share numeric := 0;
  expanded_share numeric := 0;
  greeting_change_share numeric := 0;
  closing_change_share numeric := 0;
  recommended_max_words integer := null;
begin
  select
    count(*)::integer,
    percentile_disc(0.5) within group (
      order by (f.edit_summary->>'sent_words')::integer
    )::integer,
    coalesce(avg((f.edit_labels @> array['shortened']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['expanded']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['greeting_changed']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['closing_changed']::text[])::integer), 0)
  into sample_count, median_words, shortened_share, expanded_share,
       greeting_change_share, closing_change_share
  from public.email_agent_feedback f
  join public.email_agent_log l on l.message_id = f.source_message_id
  where f.is_valid = true
    and f.learning_status = 'approved'
    and f.collected_at >= now() - interval '90 days'
    and coalesce(f.edit_summary->>'sent_words', '') ~ '^[0-9]{1,5}$'
    and not (f.edit_labels && array[
      'question_added', 'question_removed', 'amount_changed', 'date_changed',
      'attachment_reference_changed', 'commitment_changed', 'internal_detail_removed',
      'factual_correction', 'manual_rewrite', 'needs_human_review'
    ]::text[])
    and (nullif(p_channel, '') is null or l.message_source = p_channel)
    and (nullif(p_category, '') is null or l.category = p_category)
    and (nullif(p_reply_length_class, '') is null or l.reply_length_class = p_reply_length_class);

  if sample_count >= 3 and median_words is not null then
    recommended_max_words := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(8, least(80, median_words + 8))
      when 'complex' then greatest(60, least(360, median_words + 30))
      else greatest(25, least(180, median_words + 18))
    end;
  end if;

  return jsonb_build_object(
    'version', 'email-style-profile-v1',
    'eligible', sample_count >= 3,
    'approved_sample_count', sample_count,
    'window_days', 90,
    'channel', nullif(p_channel, ''),
    'category', nullif(p_category, ''),
    'reply_length_class', nullif(p_reply_length_class, ''),
    'median_sent_words', median_words,
    'recommended_max_words', recommended_max_words,
    'prefer_shorter', sample_count >= 3 and shortened_share >= 0.60,
    'shortened_share', round(shortened_share, 4),
    'expanded_share', round(expanded_share, 4),
    'greeting_change_share', round(greeting_change_share, 4),
    'closing_change_share', round(closing_change_share, 4),
    'facts_or_customer_content_included', false,
    'automatic_prompt_rewrite_allowed', false
  );
end;
$function$;

revoke all on function public.get_email_agent_style_profile(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile(text, text, text)
  to service_role;
