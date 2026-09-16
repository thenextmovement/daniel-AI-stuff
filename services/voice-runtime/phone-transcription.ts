import WebSocket from "ws";
import type {RuntimeConfig} from "./config.js";
import {pcmuByteLength} from "./media-protocol.js";

export type PhoneTranscriptSegment={id:string;speaker:"customer"|"operator";text:string;revision:number;final:boolean;startMs:number;endMs:number|null};
type Window={startMs:number;endMs:number;bytes:number;text:string;revision:number;final:boolean;finalText?:string;itemId?:string};
export const PHONE_TRANSCRIPTION_MODEL="gpt-live-transcribe";
export function phoneTranscriptionSession(){
 return {type:"session.update",session:{type:"transcription",audio:{input:{
  format:{type:"audio/pcmu"},transcription:{model:PHONE_TRANSCRIPTION_MODEL,languages:["de"],delay:"low",keywords:["NEONTRIP","RAL"]},
  turn_detection:null,
 }}}};
}
/** Audio-window times come from Twilio, never from delayed model completions.
 * No word timestamps or guessed individual staff names are manufactured. */
export class PhoneTranscriptChannel{
 private window:Window|null=null;
 private readonly pending:Window[]=[];
 private readonly items=new Map<string,Window>();
 private lastEnd=0;
 private stopping=false;
 private failed=false;
 constructor(private readonly prefix:string,private readonly speaker:"customer"|"operator",
  private readonly send:(message:Record<string,unknown>)=>void,private readonly stage:(segment:PhoneTranscriptSegment)=>void){
  if(!/^[a-zA-Z0-9:_-]{1,100}$/.test(prefix))throw Error("invalid_transcription_binding");
 }
 append(audio:string,startMs:number){
  if(this.stopping||this.failed)throw Error("transcription_closed");
  const bytes=pcmuByteLength(audio);
  if(!Number.isInteger(startMs)||startMs<0||startMs<this.lastEnd-1||bytes>8000||startMs+bytes/8>86400000)
   throw Error("invalid_transcription_audio_time");
  const endMs=Math.ceil(startMs+bytes/8);this.lastEnd=endMs;
  if(!this.window)this.window={startMs,endMs,bytes:0,text:"",revision:0,final:false};
  this.window.endMs=endMs;this.window.bytes+=bytes;
  this.send({type:"input_audio_buffer.append",audio});
  // Continuous deltas arrive before this commit. Bounded turns preserve a
  // stable final-revision identity and limit the amount pending at call end.
  if(this.window.bytes>=40000)this.commit();
 }
 private commit(){
  if(!this.window)return;
  if(this.pending.length+[...this.items.values()].filter(x=>!x.final).length>=64 || this.items.size>=512)throw Error("transcription_backlog");
  const window=this.window;this.window=null;
  if(window.bytes<800)this.send({type:"input_audio_buffer.append",audio:Buffer.alloc(800-window.bytes,255).toString("base64")});
  this.pending.push(window);
  this.send({type:"input_audio_buffer.commit"});
 }
 finishInput(){if(this.stopping)return;this.stopping=true;this.commit();}
 receive(event:Record<string,unknown>){
  if(this.failed)return;
  if(event.type==="error" || event.type==="conversation.item.input_audio_transcription.failed"){
   this.failed=true;throw Error("transcription_provider_failed");
  }
  if(event.type==="input_audio_buffer.committed"){
   const id=this.itemId(event.item_id);
   const window=this.pending.shift();if(!window || (window.itemId && window.itemId!==id))throw Error("unexpected_transcription_commit");
   if(this.items.has(id) && this.items.get(id)!==window)throw Error("duplicate_transcription_commit");
   window.itemId=id;this.items.set(id,window);return;
  }
  if(event.type!=="conversation.item.input_audio_transcription.delta" && event.type!=="conversation.item.input_audio_transcription.completed")return;
  if(event.content_index!==0)throw Error("invalid_transcription_content_index");
  const id=this.itemId(event.item_id);
  let item=this.items.get(id);
  if(!item){
   // GPT-Live-Transcribe can caption the still-open audio window before commit.
   // The connection has one uncommitted turn; committed windows keep FIFO
   // acknowledgment order, while their final transcripts may arrive out of order.
   item=this.pending.find(window=>!window.itemId)||(this.window?.itemId?undefined:this.window)||undefined;
   if(!item)throw Error("unbound_transcription_item");
   item.itemId=id;this.items.set(id,item);
  }
  const final=event.type==="conversation.item.input_audio_transcription.completed";
  if(final&&item===this.window)throw Error("transcription_final_before_commit");
  const fragment=final?event.transcript:event.delta;
  if(typeof fragment!=="string" || fragment.includes("\u0000") || fragment.length>16000)throw Error("invalid_transcription_text");
  if(item.final){
   if(final && item.finalText===fragment)return;
   throw Error("transcription_changed_after_final");
  }
  const text=final?fragment:item.text+fragment;
  if(text.length>16000 || (final&&!text&&item.text))throw Error("invalid_transcription_text");
  item.text=text;item.final=final;if(final)item.finalText=fragment;
  if(text)this.stage({id:this.prefix+":"+id,speaker:this.speaker,text,revision:++item.revision,final,startMs:item.startMs,endMs:final?item.endMs:null});
 }
 private itemId(value:unknown){
  if(typeof value!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw Error("invalid_transcription_item");
  return value;
 }
 get complete(){return this.stopping&&!this.failed&&!this.window&&!this.pending.length&&[...this.items.values()].every(x=>x.final);}
}
// Socket ownership stays entirely on the server. No model output is routed
// into the customer call; this connection can only produce transcript text.
export class OpenAiPhoneTranscription{
 private readonly socket:WebSocket;
 private readonly channel:PhoneTranscriptChannel;
 private ready=false;
 private failed=false;
 private done:(complete:boolean)=>void=()=>{};
 private closing=false;
 private readonly opened:Promise<void>;
 constructor(config:RuntimeConfig,prefix:string,speaker:"customer"|"operator",stage:(segment:PhoneTranscriptSegment)=>void,
  private readonly failure:()=>void,
  connect:(url:string,options:WebSocket.ClientOptions)=>WebSocket=(url,options)=>new WebSocket(url,options)){
  if(!config.openAiApiKey)throw Error("transcription_not_configured");
  this.socket=connect("wss://api.openai.com/v1/realtime?intent=transcription",{headers:{
   Authorization:"Bearer "+config.openAiApiKey,...(config.openAiProjectId?{"OpenAI-Project":config.openAiProjectId}:{}),
  },maxPayload:128000,perMessageDeflate:false,handshakeTimeout:8000});
  this.channel=new PhoneTranscriptChannel(prefix,speaker,event=>{
   if(this.socket.readyState!==WebSocket.OPEN || this.socket.bufferedAmount>128000)throw Error("transcription_socket_backlog");
   this.socket.send(JSON.stringify(event));
  },stage);
  this.opened=new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>fail(),8000);
   const fail=()=>{clearTimeout(timeout);reject(Error("transcription_start_failed"));this.fail();};
   this.socket.on("open",()=>{
    try{this.socket.send(JSON.stringify(phoneTranscriptionSession()));}catch{fail();}
   });
   this.socket.on("message",(raw,binary)=>{
    try{
     if(binary)throw Error("transcription_binary_event");
     const event=JSON.parse(raw.toString());
     if(!event || typeof event!=="object" || Array.isArray(event))throw Error("transcription_invalid_event");
     if(!this.ready){
      if(event.type==="session.created")return;
      if(event.type!=="session.updated")throw Error("transcription_not_ready");
      if(event.session?.type!=="transcription" || event.session.audio?.input?.transcription?.model!==PHONE_TRANSCRIPTION_MODEL ||
       event.session.audio?.input?.format?.type!=="audio/pcmu" || event.session.audio?.input?.turn_detection!==null)
       throw Error("transcription_model_mismatch");
      this.ready=true;clearTimeout(timeout);resolve();return;
     }
     this.channel.receive(event);
     if(this.channel.complete)this.done(true);
    }catch{fail();}
   });
   this.socket.on("error",()=>fail());
   this.socket.on("close",()=>{clearTimeout(timeout);if(!this.closing)fail();});
  });
  // Connectors can register/start both channels before awaiting them.
  void this.opened.catch(()=>{});
 }
 async start(){await this.opened;if(this.failed)throw Error("transcription_start_failed");}
 append(audio:string,startMs:number){
  if(!this.ready||this.failed||this.closing)throw Error("transcription_not_ready");
  try{this.channel.append(audio,startMs);}catch(error){this.fail();throw error;}
 }
 async finish(){
  if(this.failed||!this.ready){this.close();return false;}
  let timer:ReturnType<typeof setTimeout>|undefined;
  const result=new Promise<boolean>(resolve=>{this.done=resolve;timer=setTimeout(()=>resolve(false),8000);});
  try{this.channel.finishInput();if(this.channel.complete)this.done(true);}catch{this.done(false);}
  const complete=await result;clearTimeout(timer);this.close();return complete&&!this.failed;
 }
 abort(){this.fail();}
 private fail(){
  if(this.failed)return;this.failed=true;this.done(false);this.failure();this.close();
 }
 private close(){this.closing=true;this.socket.close();}
}
