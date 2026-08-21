alter table public.billing_jobs drop constraint if exists billing_jobs_type_check;
alter table public.billing_jobs add constraint billing_jobs_type_check check (job_type in (
  'CREATE_PROFORMA', 'CREATE_INVOICE', 'CREATE_CREDIT', 'CREATE_CANCELLATION',
  'VOID_PROFORMA', 'PROJECT_PAYMENT_SHOPIFY', 'PROJECT_PAYMENT_EASYBILL',
  'SEND_CUSTOMER_DOCUMENT', 'VERIFY_VAT', 'SYNC_SHOPIFY_TAX', 'RECONCILE'
));

create or replace function public.billing_redirect_confirmed_vat_proforma()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.job_type = 'CREATE_PROFORMA' and new.payload->>'reason' = 'VAT_REVIEW_CONFIRMED' then
    new.job_type := 'SYNC_SHOPIFY_TAX';
    new.payload := new.payload || jsonb_build_object('nextJobType', 'CREATE_PROFORMA');
  end if;
  return new;
end;
$$;

drop trigger if exists billing_redirect_confirmed_vat_proforma_trigger on public.billing_jobs;
create trigger billing_redirect_confirmed_vat_proforma_trigger
before insert on public.billing_jobs
for each row execute function public.billing_redirect_confirmed_vat_proforma();

create or replace function public.billing_queue_proforma_after_shopify_tax_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.job_type = 'SYNC_SHOPIFY_TAX'
     and new.status = 'DONE'
     and old.status is distinct from 'DONE'
     and new.payload->>'nextJobType' = 'CREATE_PROFORMA' then
    insert into public.billing_jobs (billing_case_id, idempotency_key, job_type, payload)
    values (
      new.billing_case_id,
      new.idempotency_key || ':easybill',
      'CREATE_PROFORMA',
      (new.payload - 'nextJobType') || jsonb_build_object(
        'reason', 'VAT_REVIEW_SHOPIFY_SYNCED',
        'shopifySyncJobId', new.id
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_queue_proforma_after_shopify_tax_sync_trigger on public.billing_jobs;
create trigger billing_queue_proforma_after_shopify_tax_sync_trigger
after update of status on public.billing_jobs
for each row execute function public.billing_queue_proforma_after_shopify_tax_sync();

create or replace function public.billing_job_claim(p_worker text,p_job_types text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$$;

revoke all on function public.billing_job_claim(text,text[],integer) from public,anon,authenticated;
grant execute on function public.billing_job_claim(text,text[],integer) to service_role;
