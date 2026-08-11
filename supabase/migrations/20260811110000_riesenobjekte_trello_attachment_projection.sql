begin;

alter table public.ro_projection_outbox
  drop constraint ro_projection_outbox_projection_type_check;

alter table public.ro_projection_outbox
  add constraint ro_projection_outbox_projection_type_check
  check (
    projection_type = any (
      array[
        'trello_card_create_v1'::text,
        'trello_card_move_v1'::text,
        'trello_card_comment_v1'::text,
        'trello_card_label_v1'::text,
        'trello_card_attachment_v1'::text
      ]
    )
  );

create or replace function public.ro_enqueue_trello_attachment_projection_v1(
  p_attachment_id uuid
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  project_id_value uuid;
  project_row public.ro_projects%rowtype;
  attachment_row public.ro_lead_attachments%rowtype;
  outbox_id_value uuid;
begin
  if p_attachment_id is null then
    raise exception 'Attachment id is required';
  end if;

  select project_id
  into project_id_value
  from public.ro_lead_attachments
  where id = p_attachment_id;

  if not found then
    raise exception 'Attachment was not found';
  end if;

  if project_id_value is null then
    return null;
  end if;

  select *
  into project_row
  from public.ro_projects
  where id = project_id_value
  for update;

  if not found then
    raise exception 'Attachment project was not found';
  end if;

  select *
  into attachment_row
  from public.ro_lead_attachments
  where id = p_attachment_id
    and project_id = project_row.id
  for update;

  if not found then
    raise exception 'Attachment project changed during enqueue';
  end if;

  if project_row.trello_card_id is null then
    return null;
  end if;

  if project_row.trello_card_id !~ '^[a-fA-F0-9]{24}$' then
    raise exception 'Attachment Trello card is invalid';
  end if;

  if attachment_row.storage_bucket <> 'ro-lead-attachments'
    or attachment_row.storage_status <> 'stored'
    or attachment_row.storage_path not like
      'first-party/' || attachment_row.submission_id::text || '/%'
    or attachment_row.size_bytes not between 1 and 15728640
    or attachment_row.sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Attachment is not eligible for Trello projection';
  end if;

  insert into public.ro_projection_outbox (
    projection_type,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload
  )
  values (
    'trello_card_attachment_v1',
    'ro_project',
    project_row.id,
    'ro-trello-attachment:' || attachment_row.id::text,
    jsonb_build_object(
      'board_id', '6a672e55823b82cdbebd818c',
      'card_id', project_row.trello_card_id,
      'attachment_id', attachment_row.id,
      'storage_bucket', attachment_row.storage_bucket,
      'storage_path', attachment_row.storage_path,
      'original_file_name', attachment_row.original_file_name,
      'mime_type', attachment_row.mime_type,
      'size_bytes', attachment_row.size_bytes,
      'sha256', attachment_row.sha256,
      'source', 'first_party_attachment'
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into outbox_id_value;

  if outbox_id_value is null then
    select id
    into outbox_id_value
    from public.ro_projection_outbox
    where idempotency_key =
      'ro-trello-attachment:' || attachment_row.id::text;
  end if;

  return outbox_id_value;
end;
$function$;

revoke all on function public.ro_enqueue_trello_attachment_projection_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.ro_enqueue_trello_attachment_projection_v1(uuid)
  to service_role;

create or replace function public.ro_claim_projection_outbox_v2(
  p_worker_id text,
  p_projection_types text[],
  p_limit integer default 1,
  p_lease_seconds integer default 180
)
returns setof public.ro_projection_outbox
language plpgsql
set search_path to 'public'
as $function$
declare
  clean_types text[];
begin
  if char_length(btrim(coalesce(p_worker_id, ''))) < 3 then
    raise exception 'worker_id must contain at least 3 characters';
  end if;
  if p_limit < 1 or p_limit > 20 then
    raise exception 'limit must be between 1 and 20';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'lease_seconds must be between 30 and 900';
  end if;

  select array_agg(distinct value order by value)
  into clean_types
  from unnest(coalesce(p_projection_types, array[]::text[])) as value
  where value in (
    'trello_card_create_v1',
    'trello_card_move_v1',
    'trello_card_comment_v1',
    'trello_card_label_v1',
    'trello_card_attachment_v1'
  );

  if coalesce(cardinality(clean_types), 0) = 0
    or cardinality(clean_types) <> cardinality(p_projection_types)
  then
    raise exception 'projection type allowlist is invalid';
  end if;

  return query
  with picked as (
    select outbox.id
    from public.ro_projection_outbox as outbox
    where outbox.projection_type = any(clean_types)
      and (
        (
          outbox.status in ('pending', 'retry')
          and outbox.available_at <= now()
        )
        or (
          outbox.status = 'processing'
          and outbox.leased_until < now()
        )
      )
      and outbox.attempts < outbox.max_attempts
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  )
  update public.ro_projection_outbox as outbox
  set status = 'processing',
      attempts = outbox.attempts + 1,
      lease_owner = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      leased_until = now() + make_interval(secs => p_lease_seconds),
      last_error = null
  from picked
  where outbox.id = picked.id
  returning outbox.*;
end;
$function$;

create or replace function public.ro_complete_projection_outbox_v1(
  p_outbox_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_external_id text,
  p_external_url text
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  outbox_row public.ro_projection_outbox%rowtype;
  project_row public.ro_projects%rowtype;
  attachment_id_value uuid;
  attachment_row record;
begin
  if p_outbox_id is null
    or p_lease_token is null
    or char_length(btrim(coalesce(p_worker_id, ''))) < 3
    or char_length(btrim(coalesce(p_external_id, ''))) < 3
  then
    raise exception 'complete projection arguments are invalid';
  end if;

  select *
  into outbox_row
  from public.ro_projection_outbox
  where id = p_outbox_id
  for update;

  if not found then
    raise exception 'projection outbox row was not found';
  end if;

  if outbox_row.status = 'succeeded'
    and outbox_row.external_id = btrim(p_external_id)
  then
    return jsonb_build_object(
      'completed', true,
      'idempotent_replay', true,
      'outbox_id', outbox_row.id,
      'external_id', outbox_row.external_id,
      'external_url', outbox_row.external_url
    );
  end if;

  if outbox_row.status <> 'processing'
    or outbox_row.lease_owner <> btrim(p_worker_id)
    or outbox_row.lease_token <> p_lease_token
    or outbox_row.leased_until < now()
  then
    raise exception 'projection lease is not valid';
  end if;

  select *
  into project_row
  from public.ro_projects
  where id = outbox_row.aggregate_id
  for update;

  if not found then
    raise exception 'projection project was not found';
  end if;

  if outbox_row.projection_type = 'trello_card_create_v1' then
    if project_row.trello_card_id is not null
      and project_row.trello_card_id <> btrim(p_external_id)
    then
      raise exception 'project already references another Trello card';
    end if;

    update public.ro_projects
    set trello_card_id = btrim(p_external_id),
        trello_card_url = nullif(btrim(coalesce(p_external_url, '')), '')
    where id = outbox_row.aggregate_id
    returning * into project_row;

    for attachment_row in
      select id
      from public.ro_lead_attachments
      where project_id = project_row.id
        and storage_status = 'stored'
      order by attachment_index, id
    loop
      perform public.ro_enqueue_trello_attachment_projection_v1(
        attachment_row.id
      );
    end loop;
  elsif outbox_row.projection_type = 'trello_card_attachment_v1' then
    if project_row.trello_card_id is null
      or outbox_row.payload ->> 'card_id' <> project_row.trello_card_id
      or btrim(p_external_id) !~ '^[a-fA-F0-9]{24}$'
      or coalesce(outbox_row.payload ->> 'attachment_id', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'attachment projection identity is invalid';
    end if;

    attachment_id_value :=
      (outbox_row.payload ->> 'attachment_id')::uuid;

    if not exists (
      select 1
      from public.ro_lead_attachments as attachment
      where attachment.id = attachment_id_value
        and attachment.project_id = project_row.id
        and attachment.storage_bucket =
          outbox_row.payload ->> 'storage_bucket'
        and attachment.storage_path =
          outbox_row.payload ->> 'storage_path'
        and attachment.sha256 = outbox_row.payload ->> 'sha256'
        and attachment.storage_status = 'stored'
    ) then
      raise exception 'attachment projection source does not match';
    end if;
  elsif project_row.trello_card_id <> btrim(p_external_id) then
    raise exception 'projection card does not match the database project';
  end if;

  update public.ro_projection_outbox
  set status = 'succeeded',
      external_id = btrim(p_external_id),
      external_url = nullif(btrim(coalesce(p_external_url, '')), ''),
      completed_at = now(),
      lease_owner = null,
      lease_token = null,
      leased_until = null,
      last_error = null
  where id = p_outbox_id
  returning * into outbox_row;

  return jsonb_build_object(
    'completed', true,
    'idempotent_replay', false,
    'outbox_id', outbox_row.id,
    'project_id', outbox_row.aggregate_id,
    'projection_type', outbox_row.projection_type,
    'external_id', outbox_row.external_id,
    'external_url', outbox_row.external_url
  );
end;
$function$;

create or replace function public.ro_record_first_party_attachment_v1(
  p_request_id text,
  p_submission_id uuid,
  p_attachment_index integer,
  p_storage_bucket text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  request_id_value text := btrim(coalesce(p_request_id, ''));
  storage_bucket_value text := btrim(coalesce(p_storage_bucket, ''));
  storage_path_value text := btrim(coalesce(p_storage_path, ''));
  original_file_name_value text :=
    btrim(coalesce(p_original_file_name, ''));
  mime_type_value text := lower(btrim(coalesce(p_mime_type, '')));
  sha256_value text := lower(btrim(coalesce(p_sha256, '')));
  lead_row public.email_agent_log%rowtype;
  project_id_value uuid;
  existing_row public.ro_lead_attachments%rowtype;
  attachment_row public.ro_lead_attachments%rowtype;
  outbox_id_value uuid;
begin
  if p_submission_id is null
    or request_id_value <>
      'riesenobjekte-first-party:' || p_submission_id::text
  then
    raise exception 'Attachment request identity is invalid';
  end if;

  if p_attachment_index is null
    or p_attachment_index not between 1 and 5
  then
    raise exception 'Attachment index is invalid';
  end if;

  if storage_bucket_value <> 'ro-lead-attachments'
    or storage_path_value not like
      'first-party/' || p_submission_id::text || '/%'
  then
    raise exception 'Attachment storage target is invalid';
  end if;

  select *
  into lead_row
  from public.email_agent_log
  where request_id = request_id_value
    and message_source = 'riesenobjekte_first_party'
  order by updated_at desc
  limit 1
  for update;

  if not found then
    raise exception 'First-party lead was not found';
  end if;

  select id
  into project_id_value
  from public.ro_projects
  where source_email_log_id = lead_row.id
  limit 1;

  if project_id_value is not null then
    perform 1
    from public.ro_projects
    where id = project_id_value
    for update;
  end if;

  select *
  into existing_row
  from public.ro_lead_attachments
  where request_id = request_id_value
    and attachment_index = p_attachment_index
  for update;

  if found then
    if existing_row.submission_id is distinct from p_submission_id
      or existing_row.storage_bucket is distinct from storage_bucket_value
      or existing_row.storage_path is distinct from storage_path_value
      or existing_row.original_file_name is distinct from
        original_file_name_value
      or existing_row.mime_type is distinct from mime_type_value
      or existing_row.size_bytes is distinct from p_size_bytes
      or existing_row.sha256 is distinct from sha256_value
    then
      raise exception 'Attachment identity conflict';
    end if;

    if existing_row.project_id is null and project_id_value is not null then
      update public.ro_lead_attachments
      set project_id = project_id_value,
          updated_at = timezone('utc', now())
      where id = existing_row.id
      returning * into existing_row;
    end if;

    if existing_row.project_id is not null then
      outbox_id_value :=
        public.ro_enqueue_trello_attachment_projection_v1(existing_row.id);
    end if;

    return jsonb_build_object(
      'recorded', true,
      'idempotent', true,
      'attachment_id', existing_row.id,
      'lead_id', existing_row.lead_log_id,
      'project_id', existing_row.project_id,
      'storage_bucket', existing_row.storage_bucket,
      'storage_path', existing_row.storage_path,
      'sha256', existing_row.sha256,
      'projection_outbox_id', outbox_id_value
    );
  end if;

  insert into public.ro_lead_attachments (
    lead_log_id,
    project_id,
    request_id,
    submission_id,
    attachment_index,
    storage_bucket,
    storage_path,
    original_file_name,
    mime_type,
    size_bytes,
    sha256
  )
  values (
    lead_row.id,
    project_id_value,
    request_id_value,
    p_submission_id,
    p_attachment_index,
    storage_bucket_value,
    storage_path_value,
    original_file_name_value,
    mime_type_value,
    p_size_bytes,
    sha256_value
  )
  returning * into attachment_row;

  if attachment_row.project_id is not null then
    outbox_id_value :=
      public.ro_enqueue_trello_attachment_projection_v1(attachment_row.id);
  end if;

  return jsonb_build_object(
    'recorded', true,
    'idempotent', false,
    'attachment_id', attachment_row.id,
    'lead_id', attachment_row.lead_log_id,
    'project_id', attachment_row.project_id,
    'storage_bucket', attachment_row.storage_bucket,
    'storage_path', attachment_row.storage_path,
    'sha256', attachment_row.sha256,
    'projection_outbox_id', outbox_id_value
  );
end;
$function$;

do $block$
declare
  attachment_row record;
begin
  for attachment_row in
    select attachment.id
    from public.ro_lead_attachments as attachment
    join public.ro_projects as project
      on project.id = attachment.project_id
    where attachment.storage_status = 'stored'
      and project.trello_card_id is not null
    order by attachment.created_at, attachment.id
  loop
    perform public.ro_enqueue_trello_attachment_projection_v1(
      attachment_row.id
    );
  end loop;
end;
$block$;

commit;
