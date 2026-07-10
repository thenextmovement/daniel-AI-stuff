alter table public.offer_size_quote_anchors
  drop constraint if exists offer_size_quote_anchors_role_check;

alter table public.offer_size_quote_anchors
  add constraint offer_size_quote_anchors_role_check
  check (
    role in ('minimum', 'requested', 'max_250')
    or role ~ '^anchor_([3-9]|1[0-9]|20)$'
  );

comment on constraint offer_size_quote_anchors_role_check
  on public.offer_size_quote_anchors is
  'Allows fixed supplier anchors plus flexible intermediate anchor_3..anchor_20 roles from Trello custom fields.';
