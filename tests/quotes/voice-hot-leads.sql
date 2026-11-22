-- Run only in an empty isolated test database.
create role anon;create role authenticated;create role service_role;
create table master_customers(id uuid primary key);
create table master_requests(id uuid primary key,customer_id uuid,request_id text,trello_card_id text,title text,created_at timestamptz,status text,deal_status text,final_value numeric,estimated_value numeric);
create table voice_customer_directory(id uuid,name text,company text,company_name text,email text,phone text,additional_phones text[]);
create table sales_call_results(request_id text,created_at timestamptz,call_done text,superseded_at timestamptz);
create table master_orders(request_id uuid,cancelled_at timestamptz);
create table customer_case_state(request_id text,state text);
create table sales_call_cadence_state(request_id text,blocked boolean,pending_callback_at timestamptz);
create table lead_followup_plans(request_id text,contactability_status text);
create table followup_blacklist(email text,domain text,expires_at timestamptz);
create table voice_call_sessions(id uuid,bound_request_id text,context_snapshot jsonb);
create table voice_placetel_calls(session_id uuid,provider_ended_at timestamptz);
create table ops_offer_events(request_id text,offer_id text);
\i /tmp/hot-leads.sql
insert into master_customers values('11111111-1111-4111-8111-111111111111');
insert into master_requests(id,customer_id,created_at) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',now());
do $$
declare s public.voice_hot_lead_state;
begin
 s:=save_voice_hot_lead('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','ignored',now(),null,0);
 assert s.revision=1 and s.status='ignored';
 s:=save_voice_hot_lead(s.request_id,s.customer_id,'scheduled',s.source_at,current_date+1,1);
 assert s.revision=2 and s.due_date=current_date+1;
 begin
  perform save_voice_hot_lead(s.request_id,s.customer_id,'ignored',s.source_at,null,1);
  raise exception 'stale write accepted';
 exception when raise_exception then
  if sqlerrm<>'hot_lead_revision_conflict' then raise; end if;
 end;
 begin
  perform save_voice_hot_lead(s.request_id,'33333333-3333-4333-8333-333333333333','ignored',s.source_at,null,2);
  raise exception 'wrong customer accepted';
 exception when raise_exception then
  if sqlerrm<>'hot_lead_customer_mismatch' then raise; end if;
 end;
 assert not has_function_privilege('anon','save_voice_hot_lead(uuid,uuid,text,timestamptz,date,integer)','execute');
 assert not has_table_privilege('authenticated','voice_hot_lead_state','select');
 assert (select count(*) from sales_call_results)=0;
 assert (select count(*) from sales_call_cadence_state)=0;
end $$;
select status,due_date,revision from voice_hot_lead_state;
