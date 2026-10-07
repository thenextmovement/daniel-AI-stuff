import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../scripts/run_leo_dhl_tracking';

async function scenario(mode:string,options:{lock?:boolean;changeCard?:boolean;invalidState?:boolean}={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'leo-dhl-test-'));
  const keys=['LEO_DHL_STATE_DIR','LEO_DHL_SYNC_ENABLED','DHL_API_KEY','TRELLO_API_KEY','TRELLO_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ARRIVAL_LABEL_TRELLO_BOARD_ID'] as const;
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const fetchOriginal=globalThis.fetch;
  Object.assign(process.env,{LEO_DHL_STATE_DIR:dir,LEO_DHL_SYNC_ENABLED:'true',DHL_API_KEY:'test-only',TRELLO_API_KEY:'test-only',TRELLO_TOKEN:'test-only',SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',ARRIVAL_LABEL_TRELLO_BOARD_ID:'62bae9b97705e7419ed64593'});
  const calls:string[]=[],rpc:unknown[]=[];let cardReads=0;
  const nowOriginal=Date.now;Date.now=()=>Date.parse('2026-10-07T07:30:00Z');
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input));calls.push(u.hostname+u.pathname);
    if(u.hostname==='api.trello.com') {
      if(u.pathname.endsWith('/cards')) {cardReads++;return Response.json([{id:'111111111111111111111111',name:'#NEONT123',url:'https://trello.com/c/abcd1234',idBoard:'62bae9b97705e7419ed64593',idList:'69ff17bfab2afaaf96f7033a',closed:false,customFieldItems:[{idCustomField:'tracking',value:{text:options.changeCard&&cardReads>1?'DHL 9912345678':'DHL 0012345678'}}]}]);}
      if(u.pathname.endsWith('/lists')) return Response.json([{id:'69ff17bfab2afaaf96f7033a',name:'Prepare Shipping'}]);
      if(u.pathname.endsWith('/customFields')) return Response.json([{id:'tracking',name:'Tracking number'}]);
    }
    if(u.hostname==='db.example.invalid') {
      if(u.pathname.endsWith('/inbound_shipments')) return Response.json([]);
      if(u.pathname.endsWith('/inbound_record_dhl_unified_response')) {rpc.push(JSON.parse(String(init?.body)));return Response.json({});}
    }
    if(u.hostname==='api-eu.dhl.com') return Response.json({shipments:[{id:'0012345678',service:'express',events:[{timestamp:'2026-10-07T07:00:00Z',description:'Shipment information received',statusCode:'pre-transit',location:{address:{countryCode:'CN',addressLocality:'SHENZHEN'}}}]}]});
    throw new Error('unexpected external call');
  };
  try {
    if(options.lock) await writeFile(path.join(dir,'poll.lock'),'');
    if(options.invalidState) await writeFile(path.join(dir,'state.json'),'{}');
    const result=await main([mode]);
    return {result,calls,rpc,state:mode==='plan'?null:JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'))};
  } finally {Date.now=nowOriginal;globalThis.fetch=fetchOriginal;for(const k of keys) {if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await rm(dir,{recursive:true,force:true});}
}
test('CLI plan reads source data without DHL calls or database writes',async()=>{
  const r=await scenario('plan');assert.ok('candidateCount' in r.result);assert.equal(r.result.candidateCount,1);assert.equal(r.rpc.length,0);assert.equal(r.calls.some(x=>x.startsWith('api-eu.dhl.com')),false);
});
test('CLI check records private quota state without business writes',async()=>{
  const r=await scenario('check');assert.ok('checked' in r.result);assert.equal(r.result.checked,1);assert.equal(r.rpc.length,0);assert.equal(r.state.attempts[0].status,'checked');
});
test('CLI sync rechecks Trello and supplies exact identity to transactional ingest',async()=>{
  const r=await scenario('sync');assert.ok('synced' in r.result);assert.equal(r.result.synced,1);assert.equal(r.rpc.length,1);assert.equal((r.rpc[0] as any).p_payload.trelloCardId,'111111111111111111111111');
});
test('CLI blocks changed Trello identity before any business write',async()=>{
  const r=await scenario('sync',{changeCard:true});assert.equal(r.rpc.length,0);assert.equal(r.state.attempts[0].status,'record_uncertain');
});
test('CLI refuses existing lock and malformed state',async()=>{
  await assert.rejects(()=>scenario('check',{lock:true}),/leo_worker_locked/);
  await assert.rejects(()=>scenario('check',{invalidState:true}),/leo_state_invalid/);
});
