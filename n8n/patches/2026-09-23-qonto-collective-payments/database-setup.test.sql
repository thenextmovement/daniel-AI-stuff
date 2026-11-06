CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
create extension if not exists pgcrypto;

create table if not exists public.billing_cases (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_offer_id text,
  source_acceptance_id text,
  source_snapshot_hash text not null,
  shopify_order_id text not null unique,
  shopify_order_name text not null unique,
  customer jsonb not null default '{}'::jsonb,
  customer_email text,
  project_number text,
  billing_address jsonb not null default '{}'::jsonb,
  delivery_address jsonb not null default '{}'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  currency text not null,
  subtotal_net_cents bigint not null,
  vat_cents bigint not null,
  total_gross_cents bigint not null,
  payment_method text not null default 'VORKASSE',
  payment_terms_days integer,
  tax_treatment text not null,
  tax_review_status text not null,
  tax_exempt boolean not null default false,
  vat_id text,
  vat_validation jsonb,
  status text not null default 'PROFORMA_PENDING',
  current_revision integer not null default 0,
  portal_token_hash text not null unique,
  portal_token_version integer not null default 1,
  portal_revoked_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  final_invoice_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  lock_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_cases_order_name_check check (shopify_order_name ~ '^#NEONT[0-9]+$'),
  constraint billing_cases_project_number_check check (project_number is null or (length(project_number) between 1 and 100 and project_number !~ '[[:cntrl:]<>]')),
  constraint billing_cases_money_check check (subtotal_net_cents >= 0 and vat_cents >= 0 and total_gross_cents >= 0 and subtotal_net_cents + vat_cents = total_gross_cents),
  constraint billing_cases_payment_method_check check (payment_method in ('VORKASSE', 'KAUF_AUF_RECHNUNG')),
  constraint billing_cases_payment_terms_check check ((payment_method = 'VORKASSE' and payment_terms_days is null) or (payment_method = 'KAUF_AUF_RECHNUNG' and payment_terms_days in (7, 14, 30))),
  constraint billing_cases_tax_treatment_check check (tax_treatment in ('DE_STANDARD', 'EU_B2C_OSS', 'EU_B2B_REVERSE_CHARGE', 'EXPORT_THIRD_COUNTRY')),
  constraint billing_cases_tax_review_check check (tax_review_status in ('NOT_REQUIRED', 'VERIFIED', 'REVIEW_REQUIRED')),
  constraint billing_cases_status_check check (status in ('PROFORMA_PENDING', 'PROFORMA_READY', 'PAYMENT_PENDING', 'PAID', 'DELIVERED', 'INVOICE_PENDING', 'INVOICED', 'MANUAL_REVIEW', 'SYNC_BLOCKED', 'CANCELLED', 'REFUNDED'))
);

create index if not exists billing_cases_status_updated_idx on public.billing_cases (status, updated_at desc);
create index if not exists billing_cases_customer_email_idx on public.billing_cases (lower(customer_email));
create index if not exists billing_cases_project_number_idx on public.billing_cases (lower(project_number));

create table if not exists public.billing_case_versions (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete cascade,
  revision integer not null,
  snapshot_hash text not null,
  snapshot jsonb not null,
  source text not null,
  actor text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (billing_case_id, revision),
  unique (billing_case_id, snapshot_hash)
);

create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete restrict,
  document_type text not null,
  revision integer not null default 0,
  document_number text not null unique,
  status text not null default 'PENDING',
  easybill_document_id text unique,
  payload_hash text not null,
  amount_cents bigint not null,
  currency text not null,
  supersedes_document_id uuid references public.billing_documents(id) on delete restrict,
  finalized_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_documents_type_check check (document_type in ('PROFORMA', 'INVOICE', 'CREDIT', 'CANCELLATION')),
  constraint billing_documents_status_check check (status in ('PENDING', 'PROCESSING', 'DRAFT', 'FINALIZED', 'SENT', 'FAILED', 'SUPERSEDED')),
  constraint billing_documents_revision_check check (revision >= 0),
  constraint billing_documents_amount_check check (amount_cents >= 0),
  unique (billing_case_id, document_type, revision)
);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete restrict,
  provider text not null,
  provider_transaction_id text not null,
  amount_cents bigint not null,
  currency text not null,
  booked_at timestamptz not null,
  match_status text not null,
  shopify_projection_status text not null default 'PENDING',
  easybill_projection_status text not null default 'PENDING',
  raw_reference text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id),
  constraint billing_payments_amount_check check (amount_cents > 0),
  constraint billing_payments_match_check check (match_status in ('MATCHED', 'PARTIAL', 'OVERPAID', 'AMBIGUOUS', 'REJECTED')),
  constraint billing_payments_projection_check check (shopify_projection_status in ('PENDING', 'DONE', 'FAILED', 'NOT_REQUIRED') and easybill_projection_status in ('PENDING', 'DONE', 'FAILED', 'NOT_REQUIRED'))
);

create table if not exists public.billing_change_requests (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete cascade,
  idempotency_key text not null unique,
  source text not null,
  status text not null default 'PENDING',
  requested_changes jsonb not null,
  requester_email text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_change_requests_source_check check (source in ('CUSTOMER_PORTAL', 'OPS')),
  constraint billing_change_requests_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED'))
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete cascade,
  idempotency_key text not null unique,
  event_type text not null,
  source text not null,
  actor text not null,
  correlation_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_jobs (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid not null references public.billing_cases(id) on delete restrict,
  idempotency_key text not null unique,
  job_type text not null,
  status text not null default 'PENDING',
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  lease_token text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_jobs_type_check check (job_type in ('CREATE_PROFORMA', 'CREATE_INVOICE', 'CREATE_CREDIT', 'CREATE_CANCELLATION', 'VOID_PROFORMA', 'PROJECT_PAYMENT_SHOPIFY', 'PROJECT_PAYMENT_EASYBILL', 'SEND_CUSTOMER_DOCUMENT', 'VERIFY_VAT', 'RECONCILE')),
  constraint billing_jobs_status_check check (status in ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'BLOCKED'))
);

create index if not exists billing_jobs_claim_idx on public.billing_jobs (status, next_attempt_at, created_at);

create table if not exists public.billing_incidents (
  id uuid primary key default gen_random_uuid(),
  billing_case_id uuid references public.billing_cases(id) on delete cascade,
  incident_key text not null unique,
  severity text not null,
  status text not null default 'OPEN',
  title text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_incidents_severity_check check (severity in ('WARNING', 'URGENT')),
  constraint billing_incidents_status_check check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))
);


ALTER TABLE billing_cases ADD COLUMN payment_policy_code text, ADD COLUMN cash_allowance_percent numeric, ADD COLUMN cash_allowance_days integer;
CREATE TABLE processed_transactions(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,transaction_id text UNIQUE NOT NULL,neon_number text,amount numeric,shopify_marked_paid boolean,easybill_payment_created boolean,skip_reason text,processed_at timestamptz,created_at timestamptz DEFAULT now());
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
