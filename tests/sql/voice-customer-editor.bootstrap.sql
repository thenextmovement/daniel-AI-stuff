
alter table master_customers add first_name text,add last_name text,add name text,add billing_email text,add request_id text,add updated_at timestamptz default now();
alter table customer_organizations alter id set default gen_random_uuid();
alter table customer_organizations add auto_assign_enabled boolean default true;
create table voice_staff(id uuid primary key);
create table voice_customer_phone_numbers(customer_id uuid references master_customers,phone text,created_by uuid not null references voice_staff,created_at timestamptz default now(),primary key(customer_id,phone));
create table master_requests(id uuid default gen_random_uuid(),request_id text,customer_id uuid references master_customers);
create table followup_queue(request_id text,customer_email text,customer_name text);
create table lead_followup_plans(request_id text,customer_email text);
create table document_journey(customer_id uuid,customer_email text);
create table workflow_audit_log(document_id text,workflow_name text,action text,status text,metadata jsonb);

alter table master_customers add cc_emails text[],add company text,add company_name text;

-- Existing production trigger contracts, retained alongside the new guard.
create function public.update_updated_at() returns trigger language plpgsql as $$ begin NEW.updated_at=now();return NEW;end $$;
create function public.set_default_organization_id() returns trigger language plpgsql as $$ begin if NEW.organization_id is null then NEW.organization_id:='a0000000-0000-0000-0000-000000000001';end if;return NEW;end $$;
create function public.auto_populate_customer_name() returns trigger language plpgsql as $$
declare computed_name text;
begin
 computed_name:=trim(coalesce(NEW.first_name,'')||' '||coalesce(NEW.last_name,''));
 if computed_name<>'' and (NEW.name is null or (TG_OP='UPDATE' and (OLD.first_name is distinct from NEW.first_name or OLD.last_name is distinct from NEW.last_name))) then NEW.name:=computed_name;end if;
 return NEW;
end $$;
create trigger customers_updated_at before update on master_customers for each row execute function update_updated_at();
create trigger trg_master_customers_auto_name before insert or update on master_customers for each row execute function auto_populate_customer_name();
create trigger trg_master_customers_set_org before insert on master_customers for each row execute function set_default_organization_id();
