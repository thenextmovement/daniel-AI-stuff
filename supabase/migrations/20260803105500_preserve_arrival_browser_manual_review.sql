create or replace function public.arrival_labels_preserve_browser_manual_review()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job_error text;
begin
  if new.status = 'label_planned' then
    select nullif(left(j.last_error, 500), '')
      into v_job_error
    from public.arrival_label_browser_purchase_jobs j
    where j.case_id = new.id
      and j.status = 'manual_review'
    order by j.updated_at desc
    limit 1;

    if found then
      new.status := 'manual_review';
      new.manual_review_reason := coalesce(
        nullif(old.manual_review_reason, ''),
        v_job_error,
        'EasyDPD-Browserauftrag ist manuell zu pruefen; kein automatischer Zweitkauf.'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists arrival_label_cases_preserve_browser_manual_review
  on public.arrival_label_cases;
create trigger arrival_label_cases_preserve_browser_manual_review
before update of status, manual_review_reason on public.arrival_label_cases
for each row execute function public.arrival_labels_preserve_browser_manual_review();

revoke execute on function public.arrival_labels_preserve_browser_manual_review()
  from public, anon, authenticated;
grant execute on function public.arrival_labels_preserve_browser_manual_review()
  to service_role;

comment on function public.arrival_labels_preserve_browser_manual_review()
  is 'Prevents recurring discovery runs from hiding a fail-closed EasyDPD browser purchase review.';
