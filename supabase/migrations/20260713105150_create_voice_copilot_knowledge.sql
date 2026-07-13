create table if not exists public.voice_knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_knowledge_articles_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$')
);

create table if not exists public.voice_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.voice_knowledge_articles(id) on delete cascade,
  version_number integer not null,
  title text not null,
  content text not null,
  status text not null default 'draft',
  allowed_modes text[] not null default array['lead_qualification', 'follow_up']::text[],
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
  constraint voice_knowledge_versions_article_version_key unique (article_id, version_number),
  constraint voice_knowledge_versions_status_check check (status in ('draft', 'review', 'approved', 'retired')),
  constraint voice_knowledge_versions_risk_check check (risk_class in ('standard', 'sensitive', 'restricted')),
  constraint voice_knowledge_versions_modes_check check (
    allowed_modes <@ array['internal_test', 'lead_qualification', 'follow_up']::text[]
    and cardinality(allowed_modes) > 0
  ),
  constraint voice_knowledge_versions_review_check check (
    status <> 'approved' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint voice_knowledge_versions_validity_check check (
    valid_until is null or valid_from is null or valid_until > valid_from
  )
);

create table if not exists public.voice_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.voice_knowledge_versions(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  search_vector tsvector generated always as (to_tsvector('german', coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  constraint voice_knowledge_chunks_version_index_key unique (version_id, chunk_index),
  constraint voice_knowledge_chunks_index_check check (chunk_index >= 0),
  constraint voice_knowledge_chunks_content_check check (char_length(content) between 1 and 4000)
);

create table if not exists public.voice_knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_ref text,
  request_id text,
  proposed_statement text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  confidence numeric(5,4),
  status text not null default 'pending',
  idempotency_key text not null unique,
  proposed_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  merged_article_id uuid references public.voice_knowledge_articles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_knowledge_candidates_source_check check (source_type in ('call_summary', 'operator_note', 'email_pattern')),
  constraint voice_knowledge_candidates_status_check check (status in ('pending', 'approved', 'rejected', 'merged')),
  constraint voice_knowledge_candidates_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint voice_knowledge_candidates_review_check check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null)
  )
);

create table if not exists public.voice_call_sessions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  operator_name text not null,
  mode text not null,
  bound_request_id text,
  bound_offer_id text,
  consent_status text not null default 'not_required_internal',
  transcript_storage_enabled boolean not null default false,
  status text not null default 'created',
  knowledge_version_ids uuid[] not null default '{}',
  context_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_sessions_mode_check check (mode in ('internal_test', 'lead_qualification', 'follow_up')),
  constraint voice_call_sessions_consent_check check (consent_status in ('not_required_internal', 'pending', 'confirmed', 'declined')),
  constraint voice_call_sessions_status_check check (status in ('created', 'live', 'completed', 'failed', 'cancelled')),
  constraint voice_call_sessions_customer_consent_check check (
    mode = 'internal_test' or consent_status in ('pending', 'confirmed', 'declined')
  ),
  constraint voice_call_sessions_transcript_consent_check check (
    transcript_storage_enabled = false or consent_status = 'confirmed'
  )
);

create index if not exists voice_knowledge_versions_article_created_idx
  on public.voice_knowledge_versions (article_id, created_at desc);

create index if not exists voice_knowledge_versions_review_idx
  on public.voice_knowledge_versions (status, updated_at desc);

create index if not exists voice_knowledge_chunks_search_idx
  on public.voice_knowledge_chunks using gin (search_vector);

create index if not exists voice_knowledge_chunks_version_idx
  on public.voice_knowledge_chunks (version_id, chunk_index);

create index if not exists voice_knowledge_candidates_review_idx
  on public.voice_knowledge_candidates (status, created_at desc);

create index if not exists voice_knowledge_candidates_request_idx
  on public.voice_knowledge_candidates (request_id, created_at desc)
  where request_id is not null;

create index if not exists voice_call_sessions_request_idx
  on public.voice_call_sessions (bound_request_id, created_at desc)
  where bound_request_id is not null;

comment on table public.voice_knowledge_articles is
  'Stable identities for internal Voice Copilot knowledge. Postgres is the source of truth.';

comment on table public.voice_knowledge_versions is
  'Reviewable knowledge versions. Only approved, mode-allowed and time-valid content may reach a call.';

comment on table public.voice_knowledge_chunks is
  'Bounded full-text search chunks generated from knowledge versions; never written directly by AI.';

comment on table public.voice_knowledge_candidates is
  'AI or operator proposals that require human review before becoming usable knowledge.';

comment on table public.voice_call_sessions is
  'Server-bound Voice Copilot sessions. Context is pinned to one request ID and raw transcripts are disabled by default.';

