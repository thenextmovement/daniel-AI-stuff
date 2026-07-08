-- Company Brain must resolve copied Trello cards through the stable request id.
-- The current/copied card is a projection; master_requests remains the source-of-truth anchor.

create or replace function public.fill_trello_card_alias_canonical()
returns trigger
language plpgsql
as $$
begin
  if nullif(new.canonical_trello_card_id, '') is null and nullif(new.request_id, '') is not null then
    select mr.trello_card_id
      into new.canonical_trello_card_id
    from public.master_requests mr
    where mr.request_id = new.request_id
      and nullif(mr.trello_card_id, '') is not null
    order by mr.updated_at desc nulls last, mr.created_at desc nulls last
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fill_trello_card_alias_canonical on public.trello_card_aliases;

create trigger trg_fill_trello_card_alias_canonical
before insert or update of request_id, canonical_trello_card_id
on public.trello_card_aliases
for each row
execute function public.fill_trello_card_alias_canonical();

update public.trello_card_aliases tca
set canonical_trello_card_id = mr.trello_card_id,
    updated_at = now()
from public.master_requests mr
where nullif(tca.canonical_trello_card_id, '') is null
  and tca.request_id = mr.request_id
  and nullif(mr.trello_card_id, '') is not null;
