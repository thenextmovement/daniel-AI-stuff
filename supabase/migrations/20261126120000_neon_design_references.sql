create table if not exists public.neon_design_references (
 catalog_version text not null,
 card_id text not null,
 audit jsonb not null,
 reference jsonb,
 created_at timestamptz not null default now(),
 primary key(catalog_version,card_id),
 constraint neon_reference_audit_object check(jsonb_typeof(audit)='object'),
 constraint neon_reference_object check(reference is null or jsonb_typeof(reference)='object')
);
alter table public.neon_design_references enable row level security;
revoke all on public.neon_design_references from public, anon, authenticated;
grant select,insert,update,delete on public.neon_design_references to service_role;
comment on table public.neon_design_references is 'Private supplier drawing evidence. Runtime uses the reviewed versioned Studio snapshot; not price training or manufacturing approval.';
