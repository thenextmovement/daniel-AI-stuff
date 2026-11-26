import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/server";
import {registerAppTool,registerAppResource} from "@modelcontextprotocol/ext-apps/server";
import {draftSchema,type Draft,type PreviewStore,type Offer,type Preview} from "./dhl-preview.js";
import type {Identity} from "./types.js";
import type {AuditSink} from "./audit.js";
export const DHL_UI_URI="ui://neontrip/dhl-preview.html";
export type DhlPreviewContext={onPreview?:(preview:Preview)=>void;store:PreviewStore;rates:(draft:Draft)=>Promise<{offers:Offer[];warnings:string[]}>};
const reference=z.object({previewId:z.uuid(),version:z.number().int().positive()}).strict();
const prepare=z.object({draft:draftSchema,previous:reference.optional()}).strict();
const confirmation=reference.extend({offerId:z.string().min(1).max(200),pickup:z.object({readyByTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),closeTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict().refine(v=>v.readyByTime<v.closeTime).optional()}).strict();
export function readDhlUi(){
 const directory=dirname(fileURLToPath(import.meta.url));
 return readFileSync(resolve(directory,directory.endsWith("/dist/src")?"../ui/dhl-preview.html":"../dist/ui/dhl-preview.html"),"utf8");
}
export async function runDhlPreviewTool(context:DhlPreviewContext,owner:string,name:string,args:unknown){
 try{
  let result:unknown;
  if(name==="dhl_prepare_preview"){
   const {draft,previous}=prepare.parse(args);
   const p=context.store.put(owner,draft,previous?{id:previous.previewId,version:previous.version}:undefined);
   let rates:{offers:Offer[];warnings:string[]};
   try{rates=await context.rates(draft);}catch{rates={offers:[],warnings:["DHL-Tarife konnten nicht bestätigt werden. Bitte Zugang und Versanddaten prüfen."]};}
   result=context.store.setOffers(owner,p.id,p.version,rates.offers,rates.warnings);
  }else if(name==="dhl_show_preview"){
   const p=reference.parse(args);result=context.store.get(owner,p.previewId,p.version);
  }else if(name==="dhl_confirm_preview"){
   const p=confirmation.parse(args);result={...context.store.confirm(owner,p.previewId,p.version,p.offerId),pickup:p.pickup??null,pickupStatus:"not_requested"};
  }else throw new Error("Unbekannte Vorschau-Aktion.");
  if (name!=="dhl_confirm_preview") context.onPreview?.(result as Preview);
  return {content:[{type:"text" as const,text:JSON.stringify(result)}],structuredContent:result as Record<string,unknown>};
 }catch{
  return {isError:true,content:[{type:"text" as const,text:"Vorschau nicht bestätigt: Daten ungültig, geändert oder abgelaufen. Bitte neu vorbereiten."}]};
 }
}
export function registerDhlPreviewTools(server:McpServer,identity:Identity,context:DhlPreviewContext,audit:AuditSink){
 for(const [name,schema,description] of [
  ["dhl_prepare_preview",prepare,"DHL-Vorschau mit vollständigen Adressen, Außenmaßen, Bruttogewicht und 1–3 Versandterminen vorbereiten. Fehlende Daten erfragen. Bei Änderungen previous mit ID/Version übergeben. Keine Sendung oder Abholung wird gebucht."],
  ["dhl_show_preview",reference,"Aktuelle DHL-Vorschau als interaktives Formular öffnen. Adresse, Paket, Versandtag, Lieferprognose und Kundentarif prüfen. Nur Simulation."],
  ["dhl_confirm_preview",confirmation,"Gewähltes Angebot ausschließlich testweise bestätigen. Es wird nichts gebucht und kein Label erzeugt."],
 ] as const){
  registerAppTool(server,name,{description,inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:name!=="dhl_prepare_preview",openWorldHint:name==="dhl_prepare_preview"},_meta:{ui:{resourceUri:DHL_UI_URI}}},async(args:unknown)=>{
   const start=Date.now();const result=await runDhlPreviewTool(context,identity.clientId,name,args);
   audit({timestamp:new Date().toISOString(),correlationId:randomUUID(),clientId:identity.clientId,actor:identity.actor,role:identity.role,capability:name,outcome:result.isError?"failure":"success",durationMs:Date.now()-start});
   return result;
  });
 }
 registerAppResource(server,"DHL Versandvorschau",DHL_UI_URI,{},async()=>({contents:[{uri:DHL_UI_URI,mimeType:"text/html;profile=mcp-app",text:readDhlUi(),_meta:{"openai/ui":{availableDisplayModes:["inline"],preferredDisplayMode:"inline"},ui:{csp:{connectDomains:[],resourceDomains:[]}}}}]}));
}
