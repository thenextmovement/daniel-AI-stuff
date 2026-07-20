do $$
begin
  if exists (
    select 1
    from public.arrival_label_product_config
    where delivery_note_printer_key is not null
      and (printer_key is null or delivery_note_printer_key = printer_key)
  ) then
    raise exception 'unsafe arrival-label config: A4 delivery-note and A6 label printers must be separate';
  end if;
end
$$;

alter table public.arrival_label_product_config
  add constraint arrival_label_product_config_separate_printers_check
  check (
    delivery_note_printer_key is null
    or (
      printer_key is not null
      and delivery_note_printer_key <> printer_key
    )
  );

comment on constraint arrival_label_product_config_separate_printers_check
  on public.arrival_label_product_config
  is 'A4 delivery notes and A6/4x6 shipping labels must use separate approved logical printers.';
