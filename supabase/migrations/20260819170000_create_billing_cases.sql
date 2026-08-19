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
  constraint billing_cases_money_check check (subtotal_net_cents >= 0 and vat_cents >= 0 and total_gross_cents >= 0 and subtotal_net_cents + vat_cents = total_gross_cents),
  constraint billing_cases_payment_method_check check (payment_method in ('VORKASSE', 'KAUF_AUF_RECHNUNG')),
  constraint billing_cases_payment_terms_check check ((payment_method = 'VORKASSE' and payment_terms_days is null) or (payment_method = 'KAUF_AUF_RECHNUNG' and payment_terms_days in (7, 14, 30))),
  constraint billing_cases_tax_treatment_check check (tax_treatment in ('DE_STANDARD', 'EU_B2C_OSS', 'EU_B2B_REVERSE_CHARGE', 'EXPORT_THIRD_COUNTRY')),
  constraint billing_cases_tax_review_check check (tax_review_status in ('NOT_REQUIRED', 'VERIFIED', 'REVIEW_REQUIRED')),
  constraint billing_cases_status_check check (status in ('PROFORMA_PENDING', 'PROFORMA_READY', 'PAYMENT_PENDING', 'PAID', 'DELIVERED', 'INVOICE_PENDING', 'INVOICED', 'MANUAL_REVIEW', 'SYNC_BLOCKED', 'CANCELLED', 'REFUNDED'))
);

create index if not exists billing_cases_status_updated_idx on public.billing_cases (status, updated_at desc);
create index if not exists billing_cases_customer_email_idx on public.billing_cases (lower(customer_email));

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

create or replace function public.set_billing_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['billing_cases','billing_documents','billing_payments','billing_change_requests','billing_jobs','billing_incidents'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', v_table, v_table);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_billing_updated_at()', v_table, v_table);
  end loop;
end;
$$;

create or replace function public.billing_case_ingest(p_case jsonb, p_snapshot jsonb, p_snapshot_hash text, p_source_event_id text, p_portal_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_conflict boolean := false;
begin
  select * into v_case from public.billing_cases where shopify_order_id = p_case->>'shopify_order_id' for update;
  if found then
    v_conflict := v_case.source_snapshot_hash <> p_snapshot_hash;
    insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values (v_case.id,p_source_event_id,case when v_conflict then 'INTAKE_SNAPSHOT_CONFLICT' else 'INTAKE_REPLAY' end,coalesce(p_case->>'source_system','unknown'),'system',p_source_event_id,jsonb_build_object('incomingHash',p_snapshot_hash,'storedHash',v_case.source_snapshot_hash))
    on conflict (idempotency_key) do nothing;
    if v_conflict then
      update public.billing_cases set status='SYNC_BLOCKED',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
      insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
      values (v_case.id,'intake-conflict:'||v_case.id::text||':'||p_snapshot_hash,'URGENT','Shopify/Ops-Auftragssnapshot weicht ab','Ein bekannter Shopify-Auftrag wurde mit abweichenden Finanz- oder Steuerdaten erneut übergeben.',jsonb_build_object('incomingHash',p_snapshot_hash,'storedHash',v_case.source_snapshot_hash))
      on conflict (incident_key) do nothing;
    end if;
    return jsonb_build_object('id',v_case.id,'created',false,'conflict',v_conflict,'status',v_case.status);
  end if;

  insert into public.billing_cases (source_system,source_offer_id,source_acceptance_id,source_snapshot_hash,shopify_order_id,shopify_order_name,customer,customer_email,billing_address,delivery_address,line_items,totals,currency,subtotal_net_cents,vat_cents,total_gross_cents,payment_method,payment_terms_days,tax_treatment,tax_review_status,tax_exempt,vat_id,vat_validation,status,portal_token_hash,accepted_at)
  values (p_case->>'source_system',nullif(p_case->>'source_offer_id',''),nullif(p_case->>'source_acceptance_id',''),p_snapshot_hash,p_case->>'shopify_order_id',p_case->>'shopify_order_name',coalesce(p_case->'customer','{}'::jsonb),nullif(p_case->>'customer_email',''),coalesce(p_case->'billing_address','{}'::jsonb),coalesce(p_case->'delivery_address','{}'::jsonb),coalesce(p_case->'line_items','[]'::jsonb),coalesce(p_case->'totals','{}'::jsonb),p_case->>'currency',(p_case->>'subtotal_net_cents')::bigint,(p_case->>'vat_cents')::bigint,(p_case->>'total_gross_cents')::bigint,p_case->>'payment_method',nullif(p_case->>'payment_terms_days','')::integer,p_case->>'tax_treatment',p_case->>'tax_review_status',(p_case->>'tax_exempt')::boolean,nullif(p_case->>'vat_id',''),p_case->'vat_validation',p_case->>'status',p_portal_token_hash,nullif(p_case->>'accepted_at','')::timestamptz)
  returning * into v_case;
  insert into public.billing_case_versions (billing_case_id,revision,snapshot_hash,snapshot,source,actor,reason) values (v_case.id,0,p_snapshot_hash,p_snapshot,v_case.source_system,'system','INITIAL_INTAKE');
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload) values (v_case.id,p_source_event_id,'BILLING_CASE_CREATED',v_case.source_system,'system',p_source_event_id,p_snapshot);
  insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload) values (v_case.id,'billing:'||v_case.id::text||':proforma:0','CREATE_PROFORMA',jsonb_build_object('revision',0,'documentNumber','PF-'||replace(v_case.shopify_order_name,'#','')));
  if v_case.tax_review_status='REVIEW_REQUIRED' then
    insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
    values (v_case.id,'vat-review:'||v_case.id::text,'WARNING','Umsatzsteuer-ID passt nicht eindeutig zur Firma','Bestellung und Produktion bleiben möglich. Bitte USt-ID, Firmenname und Anschrift vor der finalen Nettorechnung prüfen.',jsonb_build_object('vatId',v_case.vat_id,'validation',v_case.vat_validation)) on conflict (incident_key) do nothing;
    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
    values (v_case.id,'billing:'||v_case.id::text||':verify-vat','VERIFY_VAT',jsonb_build_object('vatId',v_case.vat_id,'validation',v_case.vat_validation)) on conflict (idempotency_key) do nothing;
  end if;
  return jsonb_build_object('id',v_case.id,'created',true,'conflict',false,'status',v_case.status);
