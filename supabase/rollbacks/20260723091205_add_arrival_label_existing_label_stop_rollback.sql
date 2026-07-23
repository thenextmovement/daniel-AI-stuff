begin;

drop function if exists public.arrival_labels_block_browser_purchase_existing_label(uuid, text, text, jsonb, text, timestamptz);

commit;
