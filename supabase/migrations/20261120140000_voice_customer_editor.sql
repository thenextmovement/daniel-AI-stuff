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
 if p_email is null or p_email<>lower(btrim(p_email)) or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(coalesce(p_first_name,''))>120 or length(coalesce(p_last_name,''))>120
 or (p_phone is not null and p_phone !~ '^\+[1-9][0-9]{6,14}$') then raise exception 'invalid_contact'; end if;
 if jsonb_typeof(p_emails) is distinct from 'array' or jsonb_typeof(p_phones) is distinct from 'array'
 or jsonb_array_length(p_emails)>10 or jsonb_array_length(p_phones)>10 then raise exception 'invalid_contact_count'; end if;
 if exists(select 1 from public.master_customers where id<>c.id and lower(btrim(email))=p_email) then
  raise exception 'email_already_assigned' using errcode='23505';
 end if;
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

create or replace function public.voice_customer_order_members_v1(p_customer_id uuid,p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path='' set statement_timeout='8s' as $$
 with target as(select * from public.master_customers where id=p_customer_id and organization_id=p_tenant_id),
 members as(select c.id,c.email from public.master_customers c cross join target t
 where c.organization_id=p_tenant_id and (c.id=t.id or (t.customer_organization_id is not null and c.customer_organization_id=t.customer_organization_id))),
 emails as(
 select lower(btrim(email)) email from members
 union select p.value from public.customer_contact_points p join members m on m.id=p.customer_id where p.kind='email'
 union select p.email from public.customer_previous_primary_emails p join members m on m.id=p.customer_id where p.organization_id=p_tenant_id)
 select jsonb_build_object('explicit',t.customer_organization_id is not null,
 'manual',exists(select 1 from public.customer_manual_contact_fields f where f.customer_id=t.id and 'customer_organization_id'=any(f.fields)),
 'name',o.name,'emails',coalesce((select jsonb_agg(email order by email) from emails),'[]'::jsonb),
 'orderIds',coalesce((select jsonb_agg(l.shopify_order_id order by l.shopify_order_id) from public.shopify_order_customer_links l join members m on m.id=l.customer_id),'[]'::jsonb))
 from target t left join public.customer_organizations o on o.id=t.customer_organization_id and o.organization_id=p_tenant_id
 $$;
revoke all on function public.voice_customer_order_members_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.voice_customer_order_members_v1(uuid,uuid) to service_role;

create or replace function public.add_voice_customer_phone_v1(p_customer_id uuid,p_phone text,p_actor uuid)
returns void language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare c public.master_customers%rowtype; phones text[];
begin
 select * into c from public.master_customers where id=p_customer_id and organization_id='a0000000-0000-0000-0000-000000000001'::uuid for update;
 if not found then raise exception 'customer_not_found';end if;
 if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'invalid_phone';end if;
 if p_phone=c.phone then return;end if;
 select array_agg(phone order by phone) into phones from(
 select value as phone from public.customer_contact_points where customer_id=c.id and kind='phone'
 union select phone from public.voice_customer_phone_numbers where customer_id=c.id
 union select p_phone) u;
 if cardinality(phones)>10 then raise exception 'contact_limit_reached';end if;
 delete from public.customer_contact_points where customer_id=c.id and kind='phone';
 insert into public.customer_contact_points(customer_id,kind,slot,value)
 select c.id,'phone',ordinality::smallint,value from unnest(phones) with ordinality as p(value,ordinality);
 insert into public.voice_customer_phone_numbers(customer_id,phone,created_by)
 values(c.id,p_phone,p_actor) on conflict(customer_id,phone) do nothing;
 update public.master_customers set updated_at=clock_timestamp() where id=c.id;
end $$;
revoke all on function public.add_voice_customer_phone_v1(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.add_voice_customer_phone_v1(uuid,text,uuid) to service_role;
