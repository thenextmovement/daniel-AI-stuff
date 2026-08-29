-- Immediate rollback for CM-2A. It restores the captured function and ledger state.
-- Run only while uploads remain disabled and no membership is claimed by a batch.

begin;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('customer_match_v2:cm2a:20260829'));

lock table customer_match_v2.config in share row exclusive mode;
lock table customer_match_v2.batches in share row exclusive mode;
lock table customer_match_v2.batch_members in share row exclusive mode;
lock table customer_match_v2.memberships in share row exclusive mode;
lock table customer_match_v2.consent_receipts in share row exclusive mode;

do $preflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_namespace
    where nspname = 'codex_backup_cm_20260829_cm2a'
  ) then
    raise exception 'CM-2A backup schema is missing';
  end if;

  if pg_catalog.to_regclass(
    'codex_backup_cm_20260829_cm2a.post_memberships_snapshot'
  ) is null
    or pg_catalog.to_regclass(
      'codex_backup_cm_20260829_cm2a.post_consent_receipts_snapshot'
    ) is null
    or pg_catalog.to_regclass(
      'codex_backup_cm_20260829_cm2a.inserted_receipts_snapshot'
    ) is null then
    raise exception 'CM-2A post-migration rollback proof is incomplete';
  end if;

  if exists (
    select * from customer_match_v2.config
    except
    select * from codex_backup_cm_20260829_cm2a.post_config_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.post_config_snapshot
    except
    select * from customer_match_v2.config
  ) then
    raise exception 'CM-2A rollback refuses changed config';
  end if;

  if exists (
    select * from customer_match_v2.batches
    except
    select * from codex_backup_cm_20260829_cm2a.post_batches_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.post_batches_snapshot
    except
    select * from customer_match_v2.batches
  ) then
    raise exception 'CM-2A rollback refuses changed batches';
  end if;

  if exists (
    select * from customer_match_v2.batch_members
    except
    select * from codex_backup_cm_20260829_cm2a.post_batch_members_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.post_batch_members_snapshot
    except
    select * from customer_match_v2.batch_members
  ) then
    raise exception 'CM-2A rollback refuses changed batch members';
  end if;

  if exists (
    select * from customer_match_v2.memberships
    except
    select * from codex_backup_cm_20260829_cm2a.post_memberships_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.post_memberships_snapshot
    except
    select * from customer_match_v2.memberships
  ) then
    raise exception 'CM-2A rollback refuses changed memberships';
  end if;

  if exists (
    select * from customer_match_v2.consent_receipts
    except
    select * from codex_backup_cm_20260829_cm2a.post_consent_receipts_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.post_consent_receipts_snapshot
    except
    select * from customer_match_v2.consent_receipts
  ) then
    raise exception 'CM-2A rollback refuses changed consent receipts';
  end if;

  if (
    select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cm_v2_refresh_memberships'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) is distinct from (
    select function_md5
    from codex_backup_cm_20260829_cm2a.post_function_snapshot
    limit 1
  ) then
    raise exception 'CM-2A rollback refuses changed refresh function';
  end if;
end;
$preflight$;

delete from customer_match_v2.consent_receipts r
using codex_backup_cm_20260829_cm2a.inserted_receipts_snapshot i
where r.receipt_id = i.receipt_id;

do $restore_function$
declare
  v_definition text;
begin
  select function_definition
  into v_definition
  from codex_backup_cm_20260829_cm2a.function_snapshot
  limit 1;

  if v_definition is null then
    raise exception 'CM-2A function backup is empty';
  end if;

  execute v_definition;
end;
$restore_function$;

alter function public.cm_v2_refresh_memberships() owner to postgres;
revoke all on function public.cm_v2_refresh_memberships()
from public, anon, authenticated;
grant execute on function public.cm_v2_refresh_memberships() to service_role;

update customer_match_v2.memberships m
set
  source_classes = b.source_classes,
  first_seen_at = b.first_seen_at,
  last_seen_at = b.last_seen_at,
  desired_present = b.desired_present,
  consent_eligible = b.consent_eligible,
  consent_evidence_at = b.consent_evidence_at,
  consent_source = b.consent_source,
  consent_policy_version = b.consent_policy_version,
  eligibility_reason = b.eligibility_reason,
  google_state = b.google_state,
  pending_action = b.pending_action,
  sync_state = b.sync_state,
  active_batch_id = b.active_batch_id,
  last_google_request_id = b.last_google_request_id,
  last_terminal_at = b.last_terminal_at,
  last_error = b.last_error,
  created_at = b.created_at,
  updated_at = b.updated_at
