do $precondition$
declare
  definition text := pg_get_functiondef(to_regprocedure(
    'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)'
  ));
begin
  if md5(definition) <> 'cf7eabf48a68c007b0e6626d838e9ec9' then
    raise exception using errcode = '55000',
      message = 'followup_decline_lost_rollback_source_drifted';
  end if;
end;
$precondition$;

create or replace function public.apply_followup_reply_decision(
  p_followup_queue_id uuid,
  p_claim_token uuid,
  p_offer_id text,
  p_workflow_execution_id text,
  p_decision text,
  p_reason_code text,
  p_confidence numeric,
  p_evidence_quote text,
  p_reply_excerpt text,
  p_reply_message_id text,
  p_classifier_contract text
)
returns jsonb
language plpgsql
set search_path = 'public'
as $function$
declare
  safe_offer_id text := left(nullif(btrim(p_offer_id), ''), 200);
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_decision text := upper(nullif(btrim(p_decision), ''));
  safe_reason text := lower(nullif(btrim(p_reason_code), ''));
  safe_quote text := left(nullif(btrim(p_evidence_quote), ''), 300);
  safe_excerpt text := left(nullif(btrim(p_reply_excerpt), ''), 2000);
  safe_message_id text := left(nullif(btrim(p_reply_message_id), ''), 1000);
  safe_contract text := nullif(btrim(p_classifier_contract), '');
  normalized_quote text;
  normalized_excerpt text;
  attempt public.followup_delivery_attempts%rowtype;
  source_row public.followup_queue%rowtype;
  reply_snapshot jsonb;
  snoozed_until timestamptz;
