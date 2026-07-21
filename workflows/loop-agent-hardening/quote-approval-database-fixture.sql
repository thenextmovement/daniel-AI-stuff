create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.quote_approvals (
  id uuid primary key,
  card_id text not null unique,
  card_name text,
  card_url text,
  chat_id text not null,
  message_id bigint,
  prompt_message_id bigint,
  status text not null default 'pending',
  awaiting_input boolean not null default false,
  change_log jsonb default '[]'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  sent_attachments jsonb not null default '[]'::jsonb
);

alter table public.quote_approvals
  alter column id set default gen_random_uuid();

grant select, insert, update on public.quote_approvals to service_role;
