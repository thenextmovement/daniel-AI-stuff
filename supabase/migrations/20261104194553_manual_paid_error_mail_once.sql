-- Notification-only state; no financial or ownership data is modified.
create table public.manual_paid_error_mail_incidents (
  incident_key text primary key check (incident_key ~ '^manual-paid-claim:(claim|admit):(unknown|[1-5][0-9]{2})$'),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  notification_execution_id text not null,
  notification_nonce uuid not null,
  suppressed_count bigint not null default 0,
  candidate_order_ids text[] not null default '{}'
);
alter table public.manual_paid_error_mail_incidents enable row level security;
revoke all on public.manual_paid_error_mail_incidents from public,anon,authenticated,service_role;

create function public.claim_manual_paid_error_mail(p_key text, p_execution_id text, p_candidate_order_ids text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_nonce uuid := gen_random_uuid();
  v_approved boolean;
  v_first_seen timestamptz;
  v_suppressed bigint;
begin
  if p_key is null or p_key !~ '^manual-paid-claim:(claim|admit):(unknown|[1-5][0-9]{2})$'
     or p_execution_id is null or p_execution_id !~ '^[0-9]{1,30}$'
     or p_candidate_order_ids is null or cardinality(p_candidate_order_ids)>200
     or exists(select 1 from unnest(p_candidate_order_ids) x where x is null or x !~ '^[0-9]{1,30}$') then
    raise exception 'invalid_manual_paid_error_mail_input';
  end if;

  -- The unique key serializes simultaneous errors. A lost response is never
  -- retried as an approved send: even the same execution receives false.
  insert into public.manual_paid_error_mail_incidents as g (
    incident_key,first_seen_at,last_seen_at,notification_execution_id,notification_nonce,candidate_order_ids
  ) values (p_key,v_now,v_now,p_execution_id,v_nonce,p_candidate_order_ids)
  on conflict (incident_key) do update set
    first_seen_at = case when g.last_seen_at < v_now-interval '24 hours' and g.notification_execution_id<>p_execution_id then v_now else g.first_seen_at end,
    notification_execution_id = case when g.last_seen_at < v_now-interval '24 hours' then p_execution_id else g.notification_execution_id end,
    notification_nonce = case when g.last_seen_at < v_now-interval '24 hours' and g.notification_execution_id<>p_execution_id then v_nonce else g.notification_nonce end,
    suppressed_count = case when g.last_seen_at < v_now-interval '24 hours' and g.notification_execution_id<>p_execution_id then 0 else g.suppressed_count+1 end,
    last_seen_at = greatest(g.last_seen_at,v_now),
    candidate_order_ids = array(select distinct x from unnest(g.candidate_order_ids||excluded.candidate_order_ids) x order by x limit 200)
  returning notification_nonce=v_nonce,first_seen_at,suppressed_count into v_approved,v_first_seen,v_suppressed;
  return jsonb_build_object('approved',v_approved,'incident_started_at',v_first_seen,'suppressed_count',v_suppressed);
end;
$function$;
revoke all on function public.claim_manual_paid_error_mail(text,text,text[]) from public,anon,authenticated;
grant execute on function public.claim_manual_paid_error_mail(text,text,text[]) to service_role;
notify pgrst,'reload schema';
