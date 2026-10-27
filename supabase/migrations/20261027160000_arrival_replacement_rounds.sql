begin;
-- Keep every existing pin unchanged; later replacement rounds get their own pin.
-- No historical case, purchase or print job is reset or enqueued by this migration.
alter table public.arrival_label_first_parcels
  add column first_tracking_number text generated always as (tracking_numbers[1]) stored,
  add column previous_tracking_numbers text[] not null default '{}';
alter table public.arrival_label_first_parcels drop constraint arrival_label_first_parcels_pkey;
alter table public.arrival_label_first_parcels add primary key (trello_card_id, first_tracking_number);
alter table public.arrival_label_first_parcels drop constraint arrival_label_first_parcels_tracking_numbers_check;
alter table public.arrival_label_first_parcels add check (cardinality(tracking_numbers) between 1 and 99);
create or replace function public.arrival_labels_protect_first_parcel() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'first parcel selection is permanent'; end if;
  if tg_op = 'UPDATE' and (new.trello_card_id <> old.trello_card_id
    or new.tracking_numbers <> old.tracking_numbers
    or new.previous_tracking_numbers <> old.previous_tracking_numbers
    or new.blocked_reason is distinct from old.blocked_reason
    or new.created_at <> old.created_at
    or (old.purchase_case_id is not null and new.purchase_case_id is distinct from old.purchase_case_id)) then
    raise exception 'first parcel selection is immutable';
  end if;
  if array_position(new.tracking_numbers, null) is not null
    or exists (select 1 from unnest(new.tracking_numbers) n where n !~ '^[0-9]{10}$')
    or cardinality(new.tracking_numbers) <> (select count(distinct n) from unnest(new.tracking_numbers) n) then
    raise exception 'invalid first parcel tracking list';
  end if;
  if array_position(new.previous_tracking_numbers, null) is not null
    or cardinality(new.previous_tracking_numbers) > 98
    or exists (select 1 from unnest(new.previous_tracking_numbers) n where n !~ '^[0-9]{10}$')
    or cardinality(new.previous_tracking_numbers) <> (select count(distinct n) from unnest(new.previous_tracking_numbers) n)
    or new.previous_tracking_numbers && new.tracking_numbers then
    raise exception 'invalid previous tracking list or overlapping replacement';
  end if;
  return new;
end $$;

drop function public.arrival_labels_pin_first_parcel(text,text[]);
create function public.arrival_labels_pin_first_parcel(p_card_id text, p_tracking_numbers text[], p_previous_tracking_numbers text[] default '{}')
returns setof public.arrival_label_first_parcels
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_hold text; v_selection public.arrival_label_first_parcels%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('arrival-first-parcel:' || p_card_id, 0));
  -- Reordering/overlap never replaces an existing immutable selection.
  select * into v_selection from public.arrival_label_first_parcels
    where trello_card_id = p_card_id and tracking_numbers && p_tracking_numbers
    order by created_at, first_tracking_number limit 1;
  if found then return next v_selection; return; end if;
  if cardinality(p_previous_tracking_numbers) = 0 then
    select * into v_selection from public.arrival_label_first_parcels
      where trello_card_id = p_card_id order by created_at, first_tracking_number limit 1;
    if found then return next v_selection; return; end if;
  elsif p_previous_tracking_numbers is null or p_previous_tracking_numbers && p_tracking_numbers
    or exists (select 1 from public.arrival_label_first_parcels p where p.trello_card_id = p_card_id
      and not p.tracking_numbers <@ p_previous_tracking_numbers) then
    raise exception 'replacement previous tracking list is incomplete or overlapping';
  end if;
  if p_previous_tracking_numbers is null then raise exception 'previous tracking list missing'; end if;
  -- Only evidence belonging to this round blocks its pin. Older dispatched rounds
  -- are preserved and cannot suppress a separately verified replacement.
  if exists (select 1 from public.arrival_label_cases c where c.trello_card_id = p_card_id
    and (cardinality(p_previous_tracking_numbers) = 0 or c.incoming_dhl_tracking_number = any(p_tracking_numbers))
    and (c.existing_dpd_tracking is not null
      or exists (select 1 from public.arrival_label_browser_purchase_jobs j where j.case_id = c.id)
      or exists (select 1 from public.arrival_label_artifacts a where a.case_id = c.id)
      or exists (select 1 from public.arrival_label_print_jobs p where p.case_id = c.id))) then
    v_hold := 'Versandrunde hat bereits Kauf-/Label-/Druckbelege; Zuordnung manuell pruefen, kein neuer automatischer Kauf.';
  end if;
  insert into public.arrival_label_first_parcels(trello_card_id,tracking_numbers,previous_tracking_numbers,blocked_reason)
    values (p_card_id,p_tracking_numbers,p_previous_tracking_numbers,v_hold)
    returning * into v_selection;
  return next v_selection;
