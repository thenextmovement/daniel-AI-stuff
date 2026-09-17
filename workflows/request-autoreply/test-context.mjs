import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const name=`neontrip-autoreply-test-${process.pid}`;
function docker(args,input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:10*1024*1024});
  if(r.status!==0) throw new Error(r.stderr || r.stdout || 'Docker test failed');
  return r.stdout;
}
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
try {
  docker(['run','--rm','-d','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']);
  let ready=false;
  for(let i=0;i<30;i++) {
    const r=spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{encoding:'utf8'});
    if(r.status===0) {ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready) throw new Error('Local PostgreSQL not ready');
  const domainSource=read('supabase/migrations/20260819123716_harden_request_segmentation_phase1.sql');
  const start=domainSource.indexOf('create or replace function public.neontrip_request_segmentation_domain_facts(');
  const end=domainSource.indexOf('drop function if exists',start);
  const sql=read('workflows/request-autoreply/sql-fixture.sql')
    +'\nalter table public.master_customers add column organization_id uuid;\n'
    +domainSource.slice(start,end)
    +read('supabase/migrations/20260917074500_extend_request_autoreply_company_context.sql')
    +read('workflows/request-autoreply/test-context.sql')
    +read('supabase/rollbacks/20260917074500_extend_request_autoreply_company_context_rollback.sql')
    +"\nselect public.get_request_autoreply_relationship_context('nobody@customer.test',null)->>'relationship_type' as rollback_relationship;\n";
  console.log(docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],sql).split('\n').filter(l=>/checks passed|new|ERROR/.test(l)).join('\n'));
} finally {spawnSync('docker',['stop',name],{encoding:'utf8'});}
