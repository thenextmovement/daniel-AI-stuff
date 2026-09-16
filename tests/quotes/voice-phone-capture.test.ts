import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {setTimeout as pause} from "node:timers/promises";
import {createHmac} from "node:crypto";
import WebSocket from "ws";
import {PhoneCaptures,installPhoneCapture,type PhoneCaptureRecord,type PhoneTranscriberFactory} from "../../services/voice-runtime/phone-capture";
import {installTwilioMedia} from "../../services/voice-runtime/media";
import {phoneCaptureBinding} from "../../services/voice-runtime/phone-capture-protocol";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import type {PhoneTranscriptSegment} from "../../services/voice-runtime/phone-transcription";
const id="29500000-0000-4000-8000-000000000601",callId="29500000-0000-4000-8000-000000000201";
const ca="CA"+"1".repeat(32),mz="MZ"+"2".repeat(32),ac="AC"+"3".repeat(32);
const config={publicUrl:"https://voice.example.test",phoneTranscriptionEnabled:true,teamPhoneEnabled:true,openAiApiKey:"synthetic",
 twilioAccountSid:ac,twilioAuthToken:"fixture-auth",sipBindingSecret:"fixture-binding"} as RuntimeConfig;
const row=():PhoneCaptureRecord=>({id,call_id:callId,customer_call_sid:ca,state:"reserved",stream_sid:null,created_at:new Date().toISOString(),stream_started_at:null,ended_at:null,updated_at:new Date().toISOString(),cleanup_pending:false});
function fixture(){
 const capture=row(),actions:Record<string,unknown>[]=[],saved=new Map<string,PhoneTranscriptSegment>();
 let creates=0,stops=0,createFails=false,stopFails=false,saveFails=false;
 const store={captureAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  actions.push(input);
  if(input.action==="claim"){
   const dispatch=capture.state==="reserved";if(dispatch)capture.state="dispatching";
   return {capture:{...capture},dispatch} as T;
  }
  if(input.action==="bind"){
   if(capture.state!=="dispatching"||input.callSid!==ca||input.streamSid!==mz)throw Error("binding_rejected");
   capture.state="active";capture.stream_sid=mz;return {capture:{...capture},offsetMs:1400} as T;
  }
  if(input.action==="interrupt"){
   if(!input.updatedAt||input.updatedAt===capture.updated_at){capture.state="interrupted";capture.ended_at=new Date().toISOString();capture.cleanup_pending=true;}
  }
  if(input.action==="cleanup")capture.cleanup_pending=false;
  if(input.action==="pending")return {captures:[{...capture}]} as T;
  if(input.action==="persist"){
   if(saveFails)throw Error("storage_offline");
   for(const segment of input.segments as PhoneTranscriptSegment[])saved.set(segment.id,segment);
   if(input.finish){capture.state=input.finish as typeof capture.state;capture.ended_at=new Date().toISOString();capture.cleanup_pending=true;}
   return {saved:true,captureState:capture.state,callEnded:true} as T;
  }
  return {capture:{...capture}} as T;
 }};
 const provider={start:async()=>{creates++;if(createFails)throw Error("uncertain");},stop:async()=>{stops++;if(stopFails)throw Error("unconfirmed");}};
 return {capture,actions,saved,store,provider,control:new PhoneCaptures(store,provider,()=>true),
  get creates(){return creates;},get stops(){return stops;},failCreate(){createFails=true;},failStop(){stopFails=true;},failSave(){saveFails=true;}};
}
test("parallel capture dispatches create one stream and uncertain creation is never retried",async()=>{
 const f=fixture();await Promise.all([f.control.kick(id),f.control.kick(id)]);assert.equal(f.creates,1);
 const bad=fixture();bad.failCreate();await bad.control.kick(id);await bad.control.kick(id);
 assert.equal(bad.creates,1);assert.equal(bad.stops,1);assert.equal(bad.capture.state,"interrupted");
});
test("failed stream cleanup stays pending; stale workers only interrupt the captured version",async()=>{
 const f=fixture();f.capture.state="active";f.capture.updated_at=new Date(Date.now()-60000).toISOString();f.failStop();
 await f.control.reconcile();assert.equal(f.capture.state,"interrupted");assert(f.capture.cleanup_pending);
 assert(!f.actions.some(x=>x.action==="cleanup"));assert.equal(f.creates,0);
 const fresh=fixture();fresh.capture.state="active";await fresh.control.reconcile();
 assert.equal(fresh.stops,0);assert(!fresh.actions.some(x=>x.action==="interrupt"));
});
async function waitFor(condition:()=>boolean){for(let i=0;i<100;i++){if(condition())return;await pause(20);}assert(condition(),"timed out");}
async function socketFixture(final=true,failSave=false){
 const f=fixture();f.capture.state="dispatching";if(failSave)f.failSave();
 const server=createServer(),received:Array<{speaker:string;start:number}>=[];
 const factory:PhoneTranscriberFactory=(prefix,speaker,stage)=>{
  let segment:PhoneTranscriptSegment|null=null;
  return {start:async()=>{},append:(_audio,start)=>{
   received.push({speaker,start});segment={id:prefix+":i1",speaker,text:speaker==="customer"?"RAL 9031":"Wir prüfen das.",revision:1,final:false,startMs:start,endMs:null};stage(segment);
  },finish:async()=>{if(segment&&final)stage({...segment,revision:2,final:true,endMs:segment.startMs+20});return final;},abort:()=>{}};
 };
 const stop=installPhoneCapture(server,config,f.store,null,factory);
 // Installing both upgrade handlers must not make either one reject the other's path.
 const stopAi=installTwilioMedia(server,config,{} as never,{} as never);
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const port=(server.address() as {port:number}).port;
 const signature=createHmac("sha1",config.twilioAuthToken).update(config.publicUrl+"/media/phone").digest("base64");
 const ws=new WebSocket("ws://127.0.0.1:"+port+"/media/phone",{headers:{"x-twilio-signature":signature}});
 await once(ws,"open");
 const send=(event:unknown)=>ws.send(JSON.stringify(event));
 send({event:"connected",protocol:"Call",version:"1.0.0"});
 send({event:"start",sequenceNumber:"1",streamSid:mz,start:{callSid:ca,accountSid:ac,streamSid:mz,tracks:["inbound","outbound"],
  mediaFormat:{encoding:"audio/x-mulaw",sampleRate:8000,channels:1},customParameters:{captureId:id,binding:phoneCaptureBinding(id,ca,config.sipBindingSecret)}}});
 const media=(sequence:number,track:string)=>({event:"media",sequenceNumber:String(sequence),streamSid:mz,media:{track,chunk:"1",timestamp:"200",payload:Buffer.alloc(160,255).toString("base64")}});
 send(media(2,"inbound"));send(media(3,"outbound"));
 await waitFor(()=>received.length===2);
 return {...f,received,ws,send,close:async()=>{ws.terminate();await stop();stopAi();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
test("signed customer stream saves both tracks with stable customer binding and audio offset",async()=>{
 const f=await socketFixture();
 try{
  f.send({event:"stop",sequenceNumber:"4",streamSid:mz,stop:{callSid:ca,accountSid:ac}});
  await waitFor(()=>f.capture.state==="complete");
  assert.equal(f.saved.size,2);assert([...f.saved.values()].every(x=>x.final&&x.startMs===1600&&x.endMs===1620));
  assert.deepEqual(new Set([...f.saved.values()].map(x=>x.speaker)),new Set(["customer","operator"]));
  assert(!f.actions.some(x=>["cancel","phoneEvent","finalize"].includes(String(x.action))),"transcription cannot hang up the call");
 }finally{await f.close();}
});
test("missing final transcripts and failed persistence mark interruption without closing telephone legs",async()=>{
 for(const [final,failSave] of [[false,false],[true,true]]){
  const f=await socketFixture(final,failSave);
  try{
   f.send({event:"stop",sequenceNumber:"4",streamSid:mz,stop:{callSid:ca,accountSid:ac}});
   await waitFor(()=>f.capture.state==="interrupted");
   assert(!f.actions.some(x=>x.action==="cancel"));
  }finally{await f.close();}
 }
});
test("bad media signature is rejected before database admission or model startup",async()=>{
 const server=createServer(),f=fixture();let models=0;
 const stop=installPhoneCapture(server,config,f.store,null,()=>{models++;throw Error("must_not_connect");});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const ws=new WebSocket("ws://127.0.0.1:"+(server.address() as {port:number}).port+"/media/phone",{headers:{"x-twilio-signature":"wrong"}});
 try{await assert.rejects(once(ws,"open"));assert.equal(models,0);assert.equal(f.actions.length,0);}
 finally{ws.terminate();await stop();await new Promise<void>(r=>server.close(()=>r()));}
});
