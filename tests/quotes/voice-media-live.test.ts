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
 const socket=new Socket(),saved:any[]=[],outcomes:any[]=[],audioOut:string[]=[];
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
   event:async()=>({ok:true,result:{duplicate:false}}),
  } as never,
  (url,options)=>{
   connections++;assert.equal(url,"wss://api.openai.com/v1/live/sessions");
   assert.equal((options.headers as Record<string,string>)["OpenAI-Project"],"proj_synthetic");
   return socket as never;
  },
 );
 return {socket,saved,outcomes,audioOut,adapter,media,input:(audio:string)=>audioIn?.(audio),stop:(clean:boolean)=>closeHandler?.(clean),get ready(){return !!audioIn;},get closed(){return closed;},get connections(){return connections;}};
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
 f.socket.receive({type:"session.started",session:{id:"live_test"}});
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
 await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_test"}});
 f.socket.receive({type:"session.closed",reason:"close_requested"});await tick();
 assert.equal(f.closed,false);assert.equal(f.outcomes.length,0);
 played(true);await waitFor(()=>f.outcomes.length===1);
 assert.equal(f.saved.at(-1)[2],"complete");
});
test("unplayed output and transport loss cannot be recorded as a complete transcript",async()=>{
 for(const loss of ["playback","transport"]){
  const f=fixture({playback:Promise.resolve(false)});
  await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_test"}});
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
 await f.adapter.connectMedia(session,f.media);f.socket.open();f.socket.receive({type:"session.started",session:{id:"live_finish_ack"}});
 f.socket.receive({type:"session.closed",reason:"close_requested"});
 await waitFor(()=>f.saved.some(x=>x[2]));
 assert.equal(f.outcomes.length,0);
 await new Promise(resolve=>setTimeout(resolve,600));
 assert.equal(f.saved.filter(x=>x[2]).length,2);
 assert.equal(f.outcomes.length,1);
});
