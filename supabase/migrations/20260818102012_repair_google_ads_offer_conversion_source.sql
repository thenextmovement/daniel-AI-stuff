-- Keep the legacy quote source, and add the current authoritative offer-event bridge.
-- Current-path rows require a GCLID; email-only rows stay excluded until consent is known.
create or replace function public.get_pending_sent_conversions(p_lookback_days integer default 7)
returns table(
  request_id uuid,
  email text,
  gclid text,
  sent_at timestamptz,
  conversion_value numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with legacy_quote_candidates as (
    select
      mr.id as request_id,
      coalesce(mc_direct.email, mc_lp.email) as email,
      case
        when coalesce(mr.gclid, mr_lp.gclid) like '["%"]'
          then substring(
            coalesce(mr.gclid, mr_lp.gclid)
            from 3 for length(coalesce(mr.gclid, mr_lp.gclid)) - 4
          )
        else coalesce(mr.gclid, mr_lp.gclid)
      end as gclid,
      q.sent_at,
      q.total_value as conversion_value,
      2 as source_priority
    from public.master_quotes q
    join public.master_requests mr on mr.request_id = q.request_id
    left join public.master_customers mc_direct on mc_direct.id = mr.customer_id
    left join lateral (
      select mr2.id, mr2.gclid, mr2.customer_id
      from public.master_requests mr2
      where mr2.ac_deal_id = mr.ac_deal_id
        and mr2.form_id = 'landing-page-form'
        and mr2.id <> mr.id
      order by mr2.created_at desc
      limit 1
    ) mr_lp on true
    left join public.master_customers mc_lp on mc_lp.id = mr_lp.customer_id
    where q.sent_at is not null
      and q.sent_at >= now() - make_interval(days => p_lookback_days)
      and (
        mr.gclid is not null
        or mr_lp.gclid is not null
        or mc_direct.email is not null
        or mc_lp.email is not null
      )
      and not exists (
        select 1
        from public.google_ads_conversions gc
        where gc.request_id = mr.id
          and gc.conversion_name = 'Offline: Angebot versendet'
      )
  ),
  current_offer_candidates as (
    select distinct on (mr.id)
      mr.id as request_id,
      null::text as email,
      case
        when mr.gclid like '["%"]'
          then substring(mr.gclid from 3 for length(mr.gclid) - 4)
        else mr.gclid
      end as gclid,
      oe.event_at as sent_at,
      0::numeric as conversion_value,
      1 as source_priority
    from public.ops_offer_events oe
    join public.master_requests mr on mr.request_id = oe.request_id
    where oe.event_type = 'offer_sent'
      and oe.event_at >= now() - make_interval(days => p_lookback_days)
      and nullif(btrim(mr.gclid), '') is not null
      and not exists (
        select 1
        from public.google_ads_conversions gc
        where gc.request_id = mr.id
          and gc.conversion_name = 'Offline: Angebot versendet'
      )
    order by mr.id, oe.event_at asc
  ),
  deduplicated as (
    select distinct on (candidate.request_id)
      candidate.request_id,
      candidate.email,
      candidate.gclid,
      candidate.sent_at,
      candidate.conversion_value
    from (
      select * from legacy_quote_candidates
      union all
      select * from current_offer_candidates
    ) candidate
    order by candidate.request_id, candidate.sent_at asc, candidate.source_priority asc
  )
  select
    deduplicated.request_id,
    deduplicated.email,
    deduplicated.gclid,
    deduplicated.sent_at,
    deduplicated.conversion_value
  from deduplicated
  order by deduplicated.sent_at asc
  limit 2000;
$function$;
