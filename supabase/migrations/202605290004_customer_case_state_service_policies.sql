drop policy if exists customer_case_state_service_role_all on public.customer_case_state;
create policy customer_case_state_service_role_all
  on public.customer_case_state
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists ops_card_views_service_role_all on public.ops_card_views;
create policy ops_card_views_service_role_all
  on public.ops_card_views
  for all
  to service_role
  using (true)
  with check (true);
