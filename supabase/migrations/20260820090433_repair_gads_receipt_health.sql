create or replace function public.get_pending_gads_conversions()
returns table(
  conversion_id uuid,
  gclid text,
  has_gclid boolean,
  conversion_name text,
  conversion_value numeric,
  conversion_time timestamptz,
  email text,
  hashed_email text
)
language sql
stable
security definer
set search_path to ''
as $function$
  with candidates as (
    select
      gc.id as conversion_id,
      click.valid_gclid,
      gc.conversion_name,
      gc.conversion_value,
      coalesce(gc.conversion_time, gc.exported_at) as resolved_conversion_time,
      gc.email
    from public.google_ads_conversions gc
    left join public.master_requests mr_direct
      on mr_direct.id = gc.request_id
    left join public.master_orders mo
      on mo.shopify_order_number = gc.shopify_order_number
    left join public.master_requests mr_order
      on mr_order.id = mo.request_id
    left join lateral (
      select nullif(btrim(v.raw_gclid), '') as valid_gclid
      from (values
        (1, gc.gclid),
        (2, mr_direct.gclid),
        (3, mr_order.gclid)
      ) v(priority, raw_gclid)
      where nullif(btrim(v.raw_gclid), '') is not null
        and lower(btrim(v.raw_gclid)) not in ('test', 'undefined', 'null')
        and lower(btrim(v.raw_gclid)) not like 'test%'
        and lower(btrim(v.raw_gclid)) not like 'diagnostic-%'
        and lower(btrim(v.raw_gclid)) not like 'codex_%'
        and length(btrim(v.raw_gclid)) >= 25
      order by v.priority
      limit 1
    ) click on true
    where gc.uploaded_to_gads = false
      and gc.conversion_name in (
        'Offline: Angebot versendet',
        'Offline: Deal gewonnen'
      )
      and not exists (
        select 1
        from private.google_ads_upload_attempts a
        where a.source_type = 'conversion'
          and a.source_id = gc.id
          and (
            a.status = 'permanent_failure'
            or (
              a.status in ('retryable', 'request_failure')
              and coalesce(
                a.retry_after,
                a.recorded_at + interval '1 hour'
              ) > now()
            )
          )
      )
  )
  select
    conversion_id,
    valid_gclid as gclid,
    valid_gclid is not null as has_gclid,
    conversion_name,
    conversion_value,
    resolved_conversion_time as conversion_time,
    email,
    null::text as hashed_email
  from candidates
  where resolved_conversion_time is not null
  order by resolved_conversion_time asc
  limit 2000;
$function$;

