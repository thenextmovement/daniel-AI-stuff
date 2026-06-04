create table if not exists public.customer_email_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null,
  internet_message_id text,
  conversation_id text,
  mailbox text not null default 'support@neontrip.de',
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email text,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  bcc_emails text[] not null default '{}',
  matched_email text,
  linked_request_id uuid,
  linked_customer_id uuid,
  subject text,
  body_preview text,
  received_at timestamptz,
  sent_at timestamptz,
  message_created_at timestamptz,
  source text not null default 'outlook',
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_email_messages_message_id_key unique (message_id),
  constraint customer_email_messages_has_time check (
    received_at is not null
    or sent_at is not null
    or message_created_at is not null
  )
);

create index if not exists customer_email_messages_linked_request_idx
  on public.customer_email_messages (linked_request_id, coalesce(received_at, sent_at, message_created_at) desc);

create index if not exists customer_email_messages_linked_customer_idx
  on public.customer_email_messages (linked_customer_id, coalesce(received_at, sent_at, message_created_at) desc);

create index if not exists customer_email_messages_from_email_idx
  on public.customer_email_messages (lower(from_email));

create index if not exists customer_email_messages_matched_email_idx
  on public.customer_email_messages (lower(matched_email));

create index if not exists customer_email_messages_conversation_idx
  on public.customer_email_messages (conversation_id);

create index if not exists customer_email_messages_to_emails_gin_idx
  on public.customer_email_messages using gin (to_emails);

create index if not exists customer_email_messages_cc_emails_gin_idx
  on public.customer_email_messages using gin (cc_emails);

create index if not exists customer_email_messages_updated_idx
  on public.customer_email_messages (updated_at desc);

comment on table public.customer_email_messages is
  'Outlook email history linked to NEONTRIP customer records. Postgres is source of truth; n8n writes idempotently by message_id.';

alter table public.customer_email_messages enable row level security;

drop policy if exists customer_email_messages_service_role_all on public.customer_email_messages;
create policy customer_email_messages_service_role_all
  on public.customer_email_messages
  for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'customer_email_messages_updated_at'
      and tgrelid = 'public.customer_email_messages'::regclass
  ) then
    create trigger customer_email_messages_updated_at
      before update on public.customer_email_messages
      for each row execute function public.update_updated_at_column();
  end if;
end $$;
