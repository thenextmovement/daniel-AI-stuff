-- Preserve exact matching used by PostgREST OR filters. Existing lower(email)
-- indexes cannot serve these predicates; one unindexed arm forces a full scan.
set lock_timeout = '3s';
create index if not exists customer_email_messages_matched_email_exact_idx
  on public.customer_email_messages (matched_email);
create index if not exists customer_email_messages_from_email_exact_idx
  on public.customer_email_messages (from_email);

-- Compute the latest request once for the directory, rather than repeating
-- an index scan and sort for every customer before the top-level LIMIT.
-- CREATE OR REPLACE preserves grants; keep the existing invoker security explicitly.
create or replace view public.voice_customer_directory with (security_invoker=true) as
select c.id, coalesce(r.request_id,c.request_id) as request_id,
 r.title as request_title,r.created_at as request_created_at,
 c.name,c.first_name,c.last_name,c.company,c.company_name,c.email,c.phone,
 c.original_phone,c.billing_email,c.original_email,
 array(select p.phone from public.voice_customer_phone_numbers p
       where p.customer_id=c.id order by p.created_at,p.phone) as additional_phones
from public.master_customers c
left join (
 select distinct on (customer_id) customer_id,request_id,title,created_at
 from public.master_requests
 where request_id is not null and customer_id is not null
 order by customer_id,created_at desc nulls last,id desc
) r on r.customer_id=c.id;
reset lock_timeout;
