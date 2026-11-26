// Personal stdio transport: all tool execution stays in the loopback gateway.
import {readMcpReply} from "./dhl-pilot-transport.js";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import {loadPilotSettings,PILOT_PORT} from "./dhl-pilot.js";
const settings=loadPilotSettings();
const base=`http://127.0.0.1:${PILOT_PORT}`;
const healthy=async()=>{try{return (await fetch(base+"/health/live",{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}};
if(!await healthy()){
 const child=spawn(process.execPath,[fileURLToPath(new URL("./dhl-pilot.js",import.meta.url))],{detached:true,stdio:"ignore"});child.unref();
 for(let i=0;i<50&&!await healthy();i++)await new Promise(r=>setTimeout(r,200));
}
if(!await healthy())throw new Error("DHL preview pilot unavailable");
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
 let request:any;
 try{
  if(line.length>1000000)throw Error();request=JSON.parse(line);
  const response=await fetch(base+"/mcp",{method:"POST",headers:{authorization:"Bearer "+settings.token,"content-type":"application/json",accept:"application/json,text/event-stream"},body:line,signal:AbortSignal.timeout(30000)});
  if(request.id===undefined)continue;
  if(!response.ok)throw Error();
  const result=await readMcpReply(response);process.stdout.write(JSON.stringify(result)+"\n");
 }catch{
  if(request?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,error:{code:-32603,message:"Lokale DHL-Vorschau nicht erreichbar. Keine Buchung ausgeführt."}})+"\n");
 }
}
