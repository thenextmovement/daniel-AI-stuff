create table public.voice_customer_links(
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 request_id text not null,
 kind text not null check(kind in ('quentin','inquiry','offer')),
 url text not null check(length(url) between 1 and 2048 and url like 'https://%'),
 updated_by uuid not null references public.voice_staff(id),
 updated_at timestamptz not null default now(),
 primary key(customer_id,request_id,kind)
);
alter table public.voice_customer_links enable row level security;
revoke all on public.voice_customer_links from public,anon,authenticated;
grant select,insert,update on public.voice_customer_links to service_role;
