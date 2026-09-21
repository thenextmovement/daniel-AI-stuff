import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as tick } from "node:timers/promises";
import { OpenAiLiveAdapter } from "../../services/voice-runtime/live";

test("SIP sideband observes PCM while audio stays direct and sends only one idle check", async (t) => {
 t.mock.timers.enable({apis:["Date","setTimeout","setInterval"],now:1000});
 const original=globalThis.fetch;
 const sent:Record<string,any>[]=[];let finalized=false;
 class Socket extends EventEmitter {
  readyState=1;send(data:string){sent.push(JSON.parse(data));}
  close(){this.readyState=3;this.emit("close");}
 }
 const socket=new Socket();
 try {
  globalThis.fetch=(async()=>new Response(null,{status:200})) as typeof fetch;
  const adapter=new OpenAiLiveAdapter({openAiApiKey:"fixture",openAiProjectId:"fixture",openAiWebhookSecret:"fixture"} as never,{
   updateAttempt:async()=>{},transcript:async()=>({saved:true}),event:async()=>{},finalize:async()=>{finalized=true;},
  } as never,()=>socket as never);
  await adapter.acceptIncomingCall("live_idle","attempt_idle",{attemptId:"attempt_idle",modelId:"gpt-live-1",voice:"gleam",sessionConfig:{},instructions:"fixture",tools:[],allowlistOnly:true,safetyIdentifier:"fixture"} as never);
  socket.emit("open");
  const receive=(event:unknown)=>socket.emit("message",Buffer.from(JSON.stringify(event)));
  receive({type:"session.output_transcript.delta",event_id:"opening_idle",delta:"Claudia, KI-Telefonassistentin von NEONTRIP. Haben Sie noch Fragen?",start_ms:0,end_ms:500});
  const silence=Buffer.alloc(4800).toString("base64");
  for(let n=0;n<34;n++) {receive({type:"session.input_audio.append",audio:silence});t.mock.timers.tick(100);}
  assert.equal(sent.length,0,"no repeated greeting or premature idle check");
  receive({type:"session.input_audio.append",audio:silence});t.mock.timers.tick(100);
  assert.equal(sent.length,1);assert.match(sent[0].content,/Sind Sie noch dran/);
  receive({type:"session.output_transcript.delta",event_id:"idle_question",delta:"Sind Sie noch dran?",start_ms:3500,end_ms:4100});
  for(let n=0;n<60;n++) {receive({type:"session.input_audio.append",audio:silence});t.mock.timers.tick(100);}
  assert.equal(sent.length,1,"idle question cannot rearm itself");
  receive({type:"session.closed",reason:"remote_hangup"});
  for(let n=0;n<1000&&!finalized;n++)await tick();assert.equal(finalized,true);
  t.mock.timers.tick(10000);assert.equal(sent.length,1);
  assert.ok(sent.every(event=>event.type!=="session.input_audio.append"),"reflected audio must never loop back");
 } finally {globalThis.fetch=original;}
});
