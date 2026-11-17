import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { directoryPhoneDigits, listVoiceDirectory, type VoiceDirectoryContact } from "./voice-directory";

type Call = {id:string;customer_id:string|null;request_id:string|null;phone:string;created_at:string};
type Placetel = {session_id:string;phone:string;dialed_at:string;voice_call_sessions:{
  bound_request_id:string|null;context_snapshot:{placetel_customer_id?:string}|null}};
export type RecentPhoneCall = {id:string;phone:string;time:string;contact:VoiceDirectoryContact|null};

export async function listRecentPhoneCalls():Promise<RecentPhoneCall[]> {
  const init={signal:AbortSignal.timeout(12000)};
  const [placetel,other]=await Promise.all([
    supabaseRequest<Placetel[]>("voice_placetel_calls",init,{
      select:"session_id,phone,dialed_at,voice_call_sessions!inner(bound_request_id,context_snapshot)",
      dialed_at:"not.is.null",dispatch_status:"neq.rejected",order:"dialed_at.desc,session_id.asc",limit:5,
    }),
    supabaseRequest<Call[]>("voice_phone_calls",init,{
      select:"id,customer_id,request_id,phone,created_at",or:"(customer_status_rank.gt.0,customer_joined.eq.true)",
      order:"created_at.desc,id.asc",limit:5,
    }),
  ]);
  const calls=[...other,...placetel.map(p=>({id:p.session_id,phone:p.phone,created_at:p.dialed_at,
    customer_id:p.voice_call_sessions.context_snapshot?.placetel_customer_id || null,
    request_id:p.voice_call_sessions.bound_request_id}))].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.id.localeCompare(b.id));
  const contacts=new Map<string,Promise<VoiceDirectoryContact|null>>();
  return Promise.all(calls.filter((c,i)=>calls.findIndex(x=>x.id===c.id)===i).slice(0,5).map(async c=>{
    const key=c.customer_id || c.phone;
    if (!contacts.has(key)) contacts.set(key,listVoiceDirectory(c.customer_id?"":c.phone,0,c.customer_id).then(page=>{
      if(c.customer_id) return page.results[0] || null;
      const matches=page.results.filter(r=>r.phone && directoryPhoneDigits(r.phone)===directoryPhoneDigits(c.phone));
      return !page.nextOffset && matches.length===1 ? matches[0] : null;
    }));
    const contact=await contacts.get(key);
    return {id:c.id,phone:c.phone,time:c.created_at,contact:contact ? {...contact,requestId:c.request_id || contact.requestId}:null};
  }));
}
