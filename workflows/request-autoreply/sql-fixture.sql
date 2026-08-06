\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin';
  end if;
end;
$$;

alter role service_role bypassrls;

create table public.master_customers (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text,
  last_name text,
  name text,
  company_name text,
  company text,
  country text
);

create table public.master_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  customer_id uuid references public.master_customers(id),
  email text,
  first_name text,
  title text,
  description text,
  message text,
  status text,
  size text,
  requested_size text,
  color jsonb,
  requested_color text,
  application text,
  requested_usage text,
  usage text,
  customer_type text,
  country text,
  form_id text,
  attribution_raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

grant usage on schema public to service_role;
grant select, insert, update on public.master_customers to service_role;
grant select, insert, update on public.master_requests to service_role;
