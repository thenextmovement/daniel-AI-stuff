create or replace function public.gads_upload_health_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
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
  uploadable_rows as (
    select gc.id, gc.exported_at
    from public.google_ads_conversions gc
    join public.get_pending_gads_conversions() pending
      on pending.conversion_id = gc.id
  ),
  uploadable_metrics as (
    select
      count(*) as pending,
      count(*) filter (where exported_at < now() - interval '2 hours') as stale_2h
    from uploadable_rows
  ),
  pending_identity as (
    select
      gc.exported_at,
      gc.conversion_value,
      gc.email,
      coalesce(
        nullif(btrim(gc.gclid), ''),
        nullif(btrim(mr_direct.gclid), ''),
        nullif(btrim(mr_order.gclid), '')
      ) as resolved_gclid
    from public.google_ads_conversions gc
    left join public.master_requests mr_direct
      on mr_direct.id = gc.request_id
    left join public.master_orders mo
      on mo.shopify_order_number = gc.shopify_order_number
    left join public.master_requests mr_order
      on mr_order.id = mo.request_id
    where gc.uploaded_to_gads = false
      and gc.conversion_name in ('Offline: Angebot versendet', 'Offline: Deal gewonnen')
  ),
  unattributable_metrics as (
    select
      count(*) as pending,
      count(*) filter (where exported_at < now() - interval '2 hours') as stale_2h,
      count(*) filter (where nullif(btrim(email), '') is not null) as with_email,
      coalesce(sum(conversion_value), 0) as value_eur,
      min(exported_at) as oldest_exported_at
    from pending_identity
    where resolved_gclid is null
       or lower(resolved_gclid) in ('test', 'undefined', 'null')
       or lower(resolved_gclid) like 'test%'
       or lower(resolved_gclid) like 'diagnostic-%'
       or lower(resolved_gclid) like 'codex_%'
       or length(resolved_gclid) < 25
  ),
  request_leads_pending as (
    select
      count(*) as count,
      count(*) filter (where created_at < now() - interval '2 hours') as stale_2h,
      min(created_at) as oldest_pending_created_at
    from public.get_pending_gads_request_leads(14)
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
  ),
  latest_attempts as (
    select distinct on (source_type, source_id)
      source_type,
      source_id,
      status,
      retry_after,
      recorded_at,
      job_id
    from private.google_ads_upload_attempts
    order by source_type, source_id, recorded_at desc, id desc
  ),
  attempt_metrics as (
    select
      (select count(*) from private.google_ads_upload_attempts where recorded_at >= now() - interval '24 hours') as attempts_24h,
      (select count(*) from private.google_ads_upload_attempts where recorded_at >= now() - interval '24 hours' and status = 'success') as successes_24h,
      (select count(*) from private.google_ads_upload_attempts where recorded_at >= now() - interval '24 hours' and status = 'duplicate') as duplicates_24h,
      count(*) filter (where status = 'retryable') as retryable_latest,
      count(*) filter (where status = 'retryable' and coalesce(retry_after, recorded_at + interval '1 hour') <= now()) as retryable_due,
      count(*) filter (where status = 'permanent_failure') as permanent_failures_latest,
      count(*) filter (where status = 'request_failure') as request_failures_latest,
      max(recorded_at) as last_attempt_at,
      (
        select job_id
        from private.google_ads_upload_attempts
        where job_id is not null
        order by recorded_at desc, id desc
        limit 1
      ) as last_job_id
    from latest_attempts
  )
  select jsonb_build_object(
    'total_rows', coalesce(om.total_rows, 0),
    'uploaded', coalesce(om.uploaded, 0),
    'pending', coalesce(om.pending, 0),
    'stale_pending_2h', coalesce(om.stale_pending_2h, 0),
    'uploadable_pending', coalesce(upm.pending, 0),
    'stale_uploadable_pending_2h', coalesce(upm.stale_2h, 0),
    'unattributable_pending', coalesce(um.pending, 0),
    'stale_unattributable_pending_2h', coalesce(um.stale_2h, 0),
    'unattributable_with_email', coalesce(um.with_email, 0),
    'unattributable_value_eur', coalesce(um.value_eur, 0),
    'oldest_unattributable_exported_at', um.oldest_exported_at,
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
    'newest_activity_at', greatest(om.newest_insert, rle.newest_request_lead_exported_at, am.last_attempt_at),
    'newest_activity_age_min', case when greatest(om.newest_insert, rle.newest_request_lead_exported_at, am.last_attempt_at) is null then null else round(extract(epoch from (now() - greatest(om.newest_insert, rle.newest_request_lead_exported_at, am.last_attempt_at)))/60)::int end,
    'autoreply_without_gclid', coalesce(ar.count, 0),
    'receipt_attempts_24h', coalesce(am.attempts_24h, 0),
    'receipt_successes_24h', coalesce(am.successes_24h, 0),
    'receipt_duplicates_24h', coalesce(am.duplicates_24h, 0),
    'receipt_retryable_latest', coalesce(am.retryable_latest, 0),
    'receipt_retryable_due', coalesce(am.retryable_due, 0),
    'receipt_permanent_failures_latest', coalesce(am.permanent_failures_latest, 0),
    'receipt_request_failures_latest', coalesce(am.request_failures_latest, 0),
    'last_upload_attempt_at', am.last_attempt_at,
    'last_upload_job_id', am.last_job_id::text,
    'checked_at', now()
  )
  from offline_metrics om
  cross join uploadable_metrics upm
  cross join unattributable_metrics um
  cross join pending_sent ps
  cross join request_leads_pending rlp
  cross join request_leads_export rle
  cross join autoreply ar
  cross join attempt_metrics am;
$function$;

revoke all on function public.gads_upload_health_metrics() from public;
revoke all on function public.gads_upload_health_metrics() from anon;
revoke all on function public.gads_upload_health_metrics() from authenticated;
grant execute on function public.gads_upload_health_metrics() to service_role;