begin
  if p_followup_queue_id is null or p_claim_token is null
     or safe_offer_id is null or safe_execution_id is null
     or safe_decision not in ('DECLINED', 'SNOOZE_7_DAYS', 'MANUAL_REVIEW')
     or safe_reason is null or safe_quote is null or safe_excerpt is null
     or safe_message_id is null
     or safe_contract <> 'followup_reply_classifier_v1_20260824'
     or p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'Follow-up reply decision payload is invalid';
  end if;

  if safe_reason not in (
    'explicit_decline', 'bought_elsewhere', 'do_not_contact',
    'needs_time', 'waiting_for_customer', 'project_delayed',
    'question_or_change', 'positive_interest', 'auto_reply', 'ambiguous'
  ) then
    raise exception 'Follow-up reply reason code is invalid';
  end if;

  normalized_quote := lower(regexp_replace(safe_quote, '\s+', ' ', 'g'));
  normalized_excerpt := lower(regexp_replace(safe_excerpt, '\s+', ' ', 'g'));
  if position(normalized_quote in normalized_excerpt) = 0 then
    raise exception 'Follow-up reply evidence quote is not present in the reply';
  end if;

  if safe_decision = 'DECLINED' then
    if p_confidence < 0.90
       or safe_reason not in ('explicit_decline', 'bought_elsewhere', 'do_not_contact')
       or normalized_quote ~ '(noch|bisher)[[:space:]]+nicht[[:space:]]+(abgesagt|abgelehnt)'
       or normalized_quote ~ 'keine[[:space:]]+absage|nicht[[:space:]]+(abgesagt|abgelehnt)'
       or normalized_quote !~ (
         'kein(e[[:alpha:]]*)?[[:space:]]+(interesse|bedarf)'
         || '|hat[[:space:]]+(abgesagt|abgelehnt)'
         || '|(anderweitig|woanders).*(vergeben|bestellt|gekauft|beauftragt)'
         || '|bitte.*(keine|nicht).*(e-?mails?|nachrichten|kontakt)'
         || '|nicht[[:space:]]+mehr[[:space:]]+(kontaktieren|anschreiben|benötigt|benoetigt)'
         || '|do[[:space:]]+not[[:space:]]+contact|not[[:space:]]+interested'
         || '|will[[:space:]]+not[[:space:]]+proceed|won''t[[:space:]]+proceed'
         || '|went[[:space:]]+with[[:space:]]+another|cancelled|canceled|declined'
       ) then
      raise exception 'Automatic lost decision lacks deterministic decline evidence';
    end if;
  elsif safe_decision = 'SNOOZE_7_DAYS' then
    if p_confidence < 0.80
       or safe_reason not in ('needs_time', 'waiting_for_customer', 'project_delayed')
       or normalized_quote !~ (
         '(braucht|brauchen|benötigt|benoetigt).*(noch|mehr)?[[:space:]]*zeit'
         || '|(noch[[:space:]]+)?(keine|keinen)[[:space:]]+(rückmeldung|rueckmeldung|antwort|entscheidung)'
         || '|hat[[:space:]]+sich[[:space:]]+(noch[[:space:]]+)?nicht[[:space:]]+gemeldet'
         || '|(warten|warte|wartet).*(auf|rückmeldung|rueckmeldung)'
         || '|(nächste|naechste|kommende)[[:space:]]+woche'
         || '|(später|spaeter).*(melden|nachfragen)'
         || '|projekt.*(verschoben|verzögert|verzoegert|pausiert)'
       ) then
      raise exception 'Automatic snooze decision lacks deterministic timing evidence';
    end if;
  end if;

  select q.* into source_row
  from public.followup_queue q
  where q.id = p_followup_queue_id
    and q.document_id = safe_offer_id
  for update;
  if not found then
    raise exception 'Follow-up reply offer and queue do not match';
  end if;

  select existing.* into attempt
  from public.followup_delivery_attempts existing
  where existing.followup_queue_id = p_followup_queue_id
  for update;

  if attempt.id is null
     or attempt.status <> 'processing'
     or attempt.claim_token <> p_claim_token then
    if source_row.email_context_snapshot->>'reply_workflow_execution_id'
         = safe_execution_id
       and source_row.email_context_snapshot->>'decision' = safe_decision then
      return jsonb_build_object(
        'applied', false,
        'reason', 'already_applied',
        'decision', safe_decision,
        'queue_status', source_row.status
      );
    end if;
    raise exception 'Follow-up reply decision rejected because the claim is stale or missing';
  end if;

  reply_snapshot := jsonb_build_object(
    'classifier_contract', safe_contract,
    'decision', safe_decision,
    'reason_code', safe_reason,
    'confidence', p_confidence,
    'evidence_quote', safe_quote,
    'reply_message_id', safe_message_id,
    'reply_workflow_execution_id', safe_execution_id,
    'applied_at', now()
  );

  update public.followup_delivery_attempts
    set status = 'blocked',
        claim_token = null,
        lease_until = null,
        block_reason = 'customer_reply_' || lower(safe_decision),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        updated_at = now()
  where id = attempt.id
  returning * into attempt;

  if safe_decision = 'DECLINED' then
    update public.followup_queue
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = 'customer_declined',
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'customer_declined',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = null,
          last_error = null
    where document_id = source_row.document_id
      and followup_type not like 'payment_reminder%'
      and sent_at is null
      and status in ('pending', 'processing', 'human_review', 'error', 'retry', 'scheduled');
  elsif safe_decision = 'SNOOZE_7_DAYS' then
    snoozed_until := public.neontrip_followup_business_slot(
      now(),
      5,
      source_row.document_id || ':reply-snooze:' || safe_execution_id
    );
    update public.followup_queue
      set status = 'pending',
          scheduled_for = snoozed_until,
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'snoozed_7_days',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = snoozed_until,
          last_error = null
    where id = source_row.id;
  else
    update public.followup_queue
      set status = 'human_review',
          processing_started_at = null,
          reply_detected_at = now(),
          email_context_checked_at = now(),
          email_context_decision = 'human_review',
          email_context_reason = safe_reason,
          email_context_confidence = p_confidence,
          email_context_snapshot = reply_snapshot,
          email_context_delay_until = null,
          last_error = 'Customer reply requires human handling before another follow-up.'
    where id = source_row.id;
  end if;

  insert into public.followup_delivery_events (
    attempt_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':reply:' || safe_execution_id,
    'blocked',
    safe_execution_id,
    reply_snapshot || jsonb_build_object(
      'snoozed_until', snoozed_until,
      'automatic_send_allowed', false
    )
  ) on conflict (event_key) do nothing;

  return jsonb_build_object(
    'applied', true,
    'reason', 'reply_decision_applied',
    'decision', safe_decision,
    'queue_status', case
      when safe_decision = 'DECLINED' then 'cancelled'
      when safe_decision = 'SNOOZE_7_DAYS' then 'pending'
      else 'human_review'
    end,
    'snoozed_until', snoozed_until,
    'automatic_send_allowed', false
  );
end;
$function$;

comment on function public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text) is
  'Claim-bound reply action: explicit decline, seven-day snooze, or human review. AI output is revalidated deterministically.';

do $postcondition$
begin
  if md5(pg_get_functiondef(to_regprocedure(
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)'
     ))) <> '5e49a9a85c9c348d672f4a1bec0d8eff' then
    raise exception using errcode = '55000',
      message = 'followup_decline_lost_rollback_postcondition_failed';
  end if;
end;
$postcondition$;
