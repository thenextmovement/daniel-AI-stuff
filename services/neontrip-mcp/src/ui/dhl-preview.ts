import {App} from "@modelcontextprotocol/ext-apps";
import type {Preview} from "../dhl-preview.js";
import {mountPreview} from "./dhl-preview-view.js";
const root=document.querySelector<HTMLElement>("#app")!;
const app=new App({name:"NEONTRIP DHL Vorschau",version:"0.1.0"},{availableDisplayModes:["inline"]});
const local=window.parent===window && ["127.0.0.1","localhost"].includes(location.hostname);
async function call(name:string,args:Record<string,unknown>){
 const result=local
  ? await fetch("/pilot/tool",{method:"POST",headers:{"content-type":"application/json","x-dhl-pilot":"1"},body:JSON.stringify({name,arguments:args})}).then(r=>r.json())
  : await app.callServerTool({name,arguments:args});
 if(result.isError)throw new Error(result.content?.find((c:any)=>c.type==="text")?.text??"Aktion fehlgeschlagen.");
 return result.structuredContent;
}
const view=mountPreview(root,args=>call("dhl_confirm_preview",args),async args=>{const p=await call("dhl_prepare_preview",args) as Preview;currentKey=p.id+":"+p.version+":"+p.offers.map(o=>o.id).join();return p;});
let currentKey="";
function display(value:unknown){
 const p=value as Preview;
 if(p?.mode!=="preview"||!p.draft||!Array.isArray(p.offers))return;
 const key=p.id+":"+p.version+":"+p.offers.map(o=>o.id).join();
 if(key!==currentKey){currentKey=key;view.render(p);}
}
if(local){
 const notice=document.createElement("p");notice.className="local-notice";notice.textContent="Lokaler Pilot im Codex-Browser · direkte MCP-App-Einbettung noch nicht bestätigt";document.body.prepend(notice);
 const poll=()=>fetch("/pilot/current",{headers:{"x-dhl-pilot":"1"}}).then(r=>r.json()).then(display).catch(()=>{});
 void poll();setInterval(poll,1500);
}else{
 app.ontoolresult=result=>display(result.structuredContent);
 void app.connect().catch(()=>{root.textContent="Diese Oberfläche konnte sich nicht mit dem MCP-Host verbinden. Bitte die Vorschau im Chat erneut öffnen.";});
}
