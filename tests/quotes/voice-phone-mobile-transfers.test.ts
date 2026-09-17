import test from "node:test";
import assert from "node:assert/strict";
import {MobilePhoneCalls,type MobileCallLeg,type MobileCallResult} from "../../services/voice-runtime/phone-mobile-calls";
import {RuntimePhoneTransfers,type TransferOps} from "../../services/voice-runtime/phone-transfer-controller";
import type {PhoneTransfer,TransferProvider} from "../../services/voice-runtime/phone-transfers";
import type {PhoneCallRecord} from "../../services/voice-runtime/phone-calls";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
const id="29500000-0000-4000-8000-000000000801",cid="29500000-0000-4000-8000-000000000802",tid="29500000-0000-4000-8000-000000000803";
const da="29500000-0000-4000-8000-000000000101",db="29500000-0000-4000-8000-000000000102",sa="29500000-0000-4000-8000-000000000001",sb="29500000-0000-4000-8000-000000000002";
const a="CA"+"1".repeat(32),b="CA"+"2".repeat(32),customer="CA"+"3".repeat(32),conference="CF"+"4".repeat(32);
const config={teamPhoneEnabled:true,mobileCallsEnabled:true,mobileTransfersEnabled:true,browserCallsEnabled:false,
 mobilePhoneNumbers:["+493055501999"],phoneAllowedNumbers:["+493055501234"],twilioAccountSid:"AC"+"a".repeat(32),
 twilioAuthToken:"fixture",twilioFromNumber:"+493055500000",publicUrl:"https://voice.example.test"} as RuntimeConfig;
