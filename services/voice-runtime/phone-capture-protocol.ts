import {createHmac,timingSafeEqual} from "node:crypto";
import {pcmuByteLength} from "./media-protocol.js";
import {verifyTwilioSignature} from "./security.js";
export const PHONE_CAPTURE_PATH="/media/phone";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CA=/^CA[a-f0-9]{32}$/i,MZ=/^MZ[a-f0-9]{32}$/i,AC=/^AC[a-f0-9]{32}$/i;
export type PhoneAudioTrack="inbound"|"outbound";
export type PhoneAudioFrame={track:PhoneAudioTrack;audio:string;timestampMs:number};
export type PhoneCaptureStart={captureId:string;callSid:string;streamSid:string;accountSid:string;binding:string};
export function phoneCaptureBinding(captureId:string,callSid:string,secret:string){
 if(!UUID.test(captureId)||!CA.test(callSid)||!secret)throw Error("invalid_capture_binding");
 return createHmac("sha256",secret).update("neontrip:phone-capture:"+captureId+":"+callSid).digest("hex");
}
export function validPhoneCaptureBinding(start:PhoneCaptureStart,accountSid:string,secret:string){
 if(!secret||start.accountSid!==accountSid||!UUID.test(start.captureId)||!CA.test(start.callSid)||!MZ.test(start.streamSid)||!/^[a-f0-9]{64}$/.test(start.binding))return false;
 return timingSafeEqual(Buffer.from(phoneCaptureBinding(start.captureId,start.callSid,secret),"hex"),Buffer.from(start.binding,"hex"));
}
export function validPhoneCaptureUpgrade(method:string|undefined,path:string|undefined,signature:string|undefined,publicUrl:string,authToken:string){
 if(method!=="GET"||![PHONE_CAPTURE_PATH,PHONE_CAPTURE_PATH+"/"].includes(path||"")||!authToken)return false;
 let origin:URL;try{origin=new URL(publicUrl);}catch{return false;}
 if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)return false;
 return ["https:","wss:"].some(protocol=>["","/"].some(suffix=>{
  const url=new URL(PHONE_CAPTURE_PATH+suffix,origin);url.protocol=protocol;url.port="";
  return verifyTwilioSignature({signature,url:url.toString(),params:new URLSearchParams(),authToken});
 }));
}
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid_capture_object");
 return value as Record<string,unknown>;
};
const integer=(value:unknown)=>{
 if(typeof value!=="string"||!/^\d{1,10}$/.test(value))throw Error("invalid_capture_sequence");
 return Number(value);
};
/** One customer call with two separate tracks, carried through staff transfers.
 * The outbound track is what this customer hears, not the private conference. */
export class PhoneCaptureProtocol{
 private connected=false;
 private start:PhoneCaptureStart|null=null;
 private stopped=false;
 private sequence=0;
 private readonly chunks={inbound:0,outbound:0};
 private readonly times={inbound:0,outbound:0};
 private queued:PhoneAudioFrame[]=[];
 private queuedBytes=0;
 private consume:((frame:PhoneAudioFrame)=>void)|null=null;
 read(raw:string){
  if(Buffer.byteLength(raw)>128000||this.stopped)throw Error("capture_closed_or_oversized");
  const e=object(JSON.parse(raw));
  if(e.event==="connected"){
   if(this.connected||e.protocol!=="Call"||e.version!=="1.0.0")throw Error("invalid_capture_connection");
   this.connected=true;return {type:"connected" as const};
  }
  if(!this.connected||integer(e.sequenceNumber)!==++this.sequence)throw Error("capture_sequence_gap");
  if(e.event==="start"){
   if(this.start)throw Error("duplicate_capture_start");
   const s=object(e.start),format=object(s.mediaFormat),p=object(s.customParameters);
   if(typeof e.streamSid!=="string"||!MZ.test(e.streamSid)||e.streamSid!==s.streamSid||
    typeof s.callSid!=="string"||!CA.test(s.callSid)||typeof s.accountSid!=="string"||!AC.test(s.accountSid)||
    !Array.isArray(s.tracks)||s.tracks.length!==2||!s.tracks.includes("inbound")||!s.tracks.includes("outbound")||
    format.encoding!=="audio/x-mulaw"||format.sampleRate!==8000||format.channels!==1||
    typeof p.captureId!=="string"||!UUID.test(p.captureId)||typeof p.binding!=="string"||!/^[a-f0-9]{64}$/.test(p.binding))
    throw Error("invalid_capture_start");
   this.start={captureId:p.captureId,callSid:s.callSid,accountSid:s.accountSid,streamSid:e.streamSid,binding:p.binding};
   return {type:"start" as const,start:this.start};
  }
  if(!this.start||e.streamSid!==this.start.streamSid)throw Error("capture_stream_mismatch");
  if(e.event==="media"){
   const m=object(e.media),track=m.track;
   if(track!=="inbound"&&track!=="outbound")throw Error("invalid_capture_track");
   const bytes=pcmuByteLength(m.payload),chunk=integer(m.chunk),timestampMs=integer(m.timestamp);
   if(bytes>8000||timestampMs>86400000||chunk!==this.chunks[track]+1||timestampMs<this.times[track])throw Error("capture_track_gap");
   this.chunks[track]=chunk;this.times[track]=timestampMs;
   const frame:PhoneAudioFrame={track,audio:m.payload as string,timestampMs};
   if(this.consume)this.consume(frame);
   else{
    if(this.queuedBytes+bytes>80000)throw Error("capture_startup_backlog");
    this.queued.push(frame);this.queuedBytes+=bytes;
   }
   return {type:"audio" as const};
  }
  if(e.event==="stop"){
   const stop=object(e.stop);
   if(stop.callSid!==this.start.callSid||stop.accountSid!==this.start.accountSid)throw Error("capture_stop_mismatch");
   this.stopped=true;return {type:"stop" as const};
  }
  throw Error("unsupported_capture_event");
 }
 activate(consume:(frame:PhoneAudioFrame)=>void){
  if(!this.start||this.stopped||this.consume)throw Error("capture_not_startable");
  this.consume=consume;
  for(const frame of this.queued)consume(frame);
  this.queued=[];this.queuedBytes=0;
 }
}
