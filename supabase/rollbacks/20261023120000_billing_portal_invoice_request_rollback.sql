begin;
-- Never silently unlock invoices that customers have already confirmed.
do $$ begin
  if exists(select 1 from public.billing_cases where invoice_requested_at is not null) then
    raise exception 'Confirmed invoice requests exist: preserve the lock and roll back application code only';
  end if;
end $$;
drop function public.billing_portal_request_invoice(text,boolean,integer,timestamptz,text);
drop trigger billing_guard_confirmed_invoice_change on public.billing_change_requests;
drop function public.billing_guard_confirmed_invoice_change();
drop trigger billing_guard_confirmed_invoice on public.billing_cases;
drop function public.billing_guard_confirmed_invoice();
alter table public.billing_cases drop column invoice_requested_at;
commit;
