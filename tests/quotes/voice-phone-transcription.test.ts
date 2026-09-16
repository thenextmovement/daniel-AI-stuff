import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import WebSocket,{WebSocketServer} from "ws";
import {PhoneTranscriptChannel,OpenAiPhoneTranscription,phoneTranscriptionSession,type PhoneTranscriptSegment} from "../../services/voice-runtime/phone-transcription";
import {PhoneCaptureProtocol,phoneCaptureBinding,validPhoneCaptureBinding,validPhoneCaptureUpgrade} from "../../services/voice-runtime/phone-capture-protocol";
import {VoiceTranscriptBuffer} from "../../src/lib/ops/voice-transcript-buffer";
import {createHmac} from "node:crypto";
const audio=(bytes=160)=>Buffer.alloc(bytes,255).toString("base64");
const delta=(id:string,text:string)=>({type:"conversation.item.input_audio_transcription.delta",item_id:id,content_index:0,delta:text});
const final=(id:string,text:string)=>({type:"conversation.item.input_audio_transcription.completed",item_id:id,content_index:0,transcript:text});
const committed=(id:string)=>({type:"input_audio_buffer.committed",item_id:id});
function channel(prefix="capture_in",speaker:"customer"|"operator"="customer"){
 const sent:Record<string,unknown>[]=[],segments:PhoneTranscriptSegment[]=[];
 return {sent,segments,channel:new PhoneTranscriptChannel(prefix,speaker,event=>sent.push(event),segment=>segments.push(segment))};
}
test("live captions before commit retain the audio window and accept corrected final text",()=>{
 const f=channel();f.channel.append(audio(),1200);f.channel.receive(delta("i1","RAL 90"));
 f.channel.append(audio(),1220);f.channel.receive(delta("i1","13"));
 f.channel.finishInput();f.channel.receive(committed("i1"));f.channel.receive(final("i1","RAL 9031"));
 assert.equal(f.channel.complete,true);
 assert.deepEqual(f.segments.at(-1),{id:"capture_in:i1",speaker:"customer",text:"RAL 9031",revision:3,final:true,startMs:1200,endMs:1240});
 assert.equal(f.sent.filter(x=>x.type==="input_audio_buffer.commit").length,1);
 assert.equal(Buffer.from(f.sent.at(-2)!.audio as string,"base64").length,480,"only terminal silence pads the API minimum");
});
test("completion ordering follows captured audio rather than model arrival order",()=>{
 const f=channel();
 for(let i=0;i<10;i++)f.channel.append(audio(4000),i*500);
 f.channel.receive(committed("first"));
 for(let i=10;i<20;i++)f.channel.append(audio(4000),i*500);
 f.channel.receive(committed("second"));f.channel.finishInput();
 f.channel.receive(final("second","Zweite Aussage"));assert.equal(f.channel.complete,false);
 f.channel.receive(final("first","Erste Aussage"));assert.equal(f.channel.complete,true);
 assert.deepEqual(f.segments.map(x=>[x.id,x.startMs,x.endMs]),[["capture_in:second",5000,10000],["capture_in:first",0,5000]]);
});
test("separate customer and heard operator tracks never share transcript identities",()=>{
 const customer=channel("same_in"),operator=channel("same_out","operator");
 for(const f of [customer,operator]){f.channel.append(audio(),0);f.channel.receive(delta("sameItem","Ja"));f.channel.finishInput();f.channel.receive(committed("sameItem"));f.channel.receive(final("sameItem","Ja"));}
 assert.notEqual(customer.segments[0].id,operator.segments[0].id);
 assert.equal(operator.segments[0].speaker,"operator");
});
test("a final item is immutable and unknown or oversized model output fails capture",()=>{
 const f=channel();assert.throws(()=>f.channel.receive(delta("unknown","Hallo")),/unbound/);
 f.channel.append(audio(),0);f.channel.finishInput();f.channel.receive(committed("i1"));f.channel.receive(final("i1","Fertig"));
 const count=f.segments.length;f.channel.receive(final("i1","Fertig"));assert.equal(f.segments.length,count);
 assert.throws(()=>f.channel.receive(delta("i1"," geändert")),/after_final/);
 const tooLong=channel();tooLong.channel.append(audio(),0);
 assert.throws(()=>tooLong.channel.receive(delta("x","x".repeat(16001))),/invalid_transcription_text/);
});
test("a complete fifteen-minute pilot does not hit the pending-turn limit",()=>{
 const f=channel();
 for(let turn=0;turn<180;turn++){
  for(let chunk=0;chunk<5;chunk++)f.channel.append(audio(8000),turn*5000+chunk*1000);
  f.channel.receive(committed("i"+turn));f.channel.receive(final("i"+turn,"Abschnitt "+turn));
 }
 f.channel.finishInput();assert.equal(f.channel.complete,true);assert.equal(f.segments.length,180);
});
const cap="29500000-0000-4000-8000-000000000601",call="CA"+"1".repeat(32),account="AC"+"2".repeat(32),stream="MZ"+"3".repeat(32),secret="synthetic-capture-secret";
const start=()=>({event:"start",sequenceNumber:"1",streamSid:stream,start:{callSid:call,accountSid:account,streamSid:stream,
 tracks:["inbound","outbound"],mediaFormat:{encoding:"audio/x-mulaw",sampleRate:8000,channels:1},customParameters:{captureId:cap,binding:phoneCaptureBinding(cap,call,secret)}}});
