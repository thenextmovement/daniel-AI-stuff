begin;

update public.arrival_label_outlook_archive_settings
set enabled = true, enabled_after = now() - interval '1 minute', updated_at = now()
where singleton;

update public.arrival_label_trello_arrival_settings
set enabled = true, enabled_after = now() - interval '1 minute', updated_at = now()
where singleton;

insert into public.arrival_label_runs (
  id, correlation_id, trigger_type, mode, local_date, status
) values (
  '11000000-0000-4000-8000-000000000001',
  'arrival-trello-arrival-sql-test',
  'fixture_test',
  'execute',
  date '2026-07-23',
  'completed'
);

insert into public.arrival_label_cases (
  id, run_id, idempotency_key, incoming_dhl_tracking_number,
  outlook_message_ids, outlook_delivery_state, trello_card_id,
  destination_country_code, destination_class, delivery_note_required,
  delivery_note_status, status, updated_at
) values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'arrival-trello-arrival-sql-test:5065735500',
  '5065735500',
  array['outlook-due-mail'],
  'due_today',
  '0123456789abcdef01234567',
  'DE',
  'domestic_de',
  false,
  'not_required',
  'completed',
  now()
);

insert into public.arrival_label_artifacts (
  id, case_id, artifact_kind, storage_bucket, storage_key, sha256,
  content_type, byte_size, page_width_points, page_height_points, qa_result
) values (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'annotated_pdf',
  'arrival-labels-private',
  'sql-test/trello-arrival-label.pdf',
  repeat('a', 64),
  'application/pdf',
  1024,
  297,
  420,
  '{"ok":true}'::jsonb
);

insert into public.arrival_label_print_jobs (
  id, case_id, artifact_id, document_kind, idempotency_key,
  printer_key, document_sha256, status, cups_job_id, printed_at
) values (
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'label',
  'arrival-trello-arrival-print-sql-test-0001',
  'shipping-a6',
  repeat('a', 64),
  'printed',
  'Brother_QL_1110NWB-123',
  now()
);

insert into public.arrival_label_outlook_archive_jobs (
  id, case_id, print_job_id, idempotency_key, source_message_id,
  expected_tracking_number, status, moved_message_id, archived_at
) values (
  '51000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'arrival-outlook-archive:' || repeat('a', 64),
  'outlook-due-mail',
  '5065735500',
  'archived',
  'outlook-due-mail-archived',
  now()
);

do $$
begin
  if exists (
    select 1 from public.arrival_label_trello_arrival_jobs
    where case_id = '21000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'due-today mail incorrectly queued a Sign Arrived projection';
  end if;
end;
$$;

update public.arrival_label_cases
set outlook_message_ids = array['outlook-delivered-mail'],
    outlook_delivery_state = 'delivered_today',
    updated_at = now()
where id = '21000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.arrival_label_cases
    where id = '21000000-0000-4000-8000-000000000001'
      and outlook_delivery_state = 'delivered_today'
      and outlook_message_ids = array['outlook-delivered-mail', 'outlook-due-mail']
  ) then
    raise exception 'late delivered mail was not merged monotonically into the case';
  end if;
end;
$$;

insert into public.arrival_label_outlook_archive_jobs (
  id, case_id, print_job_id, idempotency_key, source_message_id,
  expected_tracking_number, status
) values (
  '51000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'arrival-outlook-archive:' || repeat('b', 64),
  'outlook-delivered-mail',
  '5065735500',
  'pending'
);

select public.arrival_labels_enqueue_trello_arrival(
  '21000000-0000-4000-8000-000000000001'
);

do $$
begin
  if exists (
    select 1 from public.arrival_label_trello_arrival_jobs
    where case_id = '21000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Trello projection queued before every exact Outlook mail was archived';
  end if;
end;
$$;

update public.arrival_label_outlook_archive_jobs
set status = 'archived',
    moved_message_id = 'outlook-delivered-mail-archived',
    archived_at = now(),
    updated_at = now()
where id = '51000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(*) from public.arrival_label_trello_arrival_jobs
      where case_id = '21000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'exactly one Trello projection job was not queued after complete archival';
  end if;
end;
$$;

select * from public.arrival_labels_claim_trello_arrival('sql-test-trello-worker', 180);

do $$
begin
  if not exists (
    select 1 from public.arrival_label_trello_arrival_jobs
    where case_id = '21000000-0000-4000-8000-000000000001'
      and status = 'claimed'
      and attempts = 1
      and lease_owner = 'sql-test-trello-worker'
  ) then
    raise exception 'Trello projection job was not claimed with a lease';
  end if;
end;
$$;

select * from public.arrival_labels_update_trello_arrival(
  (select id from public.arrival_label_trello_arrival_jobs
   where case_id = '21000000-0000-4000-8000-000000000001'),
  'sql-test-trello-worker',
  'dispatching'
);

select * from public.arrival_labels_update_trello_arrival(
  (select id from public.arrival_label_trello_arrival_jobs
   where case_id = '21000000-0000-4000-8000-000000000001'),
  'sql-test-trello-worker',
  'moved',
  '0123456789abcdef01234567'
);

-- An identical receipt replay is accepted without creating a second job.
select * from public.arrival_labels_update_trello_arrival(
  (select id from public.arrival_label_trello_arrival_jobs
   where case_id = '21000000-0000-4000-8000-000000000001'),
  'sql-test-trello-worker',
  'moved',
  '0123456789abcdef01234567'
);

do $$
declare
  v_signature text := 'public.arrival_labels_claim_trello_arrival(text,integer,timestamp with time zone)';
begin
  if not exists (
    select 1 from public.arrival_label_trello_arrival_jobs
    where case_id = '21000000-0000-4000-8000-000000000001'
      and status = 'moved'
      and moved_card_id = '0123456789abcdef01234567'
      and moved_at is not null
  ) then
    raise exception 'Trello projection did not finish with an exact move receipt';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'Trello projection function grants are unsafe';
  end if;
end;
$$;

rollback;
