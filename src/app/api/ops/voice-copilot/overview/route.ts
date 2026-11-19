import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { getVoiceOpenAiApiKey } from "@/lib/ops/voice-openai-config";
import { currentEmailReply } from "@/lib/ops/voice-email-reply";
import { extractOpenAiResponseText } from "@/lib/ops/voice-copilot";

export const dynamic = "force-dynamic";

const cache = new Map<string, Promise<string>>();
async function synthesize(input: string,instructions:string) {
  const model = "gpt-4.1-mini";
  const key = getVoiceOpenAiApiKey();
  if (!model || !key) throw new Error("overview_unavailable");
  let response: Response | undefined;
  for (let attempt=0;attempt<2;attempt++) {
  try { response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST", signal:AbortSignal.timeout(20000),
    headers: {authorization:"Bearer "+key,"content-type":"application/json"},
    body:JSON.stringify({model,store:false,input,instructions,max_output_tokens:900}),
  });
  } catch(error) {if(attempt===0) continue;throw error;}
  if(response.ok || ![429,500,502,503,504].includes(response.status) || attempt===1) break;
  await new Promise(resolve=>setTimeout(resolve,500));
  }
  if (!response?.ok) throw new Error("overview_ai_failed");
  const result = await response.json();
  const summary = extractOpenAiResponseText(result).trim();
  if (!summary || result.status !== "completed") throw new Error("overview_incomplete");
  return summary;
}
async function count(table:string, filters:Record<string,string>) {
  let total: number | null = null;
  await supabaseRequest(table,{method:"HEAD",headers:{Prefer:"count=exact"},signal:AbortSignal.timeout(12000)},
    {...filters,select:"id",limit:1},headers=>{
      const value=headers.get("content-range")?.split("/")[1];
      if (value && /^\d+$/.test(value)) total=Number(value);
    });
  return total;
}
type BriefInput={customerId:string;capturedAt:string;sources:{kommunikation?:Array<{kind:string;detail:string|null}>};hash:string;savedHash:string|null;previousSummary:string|null;updatedAt:string|null;instructions:string};
export async function GET(request:NextRequest) {
  const auth=await authorizeVoiceCopilotApi(request);
  if (auth) return auth;
  let stage="parameters";
  try {
    const params=request.nextUrl.searchParams;
    const id=requireVoiceUuid(params.get("customerId"),"Kunde");
    const ref=params.get("requestId") || "";
    const customer={customer_id:"eq."+id};
    const persisted=async()=> (await supabaseRequest<Array<{summary:string;source_hash:string;updated_at:string}>>("voice_customer_briefs",
      {signal:AbortSignal.timeout(4000)},{...customer,request_id:"eq.",select:"summary,source_hash,updated_at",limit:1}))[0];
    if(params.get("part")==="latest") {
      const latest=await supabaseRpc("voice_latest_customer_call",{p_customer:id});
      return NextResponse.json({latest},{headers:{"cache-control":"no-store"}});
    }
    if(params.get("part")==="cached") {
      const saved=await persisted();
      return NextResponse.json({summary:saved?.summary??null,updatedAt:saved?.updated_at??null},{headers:{"cache-control":"no-store"}});
    }
    if (params.get("part")==="counts") {
      const [email,phone,notes]=await Promise.all([
        count("voice_customer_events",{...customer,kind:"in.(inbound,outbound)"}).catch(()=>null),
        count("voice_customer_events",{...customer,kind:"in.(call,transcript)"}).catch(()=>null),
        ref ? count("workflow_audit_log",{document_id:"eq."+ref,workflow_name:"eq.customer_records_console",action:"eq.customer_record_note","metadata->>note_kind":"eq.note"}).catch(()=>null) : 0,
      ]);
      return NextResponse.json({email,phone,notes});
    }
    stage="sources";
    const data=await supabaseRequest<BriefInput>("rpc/voice_customer_brief_input",{method:"POST",body:JSON.stringify({p_customer:id}),signal:AbortSignal.timeout(12000)});
    if(data.customerId!==id) throw new Error("customer_binding_mismatch");
    let text=data.savedHash===data.hash ? data.previousSummary : null;
    // An unchanged persisted summary needs no write. A write outage must not
    // turn a successful read into "summary unavailable".
    if (text) return NextResponse.json({summary:text,updatedAt:data.updatedAt},{headers:{"cache-control":"no-store"}});
    if(!text) {
      stage="ai";
      let pending=cache.get(id+":"+data.hash);
      if(!pending) {
        if(cache.size>=128)cache.delete(cache.keys().next().value!);
        const sources={...data.sources,kommunikation:data.sources.kommunikation?.map(e=>({...e,detail:e.kind==="transcript"?e.detail:currentEmailReply(e.detail)}))};
        pending=synthesize(JSON.stringify({quellen:sources,bisherigeZusammenfassung:data.previousSummary}),data.instructions)
          .catch(error=>{cache.delete(id+":"+data.hash);throw error;});
        cache.set(id+":"+data.hash,pending);
      }
      text=await pending;
    }
    stage="save";
    await supabaseRpc("save_voice_customer_brief",{p_customer:id,p_request:"",p_summary:text,p_hash:data.hash,p_captured:data.capturedAt});
    return NextResponse.json({summary:text,updatedAt:data.capturedAt},{headers:{"cache-control":"no-store"}});

  } catch(error) {return voiceCopilotApiFailure(error,"overview-"+stage);}
}
