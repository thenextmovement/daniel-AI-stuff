drop function if exists public.arrival_labels_register_browser_artifacts(uuid, text, text, text, uuid, uuid, uuid, timestamptz);
drop function if exists public.arrival_labels_update_browser_purchase(uuid, text, text, text, text, integer, uuid, text, timestamptz);
drop function if exists public.arrival_labels_claim_browser_purchase(text, integer, timestamptz);
drop function if exists public.arrival_labels_enqueue_browser_purchase(uuid);
drop table if exists public.arrival_label_browser_purchase_jobs;
drop table if exists public.arrival_label_browser_worker_settings;

delete from storage.buckets b
where b.id = 'arrival-labels-private'
  and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
