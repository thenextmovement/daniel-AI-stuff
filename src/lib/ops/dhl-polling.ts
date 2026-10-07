import { berlinPollSlot, type DhlCandidate, type DhlIssue } from './dhl-unified';

export type PollAttempt={tracking:string;slot:string;at:number;status:'reserved'|'checked'|'synced'|'failed'|'record_uncertain';code?:string};
export type PollState={attempts:PollAttempt[]};
type Ports={now:()=>number;sleep:(ms:number)=>Promise<void>;save:(state:PollState)=>Promise<void>;fetch:(tracking:string)=>Promise<unknown>;record:(payload:unknown)=>Promise<void>};

// Single designated worker; caller must hold the exclusive filesystem lock throughout.
// Reserve quota before HTTP and do not retry uncertain writes. The 225 rolling-day cap
// leaves capacity for controlled connection tests within DHL's initial 250/day allowance.
export async function runDhlPollBatch(candidates:DhlCandidate[],state:PollState,ports:Ports,sync:boolean) {
  const now=ports.now(),slot=berlinPollSlot(now),issues:DhlIssue[]=[];
  if(!slot) return {checked:0,synced:0,issues};
  const unique=[...new Map(candidates.map(c=>[c.trackingNumber,c])).values()];
  const due=unique.filter(c=>{
    const previous=state.attempts.find(a=>a.tracking===c.trackingNumber&&a.slot===slot);
    if(previous&&['reserved','record_uncertain'].includes(previous.status)) issues.push({code:'previous_poll_incomplete',trelloUrl:c.card.url});
    return !previous;
  });
  const recent=state.attempts.filter(a=>a.at>now-86400000);
  if(recent.length+due.length>225) return {checked:0,synced:0,issues:[...issues,{code:'dhl_budget_insufficient',trelloUrl:''}]};
  let checked=0,synced=0;
  for(const candidate of due) {
    const last=Math.max(0,...state.attempts.map(a=>a.at));
    await ports.sleep(Math.max(5100,last+5100-ports.now()));
    const attempt:PollAttempt={tracking:candidate.trackingNumber,slot,at:ports.now(),status:'reserved'};
    state.attempts.push(attempt);await ports.save(state);
    let payload:unknown;
    try {payload=await ports.fetch(candidate.trackingNumber);checked++;}
    catch(error) {
      const message=error instanceof Error?error.message:'';
      const code=/^dhl_[a-z0-9_]+$/.test(message)?message:'dhl_unknown_error';
      attempt.status='failed';attempt.code=code;issues.push({code,trelloUrl:candidate.card.url});
      if(sync) {
        try {await ports.record({shipmentId:candidate.shipmentId,trackingNumber:candidate.trackingNumber,trelloCardId:candidate.card.id,trackingError:code});}
        catch {attempt.status='record_uncertain';issues.push({code:'dhl_record_uncertain',trelloUrl:candidate.card.url});}
      }
      await ports.save(state);
      // Auth, quota and provider outage affect the entire batch; no rapid retry storm.
      if(/http_(401|403|429|5\d\d)|network/.test(code)||attempt.status==='record_uncertain') break;
      continue;
    }
    if(sync) {
      try {await ports.record({...payload as object,shipmentId:candidate.shipmentId,trelloCardId:candidate.card.id});synced++;attempt.status='synced';}
      catch {attempt.status='record_uncertain';issues.push({code:'dhl_record_uncertain',trelloUrl:candidate.card.url});await ports.save(state);break;}
    } else attempt.status='checked';
    await ports.save(state);
  }
  return {checked,synced,issues};
}
