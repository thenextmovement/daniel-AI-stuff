begin;

create or replace function public.ro_enqueue_first_party_trello_projection_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  project_row public.ro_projects%rowtype;
  clean_name text;
  card_name text;
  card_description text;
  project_brief_text text;
  board_id constant text := '6a672e55823b82cdbebd818c';
  list_id constant text := '6a672e6e01eb9ea6bfb7e4d5';
begin
  if new.message_source is distinct from 'riesenobjekte_first_party'
    or new.request_id is null
    or new.request_id not like 'riesenobjekte-first-party:%'
  then
    return new;
  end if;

  clean_name := left(
    coalesce(nullif(btrim(new.from_name), ''), 'Neue Anfrage'),
    180
  );

  project_brief_text := left(
    concat_ws(
      E'\n',
      'Objekttyp: ' ||
        coalesce(new.context_snapshot #>> '{project_brief,object_type}', ''),
      'Einsatzbereich: ' ||
        coalesce(new.context_snapshot #>> '{project_brief,application}', ''),
      'Groesse: ' ||
        coalesce(new.context_snapshot #>> '{project_brief,size}', ''),
      'Einsatztermin: ' ||
        coalesce(new.context_snapshot #>> '{project_brief,event_date}', ''),
      'Einsatzort: ' ||
        coalesce(new.context_snapshot #>> '{project_brief,event_location}', ''),
      'Projektbeschreibung: ' ||
        coalesce(
          nullif(
            new.context_snapshot #>> '{project_brief,project_description}',
            ''
          ),
          new.body_preview,
          ''
        )
    ),
    5000
  );

  insert into public.ro_projects (
    project_code,
    name,
    description,
    status,
    source_email_log_id
  )
  values (
    'RO-LEAD-' || upper(left(replace(new.id::text, '-', ''), 12)),
    clean_name,
    project_brief_text,
    'draft',
    new.id
  )
  on conflict (source_email_log_id)
  where source_email_log_id is not null
  do nothing;

  select *
  into project_row
  from public.ro_projects
  where source_email_log_id = new.id;

  if project_row.id is null then
    raise exception 'First-party project could not be resolved';
  end if;

  card_name := left(project_row.project_code || ' | ' || clean_name, 240);
  card_description := concat_ws(
    E'\n',
    project_row.project_code,
    '',
    'Größen:',
    '- 200 cm',
    '- 300 cm'
  );

  insert into public.ro_projection_outbox (
    projection_type,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload
  )
  values (
    'trello_card_create_v1',
    'ro_project',
    project_row.id,
    'trello:' || board_id || ':lead:' || new.id::text,
    jsonb_build_object(
      'board_id', board_id,
      'list_id', list_id,
      'project_id', project_row.id,
      'project_code', project_row.project_code,
      'source_email_log_id', new.id,
      'card_name', card_name,
      'card_description', card_description
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$function$;

commit;