create or replace function public.gads_upload_health_metrics()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with
  offline as (
    select *
    from public.google_ads_conversions
    where conversion_name in (
      'Offline: Angebot versendet',
      'Offline: Deal gewonnen'
    )
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
      max(exported_at) filter (
        where conversion_name = 'Offline: Angebot versendet'
      ) as newest_offline_angebot
    from offline
  ),
  candidate_rows as (
    select
      gc.id,
      gc.exported_at,
      pending.has_gclid,
      pending.conversion_value,
      pending.email
    from public.get_pending_gads_conversions() pending
    join public.google_ads_conversions gc
      on gc.id = pending.conversion_id
  ),
  candidate_metrics as (
    select
      count(*) as candidate_pending,
      count(*) filter (where has_gclid) as uploadable_pending,
      count(*) filter (
        where has_gclid
          and exported_at < now() - interval '2 hours'
      ) as stale_uploadable_2h,
      count(*) filter (where not has_gclid) as local_no_click_pending,
      count(*) filter (
        where not has_gclid
          and exported_at < now() - interval '2 hours'
      ) as stale_local_no_click_2h,
      count(*) filter (
        where not has_gclid
          and nullif(btrim(email), '') is not null
      ) as local_no_click_with_email,
      coalesce(
        sum(conversion_value) filter (where not has_gclid),
        0
      ) as local_no_click_value_eur,
      min(exported_at) filter (
        where not has_gclid
      ) as oldest_local_no_click_exported_at
    from candidate_rows
  ),
  ledger_identity as (
    select
      gc.id,
      gc.uploaded_to_gads,
      gc.exported_at,
      gc.conversion_value,
      gc.email,
      click.valid_gclid
    from offline gc
    left join public.master_requests mr_direct
      on mr_direct.id = gc.request_id
    left join public.master_orders mo
      on mo.shopify_order_number = gc.shopify_order_number
    left join public.master_requests mr_order
      on mr_order.id = mo.request_id
    left join lateral (
      select nullif(btrim(v.raw_gclid), '') as valid_gclid
      from (values
        (1, gc.gclid),
        (2, mr_direct.gclid),
        (3, mr_order.gclid)
      ) v(priority, raw_gclid)
      where nullif(btrim(v.raw_gclid), '') is not null
        and lower(btrim(v.raw_gclid)) not in ('test', 'undefined', 'null')
        and lower(btrim(v.raw_gclid)) not like 'test%'
        and lower(btrim(v.raw_gclid)) not like 'diagnostic-%'
        and lower(btrim(v.raw_gclid)) not like 'codex_%'
        and length(btrim(v.raw_gclid)) >= 25
      order by v.priority
      limit 1
    ) click on true
  ),
  ledger_no_click_metrics as (
    select
      count(*) filter (
        where uploaded_to_gads = false
          and valid_gclid is null
      ) as pending,
      count(*) filter (
        where uploaded_to_gads = false
          and valid_gclid is null
          and exported_at < now() - interval '2 hours'
      ) as stale_2h,
      count(*) filter (
        where uploaded_to_gads = false
          and valid_gclid is null
          and nullif(btrim(email), '') is not null
      ) as with_email,
      coalesce(
        sum(conversion_value) filter (
          where uploaded_to_gads = false
            and valid_gclid is null
        ),
        0
      ) as value_eur,
      min(exported_at) filter (
        where uploaded_to_gads = false
          and valid_gclid is null
      ) as oldest_exported_at
    from ledger_identity
  ),
  provider_success_sources as (
    select distinct a.source_id
    from private.google_ads_upload_attempts a
    join offline o
      on a.source_type = 'conversion'
     and a.source_id = o.id
    where a.job_id is not null
      and a.status in ('success', 'duplicate')
  ),
  receipt_alignment as (
    select
      count(*) filter (
        where li.uploaded_to_gads = true
          and pss.source_id is not null
      ) as provider_receipted_conversion_rows,
      count(*) filter (
        where li.uploaded_to_gads = true
          and pss.source_id is null
      ) as ledger_uploaded_without_provider_receipt,
      count(*) filter (
        where li.uploaded_to_gads = false
          and pss.source_id is not null
      ) as provider_receipt_without_ledger_flag
    from ledger_identity li
    left join provider_success_sources pss
      on pss.source_id = li.id
  ),
  latest_attempts as (
    select distinct on (source_type, source_id)
      source_type,
      source_id,
      status,
      error_code,
      retry_after,
      recorded_at,
      job_id
    from private.google_ads_upload_attempts
    order by source_type, source_id, recorded_at desc, id desc
  ),
  latest_provider_attempts as (
    select distinct on (source_type, source_id)
      source_type,
      source_id,
      status,
      error_code,
      retry_after,
      recorded_at,
      job_id
    from private.google_ads_upload_attempts
    where job_id is not null
    order by source_type, source_id, recorded_at desc, id desc
  ),
  attempt_activity as (
    select
      count(*) filter (
        where recorded_at >= now() - interval '24 hours'
      ) as all_attempts_24h,
      max(recorded_at) as last_any_attempt_at
    from private.google_ads_upload_attempts
  ),
  provider_receipt_metrics as (
    select
      (
        select count(*)
        from private.google_ads_upload_attempts
        where job_id is not null
          and recorded_at >= now() - interval '24 hours'
      ) as attempts_24h,
      (
        select count(*)
        from private.google_ads_upload_attempts
        where job_id is not null
          and recorded_at >= now() - interval '24 hours'
          and status = 'success'
      ) as successes_24h,
      (
        select count(*)
        from private.google_ads_upload_attempts
        where job_id is not null
          and recorded_at >= now() - interval '24 hours'
          and status = 'duplicate'
      ) as duplicates_24h,
      count(*) filter (
        where status = 'retryable'
      ) as retryable_latest,
      count(*) filter (
        where status = 'retryable'
          and coalesce(
            retry_after,
            recorded_at + interval '1 hour'
          ) <= now()
      ) as retryable_due,
      count(*) filter (
        where status = 'permanent_failure'
      ) as permanent_failures_latest,
      max(recorded_at) as last_provider_receipt_at,
      (
        select job_id
        from private.google_ads_upload_attempts
        where job_id is not null
        order by recorded_at desc, id desc
        limit 1
      ) as last_job_id
    from latest_provider_attempts
  ),
  local_classification_metrics as (
    select
      count(*) filter (
        where la.source_type = 'conversion'
          and o.id is not null
          and la.status = 'permanent_failure'
          and la.error_code = 'LOCAL_NO_CLICK_ID'
          and la.job_id is null
      ) as no_click_classified_latest,
      (
        select count(*)
        from private.google_ads_upload_attempts a
        join offline oi
          on a.source_type = 'conversion'
         and a.source_id = oi.id
        where a.status = 'permanent_failure'
          and a.error_code = 'LOCAL_NO_CLICK_ID'
          and a.job_id is null
          and a.recorded_at >= now() - interval '24 hours'
      ) as no_click_classified_24h,
      max(la.recorded_at) filter (
        where la.source_type = 'conversion'
          and o.id is not null
          and la.status = 'permanent_failure'
          and la.error_code = 'LOCAL_NO_CLICK_ID'
          and la.job_id is null
      ) as last_no_click_classified_at,
      count(*) filter (
        where la.source_type = 'conversion'
          and o.id is not null
          and la.job_id is null
          and la.status = 'permanent_failure'
          and coalesce(la.error_code, '') <> 'LOCAL_NO_CLICK_ID'
      ) as other_local_permanent_failures_latest
    from latest_attempts la
    left join offline o
      on la.source_type = 'conversion'
     and la.source_id = o.id
  ),
  transport_failure_metrics as (
    select
      count(*) filter (
        where job_id is null
          and status = 'retryable'
      ) as retryable_latest,
      count(*) filter (
        where job_id is null
          and status = 'retryable'
          and coalesce(
            retry_after,
            recorded_at + interval '1 hour'
          ) <= now()
      ) as retryable_due,
      count(*) filter (
        where job_id is null
          and status = 'request_failure'
      ) as request_failures_latest
    from latest_attempts
  ),
  request_leads_pending as (
    select
      count(*) as count,
      count(*) filter (
        where created_at < now() - interval '2 hours'
      ) as stale_2h,
      min(created_at) as oldest_pending_created_at
    from public.get_pending_gads_request_leads(14)
  ),
  request_leads_export as (
    select max(gads_exported_at) as newest_request_lead_exported_at
    from public.master_requests
    where gads_exported_at is not null
  ),
  pending_sent_rows as (
    select *
    from public.get_pending_sent_conversions(7)
  ),
  pending_sent as (
    select
      count(*) as count,
      count(*) filter (
        where sent_at < now() - interval '2 hours'
      ) as stale_2h,
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
  select
    jsonb_build_object(
      'total_rows', coalesce(om.total_rows, 0),
      'uploaded', coalesce(om.uploaded, 0),
      'pending', coalesce(om.pending, 0),
      'stale_pending_2h', coalesce(om.stale_pending_2h, 0),

      'ledger_total_rows', coalesce(om.total_rows, 0),
      'ledger_uploaded_flags', coalesce(om.uploaded, 0),
      'ledger_pending_flags', coalesce(om.pending, 0),
      'ledger_stale_pending_flags_2h', coalesce(om.stale_pending_2h, 0),
      'provider_receipted_conversion_rows',
        coalesce(ra.provider_receipted_conversion_rows, 0),
      'ledger_uploaded_without_provider_receipt',
        coalesce(ra.ledger_uploaded_without_provider_receipt, 0),
      'provider_receipt_without_ledger_flag',
        coalesce(ra.provider_receipt_without_ledger_flag, 0),

      'candidate_pending', coalesce(cm.candidate_pending, 0),
      'uploadable_pending', coalesce(cm.uploadable_pending, 0),
      'stale_uploadable_pending_2h',
        coalesce(cm.stale_uploadable_2h, 0),
      'local_no_click_classification_pending',
        coalesce(cm.local_no_click_pending, 0),
      'stale_local_no_click_classification_pending_2h',
        coalesce(cm.stale_local_no_click_2h, 0),
      'local_no_click_pending_with_email',
        coalesce(cm.local_no_click_with_email, 0),
      'local_no_click_pending_value_eur',
        coalesce(cm.local_no_click_value_eur, 0),
      'oldest_local_no_click_pending_exported_at',
        cm.oldest_local_no_click_exported_at
    )
    ||
    jsonb_build_object(
      'unattributable_pending', coalesce(lnm.pending, 0),
      'stale_unattributable_pending_2h', coalesce(lnm.stale_2h, 0),
      'unattributable_with_email', coalesce(lnm.with_email, 0),
      'unattributable_value_eur', coalesce(lnm.value_eur, 0),
      'oldest_unattributable_exported_at', lnm.oldest_exported_at,

      'local_no_click_classified_latest',
        coalesce(lcm.no_click_classified_latest, 0),
      'local_no_click_classified_24h',
        coalesce(lcm.no_click_classified_24h, 0),
      'last_local_no_click_classified_at',
        lcm.last_no_click_classified_at,
      'other_local_permanent_failures_latest',
        coalesce(lcm.other_local_permanent_failures_latest, 0),

      'newest_insert', om.newest_insert,
      'newest_insert_age_min', case
        when om.newest_insert is null then null
        else round(
          extract(epoch from (now() - om.newest_insert)) / 60
        )::int
      end,
      'newest_offline_angebot', om.newest_offline_angebot,

      'pending_sent_conversions', coalesce(ps.count, 0),
      'stale_pending_sent_conversions_2h', coalesce(ps.stale_2h, 0),
      'oldest_pending_sent_at', ps.oldest_pending_sent_at,

      'request_leads_pending', coalesce(rlp.count, 0),
      'stale_request_leads_pending_2h', coalesce(rlp.stale_2h, 0),
      'oldest_request_lead_pending_created_at',
        rlp.oldest_pending_created_at,
      'newest_request_lead_exported_at',
        rle.newest_request_lead_exported_at,
      'newest_request_lead_export_age_min', case
        when rle.newest_request_lead_exported_at is null then null
        else round(
          extract(
            epoch from (
              now() - rle.newest_request_lead_exported_at
            )
          ) / 60
        )::int
      end
    )
    ||
    jsonb_build_object(
      'newest_activity_at', greatest(
        om.newest_insert,
        rle.newest_request_lead_exported_at,
        aa.last_any_attempt_at
      ),
      'newest_activity_age_min', case
        when greatest(
          om.newest_insert,
          rle.newest_request_lead_exported_at,
          aa.last_any_attempt_at
        ) is null then null
        else round(
          extract(
            epoch from (
              now() - greatest(
                om.newest_insert,
                rle.newest_request_lead_exported_at,
                aa.last_any_attempt_at
              )
            )
          ) / 60
        )::int
      end,

      'newest_provider_receipt_at', prm.last_provider_receipt_at,
      'newest_provider_receipt_age_min', case
        when prm.last_provider_receipt_at is null then null
        else round(
          extract(
            epoch from (
              now() - prm.last_provider_receipt_at
            )
          ) / 60
        )::int
      end,
      'autoreply_without_gclid', coalesce(ar.count, 0),

      'receipt_attempts_24h', coalesce(prm.attempts_24h, 0),
      'receipt_successes_24h', coalesce(prm.successes_24h, 0),
      'receipt_duplicates_24h', coalesce(prm.duplicates_24h, 0),
      'receipt_retryable_latest', coalesce(prm.retryable_latest, 0),
      'receipt_retryable_due', coalesce(prm.retryable_due, 0),
      'receipt_permanent_failures_latest',
        coalesce(prm.permanent_failures_latest, 0),
      'receipt_request_failures_latest',
        coalesce(tfm.request_failures_latest, 0),

      'provider_receipt_attempts_24h', coalesce(prm.attempts_24h, 0),
      'provider_receipt_successes_24h', coalesce(prm.successes_24h, 0),
      'provider_receipt_duplicates_24h', coalesce(prm.duplicates_24h, 0),
      'provider_receipt_retryable_latest',
        coalesce(prm.retryable_latest, 0),
      'provider_receipt_retryable_due',
        coalesce(prm.retryable_due, 0),
      'provider_receipt_permanent_failures_latest',
        coalesce(prm.permanent_failures_latest, 0),

      'transport_retryable_latest',
        coalesce(tfm.retryable_latest, 0),
      'transport_retryable_due',
        coalesce(tfm.retryable_due, 0),
      'transport_request_failures_latest',
        coalesce(tfm.request_failures_latest, 0),

      'all_attempts_24h', coalesce(aa.all_attempts_24h, 0),
      'last_any_attempt_at', aa.last_any_attempt_at,
      'last_upload_attempt_at', prm.last_provider_receipt_at,
      'last_upload_job_id', prm.last_job_id::text,
      'checked_at', now()
    )
  from offline_metrics om
  cross join candidate_metrics cm
  cross join ledger_no_click_metrics lnm
  cross join receipt_alignment ra
  cross join attempt_activity aa
  cross join provider_receipt_metrics prm
  cross join local_classification_metrics lcm
  cross join transport_failure_metrics tfm
  cross join pending_sent ps
  cross join request_leads_pending rlp
  cross join request_leads_export rle
  cross join autoreply ar;
$function$;

alter function public.get_pending_gads_conversions() owner to postgres;
revoke all on function public.get_pending_gads_conversions()
  from public, anon, authenticated;
grant execute on function public.get_pending_gads_conversions()
  to postgres, service_role;

alter function public.gads_upload_health_metrics() owner to postgres;
revoke all on function public.gads_upload_health_metrics()
  from public, anon, authenticated;
grant execute on function public.gads_upload_health_metrics()
  to postgres, service_role;
