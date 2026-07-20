set role service_role;

insert into public.email_agent_log (
  message_id, draft_created, message_source, category, reply_length_class,
  risk_level, draft_body_text, context_snapshot
)
select
  'learning-safe-' || value,
  true,
  'external_email',
  'general',
  'simple',
  'low',
  'Guten Tag Anna,' || E'\n\n' || 'vielen Dank für Ihre Nachricht. Der Vorgang ist geklärt.' || E'\n\n' || 'Viele Grüße',
  jsonb_build_object(
    'quality_gate', jsonb_build_object(
      'version', 'email-draft-quality-gate-v3',
      'passed', true,
      'soft_flags', jsonb_build_array('generic_thank_you_before_answer')
    )
  )
from generate_series(1, 5) as value;

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, draft_body_hash, sent_body_hash,
  sent_body_text, edit_ratio, edit_summary, edit_labels, change_profile,
  review_priority
)
select
  'learning-safe-' || value,
  'learning-safe-sent-' || value,
  'draft-' || value,
  'sent-' || value,
  'Guten Tag Anna,' || E'\n\n' || 'Der Vorgang ist geklärt.' || E'\n\n' || 'Viele Grüße',
  0.15,
  jsonb_build_object('sent_words', 8 + value, 'sent_paragraphs', 1),
  array['shortened']::text[],
  '{}'::jsonb,
  'normal'
from generate_series(1, 5) as value;

do $$
declare
  feedback_row record;
  review_result jsonb;
  replay_result jsonb;
  index_value integer := 0;
begin
  for feedback_row in
    select id
    from public.email_agent_feedback
    where source_message_id like 'learning-safe-%'
    order by id
  loop
    index_value := index_value + 1;
    review_result := public.review_email_agent_feedback_v3(
      feedback_row.id,
      'approved',
      array['too_long']::text[],
      'Als kurze, vollständige Stilkorrektur geprüft.',
      'Fabienne Test',
      '11111111-1111-4111-8111-' || lpad(index_value::text, 12, '0')
    );
    if (review_result->>'updated')::boolean is not true then
      raise exception 'safe v3 review did not update: %', review_result;
    end if;
  end loop;

  select id into feedback_row
  from public.email_agent_feedback
  where source_message_id = 'learning-safe-1';
  replay_result := public.review_email_agent_feedback_v3(
    feedback_row.id,
    'approved',
    array['too_long']::text[],
    'Als kurze, vollständige Stilkorrektur geprüft.',
    'Fabienne Test',
    '11111111-1111-4111-8111-000000000001'
  );
  if (replay_result->>'idempotent_replay')::boolean is not true then
    raise exception 'v3 review replay was not idempotent: %', replay_result;
  end if;
end;
$$;

insert into public.email_agent_log (
  message_id, draft_created, message_source, category, reply_length_class,
  risk_level, draft_body_text
) values (
  'learning-factual',
  true,
  'external_email',
  'invoice',
  'complex',
  'high',
  'Guten Tag Anna, der Betrag beträgt 100 Euro. Viele Grüße'
);

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, draft_body_hash, sent_body_hash,
  sent_body_text, edit_ratio, edit_summary, edit_labels, change_profile,
  review_priority
) values (
  'learning-factual',
  'learning-factual-sent',
  'factual-draft',
  'factual-sent',
  'Guten Tag Anna, der korrekte Betrag beträgt 120 Euro. Viele Grüße',
  0.25,
  '{"sent_words":10,"sent_paragraphs":1}'::jsonb,
  array['factual_correction', 'amount_changed']::text[],
  '{}'::jsonb,
  'high'
);

do $$
declare
  feedback_id_value bigint;
  review_result jsonb;
  approval_failed boolean := false;
  profile jsonb;
  metrics jsonb;
begin
  select id into feedback_id_value
  from public.email_agent_feedback
  where source_message_id = 'learning-factual';

  review_result := public.review_email_agent_feedback_v3(
    feedback_id_value,
    'rejected',
    array['factual_error', 'price_or_offer_error']::text[],
    'Faktenkorrektur getrennt zur Wissensprüfung vormerken.',
    'Fabienne Test',
    '22222222-2222-4222-8222-222222222222'
  );
  if nullif(review_result->>'improvement_candidate_id', '') is null then
    raise exception 'factual review did not create an improvement candidate: %', review_result;
  end if;

  begin
    perform public.review_email_agent_feedback_v3(
      feedback_id_value,
      'approved',
      array['factual_error']::text[],
      'Fakten dürfen nicht als Stil gelernt werden.',
      'Fabienne Test',
      '33333333-3333-4333-8333-333333333333'
    );
  exception when others then
    approval_failed := true;
  end;
  if approval_failed is not true then
    raise exception 'factual correction was unexpectedly approved for style';
  end if;

  profile := public.get_email_agent_style_profile_v3('external_email', 'general', 'simple');
  if profile->>'version' <> 'email-style-profile-v3-human-gated'
     or (profile->>'eligible')::boolean is not true
     or (profile->>'approved_sample_count')::integer <> 5
     or (profile->>'recommended_max_paragraphs')::integer <> 1 then
    raise exception 'unexpected v3 style profile: %', profile;
  end if;

  metrics := public.get_email_agent_learning_quality_v3();
  if metrics->>'version' <> 'email-agent-learning-quality-v3'
     or (metrics#>>'{feedback,approved}')::integer <> 5
     or (metrics#>>'{improvement_candidates,pending}')::integer <> 1
     or (metrics#>>'{quality_gate_7d,evaluated}')::integer <> 5
     or (metrics->>'automatic_send_allowed')::boolean is not false then
    raise exception 'unexpected learning quality metrics: %', metrics;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.email_agent_improvement_candidates
    where contains_customer_content is true
  ) then
    raise exception 'improvement candidate unexpectedly stored customer content';
  end if;
end;
$$;

reset role;

select
  public.get_email_agent_style_profile_v3('external_email', 'general', 'simple') as style_profile,
  public.get_email_agent_learning_quality_v3() as quality_metrics,
  (select count(*) from public.email_agent_improvement_candidates where status = 'pending') as pending_improvements;
