-- Caller supplies the master customer ID after checking the OPS request binding.
create function public.voice_customer_mail_evidence(p_customer_id uuid, p_question text default '')
returns table(direction text, subject text, preview text, occurred_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with query as (
    select to_tsquery('pg_catalog.german', string_agg(quote_literal(term), ' | ')) as terms
    from unnest(tsvector_to_array(to_tsvector('pg_catalog.german', left(p_question,1200)))) as term
    where length(term) >= 3
  ), ranked as (
    select m.*, q.terms,
      ts_rank(setweight(to_tsvector('pg_catalog.german',coalesce(m.subject,'')),'A') ||
              setweight(to_tsvector('pg_catalog.german',m.body_text),'B'),q.terms) as score
    from public.customer_mail_timeline m cross join query q
    where m.customer_id = p_customer_id and
       (trim(p_question) = '' or to_tsvector('pg_catalog.german',coalesce(m.subject,'') || ' ' || m.body_text) @@ q.terms)
    order by score desc nulls last,m.occurred_at desc,m.outlook_id
    limit 6
  )
  select r.direction,r.subject,
    case when length(r.body_text)<=600 or r.terms is null or to_tsvector('pg_catalog.german',left(r.body_text,450)) @@ r.terms
      then left(r.body_text,600)
      else left(ts_headline('pg_catalog.german',r.body_text,r.terms,'StartSel="", StopSel="", MaxFragments=2, MinWords=18, MaxWords=42'),600) end,
    r.occurred_at from ranked r order by score desc nulls last,r.occurred_at desc,r.outlook_id;
$$;
revoke all on function public.voice_customer_mail_evidence(uuid,text) from public, anon, authenticated;
grant execute on function public.voice_customer_mail_evidence(uuid,text) to service_role;
