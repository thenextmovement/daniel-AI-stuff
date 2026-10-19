import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const build = new Function("return (" + readFileSync("workflows/dunning/historical-continuation.js", "utf8") + "\n)")();
const prefix = "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:";
function fixture() {
  const money = (amount: string) => ({shopMoney:{amount,currencyCode:"EUR"}});
  const mail = {message_id:"m1",internet_message_id:"<m1>",conversation_id:"thread1",sent_at:"2026-10-14T12:00:00Z",subject:"Zahlungserinnerung PF-NEONT9000",to_emails:["test@example.com"],cc_emails:[],bcc_emails:[],direction:"outbound",source:"outlook"};
  return {
    observedAt:"2026-10-19T08:00:00Z",
    orders:[{id:"gid://shopify/Order/123",legacyResourceId:"123",name:"#NEONT9000",email:"test@example.com",createdAt:"2026-09-01T09:00:00Z",updatedAt:"2026-09-01T10:00:00Z",cancelledAt:null,displayFinancialStatus:"PENDING",tags:[],totalPriceSet:money("100.00"),currentTotalPriceSet:money("100.00"),totalOutstandingSet:money("100.00"),totalReceivedSet:money("0.00")}],
    documents:[{id:456,order_number:"NEONT9000",number:"PF-NEONT9000",type:"PROFORMA_INVOICE",customer_id:789,created_at:"2026-09-01 10:00:00",due_date:"2026-09-15",amount:10000,paid_amount:0,paid_at:null,cancel_id:null,is_draft:false,currency:"EUR"}],
    states:[{shopify_order_number:"#NEONT9000",mahnstufe:1,last_sent_at:mail.sent_at,paused:false}],
    logs:[],mails:[mail],proofs:[{id:"audit1",document_id:"123",status:"sent",action:"reviewed_reminder_sent_verified",metadata:{evidence_schema:"dunning.reviewed.reminder.v1",live_evidence:{review_ticket:"REPAIR-20261014-MAHN-35D"},stage:1,easybill_document_id:"456",sent_at:mail.sent_at,lock_key:prefix+"123:C-R20261014T35:S1",provider_message_id:"m1",provider_internet_message_id:"<m1>",provider_conversation_id:"thread1",recipient:"test@example.com",attachment_verified:true,pdf_sha256:"a".repeat(64),attachment_content_sha256:"a".repeat(64),pdf_bytes:5000}}],
    cases:[{order:"#NEONT9000",shopify_order_id:"123",stage:1,stage_source:"legacy",status:"reminder_evidenced",allocated_cents:0,remaining_cents:10000,gross_cents:10000}]
  };
}
test("reviewed proforma continues the original cycle instead of falling out of invoice intake",()=>{
 const result=build(fixture()); assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].continuation.cycle_prefix,prefix+"123:C-R20261014T35");
 assert.equal(result.candidates[0].continuation.anchor.stage,1);
 assert.equal(result.candidates[0].continuation.stage_model,"current_6");
});
test("unpaid historical invoice keeps its proven legacy stage and four-stage endpoint",()=>{
 const f:any=fixture();f.orders[0].createdAt="2026-01-01T09:00:00Z";f.documents[0].type="INVOICE";f.documents[0].number="#NEONT9000";f.proofs=[];
 f.mails[0].subject="Mahnung-#NEONT9000";f.mails[0].sent_at=f.states[0].last_sent_at="2026-02-02T10:00:00Z";
 const r=build(f);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].continuation.stage_model,"legacy_4");assert.equal(r.candidates[0].continuation.anchor.stage,1);
});
test("paid, held, cancelled, final and disputed cases never become continuation candidates",()=>{
 for(const status of ["held","cancelled","test","payment_data_conflict","payment_recording_required","final_stage_review","stage_source_review","sender_blocked"]){const f=fixture();f.cases[0].status=status;assert.equal(build(f).candidates.length,0,status);}
});
test("unbooked partial or full payment is never replaced by Shopify's gross balance",()=>{
 const f=fixture();f.cases[0].allocated_cents=3300;f.cases[0].remaining_cents=6700;assert.equal(build(f).candidates.length,0);
 f.cases[0].allocated_cents=10000;f.cases[0].remaining_cents=0;assert.equal(build(f).candidates.length,0);
});
test("hold added after the report classification still prevents enrollment",()=>{
 const f=fixture();f.states[0].paused=true;assert.equal(build(f).candidates.length,0);
 f.states[0].paused=false;(f.orders[0].tags as string[]).push("Nicht mahnen");assert.equal(build(f).candidates.length,0);
});
test("missing, mismatched or ambiguous sent evidence cannot advance an old stage",()=>{
 const f:any=fixture();f.proofs=[];f.mails=[];assert.equal(build(f).candidates.length,0);
 const g=fixture();g.proofs[0].metadata.provider_message_id="wrong";assert.equal(build(g).candidates.length,0);
 const h:any=fixture();h.proofs=[];h.mails.push({...h.mails[0],message_id:"m2"});assert.equal(build(h).candidates.length,0);
});
test("first historical proforma can start only without any prior reminder",()=>{
 const f:any=fixture();f.orders[0].createdAt="2026-07-01T09:00:00Z";f.proofs=[];f.mails=[];f.states[0].mahnstufe=0;f.states[0].last_sent_at=null;f.cases[0].stage=0;f.cases[0].stage_source="unknown";f.cases[0].status="reminder_missing";
 const r=build(f);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].continuation.anchor,null);
 f.mails=fixture().mails;assert.equal(build(f).candidates.length,0);
});
test("invoice supersedes proforma, but two invoices or a changed amount require review",()=>{
 const f:any=fixture();f.documents.push({...f.documents[0],id:999,type:"INVOICE",number:"#NEONT9000"});assert.equal(build(f).candidates.length,0);
 f.documents.push({...f.documents[1],id:998});assert.equal(build(f).candidates.length,0);
 const g=fixture();g.documents[0].paid_amount=100;assert.equal(build(g).candidates.length,0);
});