end;
$$;

create or replace function public.billing_portal_submit_change(p_portal_token_hash text,p_idempotency_key text,p_changes jsonb,p_requester_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_request public.billing_change_requests;
begin
  select * into v_case from public.billing_cases where portal_token_hash=p_portal_token_hash and portal_revoked_at is null for update;
  if not found then raise exception 'BILLING_PORTAL_NOT_FOUND'; end if;
  if v_case.final_invoice_at is not null then raise exception 'BILLING_PORTAL_READ_ONLY'; end if;
  insert into public.billing_change_requests (billing_case_id,idempotency_key,source,requested_changes,requester_email)
  values (v_case.id,p_idempotency_key,'CUSTOMER_PORTAL',p_changes,nullif(p_requester_email,''))
  on conflict (idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into v_request;
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
  values (v_case.id,'event:'||p_idempotency_key,'CHANGE_REQUEST_SUBMITTED','CUSTOMER_PORTAL','customer',p_idempotency_key,jsonb_build_object('changeRequestId',v_request.id)) on conflict (idempotency_key) do nothing;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'billingCaseId',v_case.id);
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['billing_cases','billing_case_versions','billing_documents','billing_payments','billing_change_requests','billing_events','billing_jobs','billing_incidents'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('drop policy if exists %I_service_role_all on public.%I',v_table,v_table);
    execute format('create policy %I_service_role_all on public.%I for all to service_role using (true) with check (true)',v_table,v_table);
    execute format('revoke all on table public.%I from anon, authenticated',v_table);
    execute format('grant select,insert,update,delete on table public.%I to service_role',v_table);
  end loop;
end;
$$;

revoke all on function public.billing_case_ingest(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_case_ingest(jsonb,jsonb,text,text,text) to service_role;
revoke all on function public.billing_portal_submit_change(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_portal_submit_change(text,text,jsonb,text) to service_role;
