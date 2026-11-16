import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { getVoiceCustomerContext, searchVoiceCustomerContexts } from "@/lib/ops/voice-knowledge";

import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { listVoiceDirectory } from "@/lib/ops/voice-directory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  try {
    if (request.nextUrl.searchParams.get("history") === "1") {
      const id = requireVoiceUuid(request.nextUrl.searchParams.get("customerId"), "Kunde");
      const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        return NextResponse.json({ok:false,error:"invalid_offset"}, {status:400});
      const channel = request.nextUrl.searchParams.get("channel");
      const kinds = channel === "phone" ? "in.(call,transcript)" : channel === "email" ? "in.(inbound,outbound)" : null;
      const rows = await supabaseRequest<unknown[]>("voice_customer_events", {signal:AbortSignal.timeout(12000)}, {
        select:"id,occurred_at,kind,subject,detail,request_ref,session_id", customer_id:"eq."+id,
        ...(kinds ? {kind:kinds} : {}),
        order:"occurred_at.desc.nullslast,id.asc", offset, limit:21,
      });
      const ref = request.nextUrl.searchParams.get("requestId");
      const brief = offset === 0 && ref && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref)
        ? (await Promise.all(["inbound","outbound","transcript"].map(kind =>
          supabaseRequest<unknown[]>("voice_customer_events",{signal:AbortSignal.timeout(12000)},{
            select:"id,occurred_at,kind,subject,detail,request_ref,session_id",customer_id:"eq."+id,
            request_ref:"in.("+ref+","+ref.slice(0,8)+")",kind:"eq."+kind,order:"occurred_at.desc.nullslast,id.asc",limit:1,
          })))).flat() : [];
      return NextResponse.json({ok:true,brief,entries:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null}, {headers:{"cache-control":"no-store"}});
    }
    if (request.nextUrl.searchParams.get("directory") === "1") {
      const directory = await listVoiceDirectory(
        request.nextUrl.searchParams.get("query") || "",
        Number(request.nextUrl.searchParams.get("offset") || 0),
        request.nextUrl.searchParams.get("customerId"),
      );
      return NextResponse.json({ ok: true, ...directory }, { headers: { "cache-control": "no-store" } });
    }
    const requestId = request.nextUrl.searchParams.get("requestId");
    if (requestId) {
      const context = await getVoiceCustomerContext(requestId, { customerId: request.nextUrl.searchParams.get("customerId") });
      return NextResponse.json({ ok: true, context }, { headers: { "cache-control": "no-store" } });
    }
    const results = await searchVoiceCustomerContexts(request.nextUrl.searchParams.get("query"));
    return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return voiceCopilotApiFailure(error, "context-read");
  }
}
