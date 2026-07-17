-- Roll back the audited email-learning and email-knowledge gates.
-- Apply only together with an application rollback to the commit before this migration.

drop view if exists public.voice_knowledge_review_overview;

drop function if exists public.review_email_support_knowledge_v1(uuid, text, text, text, text);
drop function if exists public.review_voice_knowledge_version_v2(uuid, text, text, text, text);
drop function if exists public.get_email_support_knowledge_eligibility_v1(uuid);
drop function if exists public.review_email_agent_feedback_v2(bigint, text, text, text, text);
drop function if exists public.get_email_agent_feedback_learning_eligibility_v1(bigint);

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
  with search_terms as (
    select distinct token
    from regexp_split_to_table(
      regexp_replace(
        lower(left(trim(coalesce(p_query, '')), 240)),
        '[^[:alnum:]äöüß]+',
        ' ',
        'g'
      ),
      '\s+'
    ) as split_term(token)
    where char_length(token) >= 3
    limit 24
  ),
  search_query as (
    select websearch_to_tsquery(
      'german',
      coalesce(string_agg(token, ' OR ' order by token), '')
    ) as ts_query
    from search_terms
  )
  select
    article.id as article_id,
    version.id as version_id,
    chunk.id as chunk_id,
    article.slug,
    version.title,
    chunk.content,
    version.risk_class,
    version.source_refs,
    ts_rank_cd(chunk.search_vector, search_query.ts_query) as rank
  from public.voice_knowledge_chunks as chunk
  join public.voice_knowledge_versions as version on version.id = chunk.version_id
  join public.voice_knowledge_articles as article on article.id = version.article_id
  cross join search_query
  where numnode(search_query.ts_query) > 0
    and 'email_drafting' = any(version.allowed_modes)
    and version.status = 'approved'
    and version.risk_class <> 'restricted'
    and (version.valid_from is null or version.valid_from <= now())
    and (version.valid_until is null or version.valid_until > now())
    and chunk.search_vector @@ search_query.ts_query
  order by rank desc, version.reviewed_at desc nulls last, chunk.chunk_index asc
  limit least(greatest(coalesce(p_limit, 6), 1), 8);
$$;

revoke all on function public.search_approved_support_knowledge(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_approved_support_knowledge(text, integer)
  to service_role;

grant execute on function public.review_email_agent_feedback(bigint, text, text, text)
  to service_role;
grant execute on function public.review_voice_knowledge_version(uuid, text, text)
  to service_role;

drop table if exists public.knowledge_review_audit;
drop table if exists public.email_support_knowledge_approvals;
drop table if exists public.email_agent_learning_review_audit;

-- The hardened v2 style profile intentionally remains in place during rollback.
-- It is fail-closed and reads no customer facts; restoring v1 would reduce safety.
