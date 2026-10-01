-- NEONTRIP Social Studio: existing D1 model moved into the Ops database.
-- No schedule or provider action is created by this migration.
create table public.neontrip_social_drafts (
 id text primary key check (id ~ '^[a-f0-9]{64}$'),
 texts text not null check (jsonb_typeof(texts::jsonb) = 'object'),
 revision integer not null default 1 check (revision >= 1),
 status text not null default 'draft' check (status in ('draft','preparing','scheduling','rescheduling','withdrawing','scheduled','sending','sent','manual_review')),
 due_at text, approved_by text, approved_at text, updated_at text not null
);
create table public.neontrip_social_deliveries (
 draft_id text not null references public.neontrip_social_drafts(id),
 channel text not null check (channel in ('ig','fb','linkedin','pinterest','gmb')),
 status text not null default 'pending' check (status in ('pending','inflight','scheduled','sending','sent','manual_review','failed','draft_buffer')),
 buffer_id text, error text, image_url text, due_at text, checked_at text,
 sent_at text, external_link text, updated_at text not null,
 primary key (draft_id,channel)
);
alter table public.neontrip_social_drafts enable row level security;
alter table public.neontrip_social_deliveries enable row level security;
revoke all on public.neontrip_social_drafts,public.neontrip_social_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.neontrip_social_drafts,public.neontrip_social_deliveries to service_role;
