import test from "node:test";
import assert from "node:assert/strict";
import {IncomingMobileCalls,mobileIncomingReady,type IncomingMobileOffer,type IncomingMobileResult} from "../../services/voice-runtime/phone-mobile-incoming";
import {inboundPhoneReady,type IncomingPhoneRecord} from "../../services/voice-runtime/phone-incoming";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
const id="29500000-0000-4000-8000-000000000901",incomingId="29500000-0000-4000-8000-000000000902",sid="CA"+"a".repeat(32);
const config={teamPhoneEnabled:true,browserCallsEnabled:false,mobileCallsEnabled:true,mobileIncomingEnabled:true,inboundPhoneEnabled:true,
 twilioAccountSid:"AC"+"b".repeat(32),twilioAuthToken:"fixture-only",twilioFromNumber:"+493055500000",
 phoneAllowedNumbers:["+493055501234"],mobilePhoneNumbers:["+493055501111"],inboundPhoneNumbers:["+493055500000"],publicUrl:"https://voice.example.test"} as RuntimeConfig;
function fixture(settings=config){
 const offer:IncomingMobileOffer={id,incoming_id:incomingId,staff_id:"alpha",device_id:"device",mobile_link_id:"proof",phone:"+493055501111",state:"ready",
  provider_call_sid:null,claimed_at:null,ended_at:null,provider_ended_at:null,mobile_leg_id:null,expires_at:new Date(Date.now()+60000).toISOString(),cleanup_pending:false,updated_at:new Date().toISOString()};
 const incoming={id:incomingId,phone:"+493055501234",called_number:"+493055500000",customer_call_sid:"CA"+"c".repeat(32),
  state:"waiting",customer_joined:true,ended_at:null} as IncomingPhoneRecord;
 const actions:Record<string,unknown>[]=[],forwards:Array<{id:string;kind:string;params:URLSearchParams}>=[],closed:string[]=[];
 let starts=0,ambiguous=false,failClose=false,adoptOnBind=false;
 const result=()=>({offer:{...offer},incoming:{...incoming},dial:false});
 const ops={incomingAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  actions.push(input);
  if(["mobile_offers","mobile_recover"].includes(String(input.action)))return {offers:offer.mobile_leg_id?[]:[{...offer}]} as T;
  if(input.action==="mobile_get")return result() as T;
  if(input.action!=="mobile_event")throw Error("unexpected action");
  const kind=input.kind;
  if(input.callSid)offer.provider_call_sid=String(input.callSid);
  if(kind==="claim"){
   const dial=!offer.claimed_at&&!offer.ended_at;
   if(dial){offer.claimed_at=new Date().toISOString();offer.state="claimed";offer.cleanup_pending=true;}
   return {...result(),dial} as T;
  }
  if(kind==="prompt"&&!offer.ended_at)offer.state="screening";
  if((kind==="confirm"&&!offer.ended_at)||(kind==="bind"&&adoptOnBind)){
   offer.state="adopted";offer.mobile_leg_id=id;offer.ended_at=new Date().toISOString();offer.cleanup_pending=false;incoming.state="claimed";
  }
  if(["reject","cancel","terminal"].includes(String(kind))||(kind==="expire"&&incoming.state!=="waiting")){
   if(!offer.mobile_leg_id){offer.state="ended";offer.ended_at=new Date().toISOString();}
  }
  if(kind==="terminal"){offer.provider_ended_at=new Date().toISOString();offer.cleanup_pending=false;}
  if(kind==="cleanup")offer.cleanup_pending=false;
  return result() as T;
 }};
 const provider={start:async()=>{starts++;if(ambiguous)throw Error("provider_timeout");return sid;},
  close:async(value:string)=>{closed.push(value);if(failClose)throw Error("provider_unavailable");},ended:async()=>false};
 const engine=new IncomingMobileCalls(settings,ops,provider,{webhook:async(id,kind,params)=>{forwards.push({id,kind,params});return "<Response><Dial>same-customer-room</Dial></Response>";}});
 return {offer,incoming,actions,forwards,closed,engine,starts:()=>starts,ambiguous(){ambiguous=true;},failClose(){failClose=true;},adoptOnBind(){adoptOnBind=true;}};
}
const params=(extra:Record<string,string>={})=>new URLSearchParams({CallSid:sid,From:config.twilioFromNumber,To:config.mobilePhoneNumbers[0],...extra});

