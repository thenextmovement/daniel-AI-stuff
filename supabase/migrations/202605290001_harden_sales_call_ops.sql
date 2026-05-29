create table if not exists public.ops_refresh_locks (
  lock_key text primary key,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

comment on table public.ops_refresh_locks is
  'Small operational lock table for NEONTRIP ops actions that must not run concurrently.';

create or replace function public.ops_claim_refresh_lock(
  p_lock_key text,
  p_cooldown_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  insert into public.ops_refresh_locks (lock_key, locked_until, updated_at)
  values (
    p_lock_key,
    now() + make_interval(secs => greatest(coalesce(p_cooldown_seconds, 60), 1)),
    now()
  )
  on conflict (lock_key) do update
    set locked_until = excluded.locked_until,
        updated_at = now()
    where public.ops_refresh_locks.locked_until <= now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.ops_record_sales_call_result(
  p_expected_latest_result_id uuid,
  p_call_list_item_id uuid,
  p_rank_at_time integer,
  p_request_id text,
  p_ac_deal_id bigint,
  p_preset text,
  p_call_done text,
  p_call_outcome text,
  p_next_step text,
  p_validation_useful text,
  p_notes text,
  p_operator_id text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_id uuid;
  v_created public.sales_call_results%rowtype;
  v_superseded_count integer := 0;
begin
  if nullif(trim(p_request_id), '') is null then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  perform pg_advisory_xact_lock(hashtext('sales_call_result:' || p_request_id));

  select id
    into v_latest_id
  from public.sales_call_results
  where request_id = p_request_id
    and superseded_at is null
  order by created_at desc nulls last, id desc
  limit 1;

  if v_latest_id is distinct from p_expected_latest_result_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'stale_result',
      'latest_result_id', v_latest_id
    );
  end if;

  insert into public.sales_call_results (
    call_list_item_id,
    rank_at_time,
    request_id,
    ac_deal_id,
    preset,
    call_done,
    call_outcome,
    next_step,
    validation_useful,
    notes,
    operator_id,
    source
  )
  values (
    p_call_list_item_id,
    p_rank_at_time,
    p_request_id,
    p_ac_deal_id,
    p_preset,
    p_call_done,
    p_call_outcome,
    p_next_step,
    p_validation_useful,
    p_notes,
    p_operator_id,
    p_source
  )
  returning * into v_created;

  update public.sales_call_results
    set superseded_at = coalesce(v_created.created_at, now()),
        updated_at = now()
  where request_id = p_request_id
    and superseded_at is null
    and id <> v_created.id;

  get diagnostics v_superseded_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'result', to_jsonb(v_created),
    'superseded_count', v_superseded_count
  );
end;
$$;
