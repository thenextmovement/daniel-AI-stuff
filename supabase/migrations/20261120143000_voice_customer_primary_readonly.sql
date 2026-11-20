-- OPS-authenticated contact edits may have no enrolled telephone device. Existing creator IDs are preserved.
alter table public.voice_customer_phone_numbers alter column created_by drop not null;
-- Atomic customer editor; no existing importer, trigger or primary key is replaced.
create or replace function public.save_voice_customer_v1(
 p_customer_id uuid, p_tenant_id uuid, p_expected_updated_at timestamptz,
 p_first_name text, p_last_name text, p_email text, p_phone text,
 p_emails jsonb, p_phones jsonb, p_customer_organization_id uuid,
 p_new_organization_name text, p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare c public.master_customers%rowtype; org_id uuid:=p_customer_organization_id; full_name text;
begin
 select * into c from public.master_customers where id=p_customer_id and organization_id=p_tenant_id for update;
 if not found then raise exception 'customer_not_found' using errcode='P0002'; end if;
 if c.updated_at is distinct from p_expected_updated_at then raise exception 'customer_changed_reload' using errcode='40001'; end if;
 -- Primary contacts cannot be changed by the telephone editor, including legacy formats.
 if p_email is distinct from c.email or p_phone is distinct from c.phone then raise exception 'primary_contacts_readonly'; end if;
 if length(coalesce(p_first_name,''))>120 or length(coalesce(p_last_name,''))>120 then raise exception 'invalid_contact'; end if;
 if jsonb_typeof(p_emails) is distinct from 'array' or jsonb_typeof(p_phones) is distinct from 'array'
 or jsonb_array_length(p_emails)>10 or jsonb_array_length(p_phones)>10 then raise exception 'invalid_contact_count'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_emails) x where x=p_email)
 or exists(select 1 from jsonb_array_elements_text(p_phones) x where x=p_phone) then raise exception 'duplicate_primary_contact'; end if;
 if nullif(btrim(p_new_organization_name),'') is not null then
  if org_id is not null or length(btrim(p_new_organization_name))>200 then raise exception 'invalid_organization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||lower(btrim(p_new_organization_name)),0));
  select id into org_id from public.customer_organizations where organization_id=p_tenant_id and lower(btrim(name))=lower(btrim(p_new_organization_name)) order by id limit 1;
  if org_id is null then
   insert into public.customer_organizations(organization_id,name,auto_assign_enabled)
   values(p_tenant_id,btrim(p_new_organization_name),false) returning id into org_id;
  end if;
 end if;
 if org_id is not null and not exists(select 1 from public.customer_organizations where id=org_id and organization_id=p_tenant_id) then raise exception 'invalid_organization'; end if;
 insert into public.customer_manual_contact_fields(customer_id) values(c.id) on conflict(customer_id) do nothing;
 perform set_config('ops.customer_contact_edit_id',c.id::text,true);
 full_name:=nullif(btrim(concat_ws(' ',nullif(btrim(p_first_name),''),nullif(btrim(p_last_name),''))),'');
 update public.master_customers set first_name=nullif(btrim(p_first_name),''),last_name=nullif(btrim(p_last_name),''),
 name=full_name,email=p_email,phone=p_phone,customer_organization_id=org_id,
 billing_email=case when lower(btrim(billing_email))=lower(btrim(c.email)) then p_email else billing_email end,
 updated_at=clock_timestamp() where id=c.id;
 perform set_config('ops.customer_contact_edit_id','',true);
 delete from public.customer_contact_points where customer_id=c.id;
 insert into public.customer_contact_points(customer_id,kind,slot,value)
 select c.id,'email',ordinality::smallint,value from jsonb_array_elements_text(p_emails) with ordinality;
 insert into public.customer_contact_points(customer_id,kind,slot,value)
 select c.id,'phone',ordinality::smallint,value from jsonb_array_elements_text(p_phones) with ordinality;
 -- Mirror the edited numbers for existing telephone consumers.
 delete from public.voice_customer_phone_numbers where customer_id=c.id
 and phone not in (select jsonb_array_elements_text(p_phones));
 insert into public.voice_customer_phone_numbers(customer_id,phone,created_by)
 select c.id,value,p_actor from jsonb_array_elements_text(p_phones)
 on conflict(customer_id,phone) do nothing;
 -- Keep the same downstream contact fields as the existing Kundenakte.
 if c.email is distinct from p_email or c.name is distinct from full_name then
  update public.followup_queue set customer_email=p_email,customer_name=full_name
  where request_id in (select request_id from public.master_requests where customer_id=c.id);
 end if;
 if c.email is distinct from p_email then
  update public.lead_followup_plans set customer_email=p_email
  where request_id in (select request_id from public.master_requests where customer_id=c.id);
  update public.document_journey set customer_email=p_email where customer_id=c.id;
 end if;
 insert into public.workflow_audit_log(document_id,workflow_name,action,status,metadata)
 values(c.request_id,'OPS Kundeneditor','customer_contact_updated','success',
 jsonb_build_object('customer_id',c.id,'summary','Kontaktdaten in der Telefonzentrale aktualisiert',
 'additional_emails',jsonb_array_length(p_emails),'additional_phones',jsonb_array_length(p_phones)));
 return jsonb_build_object('customerId',c.id);
end $$;
revoke all on function public.save_voice_customer_v1(uuid,uuid,timestamptz,text,text,text,text,jsonb,jsonb,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_voice_customer_v1(uuid,uuid,timestamptz,text,text,text,text,jsonb,jsonb,uuid,text,uuid) to service_role;
