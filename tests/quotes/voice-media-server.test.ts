import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { installTwilioMedia } from "../../services/voice-runtime/media";
import { TwilioMediaAdapter } from "../../services/voice-runtime/telephony";
import { getProviderReadiness } from "../../services/voice-runtime/config";
import { signAttemptBinding } from "../../services/voice-runtime/security";
const account="AC"+"1".repeat(32),call="CA"+"2".repeat(32),stream="MZ"+"3".repeat(32);
const attemptId="11111111-1111-4111-8111-111111111111",publicUrl="https://voice.example.test",secret="synthetic-binding",token="synthetic-token";
const session={attemptId,providerCallId:call,allowlistOnly:true,modelId:"gpt-live-1",phoneE164:"+491110000001"};
const config={publicUrl,twilioAccountSid:account,twilioAuthToken:token,sipBindingSecret:secret,twilioFromNumber:"+491110000002"};
const start=(changes:Record<string,unknown>={})=>({event:"start",sequenceNumber:"1",streamSid:stream,start:{streamSid:stream,accountSid:account,callSid:call,tracks:["inbound"],mediaFormat:{encoding:"audio/x-mulaw",sampleRate:8000,channels:1},customParameters:{attemptId,binding:signAttemptBinding(attemptId,secret)},...changes}});
async function fixture(run:(f:any)=>Promise<void>,options:{wrongCall?:boolean,customerCall?:boolean}={}){
 const server=createServer((_request,response)=>{response.writeHead(404).end();});
 let lookups=0,connections=0;
 const events:string[]=[],consumed=new Set<string>(),finalized:any[]=[],clients:WebSocket[]=[];
 let connectedResolve!:()=>void;
 const connected=new Promise<void>(r=>{connectedResolve=r;});
 const stop=installTwilioMedia(server,config as never,{
  getAttempt:async()=>{lookups++;return {...session,providerCallId:options.wrongCall?"CA"+"8".repeat(32):call,allowlistOnly:!options.customerCall};},
  event:async(_id:string,_source:string,type:string,key:string)=>{events.push(type);const duplicate=consumed.has(key);consumed.add(key);return {ok:true,result:{duplicate}};},
  finalize:async(...args:any[])=>{finalized.push(args);},
  transcript:async()=>({saved:true}),
 } as never,{
  connectMedia:async(_session:unknown,transport:any)=>{connections++;transport.watchClose(()=>{});transport.activateInput(()=>{});connectedResolve();},
 } as never);
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const port=(server.address() as {port:number}).port;
 async function client(valid=true){
  const signature=createHmac("sha1",valid?token:"wrong").update(publicUrl+"/media/twilio").digest("base64");
  const ws=new WebSocket("ws://127.0.0.1:"+port+"/media/twilio",{headers:{"x-twilio-signature":signature}});
  clients.push(ws);ws.on("error",()=>{});
  return ws;
 }
 try{await run({client,connected,events,finalized,get lookups(){return lookups;},get connections(){return connections;}});}
 finally{for(const c of clients)c.terminate();stop();await new Promise<void>(r=>server.close(()=>r()));}
}
async function startClient(f:any,changes:Record<string,unknown>={}){
 const ws=await f.client();await once(ws,"open");
 ws.send(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));ws.send(JSON.stringify(start(changes)));return ws;
}
test("unsigned media upgrade is rejected before any customer or attempt lookup",async()=>{
 await fixture(async f=>{
  const ws=await f.client(false);
  const response=await new Promise<number>(resolve=>ws.once("unexpected-response",(_req:any,res:any)=>{resolve(res.statusCode);res.resume();ws.terminate();}));
  assert.equal(response,401);assert.equal(f.lookups,0);assert.equal(f.connections,0);
 });
});
test("signed stream binds a stored call once and records disclosure before connecting Live",async()=>{
 await fixture(async f=>{
  const first=await startClient(f);await f.connected;
  assert.deepEqual(f.events,["media.connected","disclosure.confirmed"]);
  assert.equal(f.connections,1);assert.equal(f.lookups,1);
  const second=await startClient(f);await once(second,"close");
  assert.equal(f.connections,1);assert.equal(first.readyState,WebSocket.OPEN);
  assert.equal(f.finalized.length,0,"a rejected replay must not terminate the valid call");
 });
});
test("wrong attempt HMAC or account cannot trigger internal data lookup",async()=>{
 for(const changes of [{customParameters:{attemptId,binding:"0".repeat(64)}},{accountSid:"AC"+"9".repeat(32)}]){
  await fixture(async f=>{const ws=await startClient(f,changes);await once(ws,"close");assert.equal(f.lookups,0);assert.equal(f.connections,0);assert.deepEqual(f.events,[]);});
 }
});
test("wrong provider call and non-test attempts fail before disclosure or model connection",async()=>{
 for(const options of [{wrongCall:true},{customerCall:true}]){
  await fixture(async f=>{const ws=await startClient(f);await once(ws,"close");assert.equal(f.lookups,1);assert.equal(f.connections,0);assert.deepEqual(f.events,[]);},options);
 }
});
test("media telephony sends the disclosure before an attempt-bound stream and preserves the approved recipient",async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=(async(_url,init)=>{
   calls++;const body=new URLSearchParams(String(init?.body)),xml=body.get("Twiml")!;
   assert.equal(body.get("To"),session.phoneE164);
   assert.ok(xml.indexOf("<Say")<xml.indexOf("<Connect>"));
   assert.match(xml,/KI-Telefonassistent/);assert.match(xml,/wss:\/\/voice.example.test\/media\/twilio/);
   assert.match(xml,/name="attemptId"/);assert.match(xml,/name="binding"/);assert.match(xml,/<Hangup\/>/);
   return Response.json({sid:call});
  }) as typeof fetch;
  const adapter=new TwilioMediaAdapter(config as never);
  assert.equal((await adapter.startOutboundCall(session as never)).providerCallId,call);
  await assert.rejects(adapter.startOutboundCall({...session,allowlistOnly:false} as never),/internal_live_test_only/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test("media mode is opt-in and uses primary Live credentials without requiring SIP webhook support",()=>{
 const env={OPENAI_API_KEY:"test",OPENAI_PROJECT_ID:"proj_test",TWILIO_ACCOUNT_SID:"test",TWILIO_AUTH_TOKEN:"test",TWILIO_FROM_NUMBER:"test",VOICE_SIP_BINDING_SECRET:"test"};
 assert.equal(getProviderReadiness(env).dispatch,false);
 assert.equal(getProviderReadiness({...env,VOICE_LIVE_MEDIA_ENABLED:"true"}).dispatch,true);
 assert.equal(getProviderReadiness({...env,VOICE_LIVE_MEDIA_ENABLED:"true",VOICE_SIP_BINDING_SECRET:""}).dispatch,false);
});


test("isolated audio chain preserves duplex speech, waits for played audio and stores a bound transcript", {timeout:5000}, async()=>{
 const {EventEmitter}=await import("node:events");
 const {setTimeout:pause}=await import("node:timers/promises");
 const {OpenAiLiveAdapter}=await import("../../services/voice-runtime/live");
 class LiveSocket extends EventEmitter{
  readyState=0;bufferedAmount=0;sent:Record<string,any>[]=[];
  send(raw:string){this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.emit("open");}
  receive(value:unknown){this.emit("message",Buffer.from(JSON.stringify(value)));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit("close");}
  terminate(){this.close();}
 }
 const openai=new LiveSocket(),saved:any[]=[],outcomes:any[]=[],events:string[]=[],audioPackets:any[]=[];
 const fullSession={...session,requestId:"internal-test:"+attemptId,voice:"marin",safetyIdentifier:"synthetic",sessionConfig:{},instructions:"Interner Test ohne Folgeaktionen.",tools:[]};
 const fakeOps={
  getAttempt:async(id:string)=>{assert.equal(id,attemptId);return fullSession;},
  event:async(_id:string,_source:string,type:string)=>{events.push(type);return {ok:true,result:{duplicate:false}};},
  transcript:async(id:string,segments:unknown[],finish?:string)=>{assert.equal(id,attemptId);saved.push({id,segments,finish});return {saved:true};},
  updateAttempt:async(id:string,value:any)=>{assert.equal(id,attemptId);assert.equal(value.openAiCallId,"live_integration");},
  finalize:async(id:string,outcome:unknown)=>{assert.equal(id,attemptId);outcomes.push(outcome);},
 };
 let constructed=false;
 const live=new OpenAiLiveAdapter({...config,openAiApiKey:"synthetic",openAiProjectId:"proj_synthetic"} as never,fakeOps as never,(url)=>{
  assert.equal(url,"wss://api.openai.com/v1/live/sessions");constructed=true;return openai as never;
 });
 const server=createServer();
 const stop=installTwilioMedia(server,config as never,fakeOps as never,live);
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const signature=createHmac("sha1",token).update(publicUrl+"/media/twilio").digest("base64");
 const twilio=new WebSocket("ws://127.0.0.1:"+(server.address() as {port:number}).port+"/media/twilio",{headers:{"x-twilio-signature":signature}});
 twilio.on("error",()=>{});
 twilio.on("message",raw=>audioPackets.push(JSON.parse(String(raw))));
 const waitFor=async(check:()=>boolean)=>{for(let i=0;i<400;i++){if(check())return;await pause(5);}assert.ok(check(),"audio chain did not settle");};
 try{
  await once(twilio,"open");
  twilio.send(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
  twilio.send(JSON.stringify(start()));
  const audio=Buffer.alloc(160,0xff).toString("base64");
  twilio.send(JSON.stringify({event:"media",sequenceNumber:"2",streamSid:stream,media:{track:"inbound",chunk:"1",timestamp:"0",payload:audio}}));
  await waitFor(()=>constructed);
  assert.deepEqual(events,["media.connected","disclosure.confirmed"]);
  openai.open();assert.equal(openai.sent[0].type,"session.start");
  assert.deepEqual(openai.sent[0].session.audio.format,{type:"audio/pcmu",rate:8000});
  openai.receive({type:"session.started",session:{id:"live_integration"}});
  await waitFor(()=>openai.sent.some(e=>e.type==="session.input_audio.append"));
  assert.equal(openai.sent.find(e=>e.type==="session.input_audio.append")?.audio,audio);
  openai.receive({type:"session.output_audio.delta",delta:audio});
  await waitFor(()=>audioPackets.length===2);
  assert.equal(audioPackets[0].media.payload,audio);
  assert.equal(audioPackets[1].event,"mark");
  twilio.send(JSON.stringify({event:"media",sequenceNumber:"3",streamSid:stream,media:{track:"inbound",chunk:"2",timestamp:"20",payload:audio}}));
  await waitFor(()=>openai.sent.filter(e=>e.type==="session.input_audio.append").length===2);
  openai.receive({type:"session.input_transcript.delta",event_id:"customer_1",delta:"Ist die Adresse richtig?",start_ms:0,end_ms:1000});
  openai.receive({type:"session.output_transcript.delta",event_id:"assistant_1",delta:"Lass uns die Adresse prüfen.",start_ms:200,end_ms:1300});
  openai.receive({type:"session.closed",reason:"close_requested"});
  await pause(20);
  assert.equal(outcomes.length,0,"generated speech is not proof of playback");
  twilio.send(JSON.stringify({event:"mark",sequenceNumber:"4",streamSid:stream,mark:audioPackets[1].mark}));
  await waitFor(()=>outcomes.length===1);
  assert.deepEqual(saved.flatMap(x=>x.segments).map((x:any)=>[x.speaker,x.text,x.startMs,x.endMs]),[
   ["customer","Ist die Adresse richtig?",0,1000],["assistant","Lass uns die Adresse prüfen.",200,1300],
  ]);
  assert.equal(saved.at(-1).finish,"complete");
  assert.equal(outcomes[0].humanHandoffCompleted,false);
 }finally{
  openai.close();twilio.terminate();await live.shutdownMedia();stop();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});

