create or replace function public.search_approved_support_knowledge(
  p_query text,
  p_limit integer default 6
)
returns table (
  article_id uuid,
  version_id uuid,
  chunk_id uuid,
  slug text,
  title text,
  content text,
  risk_class text,
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
    article.slug,
    version.title,
    chunk.content,
    version.risk_class,
    version.source_refs,
    ts_rank_cd(
      chunk.search_vector,
      websearch_to_tsquery('german', left(trim(p_query), 240))
    ) as rank
  from public.voice_knowledge_chunks as chunk
  join public.voice_knowledge_versions as version on version.id = chunk.version_id
  join public.voice_knowledge_articles as article on article.id = version.article_id
  where trim(coalesce(p_query, '')) <> ''
    and 'email_drafting' = any(version.allowed_modes)
    and version.status = 'approved'
    and version.risk_class <> 'restricted'
    and (version.valid_from is null or version.valid_from <= now())
    and (version.valid_until is null or version.valid_until > now())
    and chunk.search_vector @@ websearch_to_tsquery('german', left(trim(p_query), 240))
  order by rank desc, version.reviewed_at desc nulls last, chunk.chunk_index asc
  limit least(greatest(coalesce(p_limit, 6), 1), 8);
$$;

revoke all on function public.search_approved_support_knowledge(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_approved_support_knowledge(text, integer)
  to service_role;
