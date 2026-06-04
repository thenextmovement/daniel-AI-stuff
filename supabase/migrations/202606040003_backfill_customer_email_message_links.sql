create table if not exists public.ops_customer_email_message_link_backfill_20260604 (
  message_id uuid primary key,
  previous_linked_request_id uuid,
  previous_linked_customer_id uuid,
  new_linked_request_id uuid not null,
  new_linked_customer_id uuid not null,
  matched_email text,
  created_at timestamptz not null default now()
);

with email_map as (
  select lower(trim(email_value)) as email_key,
         count(distinct mc.id) as customer_count,
         (min(mc.id::text))::uuid as customer_id,
         (min(mr.id::text))::uuid as request_uuid
  from public.master_customers mc
  join public.master_requests mr on mr.request_id = mc.request_id
  cross join lateral unnest(array_remove(array[mc.email, mc.billing_email, mc.original_email], null)) as email_value
  where nullif(trim(email_value), '') is not null
    and lower(trim(email_value)) not in ('support@neontrip.de','info@neontrip.de','kontakt@neontrip.de','angebote@neontrip.de')
  group by lower(trim(email_value))
), message_emails as (
  select cem.id, lower(trim(cem.matched_email)) as email_key
  from public.customer_email_messages cem
  where cem.linked_request_id is null
    and cem.linked_customer_id is null
    and nullif(trim(cem.matched_email), '') is not null
  union
  select cem.id, lower(trim(cem.from_email)) as email_key
  from public.customer_email_messages cem
  where cem.linked_request_id is null
    and cem.linked_customer_id is null
    and nullif(trim(cem.from_email), '') is not null
  union
  select cem.id, lower(trim(email_value)) as email_key
  from public.customer_email_messages cem
  cross join lateral unnest(coalesce(cem.to_emails, array[]::text[])) as email_value
  where cem.linked_request_id is null
    and cem.linked_customer_id is null
    and nullif(trim(email_value), '') is not null
  union
  select cem.id, lower(trim(email_value)) as email_key
  from public.customer_email_messages cem
  cross join lateral unnest(coalesce(cem.cc_emails, array[]::text[])) as email_value
  where cem.linked_request_id is null
    and cem.linked_customer_id is null
    and nullif(trim(email_value), '') is not null
), candidates as (
  select me.id,
         count(distinct em.customer_id) as matched_customers,
         (min(em.customer_id::text))::uuid as customer_id,
         (min(em.request_uuid::text))::uuid as request_uuid,
         min(me.email_key) as matched_email
  from message_emails me
  join email_map em on em.email_key = me.email_key and em.customer_count = 1
  group by me.id
  having count(distinct em.customer_id) = 1 and min(em.request_uuid::text) is not null
)
insert into public.ops_customer_email_message_link_backfill_20260604 (
  message_id,
  previous_linked_request_id,
  previous_linked_customer_id,
  new_linked_request_id,
  new_linked_customer_id,
  matched_email
)
select cem.id,
       cem.linked_request_id,
       cem.linked_customer_id,
       candidates.request_uuid,
       candidates.customer_id,
       candidates.matched_email
from public.customer_email_messages cem
join candidates on candidates.id = cem.id
on conflict (message_id) do nothing;

update public.customer_email_messages cem
set linked_request_id = backup.new_linked_request_id,
    linked_customer_id = backup.new_linked_customer_id
from public.ops_customer_email_message_link_backfill_20260604 backup
where backup.message_id = cem.id
  and cem.linked_request_id is null
  and cem.linked_customer_id is null;

comment on table public.ops_customer_email_message_link_backfill_20260604 is
  'Rollback table for the 2026-06-04 customer_email_messages link backfill. To undo, set linked IDs back to previous values for listed message_id rows.';
