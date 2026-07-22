update public.arrival_label_browser_worker_settings
set worker_enabled = false,
    live_purchase_enabled = false,
    approved_products = '{}'::jsonb,
    approved_by = null,
    approved_at = null,
    updated_at = now()
where singleton is true
  and approved_by = 'Daniel Klesse - Chatfreigabe bis 15 EUR 2026-07-22';

update public.arrival_label_product_config
set enabled = false, updated_at = now()
where version = 'live-b2c-a6-v1';

drop trigger if exists arrival_label_cases_00_preserve_delivery_note_progress on public.arrival_label_cases;
drop function if exists public.arrival_labels_preserve_case_progress();
drop function if exists public.arrival_labels_mark_delivery_note_qa_approved(uuid, uuid, timestamptz);
