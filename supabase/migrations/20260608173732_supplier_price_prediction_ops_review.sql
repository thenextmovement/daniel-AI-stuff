alter table public.supplier_price_predictions
  add column if not exists prediction_key text,
  add column if not exists source_code text,
  add column if not exists source_label text,
  add column if not exists anchor_training_item_id uuid,
  add column if not exists anchor_width_cm numeric,
  add column if not exists anchor_height_cm numeric,
  add column if not exists anchor_production_price numeric,
  add column if not exists anchor_shipping_price numeric,
  add column if not exists customer_auto_quote_eligible boolean not null default true,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_price_predictions_anchor_training_item_id_fkey'
      and conrelid = 'public.supplier_price_predictions'::regclass
  ) then
    alter table public.supplier_price_predictions
      add constraint supplier_price_predictions_anchor_training_item_id_fkey
      foreign key (anchor_training_item_id)
      references public.supplier_quote_training_items(id)
      on delete set null;
  end if;
end $$;

alter table public.supplier_price_predictions
  drop constraint if exists supplier_price_predictions_decision_status_check;

alter table public.supplier_price_predictions
  add constraint supplier_price_predictions_decision_status_check
  check (decision_status in ('shadow', 'needs_supplier_check', 'approved_for_quote', 'rejected', 'superseded'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_price_predictions_prediction_key_key'
      and conrelid = 'public.supplier_price_predictions'::regclass
  ) then
    alter table public.supplier_price_predictions
      add constraint supplier_price_predictions_prediction_key_key unique (prediction_key);
  end if;
end $$;

create index if not exists supplier_price_predictions_ops_review_idx
  on public.supplier_price_predictions(decision_status, customer_auto_quote_eligible, created_at desc);

create index if not exists supplier_price_predictions_source_code_idx
  on public.supplier_price_predictions(source_code, created_at desc)
  where source_code is not null;

comment on column public.supplier_price_predictions.prediction_key is
  'Stable idempotency key for one model/source-code/target-size suggestion.';
comment on column public.supplier_price_predictions.source_code is
  'Supplier or design code that produced this suggested size ladder.';
comment on column public.supplier_price_predictions.customer_auto_quote_eligible is
  'False when the suggestion must stay manual/customer-request only, for example above the 200 cm auto-quote boundary.';
comment on column public.supplier_price_predictions.reviewed_by is
  'Ops reviewer who approved, rejected, or requested supplier check.';
comment on column public.supplier_price_predictions.review_note is
  'Human review note. Predictions remain non-customer-visible until approved.';