create or replace function public.search_approved_voice_knowledge(
  p_query text,
  p_mode text,
  p_limit integer default 4
)
returns table (
  article_id uuid,
  version_id uuid,
  chunk_id uuid,
  title text,
  content text,
  source_refs jsonb,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    article.id as article_id,
    version.id as version_id,
    chunk.id as chunk_id,
    version.title,
    chunk.content,
    version.source_refs,
    ts_rank_cd(chunk.search_vector, websearch_to_tsquery('german', left(trim(p_query), 240))) as rank
  from public.voice_knowledge_chunks as chunk
  join public.voice_knowledge_versions as version on version.id = chunk.version_id
  join public.voice_knowledge_articles as article on article.id = version.article_id
  where trim(coalesce(p_query, '')) <> ''
    and p_mode = any(version.allowed_modes)
    and version.status = 'approved'
    and version.risk_class <> 'restricted'
    and (version.valid_from is null or version.valid_from <= now())
    and (version.valid_until is null or version.valid_until > now())
    and chunk.search_vector @@ websearch_to_tsquery('german', left(trim(p_query), 240))
  order by rank desc, version.reviewed_at desc nulls last, chunk.chunk_index asc
  limit least(greatest(coalesce(p_limit, 4), 1), 8);
$$;

create or replace function public.create_voice_knowledge_draft(
  p_slug text,
  p_title text,
  p_content text,
  p_allowed_modes text[],
  p_risk_class text,
  p_source_refs jsonb,
  p_author text,
  p_content_hash text,
  p_chunks text[]
)
returns table (article_id uuid, version_id uuid, version_number integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_article_id uuid;
  v_version_id uuid;
  v_version_number integer;
begin
  perform pg_advisory_xact_lock(hashtext('voice_knowledge:' || p_slug));

  insert into public.voice_knowledge_articles (slug, created_by)
  values (p_slug, p_author)
  on conflict (slug) do update set updated_at = now()
  returning id into v_article_id;

  select existing.id, existing.version_number
    into v_version_id, v_version_number
  from public.voice_knowledge_versions as existing
  where existing.article_id = v_article_id
    and existing.content_hash = p_content_hash
  order by existing.version_number desc
  limit 1;

  if v_version_id is not null then
    return query select v_article_id, v_version_id, v_version_number;
    return;
  end if;

  select coalesce(max(existing.version_number), 0) + 1
    into v_version_number
  from public.voice_knowledge_versions as existing
  where existing.article_id = v_article_id;

  insert into public.voice_knowledge_versions (
    article_id,
    version_number,
    title,
    content,
    status,
    allowed_modes,
    risk_class,
    source_refs,
    content_hash,
    authored_by
  ) values (
    v_article_id,
    v_version_number,
    p_title,
    p_content,
    'review',
    p_allowed_modes,
    p_risk_class,
    p_source_refs,
    p_content_hash,
    p_author
  )
  returning id into v_version_id;

  insert into public.voice_knowledge_chunks (version_id, chunk_index, content)
  select v_version_id, chunk.ordinality - 1, chunk.content
  from unnest(p_chunks) with ordinality as chunk(content, ordinality);

  return query select v_article_id, v_version_id, v_version_number;
end;
$$;

create or replace function public.review_voice_knowledge_version(
  p_version_id uuid,
  p_decision text,
  p_reviewer text
)
returns table (version_id uuid, article_id uuid, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_article_id uuid;
  v_status text;
begin
  if p_decision not in ('approve', 'request_changes', 'retire') then
    raise exception 'invalid voice knowledge review decision';
  end if;

  select existing.article_id
    into v_article_id
  from public.voice_knowledge_versions as existing
  where existing.id = p_version_id
  for update;

  if v_article_id is null then
    raise exception 'voice knowledge version not found';
  end if;

  if p_decision = 'approve' then
    update public.voice_knowledge_versions as version
    set status = 'retired', updated_at = now()
    where version.article_id = v_article_id
      and version.id <> p_version_id
      and version.status = 'approved';

    v_status := 'approved';
    update public.voice_knowledge_versions as version
    set status = v_status, reviewed_by = p_reviewer, reviewed_at = now(), updated_at = now()
    where version.id = p_version_id;
  elsif p_decision = 'request_changes' then
    v_status := 'draft';
    update public.voice_knowledge_versions as version
    set status = v_status, reviewed_by = p_reviewer, reviewed_at = now(), updated_at = now()
    where version.id = p_version_id;
  else
    v_status := 'retired';
    update public.voice_knowledge_versions as version
    set status = v_status, reviewed_by = p_reviewer, reviewed_at = now(), updated_at = now()
    where version.id = p_version_id;
  end if;

  return query select p_version_id, v_article_id, v_status;
end;
$$;

create or replace function public.promote_voice_knowledge_candidate(
  p_candidate_id uuid,
  p_slug text,
  p_title text,
  p_reviewer text,
  p_content_hash text
)
returns table (candidate_id uuid, article_id uuid, version_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement text;
  v_evidence_refs jsonb;
  v_article_id uuid;
  v_version_id uuid;
  v_version_number integer;
begin
  select candidate.proposed_statement, candidate.evidence_refs
    into v_statement, v_evidence_refs
  from public.voice_knowledge_candidates as candidate
  where candidate.id = p_candidate_id
    and candidate.status = 'pending'
  for update;

  if v_statement is null then
    raise exception 'voice knowledge candidate is not pending';
  end if;

  perform pg_advisory_xact_lock(hashtext('voice_knowledge:' || p_slug));

  insert into public.voice_knowledge_articles (slug, created_by)
  values (p_slug, p_reviewer)
  on conflict (slug) do update set updated_at = now()
  returning id into v_article_id;

  select coalesce(max(existing.version_number), 0) + 1
    into v_version_number
  from public.voice_knowledge_versions as existing
  where existing.article_id = v_article_id;

  insert into public.voice_knowledge_versions (
    article_id,
    version_number,
    title,
    content,
    status,
    allowed_modes,
    risk_class,
    source_refs,
    content_hash,
    authored_by
  ) values (
    v_article_id,
    v_version_number,
    p_title,
    v_statement,
    'review',
    array['lead_qualification', 'follow_up']::text[],
    'standard',
    v_evidence_refs,
    p_content_hash,
    p_reviewer
  )
  returning id into v_version_id;

  insert into public.voice_knowledge_chunks (version_id, chunk_index, content)
  values (v_version_id, 0, v_statement);

  update public.voice_knowledge_candidates as candidate
  set status = 'merged',
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      merged_article_id = v_article_id,
      updated_at = now()
  where candidate.id = p_candidate_id;

  return query select p_candidate_id, v_article_id, v_version_id;
end;
$$;

alter table public.voice_knowledge_articles enable row level security;
alter table public.voice_knowledge_versions enable row level security;
alter table public.voice_knowledge_chunks enable row level security;
alter table public.voice_knowledge_candidates enable row level security;
alter table public.voice_call_sessions enable row level security;

revoke all on table public.voice_knowledge_articles from public, anon, authenticated;
revoke all on table public.voice_knowledge_versions from public, anon, authenticated;
revoke all on table public.voice_knowledge_chunks from public, anon, authenticated;
revoke all on table public.voice_knowledge_candidates from public, anon, authenticated;
revoke all on table public.voice_call_sessions from public, anon, authenticated;

grant select, insert, update, delete on table public.voice_knowledge_articles to service_role;
grant select, insert, update, delete on table public.voice_knowledge_versions to service_role;
grant select, insert, update, delete on table public.voice_knowledge_chunks to service_role;
grant select, insert, update, delete on table public.voice_knowledge_candidates to service_role;
grant select, insert, update, delete on table public.voice_call_sessions to service_role;

revoke all on function public.search_approved_voice_knowledge(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_approved_voice_knowledge(text, text, integer) to service_role;
revoke all on function public.create_voice_knowledge_draft(text, text, text, text[], text, jsonb, text, text, text[]) from public, anon, authenticated;
grant execute on function public.create_voice_knowledge_draft(text, text, text, text[], text, jsonb, text, text, text[]) to service_role;
revoke all on function public.review_voice_knowledge_version(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_voice_knowledge_version(uuid, text, text) to service_role;
revoke all on function public.promote_voice_knowledge_candidate(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.promote_voice_knowledge_candidate(uuid, text, text, text, text) to service_role;

drop policy if exists voice_knowledge_articles_service_role_all on public.voice_knowledge_articles;
create policy voice_knowledge_articles_service_role_all on public.voice_knowledge_articles
  for all to service_role using (true) with check (true);

drop policy if exists voice_knowledge_versions_service_role_all on public.voice_knowledge_versions;
create policy voice_knowledge_versions_service_role_all on public.voice_knowledge_versions
  for all to service_role using (true) with check (true);

drop policy if exists voice_knowledge_chunks_service_role_all on public.voice_knowledge_chunks;
create policy voice_knowledge_chunks_service_role_all on public.voice_knowledge_chunks
  for all to service_role using (true) with check (true);

drop policy if exists voice_knowledge_candidates_service_role_all on public.voice_knowledge_candidates;
create policy voice_knowledge_candidates_service_role_all on public.voice_knowledge_candidates
  for all to service_role using (true) with check (true);

drop policy if exists voice_call_sessions_service_role_all on public.voice_call_sessions;
create policy voice_call_sessions_service_role_all on public.voice_call_sessions
  for all to service_role using (true) with check (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'voice_knowledge_articles',
    'voice_knowledge_versions',
    'voice_knowledge_candidates',
    'voice_call_sessions'
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = table_name || '_updated_at'
        and tgrelid = format('public.%I', table_name)::regclass
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()',
        table_name || '_updated_at',
        table_name
      );
    end if;
  end loop;
end $$;
