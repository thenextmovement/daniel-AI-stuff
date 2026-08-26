begin;

create table public.dunning_insolvency_checks (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  event_key text not null unique,
  legal_review_due_at timestamptz not null,
  identity_hash text not null,
  identity_snapshot jsonb not null,
  source text not null default 'official_insolvency_publications',
  source_url text not null,
  status text not null default 'checking',
  result_code text,
  checked_at timestamptz,
  match_count integer not null default 0,
  matches jsonb not null default '[]'::jsonb,
  attempt_count integer not null default 1,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dunning_insolvency_checks_order_number_check
    check (char_length(btrim(order_number)) between 1 and 100),
  constraint dunning_insolvency_checks_event_key_check
    check (event_key ~ '^[a-f0-9]{64}$'),
  constraint dunning_insolvency_checks_identity_hash_check
    check (identity_hash ~ '^[a-f0-9]{64}$'),
  constraint dunning_insolvency_checks_identity_snapshot_check
    check (
      jsonb_typeof(identity_snapshot) = 'object'
      and identity_snapshot ? 'kind'
      and identity_snapshot ? 'complete'
    ),
  constraint dunning_insolvency_checks_source_check
    check (source = 'official_insolvency_publications'),
  constraint dunning_insolvency_checks_source_url_check
    check (
      source_url =
      'https://neu.insolvenzbekanntmachungen.de/ap/suche.jsf'
    ),
  constraint dunning_insolvency_checks_status_check
    check (status in ('checking', 'completed', 'retryable', 'failed_final')),
  constraint dunning_insolvency_checks_result_code_check
    check (
      result_code is null
      or result_code in (
        'public_notice_found',
        'no_public_notice_found',
        'ambiguous_match',
        'identity_incomplete',
        'technical_error'
      )
    ),
  constraint dunning_insolvency_checks_match_count_check
    check (match_count between 0 and 10000),
  constraint dunning_insolvency_checks_matches_check
    check (
      jsonb_typeof(matches) = 'array'
      and jsonb_array_length(matches) <= 50
    ),
  constraint dunning_insolvency_checks_attempt_count_check
    check (attempt_count between 1 and 3),
  constraint dunning_insolvency_checks_last_error_check
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z0-9_]{1,80}$'
    ),
  constraint dunning_insolvency_checks_state_shape_check
    check (
      (
        status = 'checking'
        and result_code is null
        and lease_expires_at is not null
      )
      or (
        status = 'completed'
        and result_code in (
          'public_notice_found',
          'no_public_notice_found',
          'ambiguous_match',
          'identity_incomplete'
        )
        and checked_at is not null
        and lease_expires_at is null
      )
      or (
        status = 'retryable'
        and result_code = 'technical_error'
        and next_attempt_at is not null
        and lease_expires_at is null
      )
      or (
        status = 'failed_final'
        and result_code = 'technical_error'
        and next_attempt_at is null
        and lease_expires_at is null
      )
    )
);

create index dunning_insolvency_checks_order_updated_idx
  on public.dunning_insolvency_checks (order_number, updated_at desc);

create index dunning_insolvency_checks_retry_idx
  on public.dunning_insolvency_checks (status, next_attempt_at)
  where status in ('checking', 'retryable');

alter table public.dunning_insolvency_checks enable row level security;

create policy dunning_insolvency_checks_service_role_all
  on public.dunning_insolvency_checks
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.dunning_insolvency_checks
  from public, anon, authenticated;
grant select, insert, update on table public.dunning_insolvency_checks
  to service_role;

comment on table public.dunning_insolvency_checks is
  'Minimal, auditable results of official single-case insolvency-publication checks. A no-hit result is not proof of solvency and never triggers legal action.';

create function public.claim_dunning_insolvency_check(
  p_order_number text,
  p_event_key text,
  p_legal_review_due_at timestamptz,
  p_identity_hash text,
  p_identity_snapshot jsonb,
  p_source_url text
)
returns table (
  claimed boolean,
  id uuid,
  status text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_row public.dunning_insolvency_checks%rowtype;
begin
  if p_event_key !~ '^[a-f0-9]{64}$'
     or p_identity_hash !~ '^[a-f0-9]{64}$'
     or char_length(btrim(coalesce(p_order_number, ''))) not between 1 and 100
     or jsonb_typeof(p_identity_snapshot) is distinct from 'object'
     or p_source_url is distinct from
       'https://neu.insolvenzbekanntmachungen.de/ap/suche.jsf' then
    raise exception 'invalid_insolvency_check_claim'
      using errcode = '22023';
  end if;

  insert into public.dunning_insolvency_checks as target (
    order_number,
    event_key,
    legal_review_due_at,
    identity_hash,
    identity_snapshot,
    source_url,
    status,
    attempt_count,
    lease_expires_at
  ) values (
    btrim(p_order_number),
    p_event_key,
    p_legal_review_due_at,
    p_identity_hash,
    p_identity_snapshot,
    p_source_url,
    'checking',
    1,
    now() + interval '5 minutes'
  )
  on conflict (event_key) do nothing
  returning target.* into v_row;

  if found then
    return query select true, v_row.id, v_row.status, v_row.attempt_count;
    return;
  end if;

  select existing.*
    into v_row
  from public.dunning_insolvency_checks as existing
  where existing.event_key = p_event_key
  for update;

  if not found then
    raise exception 'insolvency_check_claim_missing'
      using errcode = '55000';
  end if;

  if (
    v_row.status = 'retryable'
    and v_row.next_attempt_at <= now()
    and v_row.attempt_count < 3
  ) or (
    v_row.status = 'checking'
    and v_row.lease_expires_at <= now()
    and v_row.attempt_count < 3
  ) then
    update public.dunning_insolvency_checks as target
    set status = 'checking',
        result_code = null,
        attempt_count = target.attempt_count + 1,
        lease_expires_at = now() + interval '5 minutes',
        next_attempt_at = null,
        last_error_code = null,
        updated_at = now()
    where target.id = v_row.id
    returning target.* into v_row;
    return query select true, v_row.id, v_row.status, v_row.attempt_count;
    return;
  end if;

  return query select false, v_row.id, v_row.status, v_row.attempt_count;
end;
$function$;

revoke all on function public.claim_dunning_insolvency_check(
  text, text, timestamptz, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.claim_dunning_insolvency_check(
  text, text, timestamptz, text, jsonb, text
) to service_role;

commit;
