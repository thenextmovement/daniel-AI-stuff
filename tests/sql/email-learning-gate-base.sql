create extension if not exists pgcrypto;

create table public.email_agent_log (
  id uuid primary key default gen_random_uuid(),
  message_id text not null,
  draft_created boolean not null default false,
  created_at timestamptz not null default now(),
  message_source text,
  category text,
  reply_length_class text,
  risk_level text,
  draft_body_text text
);

create table public.email_agent_feedback (
  id bigint generated always as identity primary key,
  source_message_id text not null,
  sent_message_id text not null unique,
  draft_body_hash text,
  sent_body_hash text,
  sent_body_text text,
  edit_ratio numeric,
  edit_summary jsonb not null default '{}'::jsonb,
  edit_labels text[] not null default '{}'::text[],
  change_profile jsonb not null default '{}'::jsonb,
  review_priority text not null default 'normal',
  learning_status text not null default 'pending',
  human_review_note text,
  human_reviewed_by text,
  human_reviewed_at timestamptz,
  is_valid boolean not null default true,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.review_email_agent_feedback(
  p_feedback_id bigint,
  p_decision text,
  p_note text default null,
  p_reviewer text default null
)
returns jsonb language sql as $$ select '{}'::jsonb $$;

create table public.voice_knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.voice_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.voice_knowledge_articles(id) on delete cascade,
  version_number integer not null,
  title text not null,
  content text not null,
  status text not null default 'draft',
  allowed_modes text[] not null,
  risk_class text not null default 'standard',
  source_refs jsonb not null default '[]'::jsonb,
  content_hash text not null,
  valid_from timestamptz,
  valid_until timestamptz,
  authored_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, version_number)
);

create table public.voice_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.voice_knowledge_versions(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  search_vector tsvector generated always as (to_tsvector('german', coalesce(content, ''))) stored,
  unique (version_id, chunk_index)
);

create or replace function public.review_voice_knowledge_version(
  p_version_id uuid,
  p_decision text,
  p_reviewer text
)
returns table (version_id uuid, article_id uuid, status text)
language sql as $$ select null::uuid, null::uuid, null::text where false $$;

grant execute on function public.review_email_agent_feedback(bigint, text, text, text) to service_role;
grant execute on function public.review_voice_knowledge_version(uuid, text, text) to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