test("transient technical source failure remains retryable while business blocks stay excluded",()=>{
 const f:any=fixture();f.cases[0].status="sender_blocked";f.cases[0].sender_block_kind="technical";
 assert.equal(build(f).candidates.length,1);f.cases[0].sender_block_kind="permanent";assert.equal(build(f).candidates.length,0);
});

test("proforma without API due date uses only the explicit immediate payment term on its document",()=>{
 const f:any=fixture();f.documents[0].due_date=null;f.documents[0].due_in_days=0;f.documents[0].document_date="2026-09-01";f.documents[0].text="Zahlbar sofort. Die Produktion beginnt bereits.";
 const r=build(f);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].easybill_due_date,"2026-09-01");assert.equal(r.candidates[0].easybill_due_basis,"explicit_immediate_proforma");
 f.documents[0].text="Zahlbar nach gesonderter Vereinbarung";assert.equal(build(f).candidates.length,0);
});

test("a verified reviewed billing recipient stays attached to its original invoice and mail",()=>{
 const f:any=fixture();f.proofs[0].metadata.recipient="billing@example.com";f.mails[0].to_emails=["billing@example.com"];
 const c=build(f).candidates[0];assert.equal(c.shopify_email_hint,"billing@example.com");assert.equal(c.continuation.original_shopify_email,"test@example.com");assert.equal(c.continuation.anchor.recipient,"billing@example.com");
});

test("documented correspondence review carries its cutoff but unresolved billing routes stay excluded",()=>{
 const f:any=fixture();const review={id:"8a19fc8c-1dbf-4bb2-bdbd-2325a04c179c",action:"one_time_correspondence_review",status:"success",created_at:"2026-10-14T13:10:26Z",metadata:{schema:"dunning.mailreview.v1",provider_mailbox:"support@neontrip.de",findings:{"9000":{hold:false,outcome:"confirmed_order"}}}};f.proofs.push(review);
 assert.equal(build(f).candidates[0].continuation.correspondence_review.audit_id,review.id);
 review.metadata.findings["9000"].outcome="auto_reply_and_billing_route";assert.equal(build(f).candidates.length,0);
 review.metadata.findings["9000"].outcome="confirmed_order";review.metadata.findings["9000"].hold=true;assert.equal(build(f).candidates.length,0);
});

test("a young post-cutover proforma is routed to regular intake, never excluded by age",()=>{
 const f:any=fixture();f.orders[0].createdAt="2026-10-01T09:00:00Z";f.proofs=[];f.mails=[];f.states=[];f.cases[0].stage=0;f.cases[0].stage_source="unknown";f.cases[0].status="reminder_missing";
 const r=build(f);assert.equal(r.candidates.length,0);assert.equal(r.excluded[0].reason,"REGULAR_INTAKE");
});

test("manual reminder body plus exact sent timestamp preserves legacy stage and resolved billing review",()=>{
 const f:any=fixture();f.proofs=[];f.mails[0].cc_emails=["colleague@example.com"];f.mails[0].subject="AW: Anfrage Schriftzug";f.mails[0].body_preview="Hallo Herr Balko, wir haben noch die Rechnung #NEONT9000 offen bzw. unbezahlt.";
 const review={id:"8a19fc8c-1dbf-4bb2-bdbd-2325a04c179c",action:"one_time_correspondence_review",status:"success",created_at:"2026-10-14T13:10:26Z",metadata:{schema:"dunning.mailreview.v1",provider_mailbox:"support@neontrip.de",findings:{"9000":{hold:false,outcome:"answered_billing_route"}}}};f.proofs.push(review);
 const c=build(f).candidates[0];assert.equal(c?.continuation.anchor.stage,1);assert.deepEqual(c.continuation.anchor.cc_emails,["colleague@example.com"]);assert.equal(c.continuation.stage_model,"legacy_4");assert.equal(c.continuation.correspondence_review.outcome,"answered_billing_route");
 f.mails[0].body_preview="Rechnung #NEONT90000 offen bzw. unbezahlt.";assert.equal(build(f).candidates.length,0);
 f.mails[0].body_preview="Rechnung #NEONT9000 ist beigefügt.";assert.equal(build(f).candidates.length,0);
 f.mails[0].body_preview="Rechnung #NEONT9000 offen bzw. unbezahlt.";f.states[0].paused=true;assert.equal(build(f).candidates.length,0);
});
