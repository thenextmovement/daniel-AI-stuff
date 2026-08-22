alter table public.billing_change_requests
  add column if not exists ops_draft_changes jsonb,
  add column if not exists ops_draft_saved_by text,
  add column if not exists ops_draft_saved_at timestamptz,
  add column if not exists applied_changes jsonb;

create or replace function public.billing_change_request_save_draft(
  p_case_id uuid,
  p_change_request_id uuid,
  p_changes jsonb,
  p_actor text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_change public.billing_change_requests;
begin
  if length(trim(coalesce(p_actor,''))) < 2 then raise exception 'BILLING_ACTOR_REQUIRED'; end if;
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'BILLING_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then raise exception 'BILLING_CHANGE_DRAFT_INVALID'; end if;
  select * into v_case from public.billing_cases where id=p_case_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
  select * into v_change from public.billing_change_requests where id=p_change_request_id and billing_case_id=p_case_id for update;
  if not found then raise exception 'BILLING_CHANGE_REQUEST_NOT_FOUND'; end if;
  if v_change.status <> 'PENDING' then raise exception 'BILLING_CHANGE_REQUEST_ALREADY_REVIEWED'; end if;
  if exists(select 1 from public.billing_events where idempotency_key=p_idempotency_key) then
    return jsonb_build_object('id',v_change.id,'status',v_change.status,'duplicate',true);
  end if;
  update public.billing_change_requests
    set ops_draft_changes=p_changes,ops_draft_saved_by=p_actor,ops_draft_saved_at=now(),updated_at=now()
    where id=v_change.id returning * into v_change;
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values (p_case_id,p_idempotency_key,'CHANGE_REQUEST_DRAFT_SAVED','OPS',p_actor,p_idempotency_key,jsonb_build_object('changeRequestId',v_change.id,'draftChanges',p_changes));
  return jsonb_build_object('id',v_change.id,'status',v_change.status,'draftSavedAt',v_change.ops_draft_saved_at,'duplicate',false);
end;
$$;

create or replace function public.billing_change_request_decide(
  p_case_id uuid,
  p_change_request_id uuid,
  p_decision text,
  p_approved_changes jsonb,
  p_note text,
  p_actor text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_case public.billing_cases;
  v_change public.billing_change_requests;
  v_original jsonb;
  v_reviewed jsonb;
  v_result jsonb;
  v_recipient text;
  v_portal_url text;
  v_action text;
begin
  if upper(coalesce(p_decision,'')) not in ('APPLY','REJECT') then raise exception 'BILLING_CHANGE_DECISION_INVALID'; end if;
  select * into v_case from public.billing_cases where id=p_case_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
  select * into v_change from public.billing_change_requests where id=p_change_request_id and billing_case_id=p_case_id for update;
  if not found then raise exception 'BILLING_CHANGE_REQUEST_NOT_FOUND'; end if;
  if v_change.status <> 'PENDING' then raise exception 'BILLING_CHANGE_REQUEST_ALREADY_REVIEWED'; end if;

  v_original := v_change.requested_changes;
  v_reviewed := case
    when jsonb_typeof(p_approved_changes)='object' and p_approved_changes<>'{}'::jsonb then p_approved_changes
    when jsonb_typeof(v_change.ops_draft_changes)='object' and v_change.ops_draft_changes<>'{}'::jsonb then v_change.ops_draft_changes
    else v_original
  end;
  v_action := case when upper(p_decision)='APPLY' then 'APPLY_CHANGE_REQUEST' else 'REJECT_CHANGE_REQUEST' end;

  if v_action='APPLY_CHANGE_REQUEST' then
    update public.billing_change_requests set requested_changes=v_reviewed where id=v_change.id;
  end if;
  v_result := public.billing_case_apply_action(
    p_case_id,
    v_action,
    jsonb_build_object('changeRequestId',p_change_request_id,'note',nullif(trim(coalesce(p_note,'')),'')),
    p_actor,
    p_idempotency_key
  );
  update public.billing_change_requests
    set requested_changes=v_original,
        applied_changes=case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else null end,
        ops_draft_changes=case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else ops_draft_changes end,
        updated_at=now()
    where id=v_change.id returning * into v_change;
  select * into v_case from public.billing_cases where id=p_case_id;

  v_recipient := case when v_action='APPLY_CHANGE_REQUEST'
    then coalesce(nullif(v_case.customer_email,''),nullif(v_case.customer->>'email',''))
    else coalesce(nullif(v_change.requester_email,''),nullif(v_case.customer_email,''),nullif(v_case.customer->>'email',''))
  end;
  v_recipient := lower(trim(coalesce(v_recipient,'')));
  if v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_recipient)>254 then
    raise exception 'BILLING_CHANGE_EMAIL_INVALID';
  end if;
  select payload->>'portalUrl' into v_portal_url
    from public.billing_jobs
    where billing_case_id=p_case_id and job_type='CREATE_PROFORMA' and coalesce(payload->>'portalUrl','')<>''
    order by created_at asc limit 1;
  if coalesce(v_portal_url,'') !~ '^https://rechnung\.neontrip\.de/[A-Za-z0-9_-]+$' then
    raise exception 'BILLING_CHANGE_PORTAL_URL_MISSING';
  end if;

  insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
    values (
      p_case_id,
      'notify-change-decision:'||p_change_request_id::text||':'||upper(p_decision),
      'NOTIFY_CHANGE_REQUEST',
      jsonb_build_object(
        'notificationKind','DECISION_CUSTOMER',
        'changeRequestId',p_change_request_id,
        'decision',upper(p_decision),
        'recipient',v_recipient,
        'portalUrl',v_portal_url,
        'shopifyOrderName',v_case.shopify_order_name,
        'reviewedChanges',case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else v_original end,
        'reviewNote',nullif(trim(coalesce(p_note,'')),''),
        'reviewedBy',p_actor,
        'reviewedAt',v_change.reviewed_at
      )
    ) on conflict (idempotency_key) do nothing;
  return v_result||jsonb_build_object('changeRequestId',v_change.id,'decision',upper(p_decision),'notificationQueued',true);
end;
$$;

revoke all on function public.billing_change_request_save_draft(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.billing_change_request_save_draft(uuid,uuid,jsonb,text,text) to service_role;
revoke all on function public.billing_change_request_decide(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_change_request_decide(uuid,uuid,text,jsonb,text,text,text) to service_role;
