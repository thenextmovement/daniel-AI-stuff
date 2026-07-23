drop trigger if exists arrival_label_outlook_archives_queue_trello_arrival
  on public.arrival_label_outlook_archive_jobs;

drop function if exists public.arrival_labels_update_trello_arrival(uuid, text, text, text, text, timestamptz);
drop function if exists public.arrival_labels_claim_trello_arrival(text, integer, timestamptz);
drop function if exists public.arrival_labels_queue_trello_arrival_after_archive();
drop function if exists public.arrival_labels_enqueue_trello_arrival(uuid, timestamptz);

drop table if exists public.arrival_label_trello_arrival_jobs;
drop table if exists public.arrival_label_trello_arrival_settings;

create or replace function public.arrival_labels_preserve_case_progress()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_rank integer;
  new_rank integer;
begin
  old_rank := case old.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  new_rank := case new.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  if old.delivery_note_required and new.delivery_note_required and old_rank > new_rank then
    new.delivery_note_status := old.delivery_note_status;
  end if;
  new.existing_dpd_tracking := coalesce(new.existing_dpd_tracking, old.existing_dpd_tracking);
  new.original_pdf_path := coalesce(new.original_pdf_path, old.original_pdf_path);
  new.annotated_pdf_path := coalesce(new.annotated_pdf_path, old.annotated_pdf_path);
  new.rendered_preview_path := coalesce(new.rendered_preview_path, old.rendered_preview_path);
  if old.status in ('label_created', 'pdf_processed', 'completed')
    and new.status in ('discovered', 'trello_matched', 'shopify_matched', 'validated', 'label_planned', 'existing_label', 'already_fulfilled') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

revoke execute on function public.arrival_labels_preserve_case_progress() from public, anon, authenticated;
grant execute on function public.arrival_labels_preserve_case_progress() to service_role;
