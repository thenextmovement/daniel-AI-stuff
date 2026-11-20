-- Opt-in protection: only fields manually changed through the editor are owned.
create table public.customer_manual_contact_fields(
 customer_id uuid primary key references public.master_customers(id) on delete cascade,
 fields text[] not null default '{}',
 check(fields <@ array['email','phone','first_name','last_name','customer_organization_id']::text[])
);
create table public.customer_previous_primary_emails(
 organization_id uuid not null, email text not null,
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 primary key(organization_id,email)
);
create index customer_previous_primary_emails_customer on public.customer_previous_primary_emails(customer_id);
alter table public.customer_manual_contact_fields enable row level security;
alter table public.customer_previous_primary_emails enable row level security;
revoke all on public.customer_manual_contact_fields,public.customer_previous_primary_emails from public,anon,authenticated;
grant select on public.customer_manual_contact_fields,public.customer_previous_primary_emails to service_role;

create function public.guard_manual_customer_contacts_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare owned text[]; changed text[]:='{}'; mapped_email text; k text;
begin
 if TG_OP='INSERT' then
  -- Existing email-keyed upserts keep returning the same customer after an email edit.
  select c.email into mapped_email from public.customer_previous_primary_emails a
  join public.master_customers c on c.id=a.customer_id
  where a.organization_id=coalesce(NEW.organization_id,'a0000000-0000-0000-0000-000000000001'::uuid)
  and a.email=lower(btrim(NEW.email)) and c.organization_id=a.organization_id for update of c;
  if found then NEW.email:=mapped_email; end if;
  return NEW;
 end if;
 select fields into owned from public.customer_manual_contact_fields where customer_id=OLD.id;
 if not found then return NEW;end if;
 if current_setting('ops.customer_contact_edit_id',true)=OLD.id::text then
  foreach k in array array['email','phone','first_name','last_name','customer_organization_id'] loop
   if to_jsonb(NEW)->k is distinct from to_jsonb(OLD)->k then changed:=array_append(changed,k);end if;
  end loop;
  if NEW.email is distinct from OLD.email then
   if exists(select 1 from public.master_customers c where c.id<>OLD.id and lower(btrim(c.email))=lower(btrim(NEW.email)))
   or exists(select 1 from public.customer_previous_primary_emails a where a.organization_id=OLD.organization_id and a.email=lower(btrim(NEW.email)) and a.customer_id<>OLD.id)
   then raise exception 'email_already_assigned' using errcode='23505';end if;
   insert into public.customer_previous_primary_emails(organization_id,email,customer_id)
   values(OLD.organization_id,lower(btrim(OLD.email)),OLD.id)
   on conflict(organization_id,email) do nothing;
   if exists(select 1 from public.customer_previous_primary_emails where organization_id=OLD.organization_id and email=lower(btrim(OLD.email)) and customer_id<>OLD.id)
   then raise exception 'ambiguous_previous_email' using errcode='23505';end if;
  end if;
  update public.customer_manual_contact_fields set fields=array(select distinct unnest(owned||changed)) where customer_id=OLD.id;
 else
  if 'email'=any(owned) then NEW.email:=OLD.email;end if;
  if 'phone'=any(owned) then NEW.phone:=OLD.phone;end if;
  if 'first_name'=any(owned) then NEW.first_name:=OLD.first_name;end if;
  if 'last_name'=any(owned) then NEW.last_name:=OLD.last_name;end if;
  if 'customer_organization_id'=any(owned) then NEW.customer_organization_id:=OLD.customer_organization_id;end if;
  if 'first_name'=any(owned) or 'last_name'=any(owned) then
   NEW.name:=nullif(btrim(concat_ws(' ',NEW.first_name,NEW.last_name)),'');
  end if;
 end if;
 return NEW;