function snapshot(){
 const leg={id,call_id:cid,transfer_id:tid,staff_id:sb,device_id:db,mobile_link_id:"29500000-0000-4000-8000-000000000901",
  phone:"+493055501999",state:"ready",claimed_at:null,provider_call_sid:null,confirmed_at:null,ended_at:null,provider_ended_at:null,
  expires_at:new Date(Date.now()+60000).toISOString(),cleanup_pending:false,updated_at:new Date().toISOString()} as MobileCallLeg;
 const call={id:cid,device_id:da,staff_id:sa,phone:"+493055501234",agent_transport:"browser",agent_call_sid:a,customer_call_sid:customer,
  conference_sid:conference,state:"connected",agent_joined:true,customer_joined:true,ended_at:null,cleanup_pending:false} as PhoneCallRecord;
 const transfer={id:tid,call_id:cid,from_device_id:da,from_staff_id:sa,from_call_sid:a,to_device_id:db,to_staff_id:sb,
  to_transport:"mobile",mobile_leg_id:id,to_call_sid:null,state:"dialing",dial_claimed:true,customer_held:true,cancel_requested:false,
  target_joined:false,owner_adopted:false,ended_at:null,expires_at:leg.expires_at} as PhoneTransfer;
 return {leg,call,transfer};
}
const params=()=>new URLSearchParams({From:config.twilioFromNumber,To:"+493055501999",CallSid:b,Digits:"1"});
test("mobile invitation requires its separate feature flag and DTMF before private conference TwiML",async()=>{
 const {leg,call,transfer}=snapshot();let starts=0,callClosed=0;const resumed:string[]=[];
 const result=(dial=false,join=false):MobileCallResult=>({leg:{...leg},call:{...call},transfer:{...transfer},dial,join,closeCall:false});
 const ops={mobileCallAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  if(input.action==="get")return result() as T;
  let dial=false,join=false;
  if(input.kind==="claim"&&!leg.claimed_at){dial=true;leg.claimed_at=new Date().toISOString();leg.state="claimed";}
  if(input.callSid){leg.provider_call_sid=String(input.callSid);transfer.to_call_sid=String(input.callSid);}
  if(input.kind==="prompt")leg.state="screening";
  if(input.kind==="confirm"){assert.equal(leg.state,"screening");leg.confirmed_at=new Date().toISOString();join=true;}
  if(input.kind==="reject"){leg.ended_at=new Date().toISOString();leg.cleanup_pending=true;transfer.state="cancelling";}
  if(input.kind==="terminal"){leg.provider_ended_at=new Date().toISOString();leg.cleanup_pending=false;}
  return result(dial,join) as T;
 }};
 const provider={start:async()=>{starts++;return b;},close:async()=>{},ended:async()=>false};
 const blocked=new MobilePhoneCalls({...config,mobileTransfersEnabled:false},ops,provider,async()=>{callClosed++;});
 await assert.rejects(blocked.start(id),/not_configured/);assert.equal(starts,0);
 const engine=new MobilePhoneCalls(config,ops,provider,async()=>{callClosed++;},async id=>{resumed.push(id);});
 await engine.start(id);assert.equal(starts,1);
 const prompt=await engine.webhook(id,"prompt",params());
 assert.match(prompt,/interne Rücksprache/);assert(!prompt.includes("<Conference"));assert(!prompt.includes(call.phone));
 const join=await engine.webhook(id,"confirm",params());
 assert(join.includes('participantLabel="xfer_'+tid+'"'));assert(join.includes('endConferenceOnExit="false"'));
 assert(join.includes("ntp_"+cid));assert.equal(call.agent_call_sid,a);assert.equal(call.customer_call_sid,customer);
 const reject=params();reject.set("Digits","");
 assert.match(await engine.webhook(id,"confirm",reject),/<Hangup/);
 assert.deepEqual(resumed,[tid]);assert.equal(callClosed,0,"declining handset must return to the source call");
});
test("mobile transfer prepare holds the customer before starting the saved handset, without browser credentials",async()=>{
 const {transfer:t,call}=snapshot();t.state="preparing";t.customer_held=false;t.dial_claimed=false;
 const effects:string[]=[];let input:Record<string,unknown>|null=null;
 const ops:TransferOps={
  getPhoneDevice:async(deviceId,staffId)=>({deviceId,staffId,expiresAt:new Date(Date.now()+600000).toISOString()}),
  phoneEvent:async()=>({call,dial:false,close:false,duplicate:false}),
  transferAction:async<T>(action:Record<string,unknown>):Promise<T>=>{
   if(action.action==="begin")input=action;
   if(action.action==="event"){
    effects.push(String(action.kind));
    if(action.kind==="held")t.customer_held=true;
    if(action.kind==="claim_dial"){assert(t.customer_held);t.dial_claimed=true;t.state="dialing";}
   }
   return {transfer:{...t},call:{...call},dial:false,duplicate:false} as T;
  },
 };
 const provider:TransferProvider={holdCustomer:async()=>{effects.push("hold");},guard:async()=>{},remove:async()=>{}};
 const controller=new RuntimePhoneTransfers(config,ops,async()=>{},provider,async legId=>{assert.equal(legId,id);effects.push("handset");});
 await controller.control({action:"begin",callId:cid,targetStaffId:sb,deviceId:da,staffId:sa,requestKey:tid});
 await new Promise<void>(r=>setImmediate(r));
 assert.equal(input!.allowMobile,true);assert.equal(input!.allowBrowser,false);
 assert.deepEqual(effects,["hold","held","claim_dial","handset"]);
});
test("browser admission cannot consume a mobile invitation even with an otherwise matching device",async()=>{
 const {transfer,call}=snapshot();transfer.to_call_sid=b;
 const ops:TransferOps={getPhoneDevice:async(deviceId,staffId)=>({deviceId,staffId,expiresAt:"2099-01-01"}),
  phoneEvent:async()=>({call,dial:false,close:false,duplicate:false}),
  transferAction:async<T>()=>({transfer,call} as T)};
 const controller=new RuntimePhoneTransfers({...config,browserCallsEnabled:true,twilioApiKeySid:"SK"+"a".repeat(32),
  twilioApiKeySecret:"fixture",twilioPhoneAppSid:"AP"+"a".repeat(32)},ops,async()=>{});
 await assert.rejects(controller.client(new URLSearchParams({transferId:tid,CallSid:b,From:"client:ntd_"+db.replaceAll("-","")})),/invitation_not_current/);
});
