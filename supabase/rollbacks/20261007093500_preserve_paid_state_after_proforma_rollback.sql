-- NEONTRIP only: preserve paid/final invoice state across delayed proforma work.
-- No data backfill, document void, job execution, customer send or workflow write.
begin;

do $repair$
declare
  definition text;
  before_fragment text := $before$    -- Re-read under the same case lock used by payment/document completion.
    -- The correction may have been approved before payment, but synced after it.
    perform 1 from public.billing_cases
      where id = new.billing_case_id
        and paid_at is null and final_invoice_at is null
      for update;
    if not found then
      return new;
    end if;

    insert into public.billing_jobs (billing_case_id, idempotency_key, job_type, payload)$before$;
  after_fragment text := $after$    insert into public.billing_jobs (billing_case_id, idempotency_key, job_type, payload)$after$;
begin
  definition := pg_get_functiondef('public.billing_queue_proforma_after_shopify_tax_sync()'::regprocedure);
  if (length(definition) - length(replace(definition, before_fragment, ''))) / length(before_fragment) <> 1 then
    raise exception 'BILLING_PROFORMA_REPAIR_DRIFT_1';
  end if;
  execute replace(definition, before_fragment, after_fragment);
end;
$repair$;

do $repair$
declare
  definition text;
  before_fragment text := $before$      elsif v_type='PROFORMA' and v_case.paid_at is null and v_case.final_invoice_at is null then$before$;
  after_fragment text := $after$      elsif v_type='PROFORMA' then$after$;
begin
  definition := pg_get_functiondef('public.billing_job_complete(uuid,text,boolean,jsonb,text)'::regprocedure);
  if (length(definition) - length(replace(definition, before_fragment, ''))) / length(before_fragment) <> 1 then
    raise exception 'BILLING_PROFORMA_REPAIR_DRIFT_2';
  end if;
  execute replace(definition, before_fragment, after_fragment);
end;
$repair$;

do $repair$
declare
  definition text;
  before_fragment text := $before$  -- A proforma can finish after payment even if it was claimed beforehand.
  -- Keep the provider document as evidence, without queuing a payment demand.
  if new.document_type = 'PROFORMA'
    and (v_case.paid_at is not null or v_case.final_invoice_at is not null) then
    return new;
  end if;

  v_recipient := lower(btrim(coalesce($before$;
  after_fragment text := $after$  v_recipient := lower(btrim(coalesce($after$;
begin
  definition := pg_get_functiondef('public.billing_queue_customer_document_after_finalize()'::regprocedure);
  if (length(definition) - length(replace(definition, before_fragment, ''))) / length(before_fragment) <> 1 then
    raise exception 'BILLING_PROFORMA_REPAIR_DRIFT_3';
  end if;
  execute replace(definition, before_fragment, after_fragment);
end;
$repair$;

commit;
