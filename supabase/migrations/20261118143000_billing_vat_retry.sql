
-- PROJ-001: durable VIES checks only. No financial/document/payment mutations.
create or replace function public.billing_vat_attempt_complete(
 p_job_id uuid,p_lease_token text,p_snapshot jsonb,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 j public.billing_jobs; c public.billing_cases; s jsonb; e jsonb:=p_evidence;
 n integer; outcome text; retry boolean:=false; alert boolean:=false;
 due timestamptz; result jsonb; other_hold boolean;
begin
 select * into j from billing_jobs where id=p_job_id;
 if not found or j.job_type<>'VERIFY_VAT' then raise exception 'BILLING_VAT_JOB_INVALID'; end if;
 select * into c from billing_cases where id=j.billing_case_id for update;
 select * into j from billing_jobs where id=p_job_id for update;
 if nullif(p_lease_token,'') is not null and j.payload->>'lastVatLeaseHash'=md5(p_lease_token) then
  return jsonb_build_object('duplicate',true,'retry',false,'shouldAlert',false,'jobId',j.id);
 end if;
 if j.status<>'PROCESSING' or j.lease_token is distinct from p_lease_token
    or nullif(p_lease_token,'') is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'BILLING_VAT_LEASE_INVALID';
 end if;
 s:=jsonb_build_object('vatId',c.vat_id,'billingAddress',c.billing_address,'deliveryAddress',c.delivery_address,'revision',c.current_revision);
 if s is distinct from p_snapshot then
  update billing_jobs set status='PENDING',lease_token=null,lease_expires_at=null,next_attempt_at=null,
   payload=(payload-'viesAttempts')||jsonb_build_object('lastVatLeaseHash',md5(p_lease_token)),last_error=null where id=j.id;
  return jsonb_build_object('outcome','STALE','retry',false,'shouldAlert',false,'jobId',j.id);
 end if;
 outcome:=e->>'outcome';
 if e->>'source' is distinct from 'EU_VIES' or outcome is null or outcome not in
  ('VERIFIED','INVALID','UNAVAILABLE','IDENTITY_MISMATCH','IDENTITY_UNAVAILABLE','FORMAT_INVALID','COUNTRY_MISMATCH','SKIPPED')
  or e->>'normalizedVatId' is distinct from upper(regexp_replace(coalesce(c.vat_id,''),'[^A-Za-z0-9]','','g')) then
  raise exception 'BILLING_VAT_EVIDENCE_INVALID';
 end if;
 if outcome='VERIFIED' and (
  e->'checked' is distinct from 'true'::jsonb or e->'valid' is distinct from 'true'::jsonb
  or e->>'identityComparison' is distinct from 'MATCH' or e->>'addressComparison' is distinct from 'MATCH'
  or length(trim(coalesce(e->>'name','')))<2 or length(trim(coalesce(e->>'address','')))<4
 ) then raise exception 'BILLING_VAT_EVIDENCE_INVALID'; end if;
 if c.tax_review_status<>'REVIEW_REQUIRED' or c.cancelled_at is not null or c.refunded_at is not null or c.final_invoice_at is not null then
  outcome:='SKIPPED';
 elsif outcome='SKIPPED' then
  raise exception 'BILLING_VAT_EVIDENCE_INVALID';
 end if;
 if outcome='VERIFIED' and (c.vat_cents<>0 or not c.tax_exempt or c.tax_treatment<>'EU_B2B_REVERSE_CHARGE'
  or exists(select 1 from billing_change_requests where billing_case_id=c.id and status in ('PENDING','APPROVED'))) then
  outcome:='TAX_REVIEW';
 end if;
 n:=coalesce((j.payload->>'viesAttempts')::integer,0)+1;
 if n>3 then raise exception 'BILLING_VAT_ATTEMPTS_EXHAUSTED'; end if;
 retry:=outcome not in ('VERIFIED','SKIPPED') and n<3;
 alert:=outcome not in ('VERIFIED','SKIPPED') and not retry;
 if retry then due:=clock_timestamp()+interval '5 minutes'; end if;
 e:=e||jsonb_build_object('outcome',outcome,'attempts',n,'checkedAt',clock_timestamp());
 if outcome<>'SKIPPED' then
  update billing_cases set vat_validation=e,lock_version=lock_version+1 where id=c.id;
 end if;
 if outcome='VERIFIED' then
  select exists(select 1 from billing_incidents where billing_case_id=c.id and status<>'RESOLVED' and incident_key<>'vat-review:'||c.id::text)
   or exists(select 1 from billing_change_requests where billing_case_id=c.id and status in ('PENDING','APPROVED'))
   into other_hold;
  update billing_cases set tax_review_status='VERIFIED',
   status=case when status='MANUAL_REVIEW' and not other_hold and paid_at is null and delivered_at is null
    then case when exists(select 1 from billing_documents where billing_case_id=c.id and document_type='PROFORMA' and status='SENT') then 'PAYMENT_PENDING'
              when exists(select 1 from billing_documents where billing_case_id=c.id and document_type='PROFORMA' and status='FINALIZED') then 'PROFORMA_READY'
              else 'PROFORMA_PENDING' end
    else status end
   where id=c.id;
  update billing_incidents set status='RESOLVED',resolved_by='n8n-vies-verification',resolved_at=clock_timestamp(),
   details=details||jsonb_build_object('viesEvidence',e)
   where billing_case_id=c.id and incident_key='vat-review:'||c.id::text and status<>'RESOLVED';
 elsif outcome<>'SKIPPED' then
  update billing_incidents set title=case
   when retry then 'Umsatzsteuerprüfung wird automatisch wiederholt'
   when outcome='UNAVAILABLE' then 'VIES-Prüfdienst nach drei Versuchen nicht verfügbar'
   when outcome='INVALID' then 'Umsatzsteuer-ID von VIES als ungültig gemeldet'
   when outcome='IDENTITY_MISMATCH' then 'Umsatzsteuer-ID gültig; Firmenangaben weichen ab'
   when outcome='IDENTITY_UNAVAILABLE' then 'Umsatzsteuer-ID gültig; Registerdaten fehlen'
   when outcome='FORMAT_INVALID' then 'Umsatzsteuer-ID: Format ungültig'
   when outcome='COUNTRY_MISMATCH' then 'Umsatzsteuer-ID: Lieferland weicht ab'
   else 'Umsatzsteuer-ID bestätigt; Steuerbehandlung prüfen' end,
   summary=case when retry then 'Automatische Wiederholung nach fünf Minuten; noch keine Fehlermail.'
    else 'Drei Prüfversuche abgeschlossen. Finale steuerfreie Rechnung bleibt bis zur Klärung gesperrt.' end,
   details=details||jsonb_build_object('validation',e,'nextAttemptAt',due)
   where billing_case_id=c.id and incident_key='vat-review:'||c.id::text and status<>'RESOLVED';
 end if;
 result:=jsonb_build_object('jobId',j.id,'caseId',c.id,'orderName',c.shopify_order_name,'vatId',c.vat_id,
  'outcome',outcome,'validation',e,'attempts',n,'retry',retry,'nextAttemptAt',due,'shouldAlert',alert);
 update billing_jobs set status=case when retry then 'FAILED' else 'DONE' end,
  next_attempt_at=due,lease_token=null,lease_expires_at=null,last_error=case when retry then 'VIES_RETRY_PENDING:'||outcome else null end,
  payload=payload||jsonb_build_object('viesAttempts',n,'viesOutcome',outcome,'lastVatLeaseHash',md5(p_lease_token))
  where id=j.id;
 insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
  values(c.id,'vat-attempt:'||j.id::text||':'||md5(p_lease_token),'VAT_VALIDATION_ATTEMPT','N8N','n8n-vies-verification',j.id::text,result);
 return result;
end;
$$;
revoke all on function public.billing_vat_attempt_complete(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.billing_vat_attempt_complete(uuid,text,jsonb,jsonb) to service_role;

create or replace function public.billing_vat_retry_claim(p_job_id uuid,p_expected_attempts integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.billing_jobs; c public.billing_cases;
begin
 if p_expected_attempts not between 1 and 2 then return jsonb_build_object('claimed',null); end if;
 select * into j from billing_jobs where id=p_job_id and job_type='VERIFY_VAT'
  and status='FAILED' and next_attempt_at<=clock_timestamp()
  and (payload->>'viesAttempts')::integer=p_expected_attempts for update skip locked;
 if not found then return jsonb_build_object('claimed',null); end if;
 update billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=gen_random_uuid()::text,
  lease_expires_at=clock_timestamp()+interval '3 minutes',last_error=null where id=j.id returning * into j;
 select * into c from billing_cases where id=j.billing_case_id;
 return jsonb_build_object('claimed',jsonb_build_object('job',to_jsonb(j),'billingCase',to_jsonb(c)));
end;
$$;
revoke all on function public.billing_vat_retry_claim(uuid,integer) from public,anon,authenticated;
grant execute on function public.billing_vat_retry_claim(uuid,integer) to service_role;
