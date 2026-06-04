alter table public.customer_email_messages
  drop constraint if exists customer_email_messages_has_time;

comment on table public.customer_email_messages is
  'Outlook email history linked to NEONTRIP customer records. Postgres is source of truth; n8n writes idempotently by message_id. Outlook may omit message timestamps, so created_at/updated_at remain the fallback ordering fields.';