end $$;
-- Run after existing auto-name/default-tenant triggers. No existing trigger is replaced.
create trigger zz_guard_manual_customer_contacts_v1 before insert or update on public.master_customers
for each row execute function public.guard_manual_customer_contacts_v1();
revoke all on function public.guard_manual_customer_contacts_v1() from public,anon,authenticated;

-- Existing Kundenakte stays an intentional editor, including its rollback path.
create function public.patch_customer_record_contact_v1(p_customer_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.master_customers%rowtype; n public.master_customers%rowtype; previous_flag text; saved_fields text[]; saved_aliases jsonb;
begin
 if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in('email','billing_email','cc_emails','first_name','last_name','phone','company','company_name','name'))
 then raise exception 'invalid_contact_patch';end if;
 select * into c from public.master_customers where id=p_customer_id for update;
 if not found then raise exception 'customer_not_found';end if;
 select fields into saved_fields from public.customer_manual_contact_fields where customer_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into saved_aliases from public.customer_previous_primary_emails a where customer_id=c.id;
 n:=jsonb_populate_record(c,p_patch);
 previous_flag:=current_setting('ops.customer_contact_edit_id',true);
 perform set_config('ops.customer_contact_edit_id',c.id::text,true);
 update public.master_customers set email=n.email,billing_email=n.billing_email,cc_emails=n.cc_emails,
 first_name=n.first_name,last_name=n.last_name,phone=n.phone,company=n.company,company_name=n.company_name,name=n.name
 where id=c.id returning * into n;
 perform set_config('ops.customer_contact_edit_id',coalesce(previous_flag,''),true);
 return to_jsonb(n)||jsonb_build_object('_contactRollback',jsonb_build_object('fields',saved_fields,'aliases',saved_aliases,'expected_updated_at',n.updated_at));
end $$;
revoke all on function public.patch_customer_record_contact_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.patch_customer_record_contact_v1(uuid,jsonb) to service_role;

create or replace function public.set_customer_organization_v1(p_customer_id uuid,p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_tenant uuid; previous_flag text;
begin
 select organization_id into v_tenant from public.master_customers where id=p_customer_id for update;
 if not found or v_tenant is null then raise exception 'CUSTOMER_NOT_FOUND';end if;
 if p_organization_id is not null and not exists(select 1 from public.customer_organizations where id=p_organization_id and organization_id=v_tenant)
 then raise exception 'ORGANIZATION_NOT_FOUND_IN_TENANT';end if;
 previous_flag:=current_setting('ops.customer_contact_edit_id',true);
 perform set_config('ops.customer_contact_edit_id',p_customer_id::text,true);
 update public.master_customers set customer_organization_id=p_organization_id
 where id=p_customer_id and customer_organization_id is distinct from p_organization_id;
 perform set_config('ops.customer_contact_edit_id',coalesce(previous_flag,''),true);
end $$;

-- A failed multi-table Kundenakte edit must restore identity metadata too.
create function public.restore_customer_record_contact_v1(p_customer_id uuid,p_patch jsonb,p_state jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.master_customers%rowtype;
begin
 select * into c from public.master_customers where id=p_customer_id for update;
 if not found or c.updated_at is distinct from (p_state->>'expected_updated_at')::timestamptz then
  raise exception 'customer_changed_reload' using errcode='40001';end if;
 perform public.patch_customer_record_contact_v1(c.id,p_patch);
 delete from public.customer_manual_contact_fields where customer_id=c.id;
 if jsonb_typeof(p_state->'fields')='array' then
  insert into public.customer_manual_contact_fields(customer_id,fields)
  select c.id,array(select jsonb_array_elements_text(p_state->'fields'));
 end if;
 delete from public.customer_previous_primary_emails where customer_id=c.id;
 insert into public.customer_previous_primary_emails(organization_id,email,customer_id)
 select c.organization_id,a->>'email',c.id from jsonb_array_elements(p_state->'aliases') a;
end $$;
revoke all on function public.restore_customer_record_contact_v1(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.restore_customer_record_contact_v1(uuid,jsonb,jsonb) to service_role;
