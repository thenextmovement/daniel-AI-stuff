import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import {mobileLinkInput} from "../../src/lib/ops/voice-mobile-contract";
import {mobileCodeHash,mobilePhoneReady,MobilePhoneLinks,TwilioMobileProvider,type MobileAttempt,type MobileResult} from "../../services/voice-runtime/phone-mobile";
import {phoneWebhookParameters} from "../../services/voice-runtime/phone-calls";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
const id="29500000-0000-4000-8000-000000000801",sid="CA"+"a".repeat(32);
const config={teamPhoneEnabled:true,mobilePhoneEnabled:true,mobilePhoneNumbers:["+493055501234"],twilioAccountSid:"AC"+"4".repeat(32),twilioAuthToken:"fixture-only",twilioFromNumber:"+493055500000",publicUrl:"https://voice.example.test"} as RuntimeConfig;
function record(extra:Partial<MobileAttempt>={}):MobileAttempt{return {id,device_id:"29500000-0000-4000-8000-000000000101",staff_id:"29500000-0000-4000-8000-000000000001",staff_revision:1,
 phone:"+493055501234",state:"reserved",provider_call_sid:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+180000).toISOString(),
 ended_at:null,provider_ended_at:null,cleanup_pending:false,verified_at:null,revoked_at:null,...extra};}
