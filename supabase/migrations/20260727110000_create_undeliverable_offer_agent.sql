create table if not exists public.undeliverable_offer_settings (
  singleton boolean primary key default true check (singleton),
  intake_enabled boolean not null default false,
  automatic_execution_enabled boolean not null default false,
  max_send_attempts integer not null default 1 check (max_send_attempts = 1),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

insert into public.undeliverable_offer_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.undeliverable_offer_cases (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'detected' check (status in ('detected','needs_research','manual_review','approved','processing','sent','failed','unknown','dismissed')),
  source_message_id text not null unique check (char_length(source_message_id) between 1 and 500),
  source_internet_message_id text,
  mailbox text not null check (mailbox = lower(mailbox) and mailbox ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  received_at timestamptz not null,
  failed_email text not null check (failed_email = lower(failed_email) and failed_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  failure_kind text not null check (failure_kind in ('domain_not_found','mailbox_not_found','policy_rejected','temporary','unknown')),
  diagnostic_code text,
  diagnostic_excerpt text check (char_length(coalesce(diagnostic_excerpt, '')) <= 2000),
  subject text check (char_length(coalesce(subject, '')) <= 500),
  offer_id text,
  offer_number text,
  request_id text,
  proposed_email text check (proposed_email is null or (proposed_email = lower(proposed_email) and proposed_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 10),
  automatic_eligible boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  approval_note text check (char_length(coalesce(approval_note, '')) <= 2000),
  correction_applied_at timestamptz,
  previous_email text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  execution_idempotency_key text unique,
  processing_started_at timestamptz,
  provider_message_id text,
  provider_conversation_id text,
  failure_reason text check (char_length(coalesce(failure_reason, '')) <= 2000),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_email is null or proposed_email <> failed_email),
  check ((status not in ('approved','processing','sent')) or (proposed_email is not null and approved_at is not null)),
  check ((status <> 'sent') or (provider_message_id is not null))
);

create index if not exists undeliverable_offer_cases_status_received_idx on public.undeliverable_offer_cases(status, received_at desc);
create index if not exists undeliverable_offer_cases_offer_number_idx on public.undeliverable_offer_cases(offer_number) where offer_number is not null;
create index if not exists undeliverable_offer_cases_request_idx on public.undeliverable_offer_cases(request_id) where request_id is not null;

create table if not exists public.undeliverable_offer_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.undeliverable_offer_cases(id) on delete restrict,
  event_type text not null,
  actor text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists undeliverable_offer_events_case_idx on public.undeliverable_offer_events(case_id, created_at);

alter table public.undeliverable_offer_settings enable row level security;
alter table public.undeliverable_offer_cases enable row level security;
alter table public.undeliverable_offer_events enable row level security;
revoke all on public.undeliverable_offer_settings from public, anon, authenticated;
revoke all on public.undeliverable_offer_cases from public, anon, authenticated;
revoke all on public.undeliverable_offer_events from public, anon, authenticated;
grant select, insert, update on public.undeliverable_offer_settings to service_role;
grant select, insert, update on public.undeliverable_offer_cases to service_role;
grant select, insert on public.undeliverable_offer_events to service_role;
grant usage, select on sequence public.undeliverable_offer_events_id_seq to service_role;

create or replace function public.touch_undeliverable_offer_case_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists touch_undeliverable_offer_case_v1 on public.undeliverable_offer_cases;
create trigger touch_undeliverable_offer_case_v1 before update on public.undeliverable_offer_cases
for each row execute function public.touch_undeliverable_offer_case_v1();

create or replace function public.ingest_undeliverable_offer_v1(
  p_source_message_id text, p_source_internet_message_id text, p_mailbox text, p_received_at timestamptz,
  p_failed_email text, p_failure_kind text, p_diagnostic_code text, p_diagnostic_excerpt text, p_subject text,
  p_offer_id text, p_offer_number text, p_request_id text, p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases; v_created boolean := false;
begin
  if nullif(trim(p_source_message_id),'') is null or p_received_at is null or p_correlation_id is null then raise exception 'invalid_bounce_input'; end if;
  if lower(trim(p_mailbox)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or lower(trim(p_failed_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if p_failure_kind not in ('domain_not_found','mailbox_not_found','policy_rejected','temporary','unknown') then raise exception 'invalid_failure_kind'; end if;
  insert into public.undeliverable_offer_cases(source_message_id,source_internet_message_id,mailbox,received_at,failed_email,failure_kind,diagnostic_code,diagnostic_excerpt,subject,offer_id,offer_number,request_id,correlation_id,status)
  values(trim(p_source_message_id),nullif(trim(p_source_internet_message_id),''),lower(trim(p_mailbox)),p_received_at,lower(trim(p_failed_email)),p_failure_kind,nullif(trim(p_diagnostic_code),''),left(coalesce(p_diagnostic_excerpt,''),2000),left(coalesce(p_subject,''),500),nullif(trim(p_offer_id),''),nullif(trim(p_offer_number),''),nullif(trim(p_request_id),''),p_correlation_id,'needs_research')
  on conflict(source_message_id) do nothing returning * into v_case;
  if v_case.id is not null then v_created := true; else select * into strict v_case from public.undeliverable_offer_cases where source_message_id=trim(p_source_message_id); end if;
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload)
  values(v_case.id,'bounce_ingested','n8n:outlook','bounce:'||encode(extensions.digest(trim(p_source_message_id),'sha256'),'hex'),jsonb_build_object('created',v_created,'correlation_id',p_correlation_id,'failure_kind',p_failure_kind))
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',v_case.id,'created',v_created,'status',v_case.status);
end $$;

create or replace function public.propose_undeliverable_offer_email_v1(
  p_case_id uuid, p_proposed_email text, p_confidence numeric, p_evidence jsonb,
  p_automatic_eligible boolean, p_actor text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases; v_status text; v_auto boolean;
begin
  select * into strict v_case from public.undeliverable_offer_cases where id=p_case_id for update;
  if v_case.status in ('processing','sent','dismissed','unknown') then raise exception 'case_not_proposable'; end if;
  if lower(trim(p_proposed_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or lower(trim(p_proposed_email))=v_case.failed_email then raise exception 'invalid_candidate'; end if;
  if p_confidence < 0 or p_confidence > 1 or jsonb_typeof(p_evidence)<>'array' or jsonb_array_length(p_evidence) not between 1 and 10 then raise exception 'invalid_evidence'; end if;
  v_auto := coalesce(p_automatic_eligible,false)
    and p_confidence=1
    and coalesce(v_case.offer_number,'')<>'14706'
    and exists (select 1 from jsonb_array_elements(p_evidence) evidence_item where evidence_item->>'type' in ('customer_supplied','existing_verified_contact'))
    and not exists (select 1 from jsonb_array_elements(p_evidence) evidence_item where coalesce(evidence_item->>'type','') not in ('customer_supplied','existing_verified_contact'));
  v_status := case when v_auto then 'approved' else 'manual_review' end;
  update public.undeliverable_offer_cases set proposed_email=lower(trim(p_proposed_email)),confidence=p_confidence,evidence=p_evidence,automatic_eligible=v_auto,status=v_status,approved_by=case when v_auto then 'policy:auto' else null end,approved_at=case when v_auto then now() else null end,approval_note=case when v_auto then 'Deterministic evidence policy v1' else null end where id=p_case_id returning * into v_case;
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload)
  values(p_case_id,'candidate_proposed',left(coalesce(nullif(trim(p_actor),''),'unknown'),200),'proposal:'||p_idempotency_key,jsonb_build_object('proposed_email',v_case.proposed_email,'confidence',p_confidence,'automatic_eligible',v_auto,'evidence',p_evidence))
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',v_case.id,'status',v_case.status,'automatic_eligible',v_auto);
end $$;

create or replace function public.review_undeliverable_offer_v1(
  p_case_id uuid, p_decision text, p_note text, p_actor text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases; v_existing jsonb;
begin
  select payload into v_existing from public.undeliverable_offer_events where idempotency_key='review:'||p_idempotency_key;
  if found then return v_existing || jsonb_build_object('idempotent_replay',true); end if;
  select * into strict v_case from public.undeliverable_offer_cases where id=p_case_id for update;
  if v_case.status not in ('detected','needs_research','manual_review','approved','failed') then raise exception 'case_not_reviewable'; end if;
  if p_decision not in ('approve','dismiss') or char_length(trim(coalesce(p_note,''))) not between 8 and 2000 or nullif(trim(p_actor),'') is null then raise exception 'invalid_review'; end if;
  if p_decision='approve' and v_case.proposed_email is null then raise exception 'candidate_required'; end if;
  update public.undeliverable_offer_cases set status=case when p_decision='approve' then 'approved' else 'dismissed' end,approved_by=case when p_decision='approve' then left(trim(p_actor),200) else null end,approved_at=case when p_decision='approve' then now() else null end,approval_note=trim(p_note),automatic_eligible=false where id=p_case_id returning * into v_case;
  v_existing := jsonb_build_object('id',v_case.id,'status',v_case.status,'idempotent_replay',false);
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload) values(p_case_id,'case_'||p_decision,left(trim(p_actor),200),'review:'||p_idempotency_key,v_existing);
  return v_existing;
end $$;

create or replace function public.claim_undeliverable_offer_execution_v1(p_worker text, p_execution_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases; v_enabled boolean;
begin
  select automatic_execution_enabled into v_enabled from public.undeliverable_offer_settings where singleton=true;
  if not coalesce(v_enabled,false) then return null; end if;
  select * into v_case from public.undeliverable_offer_cases where status='approved' and attempt_count=0 order by approved_at,id for update skip locked limit 1;
  if v_case.id is null then return null; end if;
  update public.undeliverable_offer_cases set status='processing',attempt_count=1,processing_started_at=now(),execution_idempotency_key='undeliverable:'||v_case.id||':v1' where id=v_case.id returning * into v_case;
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload) values(v_case.id,'execution_claimed',left(coalesce(nullif(trim(p_worker),''),'unknown'),200),'claim:'||p_execution_idempotency_key,jsonb_build_object('execution_idempotency_key',v_case.execution_idempotency_key));
  return to_jsonb(v_case) - 'diagnostic_excerpt';
end $$;

create or replace function public.apply_undeliverable_email_correction_v1(p_case_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases; v_count integer;
begin
  select * into strict v_case from public.undeliverable_offer_cases where id=p_case_id for update;
  if v_case.status<>'processing' or v_case.attempt_count<>1 or v_case.proposed_email is null or v_case.request_id is null then raise exception 'case_not_correctable'; end if;
  if v_case.correction_applied_at is not null then return jsonb_build_object('id',v_case.id,'corrected',true,'idempotent_replay',true); end if;
  update public.master_requests set email=v_case.proposed_email where request_id=v_case.request_id and lower(trim(email))=v_case.failed_email;
  get diagnostics v_count = row_count;
  if v_count<>1 then raise exception 'customer_email_compare_and_set_failed'; end if;
  update public.undeliverable_offer_cases set previous_email=failed_email,correction_applied_at=now() where id=p_case_id;
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload) values(p_case_id,'customer_email_corrected',left(coalesce(nullif(trim(p_actor),''),'unknown'),200),'correction:'||p_case_id,jsonb_build_object('request_id',v_case.request_id,'previous_email',v_case.failed_email,'new_email',v_case.proposed_email)) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',v_case.id,'corrected',true,'idempotent_replay',false,'recipient_email',v_case.proposed_email,'offer_id',v_case.offer_id,'offer_number',v_case.offer_number,'send_idempotency_key',v_case.execution_idempotency_key);
end $$;

create or replace function public.complete_undeliverable_offer_execution_v1(
  p_case_id uuid, p_result text, p_provider_message_id text, p_provider_conversation_id text, p_failure_reason text, p_actor text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_case public.undeliverable_offer_cases;
begin
  select * into strict v_case from public.undeliverable_offer_cases where id=p_case_id for update;
  if v_case.status in ('sent','unknown') then return jsonb_build_object('id',v_case.id,'status',v_case.status,'idempotent_replay',true); end if;
  if v_case.status<>'processing' or p_result not in ('sent','failed','unknown') then raise exception 'invalid_execution_result'; end if;
  if p_result='sent' and nullif(trim(p_provider_message_id),'') is null then raise exception 'provider_receipt_required'; end if;
  update public.undeliverable_offer_cases set status=p_result,provider_message_id=nullif(trim(p_provider_message_id),''),provider_conversation_id=nullif(trim(p_provider_conversation_id),''),failure_reason=left(nullif(trim(p_failure_reason),''),2000) where id=p_case_id returning * into v_case;
  insert into public.undeliverable_offer_events(case_id,event_type,actor,idempotency_key,payload) values(p_case_id,'execution_'||p_result,left(coalesce(nullif(trim(p_actor),''),'unknown'),200),'result:'||p_case_id,jsonb_build_object('status',p_result,'provider_message_id',v_case.provider_message_id,'failure_reason',v_case.failure_reason)) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',v_case.id,'status',v_case.status,'idempotent_replay',false);
end $$;

revoke all on function public.ingest_undeliverable_offer_v1(text,text,text,timestamptz,text,text,text,text,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.propose_undeliverable_offer_email_v1(uuid,text,numeric,jsonb,boolean,text,uuid) from public, anon, authenticated;
revoke all on function public.review_undeliverable_offer_v1(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.claim_undeliverable_offer_execution_v1(text,uuid) from public, anon, authenticated;
revoke all on function public.apply_undeliverable_email_correction_v1(uuid,text) from public, anon, authenticated;
revoke all on function public.complete_undeliverable_offer_execution_v1(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.ingest_undeliverable_offer_v1(text,text,text,timestamptz,text,text,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.propose_undeliverable_offer_email_v1(uuid,text,numeric,jsonb,boolean,text,uuid) to service_role;
grant execute on function public.review_undeliverable_offer_v1(uuid,text,text,text,uuid) to service_role;
grant execute on function public.claim_undeliverable_offer_execution_v1(text,uuid) to service_role;
grant execute on function public.apply_undeliverable_email_correction_v1(uuid,text) to service_role;
grant execute on function public.complete_undeliverable_offer_execution_v1(uuid,text,text,text,text,text) to service_role;
