alter table public.ops_refresh_locks enable row level security;

revoke execute on function public.ops_claim_refresh_lock(text, integer) from public;
revoke execute on function public.ops_claim_refresh_lock(text, integer) from anon;
revoke execute on function public.ops_claim_refresh_lock(text, integer) from authenticated;
grant execute on function public.ops_claim_refresh_lock(text, integer) to service_role;

revoke execute on function public.ops_record_sales_call_result(
  uuid,
  uuid,
  integer,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;
revoke execute on function public.ops_record_sales_call_result(
  uuid,
  uuid,
  integer,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from anon;
revoke execute on function public.ops_record_sales_call_result(
  uuid,
  uuid,
  integer,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from authenticated;
grant execute on function public.ops_record_sales_call_result(
  uuid,
  uuid,
  integer,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;
