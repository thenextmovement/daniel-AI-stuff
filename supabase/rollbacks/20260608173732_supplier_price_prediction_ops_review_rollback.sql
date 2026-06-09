drop index if exists public.supplier_price_predictions_source_code_idx;
drop index if exists public.supplier_price_predictions_ops_review_idx;
alter table public.supplier_price_predictions
  drop constraint if exists supplier_price_predictions_prediction_key_key;

alter table public.supplier_price_predictions
  drop constraint if exists supplier_price_predictions_anchor_training_item_id_fkey;

update public.supplier_price_predictions
set decision_status = 'shadow'
where decision_status = 'needs_supplier_check';

alter table public.supplier_price_predictions
  drop constraint if exists supplier_price_predictions_decision_status_check;

alter table public.supplier_price_predictions
  add constraint supplier_price_predictions_decision_status_check
  check (decision_status in ('shadow', 'approved_for_quote', 'rejected', 'superseded'));

alter table public.supplier_price_predictions
  drop column if exists review_note,
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists customer_auto_quote_eligible,
  drop column if exists anchor_shipping_price,
  drop column if exists anchor_production_price,
  drop column if exists anchor_height_cm,
  drop column if exists anchor_width_cm,
  drop column if exists anchor_training_item_id,
  drop column if exists source_label,
  drop column if exists source_code,
  drop column if exists prediction_key;
