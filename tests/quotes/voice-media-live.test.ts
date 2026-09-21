import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as tick } from "node:timers/promises";
import { OpenAiLiveAdapter, type LiveMediaTransport } from "../../services/voice-runtime/live";
import type { RuntimeSession } from "../../services/voice-runtime/types";

class Socket extends EventEmitter {
  readyState=0;bufferedAmount=0;sent:Record<string,any>[]=[];
  send(data:string){this.sent.push(JSON.parse(data));}
  open(){this.readyState=1;this.emit("open");}
  receive(event:unknown){this.emit("message",Buffer.from(JSON.stringify(event)));}
  close(){this.readyState=3;this.emit("close");}
  terminate(){this.close();}
}
const session: RuntimeSession={attemptId:"11111111-1111-4111-8111-111111111111",requestId:"internal-test:11111111-1111-4111-8111-111111111111",allowlistOnly:true,phoneE164:"+491110000001",safetyIdentifier:"synthetic-test",modelId:"gpt-live-1",voice:"marin",sessionConfig:{},instructions:"Nur interner Test.",tools:[]};
async function waitFor(check:()=>boolean){
 for(let n=0;n<1000;n++){if(check())return;await tick();}
 assert(check(),"condition did not settle");
}
function fixture(options:{storage?:boolean,update?:Promise<void>,playback?:Promise<boolean>,storageWait?:Promise<void>,finishFailures?:number}={}){
 const socket=new Socket(),saved:any[]=[],outcomes:any[]=[],audioOut:string[]=[],events:any[]=[],tools:any[]=[];
 let audioIn:((value:string)=>void)|undefined,closeHandler:((clean:boolean)=>void)|undefined,closed=false,connections=0;
 const media:LiveMediaTransport={
  activateInput:handler=>{audioIn=handler;},
  output:audio=>{audioOut.push(audio);},
  watchClose:handler=>{closeHandler=handler;},
  finishPlayback:()=>options.playback||Promise.resolve(true),
  close:()=>{closed=true;},
 };
 const adapter=new OpenAiLiveAdapter(
  {openAiApiKey:"synthetic",openAiWebhookSecret:"synthetic",openAiProjectId:"proj_synthetic"} as never,
  {transcript:async(...args:any[])=>{saved.push(args);await options.storageWait;if(args[2] && options.finishFailures){options.finishFailures--;return {saved:false};}return {saved:options.storage!==false};},
   updateAttempt:async()=>{await options.update;},
   finalize:async(...args:any[])=>{outcomes.push(args);},
   event:async(...args:any[])=>{events.push(args);return {ok:true,result:{duplicate:false}};},
   tool:async(...args:any[])=>{tools.push(args);return {result:{email:"test@example.test"}};},
  } as never,
  (url,options)=>{
   connections++;assert.equal(url,"wss://api.openai.com/v1/live/sessions");
   assert.equal((options.headers as Record<string,string>)["OpenAI-Project"],"proj_synthetic");
   return socket as never;
  },
 );
 return {socket,saved,outcomes,audioOut,events,tools,adapter,media,input:(audio:string)=>audioIn?.(audio),stop:(clean:boolean)=>closeHandler?.(clean),get ready(){return !!audioIn;},get closed(){return closed;},get connections(){return connections;}};
}
test("Live media waits for started and forwards both directions while persistence is slow",async()=>{
 let release!:()=>void;const update=new Promise<void>(r=>{release=r;}),f=fixture({update});
 await f.adapter.connectMedia(session,f.media);
 assert.equal(f.ready,false);f.socket.open();
 assert.equal(f.socket.sent[0].type,"session.start");
 // The real primary Live endpoint rejects this field with unknown_parameter.
 assert.equal(Object.hasOwn(f.socket.sent[0].session,"type"),false);
 assert.deepEqual(f.socket.sent[0].session.audio.format,{type:"audio/pcmu",rate:8000});
 assert.equal(f.socket.sent[0].session.model,"gpt-live-1");
 assert.equal(f.socket.sent[0].session.store,false);
 f.socket.receive({type:"session.started",session:{id:"live_test",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 assert.equal(f.ready,true);
 const audio=Buffer.alloc(160,0xff).toString("base64");
 f.socket.receive({type:"session.output_audio.delta",delta:audio});
 f.input(audio);
 assert.deepEqual(f.audioOut,[audio]);
 assert.equal(f.socket.sent.at(-1)?.type,"session.input_audio.append");
 assert.equal(f.socket.sent.at(-1)?.audio,audio);
 f.socket.receive({type:"session.input_transcript.delta",event_id:"input_1",delta:"Hallo",start_ms:0,end_ms:500});
 f.socket.receive({type:"session.output_transcript.delta",event_id:"output_1",delta:"Guten Tag",start_ms:100,end_ms:600});
 assert.equal(f.saved.length,1);
 release();f.socket.receive({type:"session.closed",reason:"close_requested"});
 await waitFor(()=>f.outcomes.length===1);
 const segments=f.saved.flatMap(x=>x[1]);
 assert.deepEqual(segments.map((x:any)=>[x.speaker,x.startMs,x.endMs]),[["customer",0,500],["assistant",100,600]]);
 assert.equal(f.saved.at(-1)[2],"complete");assert.equal(f.closed,true);
 assert.ok(!f.socket.sent.some(e=>e.type==="response.create"),"voice audio must not use Realtime turn commits");
});
test("session.closed waits for playback acknowledgement before declaring complete",async()=>{
 let played!:(v:boolean)=>void;const f=fixture({playback:new Promise(r=>{played=r;})});
 await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_test",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 f.socket.receive({type:"session.closed",reason:"close_requested"});await tick();
 assert.equal(f.closed,false);assert.equal(f.outcomes.length,0);
 played(true);await waitFor(()=>f.outcomes.length===1);
 assert.equal(f.saved.at(-1)[2],"complete");
});
test("unplayed output and transport loss cannot be recorded as a complete transcript",async()=>{
 for(const loss of ["playback","transport"]){
  const f=fixture({playback:Promise.resolve(false)});
  await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_test",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
  if(loss==="playback")f.socket.receive({type:"session.closed",reason:"close_requested"});
  else {f.stop(false);assert.equal(f.socket.sent.at(-1)?.type,"session.close");f.socket.close();}
  await waitFor(()=>f.outcomes.length===1);
  assert.equal(f.saved.at(-1)[2],"interrupted");
 }
});
test("unapproved calls, wrong models and missing storage acknowledgement never open a Live socket",async()=>{
 const f=fixture();
 await assert.rejects(f.adapter.connectMedia({...session,allowlistOnly:false},f.media),/internal_test_only/);
 await assert.rejects(f.adapter.connectMedia({...session,modelId:"other"},f.media),/unsupported_voice_model/);
 assert.equal(f.connections,0);
 const storage=fixture({storage:false});
 await assert.rejects(storage.adapter.connectMedia(session,storage.media),/transcript_not_acknowledged/);
 assert.equal(storage.connections,0);
});


test("shutdown rejects a media connection still waiting for storage and later new connections",async()=>{
 let release!:()=>void;const f=fixture({storageWait:new Promise<void>(r=>{release=r;})});
 const pending=f.adapter.connectMedia(session,f.media);
 const rejected=assert.rejects(pending,/media_runtime_stopping/);
 await f.adapter.shutdownMedia();release();await rejected;
 await assert.rejects(f.adapter.connectMedia(session,f.media),/media_runtime_stopping/);
 assert.equal(f.connections,0);
});
test("finalization waits for a positively acknowledged transcript completion",async()=>{
 const f=fixture({finishFailures:1});
 await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_finish_ack",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 f.socket.receive({type:"session.closed",reason:"close_requested"});
 await waitFor(()=>f.saved.some(x=>x[2]));
 assert.equal(f.outcomes.length,0);
 await new Promise(resolve=>setTimeout(resolve,600));
 assert.equal(f.saved.filter(x=>x[2]).length,2);
 assert.equal(f.outcomes.length,1);
});


test("provider model/codec confirmation is mandatory and preserved as a bounded audit event", async () => {
 for (const change of [{ model: "gpt-realtime-2.1" }, { audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } } }, { model: undefined }]) {
  const f=fixture();await f.adapter.connectMedia(session,f.media);f.socket.open();
  f.socket.receive({type:"session.started",session:{id:"live_wrong",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}},...change}});
  await waitFor(()=>f.outcomes.length===1);
  assert.equal(f.ready,false);assert.equal(f.outcomes[0][1].failureCode,"live_session_contract_mismatch");
 }
 const f=fixture();await f.adapter.connectMedia(session,f.media);f.socket.open();
 f.socket.receive({type:"session.started",session:{id:"live_verified",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 await waitFor(()=>f.events.length===1);
 assert.equal(f.events[0][2],"live.session.confirmed");assert.equal(f.events[0][4].model,"gpt-live-1");
 f.socket.receive({type:"session.closed",reason:"close_requested"});await waitFor(()=>f.outcomes.length===1);
});

test("Live speaks disclosure itself; delegated reads then return actual bound values", async (t) => {
 t.mock.timers.enable({ apis: ["setTimeout"] });
 const f=fixture();await f.adapter.connectMedia(session,f.media);f.socket.open();
 f.socket.receive({type:"session.started",session:{id:"live_tools",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 assert.ok(!f.socket.sent.some(e=>e.type==="session.instructions.append"));
 t.mock.timers.tick(999);
 assert.ok(!f.socket.sent.some(e=>e.type==="session.instructions.append"));
 const greetingAudio=Buffer.alloc(160,0xff).toString("base64");f.input(greetingAudio);
 assert.equal(f.socket.sent.at(-1)?.type,"session.input_audio.append");
 t.mock.timers.tick(1);
 assert.match(f.socket.sent.find(e=>e.type==="session.instructions.append")!.content,/KI-Telefonassistent/);
 const tool=(id:string)=>{
  const emit=(event:unknown)=>f.socket.receive({type:"response.event",delegation_id:id,event});
  emit({type:"response.created",response:{id}});
  emit({type:"response.output_item.done",item:{type:"function_call",call_id:id,name:"get_customer_context",arguments:"{}"}});
  emit({type:"response.completed",response:{id,output:[]}});
 };
 tool("before");await waitFor(()=>f.socket.sent.some(e=>e.type==="response.create"));
 assert.equal(f.tools.length,0);
 f.socket.receive({type:"session.output_transcript.delta",event_id:"disclosure",delta:"Hier ist Nia, der KI-Telefonassistent von NEONTRIP.",start_ms:0,end_ms:1000});
 tool("after");await waitFor(()=>f.tools.length===1);
 await waitFor(()=>f.socket.sent.some(e=>e.item?.call_id==="after"));
 assert.equal(JSON.parse(f.socket.sent.find(e=>e.item?.call_id==="after")!.item.output).email,"test@example.test");
 assert.ok(f.events.some(e=>e[2]==="disclosure.confirmed"));
 f.stop(true);
 f.socket.receive({type:"session.output_audio.delta",delta:Buffer.alloc(160,0xff).toString("base64")});
 f.socket.receive({type:"session.closed",reason:"close_requested"});await waitFor(()=>f.outcomes.length===1);
 assert.equal(f.outcomes[0][1].failureCode,"missing_structured_outcome","late model audio after a normal hangup is not a media failure");
});


test("aggregate timing audit is written only after the media connection closes", async () => {
 const f=fixture();f.media.timingMetrics=()=>({input_startup_buffer:2800,output_schedule_gap_peak:250});
 await f.adapter.connectMedia(session,f.media);f.socket.open();
 f.socket.receive({type:"session.started",session:{id:"live_timing",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 await waitFor(()=>f.events.length===1);
 assert.ok(!f.events.some(e=>e[2].startsWith("media.timing.")));
 f.socket.receive({type:"session.closed",reason:"close_requested"});await waitFor(()=>f.outcomes.length===1);
 await waitFor(()=>f.events.filter(e=>e[2].startsWith("media.timing.")).length===2);
 assert.deepEqual(f.events.filter(e=>e[2].startsWith("media.timing.")).map(e=>[e[2],e[4]]),[
  ["media.timing.input_startup_buffer",{duration_ms:2800}],
  ["media.timing.output_schedule_gap_peak",{duration_ms:250}],
 ]);
});


test("hanging up during the opening pause cancels the greeting", async (t) => {
 t.mock.timers.enable({apis:["setTimeout"]});
 const f=fixture();await f.adapter.connectMedia(session,f.media);f.socket.open();
 f.socket.receive({type:"session.started",session:{id:"live_early_close",model:"gpt-live-1",audio:{format:{type:"audio/pcmu",rate:8000},output:{voice:"marin"}}}});
 f.socket.receive({type:"session.closed",reason:"remote_hangup"});
 await waitFor(()=>f.outcomes.length===1);
 t.mock.timers.tick(1000);
 assert.ok(!f.socket.sent.some(e=>e.type==="session.instructions.append"));
});
