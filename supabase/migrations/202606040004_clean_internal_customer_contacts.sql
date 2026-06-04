create table if not exists public.ops_customer_contact_cleanup_20260604 (
  customer_id uuid primary key,
  request_id text,
  previous_email text,
  previous_original_email text,
  previous_billing_email text,
  previous_first_name text,
  previous_last_name text,
  previous_name text,
  cleanup_reason text not null,
  created_at timestamptz not null default now()
);

insert into public.ops_customer_contact_cleanup_20260604 (
  customer_id,
  request_id,
  previous_email,
  previous_original_email,
  previous_billing_email,
  previous_first_name,
  previous_last_name,
  previous_name,
  cleanup_reason
)
select
  id,
  request_id,
  email,
  original_email,
  billing_email,
  first_name,
  last_name,
  name,
  concat_ws(
    ',',
    case
      when lower(coalesce(email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
        then 'internal_email'
    end,
    case
      when lower(coalesce(original_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
        then 'internal_original_email'
    end,
    case
      when lower(coalesce(billing_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
        then 'internal_billing_email'
    end,
    case
      when lower(coalesce(first_name, '')) = 'vorname' and lower(coalesce(last_name, '')) = 'nachname'
        then 'placeholder_name'
    end
  )
from public.master_customers
where lower(coalesce(email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
   or lower(coalesce(original_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
   or lower(coalesce(billing_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
   or (lower(coalesce(first_name, '')) = 'vorname' and lower(coalesce(last_name, '')) = 'nachname')
on conflict (customer_id) do nothing;

update public.master_customers mc
set
  email = case
    when lower(coalesce(mc.email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
      then concat('missing-email-', mc.id::text, '@no-customer-email.invalid')
    else mc.email
  end,
  original_email = case
    when lower(coalesce(mc.original_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de') then null
    else mc.original_email
  end,
  billing_email = case
    when lower(coalesce(mc.billing_email, '')) in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de') then null
    else mc.billing_email
  end,
  first_name = case
    when lower(coalesce(mc.first_name, '')) = 'vorname' and lower(coalesce(mc.last_name, '')) = 'nachname' then null
    else mc.first_name
  end,
  last_name = case
    when lower(coalesce(mc.first_name, '')) = 'vorname' and lower(coalesce(mc.last_name, '')) = 'nachname' then null
    else mc.last_name
  end,
  name = case
    when lower(coalesce(mc.first_name, '')) = 'vorname' and lower(coalesce(mc.last_name, '')) = 'nachname' then null
    else mc.name
  end
from public.ops_customer_contact_cleanup_20260604 backup
where backup.customer_id = mc.id;

comment on table public.ops_customer_contact_cleanup_20260604 is
  'Rollback table for the 2026-06-04 cleanup of internal NEONTRIP emails and exact placeholder names in master_customers.';
