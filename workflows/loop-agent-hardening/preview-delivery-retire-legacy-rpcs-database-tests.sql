do $$
begin
  if has_function_privilege(
       'anon',
       'public.claim_next_preview_delivery_job(text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_next_preview_delivery_job(text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.claim_next_preview_delivery_job(text,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'legacy preview claim RPC remains executable';
  end if;

  if has_function_privilege(
       'anon',
       'public.finish_preview_delivery_job(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.finish_preview_delivery_job(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.finish_preview_delivery_job(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'legacy preview finish RPC remains executable';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.claim_next_preview_delivery_job_v2(text,text,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.finish_preview_delivery_job_v2(uuid,uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'token-bound preview RPC access was removed unexpectedly';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.enqueue_preview_delivery_jobs(jsonb,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'event-intake enqueue access was removed unexpectedly';
  end if;
end
$$;
