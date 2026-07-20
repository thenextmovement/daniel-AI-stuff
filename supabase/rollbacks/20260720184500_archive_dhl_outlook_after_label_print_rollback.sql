drop trigger if exists arrival_label_print_jobs_queue_outlook_archives on public.arrival_label_print_jobs;
drop function if exists public.arrival_labels_queue_outlook_archives_after_print();
drop function if exists public.arrival_labels_update_outlook_archive(uuid, text, text, text, text, timestamptz);
drop function if exists public.arrival_labels_claim_outlook_archive(text, integer, timestamptz);
drop function if exists public.arrival_labels_enqueue_outlook_archives_for_print(uuid, timestamptz);
drop table if exists public.arrival_label_outlook_archive_jobs;
drop table if exists public.arrival_label_outlook_archive_settings;