test("mobile incoming is separately enabled and accepts a parked caller without any browser SDK credentials",async()=>{
 assert.equal(mobileIncomingReady(config),true);assert.equal(inboundPhoneReady(config),true);
 for(const settings of [{...config,mobileIncomingEnabled:false},{...config,mobileCallsEnabled:false},{...config,inboundPhoneEnabled:false},{...config,inboundPhoneNumbers:[]}]){
  assert.equal(mobileIncomingReady(settings),false);const f=fixture(settings);await f.engine.sync(f.incoming);assert.equal(f.starts(),0);
  assert.deepEqual(f.actions.find(x=>x.action==="mobile_offers")?.allowedPhones,[]);
 }
 const f=fixture();await f.engine.sync(f.incoming);await f.engine.sync(f.incoming);
 assert.equal(f.starts(),1);assert(!f.forwards.length);
});
test("only a bound handset receives a neutral invitation; DTMF adoption routes to the existing mobile call",async()=>{
 const f=fixture();await f.engine.sync(f.incoming);
 await assert.rejects(f.engine.webhook(id,"prompt",params({To:"+493055509999"})),/binding_invalid/);
 const prompt=await f.engine.webhook(id,"prompt",params());
 assert.match(prompt,/Ein Anruf wartet/);assert.match(prompt,/numDigits="1"/);assert(!prompt.includes("493055501234"));
 assert(!prompt.includes("<Conference"));assert.equal(f.forwards.length,0);
 const joined=await f.engine.webhook(id,"confirm",params({Digits:"1"}));
 assert.match(joined,/same-customer-room/);assert.equal(f.forwards[0].id,id);assert.equal(f.forwards[0].kind,"confirm");
 await f.engine.webhook(id,"prompt",params());
 assert.equal(f.forwards.at(-1)?.kind,"confirm");assert.equal(f.forwards.at(-1)?.params.get("Digits"),"1");
 assert.equal(f.starts(),1);assert.equal(f.closed.length,0);
});
test("declining a mobile invitation cleans its handset only and leaves the customer available",async()=>{
 const f=fixture();await f.engine.sync(f.incoming);await f.engine.webhook(id,"prompt",params());
 assert.match(await f.engine.webhook(id,"confirm",params({Digits:"2"})),/<Hangup/);
 assert.equal(f.incoming.state,"waiting");assert.equal(f.incoming.ended_at,null);assert.equal(f.forwards.length,0);assert.deepEqual(f.closed,[sid]);
});
test("an ambiguous dispatch is not redialed, and failed losing-handset cleanup stays pending",async()=>{
 const f=fixture();f.ambiguous();await f.engine.sync(f.incoming);await f.engine.sync(f.incoming);await f.engine.reconcile();
 assert.equal(f.starts(),1);assert.equal(f.offer.provider_call_sid,null);assert(f.offer.claimed_at);
 f.offer.ended_at=new Date().toISOString();f.offer.state="ended";f.failClose();
 await assert.rejects(f.engine.webhook(id,"status",params({CallStatus:"ringing"})),/provider_unavailable/);
 assert.equal(f.offer.cleanup_pending,true);assert(!f.actions.some(x=>x.kind==="terminal"));
});
test("callback racing with adoption follows the adopted mobile leg and never cleans a new owner",async()=>{
 const f=fixture();await f.engine.sync(f.incoming);f.adoptOnBind();
 await f.engine.webhook(id,"status",params({CallStatus:"ringing"}));
 assert.equal(f.forwards.length,1);assert.equal(f.forwards[0].kind,"status");assert.equal(f.closed.length,0);
 await f.engine.webhook(id,"status",params({CallStatus:"completed"}));
 assert.equal(f.forwards.length,2);assert.equal(f.closed.length,0);
});
