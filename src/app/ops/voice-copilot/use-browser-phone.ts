"use client";
import {useEffect,useRef,useState} from "react";
import type {Call,Device} from "@twilio/voice-sdk";
import type {PhoneIdentity} from "@/lib/ops/voice-phone-contract";
import {readPhoneCentralResponse} from "./phone-central-data";

export type BrowserCall = {id:string;state:string;direction?:"inbound"|"outbound";phone:string;connected:boolean;endedAt:string|null;cleanupPending:boolean;isTest:boolean;customerId?:string|null;requestId?:string|null};
export type PhoneTransferView = {id:string;state:string;fromStaffId:string;toStaffId:string;call:BrowserCall;role:"source"|"recipient";fromName:string;toName:string;
 expiresAt:string;targetJoined:boolean;cancelRequested:boolean;ownerAdopted:boolean;endedAt:string|null;cleanupPending:boolean};
export type IncomingPhoneView = {id:string;phone:string;displayName:string|null;customerId:string|null;requestId:string|null;expiresAt:string;state:string};
export type PhoneDialTarget = {customerId?:string;requestId?:string|null;phone?:string};
const terminal=(call:BrowserCall)=>!!call.endedAt && !call.cleanupPending;
async function phoneJson<T>(path:string,body?:Record<string,unknown>):Promise<T> {
 const response=await fetch("/api/ops/voice-phone"+path,{...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),
  cache:"no-store",signal:AbortSignal.timeout(body?.action==="cancel"?22000:15000)});
 return readPhoneCentralResponse<T>(response,"Der Telefonanschluss ist gerade nicht erreichbar.");
}
export function useBrowserPhone(identity:PhoneIdentity|null,otherBusy:boolean) {
 const [registered,setRegistered]=useState(false),[working,setWorking]=useState(false);
 const [call,setCall]=useState<BrowserCall|null>(null),[muted,setMuted]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [transfer,setTransfer]=useState<PhoneTransferView|null>(null),[incoming,setIncoming]=useState<PhoneTransferView|null>(null);
 const [externalIncoming,setExternalIncoming]=useState<IncomingPhoneView|null>(null);
 const externalOffer=useRef<IncomingPhoneView|null>(null);
 const device=useRef<Device|null>(null),audioCall=useRef<Call|null>(null),active=useRef<BrowserCall|null>(null);
 const activeTransfer=useRef<PhoneTransferView|null>(null),offer=useRef<PhoneTransferView|null>(null);
 const generation=useRef(0),starting=useRef(false),polling=useRef(false),ending=useRef(false);
 const request=useRef<{key:string;target:string}|null>(null),transferRequest=useRef<{key:string;callId:string;target:string}|null>(null);
 const profileId=identity?.device?.id||null;
 const allowed=!!identity?.browserCallingAvailable && !!profileId;
 function updateCall(value:BrowserCall|null) {active.current=value;setCall(value);}
 function updateTransfer(value:PhoneTransferView|null) {activeTransfer.current=value;setTransfer(value);}
 function updateOffer(value:PhoneTransferView|null) {offer.current=value;setIncoming(value);}
 function updateExternalOffer(value:IncomingPhoneView|null) {
  if(value&&value.id!==externalOffer.current?.id)setNotice("");
  externalOffer.current=value;setExternalIncoming(value);
 }
 function releaseAudio() {const old=audioCall.current;audioCall.current=null;old?.disconnect();setMuted(false);}
 function releaseCall() {releaseAudio();updateCall(null);request.current=null;ending.current=false;setWorking(false);}
 async function presence(online:boolean) {
  try{await phoneJson("",{action:"presence",registered:online,available:online&&!active.current&&!activeTransfer.current&&!offer.current&&!otherBusy});}
  catch{setError("Dein Telefonstatus konnte nicht bestätigt werden.");}
 }
 // The device credential is independent of the general Ops login.
 useEffect(()=>{
  generation.current++;const currentGeneration=generation.current;
  return ()=>{
   if(generation.current===currentGeneration)generation.current++;
   const old=device.current;device.current=null;audioCall.current=null;active.current=null;
   activeTransfer.current=null;offer.current=null;externalOffer.current=null;old?.destroy();
  };
 },[profileId]);
 useEffect(()=>{
  setRegistered(false);setWorking(false);setCall(null);setTransfer(null);setIncoming(null);setExternalIncoming(null);setMuted(false);setError("");setNotice("");
  starting.current=false;ending.current=false;request.current=null;transferRequest.current=null;
 },[profileId]);
 useEffect(()=>{
  if(!registered)return;
  const timer=window.setInterval(()=>{void presence(true);},15000);
  void presence(true);return ()=>window.clearInterval(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[registered,!!call,!!transfer,!!incoming,otherBusy,profileId]);
 async function refreshTransfer() {
  const current=activeTransfer.current;if(!current)return;
  const epoch=generation.current;
  const {transfer:t}=await phoneJson<{transfer:PhoneTransferView}>("/transfers?id="+encodeURIComponent(current.id));
  if(epoch!==generation.current || activeTransfer.current?.id!==current.id)return;
  if(t.id!==current.id || t.call.id!==current.call.id || t.role!==current.role)throw Error("transfer_mismatch");
  updateTransfer(t);
  if(t.role==="source" && t.ownerAdopted)releaseAudio();
  if(t.endedAt && !t.cleanupPending) {
   if(t.role==="source" && t.state==="transferred") {
    releaseCall();setNotice("Gespräch an "+t.toName+" übergeben.");
   }else if(t.role==="recipient" && t.state!=="transferred") {
    releaseCall();setNotice("Die Übergabe wurde beendet.");
   }else if(terminal(t.call))releaseCall();
   else updateCall(t.call);
   updateTransfer(null);transferRequest.current=null;
  }else if(terminal(t.call))releaseAudio();
  else updateCall(t.call);
 }
 async function refreshCall() {
  if(polling.current)return;
  const current=active.current;if(!current && !activeTransfer.current)return;
  polling.current=true;const epoch=generation.current;
  try {
   if(activeTransfer.current){await refreshTransfer();return;}
   if(!current)return;
   const data=await phoneJson<{call:BrowserCall}>("/calls?id="+encodeURIComponent(current.id));
   if(epoch!==generation.current || active.current?.id!==current.id || activeTransfer.current)return;
   if(data.call.id!==current.id)throw Error("phone_call_mismatch");
   updateCall(data.call);if(terminal(data.call))releaseCall();
  }catch{if(epoch===generation.current)setError("Der Gesprächsstatus ist gerade nicht erreichbar. Die Verbindung wird weiter geprüft.");}
  finally{polling.current=false;}
 }
 useEffect(()=>{
  if(!call && !transfer)return;
  const timer=window.setInterval(()=>{void refreshCall();},1500);
  return ()=>window.clearInterval(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[call?.id,transfer?.id]);
 useEffect(()=>{
  if(!registered || call || transfer || otherBusy){updateOffer(null);updateExternalOffer(null);return;}
  let stopped=false,running=false;const epoch=generation.current;
  const poll=async()=>{
   if(running||starting.current||active.current||activeTransfer.current)return;running=true;
   try{
    const [team,external]=await Promise.allSettled([
     phoneJson<{incoming:PhoneTransferView[]}>("/transfers"),
     phoneJson<{incoming:IncomingPhoneView[]}>("/incoming"),
    ]);
    if(!stopped && epoch===generation.current && !starting.current && !active.current && !activeTransfer.current){
     if(team.status==="fulfilled")updateOffer(team.value.incoming[0]||null);
     if(offer.current)updateExternalOffer(null);
     else if(external.status==="fulfilled")updateExternalOffer(external.value.incoming[0]||null);
     if(team.status==="rejected"||external.status==="rejected")setError("Eingehende Anrufe können gerade nicht vollständig geprüft werden.");
    }
   }catch{if(!stopped)setError("Eingehende Anrufe können gerade nicht geprüft werden.");}
   finally{running=false;}
  };
  void poll();const timer=window.setInterval(()=>void poll(),1500);
  return ()=>{stopped=true;window.clearInterval(timer);};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[registered,call?.id,transfer?.id,otherBusy,profileId]);
 async function transferAction(action:"commit"|"cancel",value=activeTransfer.current||offer.current) {
  if(!value||starting.current)return;
  starting.current=true;setWorking(true);setError("");const epoch=generation.current;
  try {
   await phoneJson("/transfers",{action,transferId:value.id});
   if(epoch!==generation.current)return;
   if(activeTransfer.current?.id===value.id)await refreshTransfer();else updateOffer(null);
  }catch{if(epoch===generation.current)setError("Die Übergabe konnte noch nicht bestätigt werden. Bitte versuche die Aktion erneut.");}
  finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function finish() {
  const current=active.current;if(!current||ending.current)return;
  const t=activeTransfer.current;
  if(t?.role==="recipient" && !t.ownerAdopted) {await transferAction("cancel",t);return;}
  if(t?.role==="source" && (t.ownerAdopted||t.state==="committing"))return;
  ending.current=true;setWorking(true);releaseAudio();const epoch=generation.current;
  try{await phoneJson("/calls",{action:"cancel",callId:current.id});if(epoch===generation.current)await refreshCall();}
  catch{if(epoch===generation.current)setError("Die Audioverbindung ist getrennt. Das Beenden beim Anbieter wird noch geprüft.");}
  finally{if(epoch===generation.current){ending.current=false;setWorking(false);}}
 }
 function attachAudio(sdkCall:Call,callId:string) {
  audioCall.current=sdkCall;
  const isCurrent=()=>audioCall.current===sdkCall && active.current?.id===callId;
  const disconnected=()=>{
   if(!isCurrent())return;
   const t=activeTransfer.current;
   if(t) {
    if(t.role==="recipient" && !t.ownerAdopted && t.state!=="committing")void transferAction("cancel",t);
    void refreshCall();
   }else void finish();
  };
  sdkCall.on("accept",()=>{if(isCurrent())void refreshCall();});
  sdkCall.on("disconnect",disconnected);sdkCall.on("cancel",disconnected);
  sdkCall.on("error",()=>{if(isCurrent()){setError("Die Audioverbindung wurde unterbrochen.");disconnected();}});
  sdkCall.on("reconnecting",()=>{if(isCurrent())setError("Die Audioverbindung wird wiederhergestellt …");});
  sdkCall.on("reconnected",()=>{if(isCurrent())setError("");});
  if(sdkCall.status()==="closed")disconnected();else void refreshCall();
 }
 async function enable() {
  if(!allowed||starting.current||active.current||registered)return;
  device.current?.destroy();device.current=null;
  starting.current=true;setWorking(true);setError("");const epoch=generation.current;
  let created:Device|null=null;
  try {
   const data=await phoneJson<{token:string}>("/token",{});
   const {Device:TwilioDevice}=await import("@twilio/voice-sdk");
   if(epoch!==generation.current)return;
   created=new TwilioDevice(data.token,{closeProtection:true,tokenRefreshMs:60000,edge:"frankfurt"});
   const own=created;device.current=own;
   own.on("registered",()=>{if(device.current===own){setRegistered(true);setError("");}});
   own.on("unregistered",()=>{if(device.current===own){setRegistered(false);void presence(false);}});
   own.on("error",()=>{if(device.current===own)setError("Der Browser-Anschluss meldet eine Störung. Prüfe deine Verbindung.");});
   // Incoming calls and team invitations use the bound Ops offer. Unknown provider calls are rejected.
   own.on("incoming",(incoming:Call)=>incoming.reject());
   own.on("tokenWillExpire",()=>{
    void phoneJson<{token:string}>("/token",{}).then(next=>{if(device.current===own)own.updateToken(next.token);})
     .catch(()=>{if(device.current===own){setRegistered(false);void presence(false);setError("Deine Telefonanmeldung konnte nicht verlängert werden.");}});
   });
   await own.register();
  }catch{
   created?.destroy();if(device.current===created)device.current=null;
   if(epoch===generation.current){setRegistered(false);setError("Der Browser-Anschluss konnte noch nicht verbunden werden.");}
  }finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function dial(target:PhoneDialTarget) {
  if(!allowed||!registered||!device.current||starting.current||active.current||activeTransfer.current||offer.current||externalOffer.current||otherBusy)return;
  starting.current=true;setWorking(true);setError("");setNotice("");const epoch=generation.current;
  const signature=JSON.stringify(target);
  if(request.current?.target!==signature)request.current={key:crypto.randomUUID(),target:signature};
  try {
   const result=await phoneJson<{call:BrowserCall}>("/calls",{action:"reserve",requestKey:request.current.key,...target});
   if(epoch!==generation.current)return;
   if(terminal(result.call)){request.current=null;throw Error("reservation_expired");}
   updateCall(result.call);
   const sdkCall=await device.current.connect({params:{callId:result.call.id}});
   if(epoch!==generation.current || (active.current as BrowserCall|null)?.id!==result.call.id){sdkCall.disconnect();return;}
   attachAudio(sdkCall,result.call.id);
  }catch{
   if(epoch===generation.current){setError("Der Anruf konnte nicht gestartet werden. Im Pilot sind nur freigegebene Testnummern erreichbar.");if(active.current)void finish();}
  }finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function beginTransfer(targetStaffId:string) {
  const current=active.current;
  if(!current?.connected||activeTransfer.current||starting.current)return;
  starting.current=true;setWorking(true);setError("");setNotice("");const epoch=generation.current;
  if(transferRequest.current?.callId!==current.id || transferRequest.current.target!==targetStaffId)
   transferRequest.current={key:crypto.randomUUID(),callId:current.id,target:targetStaffId};
  try {
   const data=await phoneJson<{transferId:string}>("/transfers",{action:"begin",callId:current.id,targetStaffId,requestKey:transferRequest.current.key});
   const {transfer:t}=await phoneJson<{transfer:PhoneTransferView}>("/transfers?id="+encodeURIComponent(data.transferId));
   if(epoch!==generation.current || active.current?.id!==current.id)return;
   if(t.role!=="source" || t.call.id!==current.id)throw Error("transfer_mismatch");
   updateTransfer(t);
  }catch{if(epoch===generation.current)setError("Der Kollege ist nicht erreichbar oder die Übergabe wird noch geprüft. Erneutes Weitergeben an dieselbe Person setzt den Versuch fort.");}
  finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function acceptTransfer() {
  const current=offer.current,own=device.current;
  if(!current||!own||!registered||starting.current||active.current||activeTransfer.current||otherBusy)return;
  starting.current=true;setWorking(true);setError("");setNotice("");const epoch=generation.current;
  try {
   const {transfer:t}=await phoneJson<{transfer:PhoneTransferView}>("/transfers?id="+encodeURIComponent(current.id));
   if(epoch!==generation.current)return;
   if(t.role!=="recipient"||t.id!==current.id||t.endedAt||t.cancelRequested||t.state!=="dialing")throw Error("invitation_expired");
   updateTransfer(t);updateCall(t.call);updateOffer(null);
   const sdkCall=await own.connect({params:{transferId:t.id}});
   if(epoch!==generation.current || (activeTransfer.current as PhoneTransferView|null)?.id!==t.id){sdkCall.disconnect();return;}
   attachAudio(sdkCall,t.call.id);
  }catch{
   if(epoch===generation.current){
    setError("Die Übergabe konnte nicht angenommen werden. Die Einladung wird erneut geprüft.");
    // Never cancel the customer's call from an unadopted recipient.
    if((activeTransfer.current as PhoneTransferView|null)?.id===current.id) {
     await phoneJson("/transfers",{action:"cancel",transferId:current.id}).catch(()=>{});
     await refreshTransfer().catch(()=>{});
    }else updateOffer(null);
   }
  }finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function acceptIncoming() {
  const current=externalOffer.current,own=device.current;
  if(!current||!own||!registered||starting.current||active.current||activeTransfer.current||offer.current||otherBusy)return;
  starting.current=true;setWorking(true);setError("");setNotice("");const epoch=generation.current;
  try{
   const result=await phoneJson<{call:BrowserCall}>("/incoming",{action:"accept",incomingId:current.id});
   if(epoch!==generation.current)return;
   if(result.call.id!==current.id||result.call.direction!=="inbound"||result.call.endedAt)throw Error("incoming_accept_unconfirmed");
   updateCall(result.call);updateExternalOffer(null);
   const sdkCall=await own.connect({params:{callId:result.call.id}});
   if(epoch!==generation.current||(active.current as BrowserCall|null)?.id!==result.call.id){sdkCall.disconnect();return;}
   attachAudio(sdkCall,result.call.id);
  }catch{
   if(epoch===generation.current){
    setError("Der Anruf konnte noch nicht angenommen werden. Die Verfügbarkeit wird erneut geprüft.");
    // A lost accept response can be retried with the same incoming ID.
    if((active.current as BrowserCall|null)?.id===current.id)void finish();
   }
  }finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 async function declineIncoming() {
  const current=externalOffer.current;
  if(!current||starting.current)return;
  starting.current=true;setWorking(true);setError("");const epoch=generation.current;
  try{
   await phoneJson("/incoming",{action:"decline",incomingId:current.id});
   if(epoch===generation.current){updateExternalOffer(null);setNotice("Bei dir abgelehnt. Die anderen verfügbaren Mitarbeiter können weiterhin annehmen.");}
  }catch{if(epoch===generation.current)setError("Das Ablehnen konnte noch nicht bestätigt werden.");}
  finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 function mute() {if(!audioCall.current)return;const next=!audioCall.current.isMuted();audioCall.current.mute(next);setMuted(next);}
 function sendDigits(value:string) {if(audioCall.current && /^[0-9*#]{1,32}$/.test(value))audioCall.current.sendDigits(value);}
 return {allowed,registered,working,call,muted,error,notice,transfer,incoming,externalIncoming,acceptIncoming,declineIncoming,enable,dial,finish,mute,sendDigits,beginTransfer,acceptTransfer,transferAction,
  busy:!!call||!!transfer||!!incoming||!!externalIncoming||working};
}
