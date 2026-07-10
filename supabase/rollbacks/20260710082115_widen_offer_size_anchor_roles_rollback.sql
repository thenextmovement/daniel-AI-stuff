alter table public.offer_size_quote_anchors
  drop constraint if exists offer_size_quote_anchors_role_check;

alter table public.offer_size_quote_anchors
  add constraint offer_size_quote_anchors_role_check
  check (role in ('minimum', 'requested', 'max_250'));

comment on constraint offer_size_quote_anchors_role_check
  on public.offer_size_quote_anchors is
  'Allows the original fixed minimum, requested and 250cm supplier anchor roles.';