end $$;
revoke execute on function public.arrival_labels_pin_first_parcel(text,text[],text[]) from public, anon, authenticated;
grant execute on function public.arrival_labels_pin_first_parcel(text,text[],text[]) to service_role;
create or replace function public.arrival_labels_guard_first_parcel_purchase() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_card text; v_selection public.arrival_label_first_parcels%rowtype;
begin
  select trello_card_id into v_card from public.arrival_label_cases where id = new.case_id;
  perform pg_advisory_xact_lock(hashtextextended('arrival-first-parcel:' || v_card, 0));
  select * into v_selection from public.arrival_label_first_parcels where trello_card_id = v_card and new.incoming_dhl_tracking_number = any(tracking_numbers) for update;
  if not found and exists (select 1 from public.arrival_label_first_parcels where trello_card_id = v_card) then
    raise exception 'only the pinned first parcel may be purchased; shipment round missing';
  end if;
  if found then
    if v_selection.blocked_reason is not null or new.parcel_kind <> 'main'
      or new.incoming_dhl_tracking_number <> v_selection.tracking_numbers[1]
      or (v_selection.purchase_case_id is not null and v_selection.purchase_case_id <> new.case_id) then
      raise exception 'only the pinned first parcel may be purchased; remaining parcels are manual';
    end if;
    update public.arrival_label_first_parcels set purchase_case_id = new.case_id where trello_card_id = v_card and first_tracking_number = v_selection.first_tracking_number;
  end if;
  return new;
end $$;
-- Require the selected first-parcel overlay; existing artifacts remain untouched.
create or replace function public.arrival_labels_register_browser_artifacts(
  p_job_id uuid,
  p_worker_id text,
  p_dpd_tracking_number text,
  p_original_pdf_sha256 text,
  p_original_artifact_id uuid,
  p_annotated_artifact_id uuid,
  p_preview_artifact_id uuid,
  p_now timestamptz default now()
)
returns setof public.arrival_label_browser_purchase_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_browser_purchase_jobs%rowtype;
  v_original public.arrival_label_artifacts%rowtype;
  v_annotated public.arrival_label_artifacts%rowtype;
  v_preview public.arrival_label_artifacts%rowtype;
begin
  select * into v_job from public.arrival_label_browser_purchase_jobs
  where id = p_job_id and lease_owner = p_worker_id for update;
  if not found or v_job.status not in ('dispatching', 'purchased', 'artifact_uploaded') then
    raise exception 'browser purchase job is not ready for artifact registration';
  end if;
  if p_dpd_tracking_number !~ '^[0-9]{11,20}$' or p_original_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid purchased-label proof';
  end if;
  select * into v_original from public.arrival_label_artifacts where id = p_original_artifact_id and case_id = v_job.case_id and artifact_kind = 'original_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_annotated from public.arrival_label_artifacts where id = p_annotated_artifact_id and case_id = v_job.case_id and artifact_kind = 'annotated_pdf' and parcel_kind = v_job.parcel_kind;
  select * into v_preview from public.arrival_label_artifacts where id = p_preview_artifact_id and case_id = v_job.case_id and artifact_kind = 'rendered_preview' and parcel_kind = v_job.parcel_kind;
  if v_original.id is null or v_annotated.id is null or v_preview.id is null
    or v_original.sha256 <> p_original_pdf_sha256
    or v_original.content_type <> 'application/pdf'
    or v_annotated.content_type <> 'application/pdf'
    or coalesce(v_annotated.qa_result ->> 'ok', 'false') <> 'true'
    or coalesce(v_annotated.qa_result ->> 'overlayText', '') <> (case when v_job.parcel_kind = 'acrylic_table_device' then v_job.incoming_dhl_last_six || ' (Tischgerät)' else v_job.incoming_dhl_last_six || coalesce((select ' Paket 1 von ' || cardinality(p.tracking_numbers)::text
      from public.arrival_label_first_parcels p join public.arrival_label_cases c on c.trello_card_id = p.trello_card_id
      where c.id = v_job.case_id and p.tracking_numbers[1] = v_job.incoming_dhl_tracking_number and cardinality(p.tracking_numbers) > 1), '') end)
    or v_preview.content_type <> 'image/png' then
    raise exception 'browser artifacts are incomplete or failed QA';
  end if;

  if v_job.parcel_kind = 'acrylic_table_device' and (
    v_job.expected_primary_dpd_tracking is null or p_dpd_tracking_number = v_job.expected_primary_dpd_tracking
  ) then raise exception 'additional parcel cannot reuse primary tracking'; end if;
  if v_job.dpd_tracking_number is not null and v_job.dpd_tracking_number <> p_dpd_tracking_number then
    raise exception 'artifact tracking differs from purchased tracking';
  end if;

  update public.arrival_label_cases
  set existing_dpd_tracking = p_dpd_tracking_number,
      original_pdf_path = 'storage://' || v_original.storage_bucket || '/' || v_original.storage_key,
      annotated_pdf_path = 'storage://' || v_annotated.storage_bucket || '/' || v_annotated.storage_key,
      rendered_preview_path = 'storage://' || v_preview.storage_bucket || '/' || v_preview.storage_key,
      status = 'pdf_processed',
      manual_review_reason = null,
      updated_at = p_now
  where id = v_job.case_id and v_job.parcel_kind = 'main';

  update public.arrival_label_browser_purchase_jobs
  set status = 'artifact_uploaded',
      dpd_tracking_number = p_dpd_tracking_number,
      original_pdf_sha256 = p_original_pdf_sha256,
      annotated_pdf_sha256 = v_annotated.sha256,
      purchased_at = coalesce(purchased_at, p_now),
      artifact_processed_at = coalesce(artifact_processed_at, p_now),
      updated_at = p_now
  where id = v_job.id returning * into v_job;
  return next v_job;
end;
$$;

notify pgrst, 'reload schema';
commit;