function protocol(){
 const p=new PhoneCaptureProtocol();p.read(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
 const result=p.read(JSON.stringify(start()));return {p,result};
}
test("capture binding is namespaced and tied to exact call, account, origin and path",()=>{
 const {result}=protocol();assert.equal(result.type,"start");if(result.type!=="start")throw Error("start missing");
 assert(validPhoneCaptureBinding(result.start,account,secret));
 assert(!validPhoneCaptureBinding({...result.start,callSid:"CA"+"4".repeat(32)},account,secret));
 assert(!validPhoneCaptureBinding(result.start,"AC"+"9".repeat(32),secret));
 const origin="https://voice.example.test",token="test-auth",signature=createHmac("sha1",token).update(origin+"/media/phone").digest("base64");
 assert(validPhoneCaptureUpgrade("GET","/media/phone",signature,origin,token));
 assert(!validPhoneCaptureUpgrade("GET","/media/twilio",signature,origin,token));
 assert(!validPhoneCaptureUpgrade("GET","/media/phone?captureId="+cap,signature,origin,token));
 assert(!validPhoneCaptureUpgrade("GET","/media/phone",signature,"https://wrong.example.test",token));
});
test("two-track audio stays queued until admission, with independent gap detection",()=>{
 const {p}=protocol(),frames:unknown[]=[];
 const media=(seq:number,track:string,chunk:number)=>JSON.stringify({event:"media",sequenceNumber:String(seq),streamSid:stream,media:{track,chunk:String(chunk),timestamp:"0",payload:audio()}});
 p.read(media(2,"inbound",1));p.read(media(3,"outbound",1));
 assert.equal(frames.length,0);p.activate(frame=>frames.push(frame));
 assert.deepEqual(frames,[{track:"inbound",timestampMs:0,audio:audio()},{track:"outbound",timestampMs:0,audio:audio()}]);
 assert.throws(()=>p.read(media(4,"inbound",3)),/track_gap/);
});
test("actual local WebSockets finalize both tracks only after committed items and storage acknowledgment",async()=>{
 const server=createServer(),sockets=new WebSocketServer({server});
 const connections:WebSocket[]=[],saved=new Map<string,PhoneTranscriptSegment>();let failure=0,connectionIndex=0;
 sockets.on("connection",ws=>{
  connections.push(ws);const index=connectionIndex++;let opened=false;
  ws.on("message",raw=>{
   const event=JSON.parse(raw.toString());
   if(event.type==="session.update"){
    assert.deepEqual(event,phoneTranscriptionSession());
    ws.send(JSON.stringify({type:"session.updated",session:event.session}));
   }else if(event.type==="input_audio_buffer.append"){
    if(!opened){opened=true;ws.send(JSON.stringify(delta("turn_"+index,index?"Wir prüfen das.":"Bitte RAL 9031.")));}
   }else if(event.type==="input_audio_buffer.commit"){
    ws.send(JSON.stringify(committed("turn_"+index)));
    ws.send(JSON.stringify(final("turn_"+index,index?"Wir prüfen das.":"Bitte RAL 9031.")));
   }else assert.fail("Unexpected command: "+event.type);
  });
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const port=(server.address() as {port:number}).port;
 const buffer=new VoiceTranscriptBuffer(async segments=>{for(const segment of segments)saved.set(segment.id,segment as PhoneTranscriptSegment);});
 const config={openAiApiKey:"synthetic-api-key",openAiProjectId:"synthetic-project"} as never;
 const connect=(_url:string,options:WebSocket.ClientOptions)=>new WebSocket("ws://127.0.0.1:"+port,options);
 const a=new OpenAiPhoneTranscription(config,cap+"_in","customer",x=>buffer.stage(x),()=>failure++,connect);
 const b=new OpenAiPhoneTranscription(config,cap+"_out","operator",x=>buffer.stage(x),()=>failure++,connect);
 try{
  await Promise.all([a.start(),b.start()]);
  a.append(audio(),4000);b.append(audio(),4000);
  assert.deepEqual(await Promise.all([a.finish(),b.finish()]),[true,true]);await buffer.flush();
  assert.equal(failure,0);assert.equal(saved.size,2);
  assert([...saved.values()].every(x=>x.final&&x.startMs===4000&&x.endMs===4020));
  assert.deepEqual(new Set([...saved.values()].map(x=>x.speaker)),new Set(["customer","operator"]));
 }finally{a.abort();b.abort();for(const ws of connections)ws.terminate();sockets.close();await new Promise<void>(r=>server.close(()=>r()));}
});
