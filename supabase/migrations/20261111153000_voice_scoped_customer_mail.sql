create function public.voice_mail_for_customer(p_customer_id uuid)
returns setof public.customer_mail_history
language sql stable security invoker set search_path = '' as $$
  with candidates as materialized (
    select h.* from public.customer_mail_history h
    where h.customer_addresses && array(
      select a.email from public.customer_mail_history_addresses a where a.customer_id=p_customer_id
    )
  ), other_addresses as materialized (
    select distinct a.email from public.customer_mail_history_addresses a
    join (select distinct unnest(c.customer_addresses) as email from candidates c) relevant using(email)
    where a.customer_id <> p_customer_id
  )
  select c.* from candidates c where not exists (
    select 1 from other_addresses a where a.email=any(c.customer_addresses)
  )
  union all
  select h.* from public.customer_mail_history h
  where h.customer_addresses=array['rh@neontrip.de'] and public.customer_mail_test_owner(h.subject,h.occurred_at)=p_customer_id;
$$;
revoke all on function public.voice_mail_for_customer(uuid) from public,anon,authenticated;
grant execute on function public.voice_mail_for_customer(uuid) to service_role;

create or replace view public.voice_customer_events with (security_invoker=true) as
select c.id as customer_id,'mail:'||outlook_id as id,occurred_at,direction as kind,subject,left(body_text,2400) as detail,
substring(subject from '(?i)[(]([0-9a-f]{8}(?:-[0-9a-f-]{27})?)[)]') as request_ref,null::uuid as session_id
from public.master_customers c cross join lateral public.voice_mail_for_customer(c.id) mail
union all select r.customer_id,'session:'||s.id,s.started_at,'transcript','Telefonat',coalesce(nullif(s.summary,''),'Keine Zusammenfassung gespeichert.'),s.bound_request_id,s.id
from public.voice_call_sessions s join public.master_requests r on r.request_id=s.bound_request_id
where s.transcript_storage_enabled and s.mode<>'internal_test' and s.consent_status='confirmed'
union all select customer_id,'call:'||id,created_at,'call',case when direction='inbound' then 'Eingehender Anruf' else 'Ausgehender Anruf' end,
case when customer_joined then 'Gespräch verbunden.' else 'Keine Gesprächsverbindung bestätigt.' end,request_id,null::uuid from public.voice_phone_calls where customer_id is not null;

create or replace function public.voice_customer_mail_evidence(p_customer_id uuid, p_question text default '')
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
    from public.voice_mail_for_customer(p_customer_id) m cross join query q
    where
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
