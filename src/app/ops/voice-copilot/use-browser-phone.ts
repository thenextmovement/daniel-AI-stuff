"use client";
import {useEffect,useRef,useState} from "react";
import type {Call,Device} from "@twilio/voice-sdk";
import type {PhoneIdentity} from "@/lib/ops/voice-phone-contract";
import {readPhoneCentralResponse} from "./phone-central-data";

export type BrowserCall = {id:string;state:string;phone:string;connected:boolean;endedAt:string|null;cleanupPending:boolean;isTest:boolean};
export type PhoneDialTarget = {customerId?:string;requestId?:string|null;phone?:string};
const terminal=(call:BrowserCall)=>!!call.endedAt && !call.cleanupPending;
async function phoneJson<T>(path:string,body?:Record<string,unknown>):Promise<T> {
 const response=await fetch("/api/ops/voice-phone"+path,{...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),
  cache:"no-store",signal:AbortSignal.timeout(body?.action==="cancel"?22000:15000)});
 return readPhoneCentralResponse<T>(response,"Der Telefonanschluss ist gerade nicht erreichbar.");
}
export function useBrowserPhone(identity:PhoneIdentity|null,otherBusy:boolean) {
 const [registered,setRegistered]=useState(false),[working,setWorking]=useState(false);
 const [call,setCall]=useState<BrowserCall|null>(null),[muted,setMuted]=useState(false),[error,setError]=useState("");
 const device=useRef<Device|null>(null),audioCall=useRef<Call|null>(null),active=useRef<BrowserCall|null>(null);
 const generation=useRef(0),starting=useRef(false),polling=useRef(false),ending=useRef(false);
 const request=useRef<{key:string;target:string}|null>(null);
 const profileId=identity?.device?.id||null;
 const allowed=!!identity?.browserCallingAvailable && !!profileId;
 function updateCall(value:BrowserCall|null) {active.current=value;setCall(value);}
 async function presence(online:boolean) {
  try{await phoneJson("",{action:"presence",registered:online,available:online&&!active.current&&!otherBusy});}
  catch{setError("Dein Telefonstatus konnte nicht bestätigt werden.");}
 }
 // Switching/revoking the personal phone profile destroys its provider device.
 // General Ops login and its cookie remain independent.
 useEffect(()=>{
  generation.current++;const currentGeneration=generation.current;
  return ()=>{
   if(generation.current===currentGeneration)generation.current++;
   device.current?.destroy();device.current=null;
   audioCall.current=null;active.current=null;
  };
 },[profileId]);
 useEffect(()=>{
  setRegistered(false);setWorking(false);setCall(null);setMuted(false);setError("");
  starting.current=false;ending.current=false;request.current=null;
 },[profileId]);
 useEffect(()=>{
  if(!registered)return;
  const timer=window.setInterval(()=>{void presence(true);},15000);
  void presence(true);
  return ()=>window.clearInterval(timer);
 // Identity device changes destroy the SDK; this heartbeat only reports SDK registration.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[registered,!!call,otherBusy,profileId]);
 async function refreshCall() {
  const current=active.current;if(!current||polling.current)return;
  polling.current=true;const epoch=generation.current;
  try {
   const data=await phoneJson<{call:BrowserCall}>("/calls?id="+encodeURIComponent(current.id));
   if(epoch!==generation.current || active.current?.id!==current.id)return;
   if(data.call.id!==current.id)throw Error("phone_call_mismatch");
   updateCall(data.call);
   if(terminal(data.call)) {
    const endedAudio=audioCall.current;audioCall.current=null;
    updateCall(null);endedAudio?.disconnect();request.current=null;setMuted(false);ending.current=false;setWorking(false);
   }
  }catch{if(epoch===generation.current)setError("Der Anrufstatus ist gerade nicht erreichbar. Auflegen bleibt möglich.");}
  finally{polling.current=false;}
 }
 useEffect(()=>{
  if(!call)return;
  const timer=window.setInterval(()=>{void refreshCall();},1500);
  return ()=>window.clearInterval(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[call?.id]);
 async function finish() {
  const current=active.current;if(!current||ending.current)return;
  ending.current=true;setWorking(true);audioCall.current?.disconnect();
  try{await phoneJson("/calls",{action:"cancel",callId:current.id});await refreshCall();}
  catch{setError("Die Audioverbindung ist getrennt. Das Beenden beim Anbieter wird noch geprüft.");}
  finally{ending.current=false;setWorking(false);}
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
   // Incoming routing is activated separately once server-side participant
   // admission exists. Unknown incoming provider calls are never auto-accepted.
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
  if(!allowed||!registered||!device.current||starting.current||active.current||otherBusy)return;
  starting.current=true;setWorking(true);setError("");const epoch=generation.current;
  const signature=JSON.stringify(target);
  if(request.current?.target!==signature)request.current={key:crypto.randomUUID(),target:signature};
  try {
   const result=await phoneJson<{call:BrowserCall}>("/calls",{action:"reserve",requestKey:request.current.key,...target});
   if(epoch!==generation.current)return;
   if(terminal(result.call)){request.current=null;throw Error("reservation_expired");}
   updateCall(result.call);
   const sdkCall=await device.current.connect({params:{callId:result.call.id}});
   if(epoch!==generation.current || (active.current as BrowserCall|null)?.id!==result.call.id){sdkCall.disconnect();return;}
   audioCall.current=sdkCall;
   const isCurrent=()=>audioCall.current===sdkCall && active.current?.id===result.call.id;
   sdkCall.on("accept",()=>{if(isCurrent())void refreshCall();});
   sdkCall.on("disconnect",()=>{if(isCurrent())void finish();});
   sdkCall.on("cancel",()=>{if(isCurrent())void finish();});
   sdkCall.on("error",()=>{if(isCurrent()){setError("Die Audioverbindung wurde unterbrochen.");void finish();}});
   sdkCall.on("reconnecting",()=>{if(isCurrent())setError("Die Audioverbindung wird wiederhergestellt …");});
   sdkCall.on("reconnected",()=>{if(isCurrent())setError("");});
   if(sdkCall.status()==="closed")void finish();else void refreshCall();
  }catch{
   if(epoch===generation.current){setError("Der Anruf konnte nicht gestartet werden. Im Pilot sind nur freigegebene Testnummern erreichbar.");if(active.current)void finish();}
  }finally{if(epoch===generation.current){starting.current=false;setWorking(false);}}
 }
 function mute() {
  if(!audioCall.current)return;
  const next=!audioCall.current.isMuted();audioCall.current.mute(next);setMuted(next);
 }
 function sendDigits(value:string) {if(audioCall.current && /^[0-9*#]{1,32}$/.test(value))audioCall.current.sendDigits(value);}
 return {allowed,registered,working,call,muted,error,enable,dial,finish,mute,sendDigits,busy:!!call||working};
}
