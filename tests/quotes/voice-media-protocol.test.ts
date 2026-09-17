import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { TwilioMediaProtocol, assertMediaAttempt, pcmuByteLength, validateMediaUpgrade } from "../../services/voice-runtime/media-protocol";
import { signAttemptBinding } from "../../services/voice-runtime/security";
const account="AC"+"1".repeat(32),call="CA"+"2".repeat(32),stream="MZ"+"3".repeat(32);
const attemptId="11111111-1111-4111-8111-111111111111", secret="synthetic-binding";
const start={streamSid:stream,accountSid:account,callSid:call,tracks:["inbound"],mediaFormat:{encoding:"audio/x-mulaw",sampleRate:8000,channels:1},customParameters:{attemptId,binding:signAttemptBinding(attemptId,secret)}};
const audio=Buffer.alloc(160,0xff).toString("base64");
function setup() {
 const sent:Record<string,unknown>[]=[],p=new TwilioMediaProtocol(e=>sent.push(e));
 p.read(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
 const event=p.read(JSON.stringify({event:"start",sequenceNumber:"1",streamSid:stream,start}));
 return {p,sent,event};
}
const media=(sequence=2,chunk=1,payload=audio)=>JSON.stringify({event:"media",sequenceNumber:String(sequence),streamSid:stream,media:{track:"inbound",chunk:String(chunk),timestamp:String((chunk-1)*20),payload}});
test("media signature uses only the configured origin and exact endpoint",()=>{
 const publicUrl="https://voice.example.test";
 const signed=(url:string)=>createHmac("sha1","test-token").update(url).digest("base64");
 for(const protocol of ["https","wss"])for(const tail of ["","/"]){
  const signature=signed(protocol+"://voice.example.test/media/twilio"+tail);
  assert.equal(validateMediaUpgrade({method:"GET",path:"/media/twilio",publicUrl,authToken:"test-token",signature}),true);
 }
 for(const path of ["/media/twilio?target=other","/other","//evil.test/media/twilio"]){
  assert.equal(validateMediaUpgrade({method:"GET",path,publicUrl,authToken:"test-token",signature:signed(publicUrl+"/media/twilio")}),false);
 }
 assert.equal(validateMediaUpgrade({method:"GET",path:"/media/twilio",publicUrl,authToken:"",signature:signed(publicUrl+"/media/twilio")}),false);
 assert.equal(validateMediaUpgrade({method:"GET",path:"/media/twilio",publicUrl,authToken:"test-token",signature:signed("https://evil.test/media/twilio")}),false);
});
test("media accepts only the matching internal Live attempt, provider call and account",()=>{
 const {event}=setup();assert.equal(event.type,"start");if(event.type!=="start")throw Error("start missing");
 const session={attemptId,providerCallId:call,allowlistOnly:true,modelId:"gpt-live-1"};
 assert.doesNotThrow(()=>assertMediaAttempt(event.start,session,account,secret));
 for(const s of [{...session,providerCallId:"CA"+"4".repeat(32)},{...session,allowlistOnly:false},{...session,modelId:"gpt-realtime-2.1"},{...session,attemptId:"22222222-2222-4222-8222-222222222222"}]){
  assert.throws(()=>assertMediaAttempt(event.start,s,account,secret));
 }
 assert.throws(()=>assertMediaAttempt(event.start,session,"AC"+"9".repeat(32),secret));
 assert.throws(()=>assertMediaAttempt(event.start,session,account,"wrong"));
});
test("input preserves raw G711, buffers startup and continues while assistant playback is pending",()=>{
 const {p,sent}=setup(),received:string[]=[];
 p.read(media());assert.equal(received.length,0);
 p.activateInput(a=>received.push(a));assert.deepEqual(received,[audio]);
 p.output(audio);assert.equal(p.playbackComplete,false);
 p.read(media(3,2));assert.deepEqual(received,[audio,audio]);
 assert.deepEqual(sent,[{event:"media",streamSid:stream,media:{payload:audio}},{event:"mark",streamSid:stream,mark:{name:"played-1"}}]);
 p.read(JSON.stringify({event:"mark",sequenceNumber:"4",streamSid:stream,mark:{name:"played-1"}}));
 assert.equal(p.playbackComplete,true);
});
test("only Twilio playback acknowledgements drain outgoing audio",()=>{
 const {p}=setup();p.output(audio);p.output(audio);
 assert.equal(p.peakPlaybackBufferMs,40);
 p.read(JSON.stringify({event:"mark",sequenceNumber:"2",streamSid:stream,mark:{name:"played-1"}}));
 assert.equal(p.playbackComplete,false);
 p.read(JSON.stringify({event:"mark",sequenceNumber:"3",streamSid:stream,mark:{name:"played-2"}}));
 assert.equal(p.playbackComplete,true);
 assert.equal(p.peakPlaybackBufferMs,40);
 assert.throws(()=>p.read(JSON.stringify({event:"mark",sequenceNumber:"4",streamSid:stream,mark:{name:"unknown"}})));
});
test("cross-stream input, dropped/repeated packets and unsupported codecs fail explicitly",()=>{
 assert.throws(()=>setup().p.read(media(3)));
 const p=setup().p;p.read(media());assert.throws(()=>p.read(media()));
 assert.throws(()=>setup().p.read(media().replace(stream,"MZ"+"4".repeat(32))));
 assert.throws(()=>setup().p.read(media(2,2)));
 const wrong=new TwilioMediaProtocol(()=>{});wrong.read(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
 assert.throws(()=>wrong.read(JSON.stringify({event:"start",sequenceNumber:"1",streamSid:stream,start:{...start,mediaFormat:{...start.mediaFormat,sampleRate:24000}}})));
});
test("startup and playback backlog are bounded without silently losing audio",()=>{
 const p=setup().p;
 for(let n=1;n<=250;n++)p.read(media(n+1,n));
 assert.throws(()=>p.read(media(252,251)),/startup_backlog/);
 const output=setup().p;
 for(let n=0;n<400;n++)output.output(audio);
 assert.throws(()=>output.output(audio),/playback_backlog/);
});
test("a matching stop closes the channel and unplayed output stays incomplete",()=>{
 const {p}=setup();p.output(audio);
 const stop={event:"stop",sequenceNumber:"2",streamSid:stream,stop:{accountSid:account,callSid:call}};
 assert.equal(p.read(JSON.stringify(stop)).type,"stop");
 assert.equal(p.playbackComplete,false);
 assert.throws(()=>p.output(audio));assert.throws(()=>p.activateInput(()=>{}));
 assert.throws(()=>setup().p.read(JSON.stringify({...stop,stop:{accountSid:account,callSid:"CA"+"9".repeat(32)}})));
});
test("malformed base64 cannot become silently altered audio",()=>{
 assert.equal(pcmuByteLength(audio),160);
 for(const invalid of ["","???","AA","AB==","AAAA\n",null])assert.throws(()=>pcmuByteLength(invalid));
});


test("invalid public origin fails closed without throwing in the upgrade handler", () => {
  assert.equal(validateMediaUpgrade({method:"GET",path:"/media/twilio",publicUrl:"not a URL",authToken:"test",signature:"test"}), false);
});


test("timings separate startup backlog, incoming jitter, model gaps and playback acknowledgement", () => {
 let now=0;const sent:Record<string,unknown>[]=[],received:string[]=[];
 const p=new TwilioMediaProtocol(e=>sent.push(e),()=>now);
 p.read(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
 p.read(JSON.stringify({event:"start",sequenceNumber:"1",streamSid:stream,start}));
 p.read(media());now=20;p.read(media(3,2));now=100;p.read(media(4,3));
 now=200;p.activateInput(a=>received.push(a));
 assert.deepEqual(received,[audio,audio,audio]);
 now=250;p.output(audio);now=270;p.output(audio);
 now=330;p.output(audio); // 40 ms without locally scheduled audio, possibly natural silence.
 now=380;p.read(JSON.stringify({event:"mark",sequenceNumber:"5",streamSid:stream,mark:{name:"played-3"}}));
 assert.deepEqual(p.timingMetrics,{input_startup_buffer:60,input_delivery_excess_peak:60,
   output_schedule_gap_peak:40,playback_ack_peak:130,first_model_audio:50});
 assert.equal(p.playbackComplete,true);
 assert.deepEqual(sent.filter(e=>e.event==="media").map(e=>(e.media as {payload:string}).payload),[audio,audio,audio]);
});

test("normal incoming cadence and buffered output are not counted as timing gaps", () => {
 let now=0;const p=new TwilioMediaProtocol(()=>{},()=>now);
 p.read(JSON.stringify({event:"connected",protocol:"Call",version:"1.0.0"}));
 p.read(JSON.stringify({event:"start",sequenceNumber:"1",streamSid:stream,start}));
 p.activateInput(()=>{});p.read(media());now=20;p.read(media(3,2));
 p.output(audio);now=25;p.output(audio);
 assert.equal(p.timingMetrics.input_delivery_excess_peak,0);
 assert.equal(p.timingMetrics.output_schedule_gap_peak,0);
 assert.equal(p.timingMetrics.input_startup_buffer,0);
});
