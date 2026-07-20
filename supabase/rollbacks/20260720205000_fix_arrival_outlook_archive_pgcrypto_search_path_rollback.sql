alter function public.arrival_labels_enqueue_outlook_archives_for_print(uuid, timestamptz)
  set search_path = public, pg_temp;

alter function public.arrival_labels_claim_outlook_archive(text, integer, timestamptz)
  set search_path = public, pg_temp;

