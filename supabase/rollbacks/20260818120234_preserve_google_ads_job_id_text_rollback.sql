do $rollback$
declare
  v_definition text;
  v_updated_definition text;
  v_numeric_fragment constant text := '''last_upload_job_id'', am.last_job_id';
  v_text_fragment constant text := '''last_upload_job_id'', am.last_job_id::text';
begin
  select pg_catalog.pg_get_functiondef('public.gads_upload_health_metrics()'::regprocedure)
  into v_definition;

  if pg_catalog.strpos(v_definition, v_text_fragment) = 0 then
    raise exception 'unexpected gads_upload_health_metrics definition';
  end if;

  v_updated_definition := pg_catalog.replace(
    v_definition,
    v_text_fragment,
    v_numeric_fragment
  );

  execute v_updated_definition;
end;
$rollback$;
