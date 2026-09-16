import type {Server} from "node:http";
import WebSocket,{WebSocketServer} from "ws";
import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import type {OpsClient} from "./ops-client.js";
import {PhoneCaptureProtocol,PHONE_CAPTURE_PATH,phoneCaptureBinding,validPhoneCaptureBinding,validPhoneCaptureUpgrade,type PhoneCaptureStart} from "./phone-capture-protocol.js";
import {OpenAiPhoneTranscription,type PhoneTranscriptSegment} from "./phone-transcription.js";
export type PhoneCaptureRecord={id:string;call_id:string;customer_call_sid:string;state:"reserved"|"dispatching"|"active"|"complete"|"interrupted";stream_sid:string|null;created_at:string;stream_started_at:string|null;ended_at:string|null;updated_at:string;cleanup_pending:boolean};
type CaptureReply={capture:PhoneCaptureRecord;dispatch?:boolean;offsetMs?:number};
type CaptureStore=Pick<OpsClient,"captureAction">;
export interface CaptureProvider{start(capture:PhoneCaptureRecord):Promise<void>;stop(capture:PhoneCaptureRecord):Promise<void>;}
export function phoneCaptureReady(config:RuntimeConfig){
 return config.phoneTranscriptionEnabled&&config.teamPhoneEnabled&&!!config.openAiApiKey&&!!config.sipBindingSecret&&!!config.twilioAccountSid&&!!config.twilioAuthToken;
}
export class TwilioCaptureProvider implements CaptureProvider{
 private client:ReturnType<typeof twilio>;
 constructor(private config:RuntimeConfig){this.client=twilio(config.twilioAccountSid,config.twilioAuthToken,{timeout:10000,autoRetry:false});}
 async start(c:PhoneCaptureRecord){
  const url=new URL(PHONE_CAPTURE_PATH,this.config.publicUrl);url.protocol="wss:";
  await this.client.calls(c.customer_call_sid).streams.create({name:"ntcapture_"+c.id,track:"both_tracks",url:url.toString(),
   "parameter1.name":"captureId","parameter1.value":c.id,"parameter2.name":"binding","parameter2.value":phoneCaptureBinding(c.id,c.customer_call_sid,this.config.sipBindingSecret)});
 }
 async stop(c:PhoneCaptureRecord){
  try{await this.client.calls(c.customer_call_sid).streams(c.stream_sid||"ntcapture_"+c.id).update({status:"stopped"});}
  catch(error){
   if((error as {status?:number}).status!==404)throw error;
   // A not-yet-visible stream after an uncertain create must not be treated
   // as stopped while the customer call is still alive.
   const call=await this.client.calls(c.customer_call_sid).fetch();
   if(!["completed","failed","busy","no-answer","canceled"].includes(call.status))throw Error("capture_cleanup_unconfirmed");
  }
 }
}
export class PhoneCaptures{
 constructor(private store:CaptureStore,private provider:CaptureProvider,private admission:()=>boolean){}
 async kick(id:string){
  let {capture}=await this.store.captureAction<CaptureReply>({action:"get",captureId:id});
  if(capture.state==="reserved"&&this.admission()){
   const claimed=await this.store.captureAction<CaptureReply>({action:"claim",captureId:id});
   capture=claimed.capture;
   if(claimed.dispatch){
    try{await this.provider.start(capture);}
    catch{
     // Never retry stream creation. A late provider acknowledgement is
     // reconciled by stopping the named stream; the phone call stays alive.
     capture=(await this.store.captureAction<CaptureReply>({action:"interrupt",captureId:id,updatedAt:capture.updated_at})).capture;
    }
   }
  }
  if(capture.cleanup_pending){
   await this.provider.stop(capture);
   await this.store.captureAction({action:"cleanup",captureId:id,updatedAt:capture.updated_at});
  }
 }
 async reconcile(){
  const {captures}=await this.store.captureAction<{captures:PhoneCaptureRecord[]}>({action:"pending"});
  for(let c of captures)try{
   if(!c.ended_at&&((c.state!=="reserved"&&Date.parse(c.updated_at)<Date.now()-45000)||!this.admission())){
    c=(await this.store.captureAction<CaptureReply>({action:"interrupt",captureId:c.id,updatedAt:c.updated_at})).capture;
   }
   await this.kick(c.id);
  }catch{console.warn("phone capture recovery pending",c.id);}
 }
}
type Transcriber=Pick<OpenAiPhoneTranscription,"start"|"append"|"finish"|"abort">;
export type PhoneTranscriberFactory=(prefix:string,speaker:"customer"|"operator",stage:(segment:PhoneTranscriptSegment)=>void,failure:()=>void)=>Transcriber;
export function installPhoneCapture(server:Server,config:RuntimeConfig,store:CaptureStore,controls:PhoneCaptures|null,
 factory:PhoneTranscriberFactory=(prefix,speaker,stage,failure)=>new OpenAiPhoneTranscription(config,prefix,speaker,stage,failure)){
 const sockets=new WebSocketServer({noServer:true,maxPayload:128000,perMessageDeflate:false});
 const finishing=new Set<Promise<void>>();
 const closeSessions=new Set<()=>Promise<void>>();
 server.on("upgrade",(request,socket,head)=>{
  const path=(request.url||"").split("?")[0];
  if(path!==PHONE_CAPTURE_PATH&&path!==PHONE_CAPTURE_PATH+"/")return;
  const signature=request.headers["x-twilio-signature"];
  if(!phoneCaptureReady(config)||!validPhoneCaptureUpgrade(request.method,request.url,typeof signature==="string"?signature:undefined,config.publicUrl,config.twilioAuthToken)){
   socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");return;
  }
  sockets.handleUpgrade(request,socket,head,connect);
 });
 function connect(ws:WebSocket){
  const protocol=new PhoneCaptureProtocol(),pending=new Map<string,PhoneTranscriptSegment>();
  let start:PhoneCaptureStart|null=null,bound=false,offset=0,closed=false,flushing:Promise<void>|null=null,heartbeat:ReturnType<typeof setInterval>|undefined;
  let channels:{inbound:Transcriber;outbound:Transcriber}|null=null;
  let ended:Promise<void>|null=null;
  const startup=setTimeout(()=>void finish(false),12000);
  const shutdown=()=>finish(false);closeSessions.add(shutdown);
  const flush=():Promise<void>=>{
   if(flushing)return flushing;
   flushing=(async()=>{
    while(pending.size){
     const batch:PhoneTranscriptSegment[]=[];let bytes=0;
     for(const segment of pending.values()){
      const size=Buffer.byteLength(JSON.stringify(segment));
      if(size>54000)throw Error("capture_segment_too_large");
      if(batch.length&&(batch.length>=50||bytes+size>54000))break;
      batch.push({...segment});bytes+=size;
     }
     const reply=await store.captureAction<{saved:boolean}>({action:"persist",captureId:start!.captureId,streamSid:start!.streamSid,segments:batch});
     if(!reply.saved)throw Error("capture_save_not_acknowledged");
     for(const segment of batch)if(pending.get(segment.id)?.revision===segment.revision)pending.delete(segment.id);
    }
   })().finally(()=>{flushing=null;});
   return flushing;
  };
  const stage=(segment:PhoneTranscriptSegment)=>{
   if(pending.size>=512&&!pending.has(segment.id))throw Error("capture_persistence_backlog");
   pending.set(segment.id,{...segment,startMs:segment.startMs+offset,endMs:segment.endMs===null?null:segment.endMs+offset});
  };
  function finish(clean:boolean):Promise<void>{
   if(ended)return ended;
   closed=true;clearTimeout(startup);clearInterval(heartbeat);
   ended=(async()=>{
    try{
     if(channels){
      const outcomes=await Promise.all([channels.inbound.finish(),channels.outbound.finish()]);
      clean=clean&&outcomes.every(Boolean);
     }else clean=false;
     if(bound&&start){
      await flush();
      // Twilio stream stop and call-ended callbacks can arrive in either order.
      // Wait briefly for the saved call end before claiming complete coverage.
      if(clean)for(let attempt=0;attempt<7;attempt++){
       const status=await store.captureAction<{saved:boolean;callEnded:boolean;captureState:string}>({action:"persist",captureId:start.captureId,streamSid:start.streamSid,segments:[]});
       if(!status.saved)throw Error("capture_end_not_acknowledged");
       if(status.captureState==="interrupted"){clean=false;break;}
       if(status.callEnded)break;
       if(attempt===6){clean=false;break;}
       await new Promise<void>(resolve=>setTimeout(resolve,500));
      }
      const reply=await store.captureAction<{saved:boolean}>({action:"persist",captureId:start.captureId,streamSid:start.streamSid,segments:[],finish:clean?"complete":"interrupted"});
      if(!reply.saved)throw Error("capture_finish_not_acknowledged");
     }
    }catch{
     if(bound&&start)await store.captureAction({action:"interrupt",captureId:start.captureId}).catch(()=>{});
    }finally{
     if(channels){channels.inbound.abort();channels.outbound.abort();}
     ws.close(1000,"transcription ended");
     if(bound&&start)await controls?.kick(start.captureId).catch(()=>{});
     closeSessions.delete(shutdown);
    }
   })();
   finishing.add(ended);void ended.finally(()=>finishing.delete(ended!));return ended;
  }
  async function bind(s:PhoneCaptureStart){
   if(!validPhoneCaptureBinding(s,config.twilioAccountSid,config.sipBindingSecret))throw Error("capture_signature_rejected");
   const reply=await store.captureAction<CaptureReply>({action:"bind",captureId:s.captureId,callSid:s.callSid,streamSid:s.streamSid});
   bound=true;offset=reply.offsetMs??-1;
   if(!Number.isInteger(offset)||offset<0||offset>86400000||reply.capture.id!==s.captureId||reply.capture.stream_sid!==s.streamSid)throw Error("capture_binding_rejected");
   if(closed){
    await store.captureAction({action:"interrupt",captureId:s.captureId});await controls?.kick(s.captureId);return;
   }
   const failure=()=>{void finish(false);};
   channels={inbound:factory(s.captureId+":inbound","customer",stage,failure),outbound:factory(s.captureId+":outbound","operator",stage,failure)};
   await Promise.all([channels.inbound.start(),channels.outbound.start()]);
   if(closed)return;
   protocol.activate(frame=>channels![frame.track].append(frame.audio,frame.timestampMs));
   clearTimeout(startup);
   let syncing=false;
   heartbeat=setInterval(()=>{
    if(syncing||closed)return;syncing=true;
    void (async()=>{
     await flush();
     const result=await store.captureAction<{saved:boolean;captureState:string;callEnded:boolean}>({action:"persist",captureId:s.captureId,streamSid:s.streamSid,segments:[]});
     if(!result.saved)throw Error("capture_heartbeat_unconfirmed");
     if(result.captureState==="interrupted"||!phoneCaptureReady(config))void finish(false);
     else if(result.callEnded)void finish(true);
    })().catch(()=>{void finish(false);}).finally(()=>{syncing=false;});
   },2000);
  }
  ws.on("message",(data,binary)=>{
   if(closed)return;
   try{
    if(binary)throw Error("capture_binary_event");
    const event=protocol.read(data.toString());
    if(event.type==="start"){start=event.start;void bind(start).catch(()=>{void finish(false);});}
    else if(event.type==="stop")void finish(true);
   }catch{void finish(false);}
  });
  ws.on("error",()=>{void finish(false);});
  ws.on("close",()=>{void finish(false);});
 }
 return async()=>{
  await Promise.all([...closeSessions].map(stop=>stop()));
  await Promise.all([...finishing]);
  sockets.close();
 };
}
