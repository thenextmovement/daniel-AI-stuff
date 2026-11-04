import { isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const ALLOWED = /^(?:|health|app\.js|cloud\.js|style\.css|example\.png|test-logo\.png|cloud\/(?:list|project|save|publish|enqueue|retry)|api\/(?:prepare|upload|trace-selection|vector-page|geometry|pricing|export|example|split-paths|recovery-source|recovery-preview|recovery-apply|outline-[a-z-]+))$/;
async function proxy(req: Request, context: { params: Promise<{path?: string[]}> }) {
  const host=req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!isOpsPortalConfigured(host) || !(await resolveOpsRequestActor(host,req.headers)))
    return Response.json({error:"Anmeldung erforderlich."},{status:401});
  const path=(await context.params).path?.join("/") || "";
  if (!ALLOWED.test(path)) return Response.json({error:"Nicht gefunden."},{status:404});
  const url=new URL(req.url);
  if (req.method!=="GET" && req.headers.get("origin") && req.headers.get("origin")!==`${req.headers.get("x-forwarded-proto") || url.protocol.replace(":","")}://${host}`)
    return Response.json({error:"Ungültiger Ursprung."},{status:403});
  const base=process.env.NEON_STUDIO_URL, key=process.env.NEON_STUDIO_TOKEN;
  if(!base || !key) return Response.json({error:"Neon Studio ist noch nicht verbunden."},{status:503});
  if(Number(req.headers.get("content-length")||0)>140*1024*1024)
    return Response.json({error:"Datei zu groß."},{status:413});
  try {
    const upstream=await fetch(base.replace(/\/$/,"")+"/"+path+url.search,{
      method:req.method,headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:req.method==="GET"?undefined:await req.arrayBuffer(),
      signal:AbortSignal.timeout(180000),redirect:"error",cache:"no-store"});
    const headers=new Headers({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
    for(const name of ["content-type","content-disposition","content-security-policy"])
      if(upstream.headers.get(name))headers.set(name,upstream.headers.get(name)!);
    return new Response(upstream.body,{status:upstream.status,headers});
  } catch {
    return Response.json({error:"Neon Studio antwortet nicht. Bitte später erneut öffnen."},{status:503});
  }
}
export const GET=proxy;
export const POST=proxy;
