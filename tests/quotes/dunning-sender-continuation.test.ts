import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";
import assert from "node:assert/strict";
const {DateTime}=createRequire(import.meta.url)("luxon");
const code=readFileSync(process.env.DUNNING_SELECTOR_TEST_SOURCE || "workflows/dunning/select-next-stage.js","utf8");
const prefix="e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:";
const anchor={stage:1,sent_at:"2026-10-14T12:00:00.000Z",message_id:"manual1",internet_message_id:"<manual1>",conversation_id:"thread1",lock_key:prefix+"123:C-R20261014T35:S1",evidence:"reviewed_reminder"};
function fixture(now="2026-10-20T13:00:00.000Z") {
 const t=DateTime.fromISO(now),observed=t.minus({minutes:5}).toISO();
 const metadata={schema:"t099.intake.snapshot.v2",run_id:"run1",observed_at:observed,fresh_until:t.plus({minutes:85}).toISO(),cutover_at:"2026-08-05T15:30:00.000Z",source_complete:true,source_issues:[],candidates:[],candidates_truncated:false,sources:{shopify:{complete:true,row_count:0},easybill:{complete:true,row_count:0}},union:{key_count:0,rows:[],candidate_count:0}};
 const candidate={preliminary_only:true,candidate_key:"shopify:123|easybill:456",shopify_order_id:"123",shopify_order_name:"#NEONT9000",shopify_order_created_at:"2026-09-01T09:00:00Z",shopify_order_updated_at:"2026-09-01T10:00:00Z",shopify_email_hint:"test@example.com",easybill_document_id:"456",easybill_invoice_number:"PF-NEONT9000",easybill_document_created_at:"2026-09-01 10:00:00",easybill_due_date:"2026-09-15",easybill_document_type:"PROFORMA_INVOICE",easybill_customer_id:"789",currency:"EUR",invoice_amount_cents:10000,payment_received_cents:0,easybill_paid_cents:0,amount_due_cents:10000,intake_evidence:{source:"historical_control_v1"},continuation:{schema:"dunning.historical.candidate.v1",stage_model:"current_6",document_type:"PROFORMA_INVOICE",cycle_id:"R20261014T35",cycle_prefix:prefix+"123:C-R20261014T35",anchor:{...anchor},observed_at:observed}};
 const page=(rows:any[])=>({statusCode:rows.length?206:200,body:rows,headers:{"content-range":rows.length?"0-"+(rows.length-1)+"/"+rows.length:"*/0"}});
 const data:any={
 "Read Latest Live Complete Intake":[{statusCode:200,body:[{id:"intake1",workflow_name:"TICKET-099 Existing Ledger Intake",action:"future_candidate_snapshot",status:"success",error_message:null,metadata}]}],
 "Read Existing One-Shot Ledger":[page([])],"Read Sender Evidence Audits":[page([])],"Read Sender Evidence Messages":[page([])],"Read All Manual Dunning Holds":[page([])],"Read Active Legacy Enrollments":[page([])],
 "Read Latest Historical Control":[{statusCode:200,body:[{id:"daily1",action:"daily_35_day_dunning_audit",status:"success",metadata:{continuation:{schema:"dunning.historical.snapshot.v1",observed_at:observed,fresh_until:t.plus({hours:26}).minus({minutes:5}).toISO(),candidates:[candidate],excluded:[]}}}]}]
 };
 return {data,now:t,candidate,page};
}
function run(f:ReturnType<typeof fixture>, source=code) {const $=(name:string)=>({isExecuted:!!f.data[name],first:()=>({json:f.data[name]?.[0]}),all:()=>f.data[name].map((json:any)=>({json}))});return new Function("$","$now","DateTime",source)($,f.now,DateTime);}
function sent(f:ReturnType<typeof fixture>,stage:number,when:string) {
 const key=f.candidate.continuation.cycle_prefix+":S"+stage,id="sent"+stage;
 const lock={request_id:key,status:"draft_created",message_id:id,internet_message_id:"<"+id+">",conversation_id:"thread"+stage,lease_until:when};
 const meta={lock_key:key,provider_message_id:id,provider_internet_message_id:lock.internet_message_id,provider_conversation_id:lock.conversation_id,evidence_schema:"t099.sender.evidence.v1",ticket:"099",stage,sent_at:when,recipient:"test@example.com",attachment_verified:true,pdf_sha256:stage>=4?"a".repeat(64):null,pdf_bytes:stage>=4?5000:null,attachment_id:stage>=4?"attachment":null,attachment_content_sha256:stage>=4?"a".repeat(64):null};
 const audit={id:"audit"+stage,workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_stage_sent_verified",status:"sent",created_at:when,metadata:meta};
 const message={message_id:id,internet_message_id:lock.internet_message_id,conversation_id:lock.conversation_id,direction:"outbound",source:"outlook",sent_at:when,to_emails:["test@example.com"],cc_emails:[],bcc_emails:[]};
 for(const [name,row] of [["Read Existing One-Shot Ledger",lock],["Read Sender Evidence Audits",audit],["Read Sender Evidence Messages",message]] as const) f.data[name]=[f.page([...f.data[name][0].body,row])];
}
test("reviewed proforma becomes S2 only at four business days, with its original lock cycle",()=>{
 assert.equal(run(fixture("2026-10-19T13:00:00Z")).length,0);
 const out=run(fixture());assert.equal(out.length,1);assert.equal(out[0].json.stage,2);assert.equal(out[0].json.lock_key,prefix+"123:C-R20261014T35:S2");assert.equal(out[0].json.previous_stage_sent_at,anchor.sent_at);
});
test("verified next send advances, and a locked unconfirmed delivery cannot be resent",()=>{
 const f=fixture("2026-10-27T13:00:00Z");sent(f,2,"2026-10-20T12:00:00Z");assert.equal(run(f)[0].json.stage,3);
 f.data["Read Existing One-Shot Ledger"][0].body[0].status="failed_final";assert.equal(run(f).length,0);
});
test("legacy S2 progresses to S3 and stops at legacy S4",()=>{
 const f=fixture("2026-10-27T13:00:00Z");f.candidate.continuation.stage_model="legacy_4";f.candidate.continuation.anchor.stage=2;f.candidate.continuation.anchor.evidence="outlook_legacy";f.candidate.continuation.anchor.lock_key=null as any;
 assert.equal(run(f)[0].json.stage,3);
 sent(f,3,"2026-10-15T12:00:00Z");assert.equal(run(f)[0].json.stage,4);
 sent(f,4,"2026-10-23T12:00:00Z");assert.equal(run(f).length,0);
});
test("fresh manual hold, paid exclusion and stale source cannot authorize continuation",()=>{
 const f=fixture();f.data["Read All Manual Dunning Holds"]=[f.page([{shopify_order_number:"#NEONT9000",paused:true}])];assert.equal(run(f).length,0);
 const g=fixture();g.data["Read Latest Historical Control"][0].body[0].metadata.continuation.fresh_until="2026-10-18T00:00:00Z";assert.throws(()=>run(g),/HISTORICAL_CONTINUATION_SOURCE/);
 const h=fixture();h.candidate.amount_due_cents=0;assert.throws(()=>run(h),/HISTORICAL_CONTINUATION_CANDIDATE/);
});
test("normal current S4 keeps progressing in its original cycle independently of historical candidates",()=>{
 const f=fixture("2026-10-21T15:00:00Z");const c:any={...f.candidate,continuation:undefined,intake_evidence:undefined,easybill_document_type:"INVOICE",easybill_document_created_at:"2026-09-01T08:00:00Z",cycle_kind:"initial",cycle_id:"INITIAL"};
 f.data["Read Latest Historical Control"][0].body[0].metadata.continuation.candidates=[];
 const m=f.data["Read Latest Live Complete Intake"][0].body[0].metadata;m.candidates=[c];m.union.candidate_count=1;
 f.candidate.continuation.cycle_prefix=prefix+"123";
 for(const [s,d] of [[1,"2026-09-02T12:00:00Z"],[2,"2026-09-08T12:00:00Z"],[3,"2026-09-14T12:00:00Z"],[4,"2026-10-14T12:00:00Z"]] as const)sent(f,s,d);
 const r=run(f);assert.equal(r.length,1);assert.equal(r[0].json.stage,5);assert.equal(r[0].json.lock_key,prefix+"123:S5");
});

 test("continued customer reply waits three business days without resetting historical stages",()=>{
 const f=fixture("2026-10-20T13:00:00Z");
 f.data["Read Sender Evidence Audits"]=[f.page([{id:"replydecision1",workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_reply_decision",status:"success",created_at:"2026-10-19T13:00:00Z",metadata:{schema:"t268.reply-decision.v1",lock_key:prefix+"123:C-R20261014T35:S2",shopify_order_id:"123",decision:"continue_dunning",reply_message_id:"reply1",reply_received_at:"2026-10-19T12:00:00Z",payment_received_cents:0,amount_due_cents:10000}}])];
 assert.equal(run(f).length,0);f.now=DateTime.fromISO("2026-10-22T13:00:00Z");
 const m=f.data["Read Latest Live Complete Intake"][0].body[0].metadata;m.observed_at=f.now.minus({minutes:5}).toISO();m.fresh_until=f.now.plus({minutes:85}).toISO();
 const h=f.data["Read Latest Historical Control"][0].body[0].metadata.continuation;h.observed_at=m.observed_at;h.fresh_until=f.now.plus({hours:26}).minus({minutes:5}).toISO();f.candidate.continuation.observed_at=h.observed_at;
 const r=run(f)[0].json;assert.equal(r.stage,2);assert.equal(r.cycle_id,"R20261014T35");assert.equal(r.scheduled_at,"2026-10-22T12:00:00.000Z");
});

test("a fulfilled invoice request keeps the original cycle and waits from actual delivery",()=>{
 const f:any=fixture("2026-10-19T13:00:00Z");
 const c={...f.candidate,continuation:undefined,intake_evidence:undefined,cycle_kind:"initial",cycle_id:"INITIAL",easybill_document_created_at:"2026-09-01T08:00:00Z"};
 f.data["Read Latest Historical Control"][0].body[0].metadata.continuation.candidates=[];
 const m=f.data["Read Latest Live Complete Intake"][0].body[0].metadata;m.candidates=[c];m.union.candidate_count=1;
 f.data["Read Sender Evidence Audits"]=[f.page([{id:"decision",workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_reply_decision",status:"success",created_at:"2026-10-19T12:00:00Z",metadata:{lock_key:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:123:S1",schema:"t268.reply-decision.v1",shopify_order_id:"123",decision:"continue_dunning",reply_message_id:"request",reply_received_at:"2026-09-16T07:04:31Z",reason_codes:["document_request_fulfilled"],invoice_delivery:{sent_at:"2026-09-16T07:34:34Z"},payment_received_cents:0,amount_due_cents:10000}}])];
 const r=run(f)[0].json;assert.equal(r.stage,1);assert.equal(r.lock_key,prefix+"123:S1");assert.equal(r.scheduled_at,"2026-09-21T07:34:34.000Z");
});


test("expiry reload overcomes only the held daily snapshot, keeping other exclusions",()=>{
 const patch=JSON.parse(readFileSync("n8n/dunning-managed-pause-expiry.patch.json","utf8"));
 const updated=patch.operations.find((op:any)=>op.nodeName==="Select Earliest Due Future Stage").updates["parameters.jsCode"];
 const f=fixture(); const c:any={...f.candidate,continuation:undefined,intake_evidence:undefined,cycle_kind:"initial",cycle_id:"INITIAL",easybill_document_created_at:"2026-09-01T08:00:00Z"};
 const historical=f.data["Read Latest Historical Control"][0].body[0].metadata.continuation;
 historical.candidates=[];historical.excluded=[{order:"#NEONT9000",reason:"held"}];
 const intake=f.data["Read Latest Live Complete Intake"][0].body[0].metadata;intake.candidates=[c];intake.union.candidate_count=1;
 const before={shopify_order_number:"#NEONT9000",paused:true,pause_mode:"until_date",pause_until:"2026-10-20T10:00:00Z",pause_reason:"Termin vereinbart",paused_by:"operator@example.test",pause_version:2,updated_at:"2026-10-13T10:00:00Z",resume_due:true};
 f.data["Read All Manual Dunning Holds"]=[f.page([before])];
 f.data["Find All Due Managed Pauses"]=[before];
 const after={...before,paused:false,pause_mode:null,pause_until:null,pause_version:3};
 f.data["Reload Holds After Expiry"]=[f.page([after])];
 assert.equal(run(f,updated)[0].json.stage,1);
 assert.equal(run(f,updated)[0].json.pause_resume_required,false);
 historical.excluded[0].reason="paid"; assert.equal(run(f,updated).length,0);
 historical.excluded[0].reason="held";after.paused=true;assert.equal(run(f,updated).length,0);
 after.paused=false;after.pause_version=4;assert.equal(run(f,updated).length,0);
});
