import { mkdir,open,readFile,rename,unlink,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTrelloClient } from '../src/lib/ops/arrival-labels/clients';
import { supabaseRequest,supabaseRpc } from '../src/lib/quotes/supabase-rest';
import { fetchDhlUnified,planDhlChecks,type DhlShipmentLink } from '../src/lib/ops/dhl-unified';
import { runDhlPollBatch,type PollState } from '../src/lib/ops/dhl-polling';

export async function main(args=process.argv.slice(2)) {
  const mode=args[0]||'plan';
  if(args.length>1||!['plan','check','sync'].includes(mode)) throw new Error('leo_mode_invalid');
  if(mode==='sync'&&process.env.LEO_DHL_SYNC_ENABLED!=='true') throw new Error('leo_sync_not_enabled');
  if(mode!=='plan'&&!process.env.DHL_API_KEY?.trim()) throw new Error('dhl_api_key_missing');
  const cards=await createTrelloClient().listQuentinCards();
  const shipments:DhlShipmentLink[]=[];
  // Pagination prevents silently losing historical mappings at the API row limit.
  for(let offset=0;;offset+=500) {
    const rows=await supabaseRequest<DhlShipmentLink[]>('inbound_shipments',undefined,{select:'id,tracking_number,trello_card_id',carrier:'eq.dhl',order:'id.asc',limit:500,offset});
    shipments.push(...rows);if(rows.length<500) break;if(offset>=49500) throw new Error('leo_mapping_scan_truncated');
  }
  const plan=planDhlChecks(cards,shipments);
  if(mode==='plan') return {mode,candidateCount:plan.candidates.length,candidates:plan.candidates.map(c=>({tracking:c.trackingNumber,trelloUrl:c.card.url,registered:!!c.shipmentId})),issues:plan.issues};
  // One persistent state directory on one designated server; never a replicated/local laptop job.
  if(!process.env.LEO_DHL_STATE_DIR||!path.isAbsolute(process.env.LEO_DHL_STATE_DIR)) throw new Error('leo_state_dir_missing');
  const dir=process.env.LEO_DHL_STATE_DIR;
  await mkdir(dir,{recursive:true,mode:0o700});
  const lock=path.join(dir,'poll.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw new Error('leo_worker_locked');});
  try {
    const statePath=path.join(dir,'state.json');
    let state:PollState;
    try {state=JSON.parse(await readFile(statePath,'utf8'));}
    catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw new Error('leo_state_invalid');state={attempts:[]};}
    if(!Array.isArray(state.attempts)||state.attempts.some(a=>!Number.isFinite(a.at)||typeof a.tracking!=='string'||typeof a.slot!=='string'||!['reserved','checked','synced','failed','record_uncertain'].includes(a.status))) throw new Error('leo_state_invalid');
    const save=async(value:PollState)=>{await writeFile(statePath+'.tmp',JSON.stringify(value),{mode:0o600});await rename(statePath+'.tmp',statePath);};
    const result=await runDhlPollBatch(plan.candidates,state,{
      now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),save,
      fetch:number=>fetchDhlUnified(number,process.env.DHL_API_KEY!),
      record:async(value)=>{
        const payload=value as {trackingNumber:string};
        // Recheck all current card identities immediately before a persisted carrier result.
        const fresh=planDhlChecks(await createTrelloClient().listQuentinCards(),shipments);
        const current=fresh.candidates.find(c=>c.trackingNumber===payload.trackingNumber);
        const original=plan.candidates.find(c=>c.trackingNumber===payload.trackingNumber);
        if(!current||current.card.id!==original?.card.id) throw new Error('leo_trello_changed');
        const c=current.card;
        await supabaseRpc('inbound_record_dhl_unified_response',{p_payload:{...payload,trelloBoardId:c.boardId,trelloCardId:c.id,trelloCardName:c.name,trelloCardUrl:c.url,trelloListId:c.listId,trelloListName:c.listName}});
      },
    },mode==='sync');
    const report={mode,at:new Date().toISOString(),...result,issues:[...plan.issues,...result.issues]};
    await writeFile(path.join(dir,'latest-report.json'),JSON.stringify(report,null,2),{mode:0o600});
    return report;
  } finally {await handle.close();await unlink(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main().then(r=>{
  process.stdout.write(JSON.stringify(r)+'\n');if(r.issues.length) process.exitCode=2;
}).catch(error=>{
  // Never print upstream HTTP bodies, URLs containing credentials, or environment values.
  const code=error instanceof Error&&/^(leo|dhl)_[a-z0-9_]+$/.test(error.message)?error.message:'leo_tracking_failed';
  process.stderr.write(code+'\n');process.exitCode=1;
});
