create or replace function public.billing_case_ingest_with_portal(
  p_case jsonb,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_source_event_id text,
  p_portal_token_hash text,
  p_portal_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_case_id uuid;
begin
  if p_portal_url !~ '^https://rechnung\.neontrip\.de/[A-Za-z0-9_-]+$' then
    raise exception 'BILLING_PORTAL_URL_INVALID';
  end if;

  v_result := public.billing_case_ingest(
    p_case,
    p_snapshot,
    p_snapshot_hash,
    p_source_event_id,
    p_portal_token_hash
  );
  v_case_id := (v_result->>'id')::uuid;

  update public.billing_jobs
  set payload = payload || jsonb_build_object('portalUrl',p_portal_url)
  where billing_case_id = v_case_id
    and idempotency_key = 'billing:'||v_case_id::text||':proforma:0'
    and job_type = 'CREATE_PROFORMA'
    and status in ('PENDING','FAILED');

  return v_result;
end;
$$;

revoke all on function public.billing_case_ingest_with_portal(jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_case_ingest_with_portal(jsonb,jsonb,text,text,text,text) to service_role;
