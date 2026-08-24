begin;

select public.complete_email_agent_message(
  'riesenobjekte-first-party:000ff1ce-1111-4111-8111-111111111111',
  jsonb_build_object(
    'message_id', '000ff1ce-1111-4111-8111-111111111111',
    'conversation_id', 'ro-description-test',
    'from_email', 'ro-description-test@example.invalid',
    'from_name', 'RO Description Test',
    'subject', 'Rollback-only Trello description check',
    'body_preview', 'Ein Riesenobjekt mit 11 Meter Hoehe.',
    'category', 'general',
    'confidence', 1,
    'order_found', false,
    'order_count', 0,
    'draft_id', '',
    'draft_body_preview', 'Keine automatische Kundenantwort',
    'processing_time_ms', 1,
    'knowledge_version_ids', '[]'::jsonb,
    'knowledge_match_count', 0,
    'internet_message_id', 'ro-description-test@example.invalid',
    'message_source', 'riesenobjekte_first_party',
    'context_snapshot', jsonb_build_object(
      'project_brief', jsonb_build_object(
        'object_type', 'Testobjekt',
        'application', 'Test',
        'size', '11 Meter hoch',
        'event_date', 'Noch offen',
        'event_location', 'Noch offen',
        'project_description', 'Ein Riesenobjekt mit 11 Meter Hoehe.',
        'attachment_count', 0
      )
    )
  )
);

do $assertions$
declare
  projected_description text;
begin
  select outbox.payload->>'card_description'
  into projected_description
  from public.ro_projection_outbox as outbox
  join public.ro_projects as project on project.id = outbox.aggregate_id
  join public.email_agent_log as email on email.id = project.source_email_log_id
  where email.message_id = '000ff1ce-1111-4111-8111-111111111111'
    and outbox.projection_type = 'trello_card_create_v1';

  if projected_description is null then
    raise exception 'Expected Trello projection was not created';
  end if;

  if projected_description not like '%Groesse: 11 Meter hoch%' then
    raise exception 'Literal requested size was not preserved';
  end if;

  if projected_description not like '%Projektbeschreibung: Ein Riesenobjekt mit 11 Meter Hoehe.%' then
    raise exception 'Original email text was not preserved';
  end if;

  if projected_description like E'%Größen:\n- 200 cm\n- 300 cm%' then
    raise exception 'Hard-coded default sizes are still projected';
  end if;
end;
$assertions$;

rollback;
