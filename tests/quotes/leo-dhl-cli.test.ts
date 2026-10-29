import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../scripts/run_leo_dhl_tracking';

async function scenario(mode:string,options:{lock?:boolean;changeCard?:boolean;invalidState?:boolean;completed?:boolean;pendingExtra?:boolean;caseSecondPage?:boolean;replacement?:boolean;historyFailures?:number;rpcFailure?:boolean;historyHttp?:number;terminal?:boolean;changeMode?:boolean}={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'leo-dhl-test-'));
  const keys=['LEO_DHL_STATE_DIR','LEO_DHL_SYNC_ENABLED','DHL_API_KEY','TRELLO_API_KEY','TRELLO_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ARRIVAL_LABEL_TRELLO_BOARD_ID'] as const;
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const fetchOriginal=globalThis.fetch;
  Object.assign(process.env,{LEO_DHL_STATE_DIR:dir,LEO_DHL_SYNC_ENABLED:'true',DHL_API_KEY:'test-only',TRELLO_API_KEY:'test-only',TRELLO_TOKEN:'test-only',SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',ARRIVAL_LABEL_TRELLO_BOARD_ID:'62bae9b97705e7419ed64593'});
  const calls:string[]=[],rpc:unknown[]=[];let cardReads=0,historyFailures=0;
  const nowOriginal=Date.now;Date.now=()=>Date.parse('2026-10-07T07:30:00Z');
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input));calls.push(u.hostname+u.pathname);
    if(u.hostname==='api.trello.com') {
      if(u.pathname.endsWith('/cards')) {cardReads++;return Response.json([{id:'111111111111111111111111',name:'#NEONT123',url:'https://trello.com/c/abcd1234',idBoard:'62bae9b97705e7419ed64593',idList:(options.terminal!==Boolean(options.changeMode&&cardReads>1))&&Boolean(options.terminal||options.changeMode)?'646c788ae63245624b6d6a7a':options.replacement?'6347e0a2f062500084675062':'69ff17bfab2afaaf96f7033a',closed:false,customFieldItems:[{idCustomField:'tracking',value:{text:options.changeCard&&cardReads>1?'DHL 9912345678':options.replacement?'DHL 1123456789 / 0012345678':'DHL 0012345678'}}]}]);}
      if(u.pathname.endsWith('/actions')) {
        if(cardReads>1&&options.historyHttp) return new Response('',{status:options.historyHttp});
        if(cardReads>1&&historyFailures++<(options.historyFailures||0)) return {ok:true,json:async()=>{throw new DOMException('private-token','TimeoutError');}} as unknown as Response;
        return Response.json([
        {id:'333333333333333333333333',date:'2026-10-06T10:00:00Z',type:'updateCustomFieldItem',data:{card:{id:'111111111111111111111111'},customField:{id:'tracking'},old:{value:{text:'1123456789'}},customFieldItem:{value:{text:'1123456789 / 0012345678'}}}},
        {id:'222222222222222222222222',date:'2026-10-05T10:00:00Z',type:'updateCard',data:{card:{id:'111111111111111111111111'},listAfter:{id:'646c788ae63245624b6d6a7a'}}},
        {id:'444444444444444444444444',date:'2026-10-04T10:00:00Z',type:'updateCustomFieldItem',data:{card:{id:'111111111111111111111111'},customField:{id:'tracking'},old:{value:{text:''}},customFieldItem:{value:{text:'1123456789'}}}},
      ]);}
      if(u.pathname.endsWith('/lists')) return Response.json([{id:'69ff17bfab2afaaf96f7033a',name:'Prepare Shipping'}]);
      if(u.pathname.endsWith('/customFields')) return Response.json([{id:'tracking',name:'Tracking number'}]);
    }
    if(u.hostname==='db.example.invalid') {
      if(u.pathname.endsWith('/inbound_shipments')) return Response.json(options.terminal||options.changeMode?[{id:'shipment',tracking_number:'0012345678',trello_card_id:'111111111111111111111111',status:'in_transit',tracking_provider:'dhl-unified'}]:options.completed?[{
        id:'shipment',tracking_number:'0012345678',trello_card_id:'111111111111111111111111',
        status:'delivered',status_reason:null,delivered_at:'2026-10-06T07:00:00Z',last_checked_at:'2026-10-06T08:00:00Z',
        tracking_provider:'dhl-unified',response_provider:'dhl-unified',response_id:'0012345678',response_service:'express',
      }]:[]);
      if(u.pathname.endsWith('/arrival_label_cases')) {
        assert.equal(u.searchParams.get('incoming_dhl_tracking_number'),'in.(0012345678)');
        if(options.caseSecondPage&&u.searchParams.get('offset')==='0') return Response.json(Array.from({length:500},()=>({incoming_dhl_tracking_number:'9912345678',status:'completed'})));
        return Response.json(options.completed?[{incoming_dhl_tracking_number:'0012345678',trello_card_id:'111111111111111111111111',
          status:'completed',manual_review_reason:null,delivery_note_required:false,delivery_note_status:'not_required',
          purchase_jobs:[{status:'completed'}],print_jobs:[{status:'printed'},...(options.pendingExtra?[{status:'queued'}]:[])],
        }]:[]);
      }
      if(u.pathname.endsWith('/inbound_reconcile_dhl_terminal')) {rpc.push(JSON.parse(String(init?.body)));return Response.json({updated:false});}
      if(u.pathname.endsWith('/inbound_record_dhl_unified_response')) {rpc.push(JSON.parse(String(init?.body)));if(options.rpcFailure)throw new TypeError('private-token');return Response.json({});}
    }
    if(u.hostname==='api-eu.dhl.com') return Response.json({shipments:[{id:'0012345678',service:'express',events:[{timestamp:'2026-10-07T07:00:00Z',description:'Shipment information received',statusCode:'pre-transit',location:{address:{countryCode:'CN',addressLocality:'SHENZHEN'}}}]}]});
    throw new Error('unexpected external call');
  };
  try {
    if(options.lock) await writeFile(path.join(dir,'poll.lock'),'');
    if(options.invalidState) await writeFile(path.join(dir,'state.json'),'{}');
    const result=await main([mode]);
    return {result,calls,rpc,state:mode==='plan'?null:JSON.parse(await readFile(path.join(dir,'state.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;}))};
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
test('CLI sends freshly rechecked replacement evidence to the real ingestion boundary',async()=>{
  const r=await scenario('sync',{replacement:true});
  assert.ok('synced' in r.result);assert.equal(r.result.synced,1);
  const p=(r.rpc[0] as any).p_payload;
  assert.equal(p.trelloListId,'6347e0a2f062500084675062');
  assert.deepEqual(p.replacementRound,{previousTrackingNumbers:['1123456789'],trackingNumbers:['0012345678'],
    previousArrivedAt:'2026-10-05T10:00:00Z',arrivalActionId:'222222222222222222222222',addedAt:'2026-10-06T10:00:00Z',trackingActionId:'333333333333333333333333'});
});
test('CLI blocks changed Trello identity before any business write',async()=>{
  const r=await scenario('sync',{changeCard:true});assert.equal(r.rpc.length,0);assert.equal(r.state.attempts[0].status,'failed');assert.equal(r.state.attempts[0].recordPhase,'prewrite');assert.equal(r.state.attempts[0].code,'replacement_tracking_changed');
});
test('CLI refuses existing lock and malformed state',async()=>{
  await assert.rejects(()=>scenario('check',{lock:true}),/leo_worker_locked/);
  await assert.rejects(()=>scenario('check',{invalidState:true}),/leo_state_invalid/);
});


test('CLI omits completed delivered work without DHL calls or quota reservations',async()=>{
  const r=await scenario('check',{completed:true,caseSecondPage:true});
  assert.equal(r.result.candidateCount,0);assert.equal(r.result.completedCount,1);assert.equal(r.state,null);
  assert.equal(r.rpc.length,0);assert.equal(r.calls.some(x=>x.startsWith('api-eu.dhl.com')),false);
  assert.equal(r.calls.filter(x=>x.endsWith('/arrival_label_cases')).length,2);
});

test('CLI keeps delivered cases with pending extra printing eligible',async()=>{
  const r=await scenario('plan',{completed:true,pendingExtra:true});
  assert.equal(r.result.candidateCount,1);assert.equal(r.result.completedCount,0);
  assert.equal(r.rpc.length,0);
});

for(const count of [1,3]) test(`CLI history body failure recovers or fails before POST (${count})`,async()=>{
  const r=await scenario('sync',{replacement:true,historyFailures:count});
  assert.equal(r.rpc.length,count===1?1:0);
  assert.equal(r.state.attempts[0].status,count===1?'synced':'failed');
  assert.equal(r.calls.filter(c=>c.endsWith('/actions')).length,count===1?3:4);
  if(count===3) {
    assert.equal(r.state.attempts[0].code,'tracking_history_unavailable');
    assert.equal(r.state.attempts[0].recordPhase,'prewrite');
    assert.equal(r.state.attempts[0].recordError,'TimeoutError');
  }
  assert.doesNotMatch(JSON.stringify(r),/private-token/);
});
test('CLI submitted RPC transport error stays uncertain and never retries POST',async()=>{
  const r=await scenario('sync',{rpcFailure:true});assert.equal(r.rpc.length,1);
  assert.equal(r.state.attempts[0].status,'record_uncertain');assert.equal(r.state.attempts[0].recordPhase,'record');
  assert.equal(r.state.attempts[0].recordError,'TypeError');assert.doesNotMatch(JSON.stringify(r),/private-token/);
});

for(const status of [401,403,429]) test(`CLI history HTTP ${status} is a board prewrite failure`,async()=>{
  const r=await scenario('sync',{replacement:true,historyHttp:status});
  assert.equal(r.rpc.length,0);assert.equal(r.state.attempts[0].status,'failed');
  assert.equal(r.state.attempts[0].recordError,`http_${status}`);
  assert.equal(r.state.attempts[0].recordPhase,'prewrite');
  assert.equal(r.calls.filter(c=>c.endsWith('/actions')).length,status===429?4:2);
});

test('terminal mirror mode uses only narrow RPC and counts nonterminal response as checked',async()=>{
 const r=await scenario('sync',{terminal:true});assert.equal(r.rpc.length,1);
 assert.ok(r.calls.some(c=>c.endsWith('/inbound_reconcile_dhl_terminal')));
 assert.equal(r.calls.some(c=>c.endsWith('/inbound_record_dhl_unified_response')),false);
 assert.equal(r.state.attempts[0].status,'checked');
});
test('list changes cannot cross the terminal-only versus general ingest boundary',async()=>{
 for(const terminal of [true,false]) {
  const r=await scenario('sync',{terminal,changeMode:true});
  assert.equal(r.rpc.length,0);assert.equal(r.state.attempts[0].status,'failed');
  assert.equal(r.state.attempts[0].recordPhase,'prewrite');
 }
});
