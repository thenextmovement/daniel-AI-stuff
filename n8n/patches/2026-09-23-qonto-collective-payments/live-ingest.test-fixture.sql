CREATE OR REPLACE FUNCTION public.billing_payment_ingest(p_shopify_order_id text, p_provider text, p_provider_transaction_id text, p_amount_cents bigint, p_currency text, p_booked_at timestamp with time zone, p_source_event_id text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_case public.billing_cases;
  v_payment public.billing_payments;
  v_total bigint;
  v_match text;
  v_is_skonto boolean := false;
  v_skonto_cents bigint := 0;
  v_expected_skonto_payment_cents bigint := 0;
  v_skonto_deadline timestamptz;
  v_invoice_document_id text;
  v_payment_evidence jsonb;
begin
  select * into v_case
  from public.billing_cases
  where shopify_order_id=p_shopify_order_id
     or shopify_order_id='gid://shopify/Order/'||p_shopify_order_id
  for update;

  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;

  select * into v_payment
  from public.billing_payments
  where provider=p_provider and provider_transaction_id=p_provider_transaction_id;

  if found then
    return jsonb_build_object(
      'id',v_payment.id,
      'duplicate',true,
      'matchStatus',v_payment.match_status,
      'billingCaseId',v_case.id,
      'billingCaseStatus',v_case.status,
      'settlementType',coalesce(v_payment.evidence->>'settlementType','FULL'),
      'skontoCents',coalesce((v_payment.evidence->>'skontoCents')::bigint,0)
    );
  end if;

  if p_amount_cents<=0 or upper(p_currency)<>v_case.currency then
    raise exception 'BILLING_PAYMENT_INVALID';
  end if;

  select coalesce(sum(amount_cents),0)+p_amount_cents into v_total
  from public.billing_payments
  where billing_case_id=v_case.id and match_status in ('MATCHED','PARTIAL');

  if v_case.payment_policy_code='UMDASCH_3PCT_30D'
     and v_case.cash_allowance_percent is not null
     and v_case.cash_allowance_days is not null
     and v_case.final_invoice_at is not null then
    v_skonto_cents := round(v_case.total_gross_cents * v_case.cash_allowance_percent / 100.0)::bigint;
    v_expected_skonto_payment_cents := v_case.total_gross_cents - v_skonto_cents;
    v_skonto_deadline := (
      (
        (v_case.final_invoice_at at time zone 'Europe/Berlin')::date
        + v_case.cash_allowance_days
        + 1
      )::timestamp at time zone 'Europe/Berlin'
    ) - interval '1 microsecond';
    v_is_skonto := v_total = v_expected_skonto_payment_cents and p_booked_at <= v_skonto_deadline;
  end if;

  v_match := case
    when v_total=v_case.total_gross_cents then 'MATCHED'
    when v_is_skonto then 'MATCHED'
    when v_total<v_case.total_gross_cents then 'PARTIAL'
    else 'OVERPAID'
  end;

  v_payment_evidence := coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object(
    'settlementType',case when v_is_skonto then 'SKONTO' else case when v_match='MATCHED' then 'FULL' else v_match end end,
    'invoiceGrossCents',v_case.total_gross_cents,
    'receivedCumulativeCents',v_total,
    'skontoCents',case when v_is_skonto then v_skonto_cents else 0 end,
    'cashAllowancePercent',case when v_is_skonto then v_case.cash_allowance_percent else null end,
    'cashAllowanceDays',case when v_is_skonto then v_case.cash_allowance_days else null end,
    'cashAllowanceDeadline',case when v_is_skonto then v_skonto_deadline else null end
  );

  insert into public.billing_payments (
    billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,
    match_status,raw_reference,evidence
  ) values (
    v_case.id,p_provider,p_provider_transaction_id,p_amount_cents,upper(p_currency),p_booked_at,
    v_match,p_evidence->>'reference',v_payment_evidence
  ) returning * into v_payment;

  insert into public.billing_events (
    billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload
  ) values (
    v_case.id,p_source_event_id,
    case when v_is_skonto then 'PAYMENT_INGESTED_WITH_SKONTO' else 'PAYMENT_INGESTED' end,
    p_provider,'system',p_provider_transaction_id,to_jsonb(v_payment)
  ) on conflict (idempotency_key) do nothing;

  if v_match='MATCHED' then
    update public.billing_payments
    set match_status='MATCHED',updated_at=now()
    where billing_case_id=v_case.id and match_status='PARTIAL';

    update public.billing_cases
    set paid_at=coalesce(paid_at,p_booked_at),
        status=case
          when tax_review_status='REVIEW_REQUIRED' then 'MANUAL_REVIEW'
          when final_invoice_at is null then 'INVOICE_PENDING'
          else 'INVOICED'
        end,
        lock_version=lock_version+1
    where id=v_case.id
    returning * into v_case;

    if v_case.tax_review_status<>'REVIEW_REQUIRED' and v_case.final_invoice_at is null then
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (
        v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',
        jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','PAYMENT_RECEIVED')
      ) on conflict (idempotency_key) do nothing;
    elsif v_case.final_invoice_at is not null then
      select easybill_document_id into v_invoice_document_id
      from public.billing_documents
      where billing_case_id=v_case.id
        and document_type='INVOICE'
        and status in ('FINALIZED','SENT')
      order by created_at desc
      limit 1;

      if v_invoice_document_id is null then
        raise exception 'BILLING_FINAL_INVOICE_DOCUMENT_MISSING';
      end if;

      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (
        v_case.id,
        'billing:'||v_case.id::text||':project-payment-easybill',
        'PROJECT_PAYMENT_EASYBILL',
        jsonb_build_object(
          'paymentId',v_payment.id,
          'documentId',v_invoice_document_id,
          'amountCents',v_total,
          'paidAt',p_booked_at,
          'markPaid',v_is_skonto,
          'settlementType',case when v_is_skonto then 'SKONTO' else 'FULL' end,
          'skontoCents',case when v_is_skonto then v_skonto_cents else 0 end,
          'invoiceGrossCents',v_case.total_gross_cents
        )
      ) on conflict (idempotency_key) do nothing;
    end if;

    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
    values (
      v_case.id,
      'payment:'||v_payment.id::text||':shopify',
      'PROJECT_PAYMENT_SHOPIFY',
      jsonb_build_object(
        'paymentId',v_payment.id,
        'amountCents',p_amount_cents,
        'receivedCumulativeCents',v_total,
        'bookedAt',p_booked_at,
        'settlementType',case when v_is_skonto then 'SKONTO' else 'FULL' end,
        'skontoCents',case when v_is_skonto then v_skonto_cents else 0 end,
        'invoiceGrossCents',v_case.total_gross_cents
      )
    ) on conflict (idempotency_key) do nothing;
  else
    update public.billing_cases
    set status='MANUAL_REVIEW',lock_version=lock_version+1
    where id=v_case.id
    returning * into v_case;

    insert into public.billing_incidents (
      billing_case_id,incident_key,severity,title,summary,details
    ) values (
      v_case.id,'payment-review:'||v_payment.id::text,'WARNING',
      case when v_match='PARTIAL' then 'Teilzahlung manuell prüfen' else 'Überzahlung manuell prüfen' end,
      case
        when v_case.payment_policy_code='UMDASCH_3PCT_30D' and v_total=v_expected_skonto_payment_cents and v_case.final_invoice_at is null
          then 'Der Skontobetrag ging vor der finalen Rechnung ein und wird deshalb nicht automatisch abgeschlossen.'
        when v_case.payment_policy_code='UMDASCH_3PCT_30D' and v_total=v_expected_skonto_payment_cents and p_booked_at>coalesce(v_skonto_deadline,p_booked_at)
          then 'Der Skontobetrag ging nach Ablauf der 30-Tage-Frist ein und wird deshalb nicht automatisch abgeschlossen.'
        else 'Teil- oder Überzahlungen erzeugen nicht automatisch eine finale Rechnung.'
      end,
      jsonb_build_object(
        'paymentId',v_payment.id,
        'amountCents',p_amount_cents,
        'cumulativeCents',v_total,
        'expectedCents',v_case.total_gross_cents,
        'expectedSkontoPaymentCents',case when v_case.payment_policy_code='UMDASCH_3PCT_30D' then v_expected_skonto_payment_cents else null end,
        'skontoDeadline',v_skonto_deadline
      )
    ) on conflict (incident_key) do nothing;
  end if;

  return jsonb_build_object(
    'id',v_payment.id,
    'duplicate',false,
    'matchStatus',v_match,
    'billingCaseId',v_case.id,
    'billingCaseStatus',v_case.status,
    'settlementType',case when v_is_skonto then 'SKONTO' else case when v_match='MATCHED' then 'FULL' else v_match end end,
    'skontoCents',case when v_is_skonto then v_skonto_cents else 0 end,
    'receivedCents',v_total,
    'invoiceGrossCents',v_case.total_gross_cents
  );
end;
$function$
