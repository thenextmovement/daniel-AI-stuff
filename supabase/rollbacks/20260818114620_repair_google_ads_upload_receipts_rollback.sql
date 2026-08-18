create or replace function public.get_pending_gads_conversions()
returns table(conversion_id uuid, gclid text, has_gclid boolean, conversion_name text, conversion_value numeric, conversion_time timestamptz, email text, hashed_email text)
language sql
stable
security definer
as $function$
  select
    gc.id as conversion_id,
    coalesce(gc.gclid, mr_direct.gclid, mr_order.gclid, mr_email.gclid) as gclid,
    coalesce(gc.gclid, mr_direct.gclid, mr_order.gclid, mr_email.gclid) is not null as has_gclid,
    gc.conversion_name,
    gc.conversion_value,
    coalesce(gc.conversion_time, gc.exported_at) as conversion_time,
    gc.email,
    case when gc.email is not null
      then encode(digest(lower(trim(gc.email)), 'sha256'), 'hex')
      else null
    end as hashed_email
  from public.google_ads_conversions gc
  left join public.master_requests mr_direct
    on mr_direct.id = gc.request_id and mr_direct.gclid is not null
  left join public.master_orders mo
    on mo.shopify_order_number = gc.shopify_order_number
  left join public.master_requests mr_order
    on mr_order.id = mo.request_id and mr_order.gclid is not null
  left join public.master_customers mc on mc.email = gc.email
  left join lateral (
    select mr.gclid
    from public.master_requests mr
    where mr.customer_id = mc.id and mr.gclid is not null
    order by mr.created_at desc
    limit 1
  ) mr_email on true
  where gc.uploaded_to_gads = false
    and (
      coalesce(gc.gclid, mr_direct.gclid, mr_order.gclid, mr_email.gclid) is not null
      or gc.email is not null
    )
  order by gc.exported_at asc;
$function$;

create or replace function public.gads_upload_health_metrics()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with offline as (
    select *
    from public.google_ads_conversions
    where conversion_name in ('Offline: Angebot versendet', 'Offline: Deal gewonnen')
  ),
  offline_metrics as (
    select
      count(*) as total_rows,
      count(*) filter (where uploaded_to_gads = true) as uploaded,
      count(*) filter (where uploaded_to_gads = false) as pending,
      count(*) filter (
        where uploaded_to_gads = false
        and exported_at < now() - interval '2 hours'
      ) as stale_pending_2h,
      max(exported_at) as newest_insert,
      max(exported_at) filter (where conversion_name = 'Offline: Angebot versendet') as newest_offline_angebot
    from offline
  ),
  request_leads_pending as (
    select
      count(*) as count,
      count(*) filter (where created_at < now() - interval '2 hours') as stale_2h,
      min(created_at) as oldest_pending_created_at
    from public.master_requests
    where gclid is not null
      and btrim(gclid) <> ''
      and lower(btrim(gclid)) not in ('test', 'undefined', 'null')
      and lower(btrim(gclid)) not like 'test%'
      and length(btrim(gclid)) >= 25
      and gads_exported_at is null
      and created_at >= now() - interval '14 days'
      and status not in ('won', 'lost', 'gewonnen', 'verloren')
      and deal_status not in ('won', 'lost', 'gewonnen', 'verloren')
  ),
  request_leads_export as (
    select max(gads_exported_at) as newest_request_lead_exported_at
    from public.master_requests
    where gads_exported_at is not null
  ),
  pending_sent_rows as (
    select * from public.get_pending_sent_conversions(7)
  ),
  pending_sent as (
    select
      count(*) as count,
      count(*) filter (where sent_at < now() - interval '2 hours') as stale_2h,
      min(sent_at) as oldest_pending_sent_at
    from pending_sent_rows
  ),
  autoreply as (
    select count(*) as count
    from public.master_requests
    where request_id like 'autoreply-%'
      and gclid is null
      and created_at >= now() - interval '24 hours'
  )
  select jsonb_build_object(
    'total_rows', coalesce(om.total_rows, 0),
    'uploaded', coalesce(om.uploaded, 0),
    'pending', coalesce(om.pending, 0),
    'stale_pending_2h', coalesce(om.stale_pending_2h, 0),
    'newest_insert', om.newest_insert,
    'newest_insert_age_min', case when om.newest_insert is null then null else round(extract(epoch from (now() - om.newest_insert))/60)::int end,
    'newest_offline_angebot', om.newest_offline_angebot,
    'pending_sent_conversions', coalesce(ps.count, 0),
    'stale_pending_sent_conversions_2h', coalesce(ps.stale_2h, 0),
    'oldest_pending_sent_at', ps.oldest_pending_sent_at,
    'request_leads_pending', coalesce(rlp.count, 0),
    'stale_request_leads_pending_2h', coalesce(rlp.stale_2h, 0),
    'oldest_request_lead_pending_created_at', rlp.oldest_pending_created_at,
    'newest_request_lead_exported_at', rle.newest_request_lead_exported_at,
    'newest_request_lead_export_age_min', case when rle.newest_request_lead_exported_at is null then null else round(extract(epoch from (now() - rle.newest_request_lead_exported_at))/60)::int end,
    'newest_activity_at', greatest(om.newest_insert, rle.newest_request_lead_exported_at),
    'newest_activity_age_min', case when greatest(om.newest_insert, rle.newest_request_lead_exported_at) is null then null else round(extract(epoch from (now() - greatest(om.newest_insert, rle.newest_request_lead_exported_at)))/60)::int end,
    'autoreply_without_gclid', coalesce(ar.count, 0),
    'checked_at', now()
  )
  from offline_metrics om
  cross join pending_sent ps
  cross join request_leads_pending rlp
  cross join request_leads_export rle
  cross join autoreply ar;
$function$;

drop function if exists public.get_pending_gads_request_leads(integer);
drop function if exists public.record_google_ads_upload_attempts(jsonb);

drop table if exists private.google_ads_upload_attempts;
drop schema if exists private;

grant execute on function public.get_pending_gads_conversions() to public, anon, authenticated, service_role;
grant execute on function public.gads_upload_health_metrics() to public, anon, authenticated, service_role;
grant execute on function public.get_pending_sent_conversions(integer) to public, anon, authenticated, service_role;
grant execute on function public.mark_gads_conversions_uploaded(uuid[]) to public, anon, authenticated, service_role;
