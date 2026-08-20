-- The pgcrypto extension is installed in the extensions schema. The worker
-- function intentionally keeps a restricted search_path, so expose only that
-- schema in addition to public for the already-deployed function body.
alter function public.billing_job_complete(uuid,text,boolean,jsonb,text)
  set search_path = public, extensions;
