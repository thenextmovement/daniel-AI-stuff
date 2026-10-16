-- NEONTRIP only. No billing writes. Private consent/payment/receipt ledger.
create table public.x_ads_purchases (
  checkout_hash text primary key check (checkout_hash ~ '^[a-f0-9]{64}$'),
  order_id text unique check (order_id ~ '^[1-9][0-9]{5,19}$'),
  twclid text check (length(twclid) between 1 and 512),
  click_at timestamptz,
  consent_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  status text not null default 'pending' check (status in ('pending','sending','delivered','revoked','expired','blocked')),
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 12),
  first_sent_at timestamptz,
  amount_cents bigint,
  currency text check (currency is null or currency = 'EUR'),
  paid_at timestamptz,
  delivered_at timestamptz,
  debug_id text,
  last_reason text
);
create index x_ads_purchases_due on public.x_ads_purchases(next_attempt_at) where status in ('pending','sending');
create index x_ads_purchases_created on public.x_ads_purchases(created_at);
alter table public.x_ads_purchases enable row level security;
revoke all on public.x_ads_purchases from public, anon, authenticated;
grant select, insert, update, delete on public.x_ads_purchases to service_role;

create function public.x_ads_capture(p_hash text, p_twclid text, p_click_at timestamptz, p_consent_at timestamptz, p_revoke boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_checkout'; end if;
  -- The limit covers new withdrawal tombstones too; existing checkouts can always revoke.
  perform pg_advisory_xact_lock(715260161);
  if not exists(select 1 from public.x_ads_purchases where checkout_hash=p_hash)
     and (select count(*) from public.x_ads_purchases where created_at > now()-interval '1 hour') >= 1000 then raise exception 'intake_limit'; end if;
  if p_revoke then
    -- Tombstones also win over an earlier grant request that arrives late.
    insert into public.x_ads_purchases(checkout_hash,status,revoked_at) values(p_hash,'revoked',now())
    on conflict(checkout_hash) do update set twclid=null, revoked_at=now(), status='revoked', lease_id=null, lease_until=null;
    return;
  end if;
  if p_twclid is null or length(p_twclid)>512 or p_twclid !~ '^[-A-Za-z0-9._~]+$' or p_click_at is null or p_consent_at is null
     or p_click_at < now()-interval '30 days' or p_consent_at < now()-interval '30 days'
     or p_click_at > now()+interval '1 minute' or p_consent_at > now()+interval '1 minute' then raise exception 'invalid_consent'; end if;
  insert into public.x_ads_purchases(checkout_hash,twclid,click_at,consent_at,expires_at)
  values(p_hash,p_twclid,p_click_at,p_consent_at,least(p_click_at,p_consent_at)+interval '30 days')
  on conflict(checkout_hash) do nothing; -- Attribution cannot be overwritten after capture.
end $$;

create function public.x_ads_associate(p_orders jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders)>10000 then raise exception 'invalid_orders'; end if;
  for r in select value from jsonb_array_elements(p_orders) loop
    if r->>'hash' ~ '^[a-f0-9]{64}$' and r->>'id' ~ '^[1-9][0-9]{5,19}$' then
      update public.x_ads_purchases p set order_id=r->>'id'
      where p.checkout_hash=r->>'hash' and p.order_id is null and p.status='pending' and p.revoked_at is null
        and not exists(select 1 from public.x_ads_purchases other where other.order_id=r->>'id');
    end if;
  end loop;
end $$;

create function public.x_ads_pending()
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.x_ads_purchases set status='expired',twclid=null,lease_id=null,lease_until=null
  where status in ('pending','sending','blocked') and (expires_at<=now() or first_sent_at<now()-interval '24 hours');
  update public.x_ads_purchases set status='blocked',twclid=null,lease_id=null,lease_until=null,last_reason='attempt_limit'
  where status in ('pending','sending') and attempts>=12 and (lease_until is null or lease_until<now());
  delete from public.x_ads_purchases where created_at<now()-interval '90 days'
    or (status<>'delivered' and created_at<now()-interval '31 days');
  return exists(select 1 from public.x_ads_purchases where status in ('pending','sending') and revoked_at is null and next_attempt_at<=now() and (lease_until is null or lease_until<now()));
end $$;

create function public.x_ads_claim()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.x_ads_purchases; v_lease uuid := gen_random_uuid();
begin
  select * into r from public.x_ads_purchases
  where status in ('pending','sending') and revoked_at is null and twclid is not null and order_id is not null
    and expires_at>now() and next_attempt_at<=now() and attempts<12
    and (first_sent_at is null or first_sent_at>now()-interval '24 hours')
    and (lease_until is null or lease_until<now())
  order by next_attempt_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.x_ads_purchases set lease_id=v_lease,lease_until=now()+interval '3 minutes' where checkout_hash=r.checkout_hash;
  return jsonb_build_object('checkout_hash',r.checkout_hash,'order_id',r.order_id,'lease_id',v_lease);
end $$;

create function public.x_ads_prepare(p_hash text, p_lease uuid, p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.x_ads_purchases; v_paid timestamptz; v_amount bigint;
begin
  select * into r from public.x_ads_purchases where checkout_hash=p_hash for update;
  if not found or r.lease_id is distinct from p_lease or r.lease_until<=now() or r.revoked_at is not null
    or r.status not in ('pending','sending') or r.expires_at<=now() or r.attempts>=12 or r.twclid is null then return null; end if;
  v_paid := (p_payment->>'paid_at')::timestamptz;
  v_amount := (p_payment->>'amount_cents')::bigint;
  if p_payment->>'order_id' is distinct from r.order_id or p_payment->>'checkout_hash' is distinct from r.checkout_hash
    or p_payment->>'currency' is distinct from 'EUR' or v_amount is null or v_amount<=0 or v_paid is null
    or v_paid<greatest(r.click_at,r.consent_at) or v_paid>now()+interval '1 minute'
    or v_paid<now()-interval '30 days' then return null; end if;
  if r.first_sent_at is not null and (r.amount_cents is distinct from v_amount or r.paid_at is distinct from v_paid or r.first_sent_at<now()-interval '24 hours') then
    update public.x_ads_purchases set status='blocked',last_reason='payment_changed',twclid=null,lease_id=null,lease_until=null where checkout_hash=p_hash;
    return null;
  end if;
  update public.x_ads_purchases set status='sending', attempts=attempts+1,first_sent_at=coalesce(first_sent_at,now()),
    amount_cents=v_amount,currency='EUR',paid_at=v_paid,lease_until=now()+interval '3 minutes'
    where checkout_hash=p_hash;
  return jsonb_build_object('conversions',jsonb_build_array(jsonb_build_object(
    'event_id','rhd5x','conversion_id','shopify:galaxybuzzdk:'||r.order_id||':paid',
    'conversion_time',to_char(v_paid at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'value',to_char(v_amount::numeric/100,'FM9999999990.00'),'price_currency','EUR',
    'identifiers',jsonb_build_array(jsonb_build_object('twclid',r.twclid)))));
end $$;

create function public.x_ads_finish(p_hash text, p_lease uuid, p_debug text, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.x_ads_purchases;
begin
  select * into r from public.x_ads_purchases where checkout_hash=p_hash for update;
  if not found or r.lease_id is distinct from p_lease or r.revoked_at is not null or r.status not in ('pending','sending') then return; end if;
  if p_debug is not null and p_debug ~ '^[-A-Za-z0-9_]{8,160}$' and r.status='sending' then
    update public.x_ads_purchases set status='delivered',debug_id=p_debug,delivered_at=now(),twclid=null,last_reason=null,lease_id=null,lease_until=null where checkout_hash=p_hash;
  else
    update public.x_ads_purchases set status=case when attempts>=12 or p_reason='x_rejected' then 'blocked' else 'pending' end,
      twclid=case when attempts>=12 or p_reason='x_rejected' then null else twclid end,
      next_attempt_at=now()+make_interval(secs=>least(3600,300*power(2,least(attempts,4)))::integer),
      last_reason=case when p_reason in ('payment_unconfirmed','x_rejected') then p_reason else 'x_unconfirmed' end,
      lease_id=null,lease_until=null where checkout_hash=p_hash;
  end if;
end $$;

revoke all on function public.x_ads_capture(text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
revoke all on function public.x_ads_associate(jsonb) from public,anon,authenticated;
revoke all on function public.x_ads_pending() from public,anon,authenticated;
revoke all on function public.x_ads_claim() from public,anon,authenticated;
revoke all on function public.x_ads_prepare(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.x_ads_finish(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.x_ads_capture(text,text,timestamptz,timestamptz,boolean) to service_role;
grant execute on function public.x_ads_associate(jsonb) to service_role;
grant execute on function public.x_ads_pending() to service_role;
grant execute on function public.x_ads_claim() to service_role;
grant execute on function public.x_ads_prepare(text,uuid,jsonb) to service_role;
grant execute on function public.x_ads_finish(text,uuid,text,text) to service_role;
