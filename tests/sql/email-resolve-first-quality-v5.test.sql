do $$
declare
  feedback_id bigint;
  analysis jsonb;
  profile jsonb;
  quality jsonb;
  rollout jsonb;
  counter integer;
begin
  insert into public.email_agent_log (
    id, message_id, draft_created, draft_body_text, category,
    message_source, risk_level, reply_length_class, context_snapshot
  ) values (
    '00000000-0000-0000-0000-000000000001', 'policy-case', true,
    'Guten Tag, wir prüfen das intern und melden uns später. Viele Grüße',
    'general', 'external_email', 'low', 'simple',
    '{"evidence_card":{"version":"email-evidence-card-v2","facts_package_version":"email-facts-package-v2"}}'
  );
  insert into public.email_agent_feedback (
    source_message_id, sent_message_id, sent_body_text, edit_ratio,
    edit_labels, change_profile, review_priority
  ) values (
    'policy-case', 'sent-policy-case', 'Guten Tag, die Antwort lautet direkt: erledigt. Viele Grüße', 0.30,
    array['shortened'],
    '{"match":{"target_recipient_present":true},"semantic_deltas":{"question_delta":0,"amounts_changed":false,"dates_changed":false,"attachment_references_changed":false,"commitment_changed":false,"internal_detail_removed":false}}',
    'normal'
  ) returning id into feedback_id;

  analysis := public.analyze_email_agent_feedback_v5(feedback_id);
  if analysis->>'classification' <> 'policy_gap'
     or not (analysis->'defect_codes' ? 'unnecessary_internal_deferral') then
    raise exception 'expected automatic deferral policy classification, got %', analysis;
  end if;

  insert into public.email_agent_log (
    id, message_id, draft_created, draft_body_text, category,
    message_source, risk_level, reply_length_class, context_snapshot
  ) values (
    '00000000-0000-0000-0000-000000000002', 'attachment-case', true,
    'Guten Tag, danke für Ihre Nachricht. Viele Grüße',
    'product', 'external_email', 'low', 'simple',
    '{"evidence_card":{"version":"email-evidence-card-v2","facts_package_version":"email-facts-package-v2"}}'
  );
  insert into public.email_agent_feedback (
    source_message_id, sent_message_id, sent_body_text, edit_ratio,
    edit_labels, change_profile, review_priority
  ) values (
    'attachment-case', 'sent-attachment-case',
    'Guten Tag, der Lieferschein liegt vor; die Bestellbestätigung fehlt. Viele Grüße', 0.30,
    array['attachment_reference_changed', 'factual_correction'],
    '{"match":{"target_recipient_present":true},"semantic_deltas":{"question_delta":0,"amounts_changed":false,"dates_changed":false,"attachment_references_changed":true,"draft_attachment_references":[],"sent_attachment_references":["delivery_note","order_confirmation"],"commitment_changed":false,"internal_detail_removed":false}}',
    'normal'
  ) returning id into feedback_id;

  analysis := public.analyze_email_agent_feedback_v5(feedback_id);
  if analysis->>'classification' <> 'resolver_gap'
     or not (analysis->'defect_codes' ? 'attachment_missed') then
    raise exception 'expected automatic attachment resolver classification, got %', analysis;
  end if;

  for counter in 1..10 loop
    insert into public.email_agent_log (
      id, message_id, draft_created, draft_body_text, category,
      message_source, risk_level, reply_length_class, context_snapshot
    ) values (
      ('10000000-0000-0000-0000-' || lpad(counter::text, 12, '0'))::uuid,
      'safe-' || counter, true,
      'Guten Tag, hier ist die direkte Antwort. Viele Grüße',
      'general', 'external_email', 'low', 'simple',
      '{"evidence_card":{"version":"email-evidence-card-v2","facts_package_version":"email-facts-package-v2"}}'
    );
    insert into public.email_agent_feedback (
      source_message_id, sent_message_id, sent_body_text, edit_ratio,
      edit_summary, edit_labels, change_profile, review_priority
    ) values (
      'safe-' || counter, 'sent-safe-' || counter,
      'Guten Tag, hier ist die direkte Antwort. Viele Grüße', 0.01,
      '{"sent_words":9,"sent_paragraphs":2}', array['unchanged'],
      '{"match":{"target_recipient_present":true},"semantic_deltas":{"question_delta":0,"amounts_changed":false,"dates_changed":false,"attachment_references_changed":false,"draft_attachment_references":[],"sent_attachment_references":[],"commitment_changed":false,"internal_detail_removed":false}}',
      'low'
    ) returning id into feedback_id;
    insert into public.email_agent_auto_style_eligibility_v1 (
      feedback_id, channel, category, reply_length_class, risk_level,
      collected_at, sent_words, sent_paragraphs, closing_style,
      shortened, expanded, unchanged, direct_answer_first, avoid_repetition,
      automatic_style_eligible, human_style_eligible, eligible, sample_source
    ) values (
      feedback_id, 'external_email', 'general', 'simple', 'low', now(),
      9, 2, 'viele_gruesse', false, false, true, true, true,
      true, false, true, 'automatic_safe_style'
    );
  end loop;

  profile := public.get_email_agent_style_profile_v5('external_email', 'general', 'simple');
  if coalesce((profile->>'eligible')::boolean, false) is not true
     or (profile->>'minimum_safe_samples')::integer <> 10
     or profile->>'version' <> 'email-style-profile-v5-passive-safe' then
    raise exception 'expected v5 style profile after ten safe samples, got %', profile;
  end if;

  quality := public.get_email_agent_learning_quality_v5();
  if quality->>'version' <> 'email-agent-learning-quality-v5'
     or (quality#>>'{automatic_analysis,policy_gap}')::integer < 1
     or (quality#>>'{automatic_analysis,resolver_gap}')::integer < 1
     or coalesce((quality->>'automatic_send_allowed')::boolean, true) then
    raise exception 'unexpected learning quality result: %', quality;
  end if;

  rollout := public.get_email_agent_rollout_gate_v2();
  if rollout->>'version' <> 'email-agent-rollout-gate-v2'
     or rollout#>>'{draft_quality_gate,current_version}' <> 'email-facts-package-v2'
     or coalesce((rollout->>'automatic_send_allowed')::boolean, true)
     or coalesce((rollout->>'human_send_approval_required')::boolean, false) is not true then
    raise exception 'unexpected rollout gate: %', rollout;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_agent_feedback_analysis_v1'
      and column_name in ('customer_body', 'message_body', 'draft_body_text', 'sent_body_text')
  ) then
    raise exception 'analysis table must not store customer or message content';
  end if;
end;
$$;