function fixture(extra:Partial<MobileAttempt>={},settings=config){
 const a=record(extra),actions:Record<string,unknown>[]=[],dialed:string[]=[],closed:string[]=[];
 let failDial=false,failClose=false,providerEnded=false;
 const ops={mobileAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  actions.push(input);
  if(input.action==="get")return {attempt:{...a}} as T;
  if(input.action==="recover")return {attempts:[{...a}]} as T;
  let claimed=false,accepted=false;
  if(input.action==="claim"&&a.state==="reserved"){claimed=true;a.state="claimed";}
  if(["bind","prompt","verify","terminal"].includes(String(input.action))){
   if(a.provider_call_sid&&input.callSid!==a.provider_call_sid)throw Error("mobile_leg_conflict");
   a.provider_call_sid=String(input.callSid);
  }
  if(input.action==="prompt"&&!a.ended_at)a.state="answered";
  if(input.action==="verify"&&!a.ended_at){accepted=input.codeHash===mobileCodeHash(id,"123456");a.state=accepted?"verified":"failed";a.ended_at=new Date().toISOString();a.cleanup_pending=true;}
  if(input.action==="cancel"){a.ended_at=new Date().toISOString();a.state="cancelled";a.cleanup_pending=true;}
  if(input.action==="terminal"){a.ended_at ||= new Date().toISOString();a.provider_ended_at=new Date().toISOString();a.cleanup_pending=false;}
  if(input.action==="cleanup")a.cleanup_pending=false;
  return {attempt:{...a},claimed,accepted} as T;
 }};
 return {a,actions,dialed,closed,engine:new MobilePhoneLinks(settings,ops,{start:async row=>{dialed.push(row.id);if(failDial)throw Error("timeout");return sid;},
  close:async s=>{closed.push(s);if(failClose)throw Error("provider_failure");},ended:async()=>providerEnded}),
  failDial(){failDial=true;},failClose(){failClose=true;},end(){providerEnded=true;}};
}
const params=()=>new URLSearchParams({CallSid:sid,To:"+493055501234",From:"+493055500000",CallStatus:"in-progress"});
test("mobile input preserves exact personal intent and rejects identity, provider and action injection",()=>{
 for(const phone of ["030 55501234","+49 30 55501234","00493055501234"])
  assert.deepEqual(mobileLinkInput({action:"start",id,phone,code:"123456"}),{action:"start",id,phone:"+493055501234",code:"123456"});
 for(const bad of [{action:"constructor",id},{action:"toString",id},{action:"start",id,phone:"+493055501234",code:"123456",staffId:"someone"},
 {action:"start",id,phone:"+493055501234",code:"12345"},{action:"start",id,phone:"sip:person@example.test",code:"123456"},{action:"cancel",id,phone:"+493055501234"}])
  assert.throws(()=>mobileLinkInput(bad));
 assert.notEqual(mobileCodeHash(id,"123456"),mobileCodeHash(id.replace("801","802"),"123456"));
});
test("mobile verification is opt in without a browser audio SDK requirement",()=>{
 assert.equal(mobilePhoneReady(config),true);
 for(const settings of [{...config,mobilePhoneEnabled:false},{...config,mobilePhoneNumbers:[]},{...config,teamPhoneEnabled:false},{...config,twilioFromNumber:"invalid"}])assert.equal(mobilePhoneReady(settings),false);
});
test("concurrent dispatch and uncertain provider response never dial twice",async()=>{
 const f=fixture();await Promise.all([f.engine.start(id),f.engine.start(id)]);assert.deepEqual(f.dialed,[id]);assert.equal(f.a.provider_call_sid,sid);
 const uncertain=fixture();uncertain.failDial();await uncertain.engine.start(id);await uncertain.engine.start(id);await uncertain.engine.reconcile();
 assert.deepEqual(uncertain.dialed,[id]);assert.equal(uncertain.a.state,"claimed");
 const forbidden=fixture({phone:"+493055509999"});await assert.rejects(forbidden.engine.start(id),/not_allowed/);assert.equal(forbidden.dialed.length,0);
});
test("signed callback must bind account, exact URL, caller, target and single leg",async()=>{
 const url=new URL(config.publicUrl+"/phone/twilio/mobile/prompt?id="+id),p=params();p.set("AccountSid",config.twilioAccountSid);
 const signature=twilio.getExpectedTwilioSignature(config.twilioAuthToken,url.toString(),Object.fromEntries(p));
 assert.equal(phoneWebhookParameters(config,url,signature,p.toString()).get("CallSid"),sid);
 assert.throws(()=>phoneWebhookParameters(config,url,"bad",p.toString()));
 assert.throws(()=>phoneWebhookParameters({...config,twilioAccountSid:"AC"+"9".repeat(32)},url,signature,p.toString()));
 assert.throws(()=>phoneWebhookParameters(config,new URL(url+"&x=1"),signature,p.toString()));
 assert.throws(()=>phoneWebhookParameters(config,url,signature,p.toString()+"&CallSid="+sid));
 for(const field of ["To","From","CallSid"]){const f=fixture({state:"claimed"}),wrong=params();wrong.set(field,"wrong");
  await assert.rejects(f.engine.webhook(id,"prompt",wrong),/leg_conflict/);assert.equal(f.actions.length,1);}
});
test("DTMF confirmation is isolated from customer audio and commits only the entered code hash",async()=>{
 const f=fixture({state:"claimed"});
 const xml=await f.engine.webhook(id,"prompt",params());
 assert.match(xml,/numDigits="6"/);assert.match(xml,/actionOnEmptyResult="true"/);assert.match(xml,/timeout="20"/);
 assert(!xml.includes("123456"));assert(!xml.includes("<Conference"));assert(!xml.includes("<Stream"));
 const p=params();p.set("Digits","123456");const result=await f.engine.webhook(id,"verify",p);
 assert.match(result,/Handy ist bestätigt/);assert.match(result,/<Hangup/);
 assert.equal(f.actions.at(-1)?.codeHash,mobileCodeHash(id,"123456"));assert(!JSON.stringify(f.actions).includes('"123456"'));
 const wrong=fixture({state:"answered"});p.set("Digits","");assert.match(await wrong.engine.webhook(id,"verify",p),/nicht erfolgreich/);
 assert.equal(wrong.a.state,"failed");
});
test("late callback cannot resume cancelled verification; cleanup requires provider confirmation",async()=>{
 const f=fixture({state:"cancelled",ended_at:new Date().toISOString(),cleanup_pending:true});
 assert.match(await f.engine.webhook(id,"prompt",params()),/<Hangup/);
 const closed=fixture({state:"claimed",provider_call_sid:sid});closed.failClose();
 await assert.rejects(closed.engine.cancel(id),/provider_failure/);
 assert(!closed.actions.some(x=>x.action==="terminal"||x.action==="cleanup"));
 const late=fixture({state:"cancelled",ended_at:new Date().toISOString(),cleanup_pending:true});
 await late.engine.webhook(id,"status",params());assert.deepEqual(late.closed,[sid]);
 const expired=fixture({state:"cancelled",ended_at:new Date().toISOString(),cleanup_pending:true,expires_at:new Date(Date.now()-61000).toISOString()});
 await expired.engine.reconcile();assert(expired.actions.some(x=>x.action==="cleanup"));
});
test("provider creation is short, unrecorded, bound to callback URLs and disables retries",async()=>{
 let input:Record<string,unknown>|null=null;
 const fake={calls:Object.assign(()=>({fetch:async()=>({status:"completed"})}),{create:async(value:Record<string,unknown>)=>{input=value;return {sid};}})};
 const p=new TwilioMobileProvider(config,fake as unknown as ReturnType<typeof twilio>);
 assert.equal(await p.start(record()),sid);
 assert.equal(input!.to,"+493055501234");assert.equal(input!.record,false);assert.equal(input!.timeLimit,60);assert.equal(input!.timeout,25);
 assert.equal(input!.url,config.publicUrl+"/phone/twilio/mobile/prompt?id="+id);
 assert.deepEqual(input!.statusCallbackEvent,["initiated","ringing","answered","completed"]);
});
