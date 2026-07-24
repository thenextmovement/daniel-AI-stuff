create or replace function public.claim_eu_supplier_delivery(p_worker text) returns setof public.eu_supplier_deliveries
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
 update public.eu_supplier_deliveries set status='failed',failed_at=now(),next_attempt_at=null,alert_status='pending',alert_idempotency_key=coalesce(alert_idempotency_key,'eu-supplier-mail-failed:v1:'||id::text),last_error_code='uncertain_graph_dispatch',last_error_summary='Graph draft existed when the delivery lease expired; automatic resend was blocked.',updated_at=now() where status='sending' and updated_at<now()-interval '15 minutes' and provider_message_id is not null;
 update public.eu_supplier_deliveries set status='failed',failed_at=now(),next_attempt_at=null,alert_status='pending',alert_idempotency_key=coalesce(alert_idempotency_key,'eu-supplier-mail-failed:v1:'||id::text),last_error_code='delivery_lease_expired',last_error_summary='Delivery lease expired after the final permitted attempt.',updated_at=now() where status='sending' and updated_at<now()-interval '15 minutes' and provider_message_id is null and attempt_count>=2;
 update public.eu_supplier_deliveries set status='retry_wait',next_attempt_at=now(),last_error_code='delivery_lease_expired',last_error_summary='Delivery lease expired before Graph draft creation.',updated_at=now() where status='sending' and updated_at<now()-interval '15 minutes' and provider_message_id is null and attempt_count<2;
 select id into v_id from public.eu_supplier_deliveries where status in ('queued','retry_wait') and attempt_count<2 and (next_attempt_at is null or next_attempt_at<=now()) order by created_at for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.eu_supplier_deliveries set status='sending',attempt_count=attempt_count+1,workflow_execution_id=left(p_worker,200),updated_at=now() where id=v_id and status in ('queued','retry_wait') and attempt_count<2 returning *;
end $$;
create or replace function public.claim_eu_supplier_failure_alert(p_worker text) returns setof public.eu_supplier_deliveries
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
 select id into v_id from public.eu_supplier_deliveries where status='failed' and alert_status='pending' order by failed_at nulls last,created_at for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.eu_supplier_deliveries set alert_status='sending',workflow_execution_id=left(p_worker,200),updated_at=now() where id=v_id and status='failed' and alert_status='pending' returning *;
end $$;
create or replace function public.record_eu_supplier_alert_result(p_delivery_id uuid,p_success boolean,p_error text default null) returns setof public.eu_supplier_deliveries
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
 return query update public.eu_supplier_deliveries set alert_status=case when p_success then 'sent' else 'failed' end,alert_sent_at=case when p_success then now() else alert_sent_at end,last_error_summary=case when p_success then last_error_summary else left(coalesce(p_error,'alert_failed'),500) end,updated_at=now() where id=p_delivery_id and status='failed' and alert_status='sending' returning *;
end $$;
revoke all on function public.claim_eu_supplier_delivery(text),public.claim_eu_supplier_failure_alert(text),public.record_eu_supplier_alert_result(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_eu_supplier_delivery(text),public.claim_eu_supplier_failure_alert(text),public.record_eu_supplier_alert_result(uuid,boolean,text) to service_role;