from codex_backup_cm_20260829_cm2a.memberships_snapshot b
where m.audience_key = b.audience_key
  and m.email_sha256 = b.email_sha256;

insert into customer_match_v2.memberships (
  audience_key,
  email_sha256,
  source_classes,
  first_seen_at,
  last_seen_at,
  desired_present,
  consent_eligible,
  consent_evidence_at,
  consent_source,
  consent_policy_version,
  eligibility_reason,
  google_state,
  pending_action,
  sync_state,
  active_batch_id,
  last_google_request_id,
  last_terminal_at,
  last_error,
  created_at,
  updated_at
)
select
  b.audience_key,
  b.email_sha256,
  b.source_classes,
  b.first_seen_at,
  b.last_seen_at,
  b.desired_present,
  b.consent_eligible,
  b.consent_evidence_at,
  b.consent_source,
  b.consent_policy_version,
  b.eligibility_reason,
  b.google_state,
  b.pending_action,
  b.sync_state,
  b.active_batch_id,
  b.last_google_request_id,
  b.last_terminal_at,
  b.last_error,
  b.created_at,
  b.updated_at
from codex_backup_cm_20260829_cm2a.memberships_snapshot b
where not exists (
  select 1
  from customer_match_v2.memberships m
  where m.audience_key = b.audience_key
    and m.email_sha256 = b.email_sha256
);

delete from customer_match_v2.memberships m
where not exists (
    select 1
    from codex_backup_cm_20260829_cm2a.memberships_snapshot b
    where b.audience_key = m.audience_key
      and b.email_sha256 = m.email_sha256
  )
  and not exists (
    select 1
    from customer_match_v2.batch_members bm
    where bm.audience_key = m.audience_key
      and bm.email_sha256 = m.email_sha256
  );

drop function customer_match_v2.normalize_buyer_email(text);

do $verify$
declare
  v_before text;
  v_after text;
  v_function_md5 text;
begin
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(m)::text,
    ',' order by m.audience_key, m.email_sha256
  ), ''))
  into v_before
  from codex_backup_cm_20260829_cm2a.memberships_snapshot m;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(m)::text,
    ',' order by m.audience_key, m.email_sha256
  ), ''))
  into v_after
  from customer_match_v2.memberships m;

  if v_before is distinct from v_after then
    raise exception 'CM-2A rollback membership verification failed';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
  into v_function_md5
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'cm_v2_refresh_memberships'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  if v_function_md5 is distinct from (
    select function_md5
    from codex_backup_cm_20260829_cm2a.function_snapshot
    limit 1
  ) then
    raise exception 'CM-2A rollback function verification failed: %', v_function_md5;
  end if;

  if exists (
    select * from customer_match_v2.config
    except
    select * from codex_backup_cm_20260829_cm2a.config_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.config_snapshot
    except
    select * from customer_match_v2.config
  ) then
    raise exception 'CM-2A rollback config verification failed';
  end if;

  if exists (
    select * from customer_match_v2.batches
    except
    select * from codex_backup_cm_20260829_cm2a.batches_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.batches_snapshot
    except
    select * from customer_match_v2.batches
  ) then
    raise exception 'CM-2A rollback batch verification failed';
  end if;

  if exists (
    select * from customer_match_v2.batch_members
    except
    select * from codex_backup_cm_20260829_cm2a.batch_members_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.batch_members_snapshot
    except
    select * from customer_match_v2.batch_members
  ) then
    raise exception 'CM-2A rollback batch-member verification failed';
  end if;

  if exists (
    select * from customer_match_v2.consent_receipts
    except
    select * from codex_backup_cm_20260829_cm2a.consent_receipts_snapshot
  ) or exists (
    select * from codex_backup_cm_20260829_cm2a.consent_receipts_snapshot
    except
    select * from customer_match_v2.consent_receipts
  ) then
    raise exception 'CM-2A rollback consent-receipt verification failed';
  end if;
end;
$verify$;

commit;
