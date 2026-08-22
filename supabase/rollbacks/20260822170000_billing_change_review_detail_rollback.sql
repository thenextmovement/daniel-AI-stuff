do $$
begin
  if exists(select 1 from public.billing_jobs where job_type='NOTIFY_CHANGE_REQUEST' and payload->>'notificationKind'='DECISION_CUSTOMER' and status='PROCESSING') then
    raise exception 'BILLING_CHANGE_DECISION_NOTIFICATION_PROCESSING';
  end if;
end;
$$;

drop function if exists public.billing_change_request_decide(uuid,uuid,text,jsonb,text,text,text);
drop function if exists public.billing_change_request_save_draft(uuid,uuid,jsonb,text,text);
alter table public.billing_change_requests
  drop column if exists applied_changes,
  drop column if exists ops_draft_saved_at,
  drop column if exists ops_draft_saved_by,
  drop column if exists ops_draft_changes;
