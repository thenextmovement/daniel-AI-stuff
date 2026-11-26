import {createHash,randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {z} from "zod";
import {createGatewayApp} from "./server.js";
import {createPreviewStore,type Draft,type Preview} from "./dhl-preview.js";
import {fetchDhlRates,type DhlRateConfig} from "./dhl-rates.js";
import {readDhlUi,runDhlPreviewTool,type DhlPreviewContext} from "./dhl-preview-mcp.js";
import type {GatewayConfig} from "./config.js";
export const PILOT_PORT=18789;
export const PILOT_FILE=join(homedir(),".config/neontrip/dhl-pilot.json");
export function loadPilotSettings():{token:string;dhl?:DhlRateConfig}{
 if(existsSync(PILOT_FILE))return JSON.parse(readFileSync(PILOT_FILE,"utf8"));
 const value={token:randomBytes(32).toString("hex")};
 mkdirSync(join(homedir(),".config/neontrip"),{recursive:true,mode:0o700});
 writeFileSync(PILOT_FILE,JSON.stringify(value),{mode:0o600,flag:"wx"});return value;
}
function sampleDraft():Draft{
 const next=new Date();next.setDate(next.getDate()+1);next.setHours(10,0,0,0);
 while([0,6].includes(next.getDay()))next.setDate(next.getDate()+1);
 const later=new Date(next);later.setDate(later.getDate()+1);while([0,6].includes(later.getDay()))later.setDate(later.getDate()+1);
 return {shipper:{name:"NEONTRIP TEST",addressLines:["Bilker Allee 29"],postalCode:"40219",city:"Düsseldorf",countryCode:"DE",phone:"+4921154257240"},receiver:{name:"TESTEMPFÄNGER – NICHT VERSENDEN",addressLines:["Teststraße 1"],postalCode:"10115",city:"Berlin",countryCode:"DE",phone:"+49301234567"},parcels:[{lengthCm:40,widthCm:30,heightCm:20,weightKg:2}],shippingDates:[next.toISOString().replace(/\.\d{3}Z$/,"Z"),later.toISOString().replace(/\.\d{3}Z$/,"Z")],customsDeclarable:false,dutiesPayer:"receiver"};
}
export async function createPilot(options:{token:string;dhl?:DhlRateConfig;saveCredentials:(dhl:DhlRateConfig)=>void}){
 const config:GatewayConfig={env:"development",host:"127.0.0.1",port:PILOT_PORT,publicUrl:new URL(`http://127.0.0.1:${PILOT_PORT}/mcp`),allowedHosts:["127.0.0.1","localhost"],allowedOrigins:["127.0.0.1","localhost"],identities:[{clientId:"rahim-dhl-pilot",actor:"Rahim DHL Pilot",role:"operator",tokenSha256:createHash("sha256").update(options.token).digest("hex"),scopes:["system:read","shipping:preview"],expiresAt:Math.floor(Date.now()/1000)+86400}],requiredServices:[],requestTimeoutMs:8000,maxResponseBytes:1500000,requestsPerMinute:240,allowDecisionCustomerEmail:false,dhl:options.dhl};
 const store=createPreviewStore();let current:Preview|undefined;
 const context:DhlPreviewContext={store,rates:async draft=>config.dhl?fetchDhlRates(draft,config.dhl):{offers:[],warnings:["DHL-Zugang fehlt. Keine Preise erfunden. Testadresse und Paketmaße sind nur Beispieldaten."]},onPreview:p=>{current=p;}};
 const gateway=createGatewayApp({config,dhlPreview:context,audit:record=>process.stderr.write(JSON.stringify(record)+"\n")});
 const {app}=gateway;
 app.get("/pilot",(_req,res)=>{res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");res.type("html").send(readDhlUi());});
 app.get("/pilot/settings",(_req,res)=>res.type("html").send(settingsHtml));
 app.use("/pilot",(req,res,next)=>{
  const origin=req.get("origin");
  if(req.get("x-dhl-pilot")!=="1"||(origin&&origin!==`http://${req.get("host")}`)){res.status(403).json({error:"forbidden"});return;}next();
 });
 app.get("/pilot/current",(_req,res)=>{
  try{if(!current)throw Error();res.json(store.get("rahim-dhl-pilot",current.id,current.version));}catch{res.status(410).json({error:"preview_expired"});}
 });
 app.post("/pilot/tool",async(req,res)=>{
  if(!["dhl_confirm_preview","dhl_show_preview","dhl_prepare_preview"].includes(req.body?.name)){res.status(400).json({error:"preview_only"});return;}
  res.json(await runDhlPreviewTool(context,"rahim-dhl-pilot",req.body.name,req.body.arguments));
 });
 app.post("/pilot/settings",async(req,res)=>{
  const parsed=z.object({environment:z.enum(["test","production"]),username:z.string().trim().min(1).max(200),password:z.string().trim().min(1).max(300),accountNumber:z.string().regex(/^\d{9}$/)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({ok:false});return;}
  try{options.saveCredentials(parsed.data);config.dhl=parsed.data;
   const result=await runDhlPreviewTool(context,"rahim-dhl-pilot","dhl_prepare_preview",{draft:current?.draft??sampleDraft(),...(current?{previous:{previewId:current.id,version:current.version}}:{})});
   res.json({ok:!result.isError,offers:current?.offers.length??0});
  }catch{res.status(500).json({ok:false});}
 });
 await runDhlPreviewTool(context,"rahim-dhl-pilot","dhl_prepare_preview",{draft:sampleDraft()});
 return {...gateway,context};
}
const settingsHtml=`<!doctype html><html lang="de"><meta charset="utf-8"><title>DHL-Zugang lokal einrichten</title><style>body{font:17px system-ui;max-width:560px;margin:60px auto}label{display:block;margin:20px 0}input,select,button{font:inherit;padding:10px;display:block;width:100%;box-sizing:border-box}</style><h1>DHL-Zugang · persönlicher Pilot</h1><p>Zugangsdaten bleiben lokal auf diesem Mac. Nur Tarifabfragen, keine Buchung.</p><form><label>API-Benutzername<input name="username" type="password" autocomplete="off" required></label><label>API-Passwort<input name="password" type="password" autocomplete="off" required></label><label>DHL-Kundennummer<input name="accountNumber" required pattern="[0-9]{9}"></label><label>Umgebung<select name="environment"><option value="test">DHL-Testumgebung</option><option value="production">DHL-Produktion · nur Tarife</option></select></label><button>Zugang lokal speichern und Tarife testen</button></form><p role="status"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target;const button=form.querySelector('button');button.disabled=true;const status=document.querySelector('[role=status]');status.textContent='Tarife werden geprüft …';try{const r=await fetch('/pilot/settings',{method:'POST',headers:{'content-type':'application/json','x-dhl-pilot':'1'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}).then(r=>r.json());form.reset();status.textContent=r.ok?'Zugang gespeichert. '+r.offers+' Tarifangebote. Vorschau unter /pilot.':'Einrichtung nicht bestätigt.';}catch{status.textContent='Einrichtung nicht bestätigt.';}button.disabled=false;};</script></html>`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const settings=loadPilotSettings();
 const pilot=await createPilot({...settings,saveCredentials:dhl=>writeFileSync(PILOT_FILE,JSON.stringify({...settings,dhl}),{mode:0o600})});
 const server=pilot.app.listen(PILOT_PORT,"127.0.0.1",()=>process.stderr.write("DHL preview pilot ready on loopback\n"));
 server.on("error",()=>{process.stderr.write("DHL pilot port unavailable\n");process.exit(1);});
}
