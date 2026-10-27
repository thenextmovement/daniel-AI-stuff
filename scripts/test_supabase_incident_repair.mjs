import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const name='neontrip-supabase-repair-'+process.pid;
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function docker(args,input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:10*1024*1024});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||'Docker test failed');
  return r.stdout;
}
try {
  docker(['run','--rm','-d','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
  let ready=false;
  for(let i=0;i<60;i++) {
    if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{encoding:'utf8'}).status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready) throw new Error('Isolated PostgreSQL not ready');
  const domain=read('supabase/migrations/20260819123716_harden_request_segmentation_phase1.sql');
  const start=domain.indexOf('create or replace function public.neontrip_request_segmentation_domain_facts(');
  const end=domain.indexOf('drop function if exists',start);
  const base=read('workflows/request-autoreply/sql-fixture.sql')
    +'\nalter table public.master_customers add column organization_id uuid;\n'
    +domain.slice(start,end)
    +read('supabase/migrations/20260917074500_extend_request_autoreply_company_context.sql')
    +read('workflows/request-autoreply/test-context.sql');
  const comparison=`
reset role;
create temporary table expected as
select c.email, r.request_id, public.get_request_autoreply_relationship_context(c.email,r.request_id) value
from public.master_customers c left join public.master_requests r on r.customer_id=c.id
union all
select c.email, null, public.get_request_autoreply_relationship_context(c.email,null) from public.master_customers c;
create table public.supplier_sale_events (
 id uuid primary key default gen_random_uuid(),event_type text not null,idempotency_key text unique,
 constraint supplier_sale_events_type_check check(event_type='manual_note')
);
`;
  const checks=`
do $check$ declare n integer; begin
 if exists(select 1 from expected e where e.value is distinct from public.get_request_autoreply_relationship_context(e.email,e.request_id))
 then raise exception 'autoreply result changed'; end if;
 insert into public.supplier_sale_events(event_type,idempotency_key)
 select t,t from unnest(array[
 'source_trello_order_title_synced','source_trello_order_title_sync_failed','supplier_trello_card_relinked',
 'supplier_trello_description_confirmed','supplier_approved_design_confirmed','post_order_change_acknowledged','shopify_tag_retry'
 ]) t;
 with inserted as (
   insert into public.supplier_sale_events(event_type,idempotency_key) values('manual_note','reserved')
   on conflict(idempotency_key) do nothing returning id
 ) select count(*) into n from inserted;
 if n<>1 then raise exception 'new reservation missing'; end if;
 with inserted as (
   insert into public.supplier_sale_events(event_type,idempotency_key) values('manual_note','reserved')
   on conflict(idempotency_key) do nothing returning id
 ) select count(*) into n from inserted;
 if n<>0 then raise exception 'duplicate acquired reservation'; end if;
 begin
   insert into public.supplier_sale_events(event_type,idempotency_key) values('unrecognized_event','invalid');
   raise exception 'unknown event accepted';
 exception when check_violation then null; end;
 if has_function_privilege('anon','public.get_request_autoreply_relationship_context(text,text)','EXECUTE')
 then raise exception 'lookup grants changed'; end if;
 raise notice 'incident checks passed: % equivalent context cases, event contract, reservation replay', (select count(*) from expected);
end $check$;
`;
  const migration=read('supabase/migrations/20261027123707_repair_supabase_incident_queries_events.sql');
  const rollback=read('supabase/rollbacks/20261027123707_repair_supabase_incident_queries_events_rollback.sql');
  const verifyRollback=`
do $$ begin
 if exists(select 1 from expected e where e.value is distinct from public.get_request_autoreply_relationship_context(e.email,e.request_id))
 then raise exception 'rollback result changed'; end if;
 if (select count(*) from supplier_sale_events)<>8 then raise exception 'rollback lost audit history'; end if;
end $$;
`;
  console.log(docker(['exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'],base+comparison+migration+checks+rollback+verifyRollback));
} finally {
  spawnSync('docker',['stop',name],{encoding:'utf8'});
}
