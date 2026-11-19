create table public.voice_customer_phone_numbers (
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 created_by uuid not null references public.voice_staff(id),
 created_at timestamptz not null default now(),
 primary key(customer_id,phone)
);
create index voice_customer_phone_lookup on public.voice_customer_phone_numbers(phone);
alter table public.voice_customer_phone_numbers enable row level security;
revoke all on public.voice_customer_phone_numbers from public,anon,authenticated;
grant select,insert on public.voice_customer_phone_numbers to service_role;
create or replace view public.voice_customer_directory with (security_invoker=true) as
 select c.id,coalesce(r.request_id,c.request_id) as request_id,
 r.title as request_title,r.created_at as request_created_at,
 c.name,c.first_name,c.last_name,c.company,c.company_name,c.email,c.phone,c.original_phone,c.billing_email,c.original_email,
 array(select p.phone from public.voice_customer_phone_numbers p where p.customer_id=c.id order by p.created_at,p.phone) as additional_phones
 from public.master_customers c left join lateral (
 select request_id,title,created_at from public.master_requests
 where customer_id=c.id and request_id is not null
 order by created_at desc nulls last,id desc limit 1
 ) r on true;
