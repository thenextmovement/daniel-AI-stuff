-- pgcrypto is installed in the managed `extensions` schema in production.
-- Both functions resolve digest() at execution time, so keep that schema in
-- their fixed search path without changing the function bodies or grants.

alter function public.arrival_labels_enqueue_outlook_archives_for_print(uuid, timestamptz)
  set search_path = public, extensions, pg_temp;

alter function public.arrival_labels_claim_outlook_archive(text, integer, timestamptz)
  set search_path = public, extensions, pg_temp;

