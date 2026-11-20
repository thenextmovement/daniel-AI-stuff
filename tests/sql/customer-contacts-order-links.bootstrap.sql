create role anon; create role authenticated; create role service_role bypassrls;
create table master_customers(id uuid primary key,email text not null unique,phone text,organization_id uuid,customer_organization_id uuid);
create table customer_organizations(id uuid primary key,organization_id uuid not null,name text not null);
create table shopify_orders(shopify_order_id text primary key,email text,kunde_email text,tags text,is_test boolean,name text,created_at timestamptz,currency text,current_total_price numeric,cancelled_at timestamptz);
grant all on master_customers,customer_organizations,shopify_orders to service_role;
