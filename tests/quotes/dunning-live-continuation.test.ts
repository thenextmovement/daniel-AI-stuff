import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";
import assert from "node:assert/strict";
const {DateTime}=createRequire(import.meta.url)("luxon");
const run=(file:string,data:any,now="2026-10-20T13:00:00Z")=>new Function("$","$now","DateTime",readFileSync("workflows/dunning/"+file,"utf8"))((name:string)=>({first:()=>({json:data[name][0]}),all:()=>data[name].map((json:any)=>({json}))}),DateTime.fromISO(now),DateTime)[0].json;
function fixture(){
 const prefix="e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:123:C-R20261014T35";
 const anchor={stage:1,sent_at:"2026-10-14T12:00:00Z",message_id:"sent1",internet_message_id:"<sent1>",conversation_id:"thread1",lock_key:prefix+":S1"};
 const continuation={schema:"dunning.historical.candidate.v1",stage_model:"current_6",cycle_id:"R20261014T35",cycle_prefix:prefix,anchor,document_type:"PROFORMA_INVOICE"};
 const c={shopify_order_id:"123",shopify_order_gid:"gid://shopify/Order/123",shopify_order_name:"#NEONT9000",shopify_order_created_at:"2026-09-01T09:00:00Z",easybill_document_created_at:"2026-09-01T09:00:00Z",easybill_document_id:"456",easybill_invoice_number:"PF-NEONT9000",easybill_document_type:"PROFORMA_INVOICE",easybill_due_date:"2026-09-15",mirror_email:"test@example.com",amount_due_cents:10000,invoice_amount_cents:10000,payment_received_cents:0,easybill_paid_cents:0,currency:"EUR",stage:2,cycle_kind:"historical_continuation",cycle_baseline_at:"2026-09-01T09:00:00Z",lock_key:prefix+":S2",previous_stage_sent_at:anchor.sent_at,continuation,intake_evidence:{source:"historical_control_v1"},company_history_query_mode:"exact_email",company_history_query_value:"test@example.com"};
 const money=(amount:string)=>({shopMoney:{amount,currencyCode:"EUR"}});
 const o={id:c.shopify_order_gid,legacyResourceId:"123",name:c.shopify_order_name,email:c.mirror_email,displayFinancialStatus:"PENDING",createdAt:c.shopify_order_created_at,totalPriceSet:money("100.00"),currentTotalPriceSet:money("100.00"),totalOutstandingSet:money("100.00"),totalReceivedSet:money("0.00"),totalRefundedSet:money("0.00"),transactions:[],tags:[],billingAddress:{}};
 const d={id:456,type:"PROFORMA_INVOICE",is_draft:false,number:"PF-NEONT9000",order_number:"#NEONT9000",amount:10000,paid_amount:0,currency:"EUR",created_at:"2026-09-01 11:00:00",due_date:"2026-09-15",address:{}};
 const env=(body:any)=>({statusCode:200,body});
 const data:any={
 "Select Earliest Due Future Stage":[c],"Validate T268 Reply Decision":[{reply_evidence:{complete:true,replies:[]}}],
 "Read Current Dunning Hold":[env([])],"Shopify Complete Live Gate":[{...env({data:{order:o,customers:{nodes:[],pageInfo:{hasNextPage:false}},disputes:{nodes:[],pageInfo:{hasNextPage:false}}}}),headers:{"x-shopify-api-version":"2026-07"}}],
 "Easybill Live Invoice":[env(d)],"Easybill Immutable Versions":[env([{id:1,created_at:"2026-09-01",items:[{id:2,document_version_item_type:"default"}]}])],
 "Easybill Customer Documents":[env([d])],"Easybill Document Payments":[env([])],"Normalize Qonto Live Gate":[{complete:true,transactions:[]}],
 "Graph Read Prior Reminder Threads":[env({value:[{id:anchor.message_id,internetMessageId:anchor.internet_message_id,conversationId:anchor.conversation_id,isDraft:false,from:{emailAddress:{address:"support@neontrip.de"}},sentDateTime:anchor.sent_at,toRecipients:[{emailAddress:{address:c.mirror_email}}],ccRecipients:[],bccRecipients:[]}]})],
 "Read Existing One-Shot Ledger":[env([])],"Read Sender Evidence Audits":[env([])],"Read Sender Evidence Messages":[env([])],"Read All Manual Dunning Holds":[env([])]
 };return{data,c,o,d};
}
test("full live gate accepts a due proforma continuation with verified Outlook anchor",()=>{
 const f=fixture(),r=run("live-send-gate.js",f.data);assert.deepEqual(r.reasons,[]);assert.equal(r.send_allowed,true);assert.match(r.subject,/Freundliche Erinnerung/);
 assert.equal(run("live-send-gate.js",f.data,"2026-10-19T13:00:00Z").send_allowed,false);
});
test("fresh paid, paused, stop-tagged, disputed and newly answered cases stay blocked",()=>{
 for(const mutate of [
 (f:any)=>{f.o.displayFinancialStatus="PAID";f.o.totalOutstandingSet.shopMoney.amount="0.00";},
 (f:any)=>{f.data["Read Current Dunning Hold"][0].body=[{shopify_order_number:f.c.shopify_order_name,paused:true}];},
 (f:any)=>{f.o.tags=["keine Zahlungserinnerung"];},
 (f:any)=>{f.data["Shopify Complete Live Gate"][0].body.data.disputes.nodes=[{order:{legacyResourceId:"123"}}];},
 (f:any)=>{f.data["Validate T268 Reply Decision"][0]={reply_evidence:{complete:true},is_new_decision:true,decision:"stop_dunning"};},
 (f:any)=>{f.data["Normalize Qonto Live Gate"][0].transactions=[{id:"bank1",side:"credit",status:"completed",currency:"EUR",amount:"100.00",reference:"NEONT9000"}];}
 ]){const f=fixture();mutate(f);assert.equal(run("live-send-gate.js",f.data).send_allowed,false);}
});
test("changed amount, replacement invoice, missing source or invalid anchor cannot send",()=>{
 for(const mutate of [
 (f:any)=>{f.d.amount=10001;},(f:any)=>{f.d.type="INVOICE";},
 (f:any)=>{f.data["Normalize Qonto Live Gate"][0].complete=false;},
 (f:any)=>{f.data["Graph Read Prior Reminder Threads"][0].body.value[0].isDraft=true;},
 (f:any)=>{f.data["Graph Read Prior Reminder Threads"][0].body.value[0].toRecipients.push({emailAddress:{address:"other@example.com"}});},
 (f:any)=>{f.data["Easybill Customer Documents"][0].body.push({...f.d,id:789,type:"INVOICE"});}
 ]){const f=fixture();mutate(f);assert.equal(run("live-send-gate.js",f.data).send_allowed,false);}
});
test("historic replies before classifier cutover remain blocking",()=>{
 const f=fixture();f.c.cycle_baseline_at="2026-01-01T00:00:00Z";
 f.data["Graph Read Prior Reminder Threads"][0].body.value.push({id:"reply1",internetMessageId:"<reply1>",conversationId:"thread1",from:{emailAddress:{address:"other@example.com"}},receivedDateTime:"2026-07-01T12:00:00Z",isDraft:false,internetMessageHeaders:[],subject:"Rechnung",body:{contentType:"text",content:"Die Rechnung ist bezahlt."}});
 const r=run("reply-decision.js",f.data);assert.equal(r.legacy_reply_present,true);assert.equal(r.reply_evidence.verified_thread_count,1);
 f.data["Validate T268 Reply Decision"]=[r];assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});
test("legacy final projection has no next stage, while modern S4 retains next due",()=>{
 const f=fixture();const gate={...f.c,stage:4,stage_model:"legacy_4"};f.data["Build Complete Live Gate + Message"]=[gate];f.data["Build Terminal Evidence Payload"]=[{verified:true,audit_record:{metadata:{sent_at:"2026-10-20T13:00:00Z"}}}];
 assert.equal(run("verified-projection.js",f.data).next_due_at,null);
 gate.stage_model="current_6";assert.equal(run("verified-projection.js",f.data).next_due_at,"2026-10-27");
});

test("proforma immediate payment terms are reverified live rather than inferred from the snapshot",()=>{
 const f:any=fixture();f.d.due_date=null;f.d.due_in_days=0;f.d.document_date="2026-09-01";f.d.text="Zahlbar sofort. Produktion beginnt bereits.";f.c.easybill_due_date="2026-09-01";
 assert.equal(run("live-send-gate.js",f.data).send_allowed,true);
 f.d.text="Zahlung später nach Vereinbarung";assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});

test("reviewed billing address is preserved, but a new Shopify recipient blocks pending review",()=>{
 const f:any=fixture();f.c.continuation.original_shopify_email=f.o.email;f.c.continuation.anchor.evidence="reviewed_reminder";f.c.continuation.anchor.audit_id="review1";f.c.continuation.anchor.recipient="billing@example.com";f.c.mirror_email="billing@example.com";f.c.company_history_query_value="billing@example.com";f.data["Graph Read Prior Reminder Threads"][0].body.value[0].toRecipients=[{emailAddress:{address:"billing@example.com"}}];
 const r=run("live-send-gate.js",f.data);assert.equal(r.send_allowed,true);assert.equal(r.recipient,"billing@example.com");
 f.o.email="changed@example.net";assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});

test("live historical reply continuation retains the agreed waiting period",()=>{const f:any=fixture();f.c.cycle_baseline_at="2026-10-19T12:00:00Z";f.c.cycle_decision_audit_id="replydecision1";assert.ok(run("live-send-gate.js",f.data).reasons.includes("LIVE_STAGE_NOT_DUE"));assert.equal(run("live-send-gate.js",f.data,"2026-10-22T13:00:00Z").send_allowed,true);});

test("proven review cutoff avoids reblocking settled correspondence but detects every newer reply",()=>{
 const f:any=fixture();f.c.continuation.correspondence_review={audit_id:"8a19fc8c-1dbf-4bb2-bdbd-2325a04c179c",reviewed_at:"2026-10-14T13:10:26Z",outcome:"confirmed_order"};
 const m={id:"oldreply",internetMessageId:"<oldreply>",conversationId:"thread1",from:{emailAddress:{address:"test@example.com"}},receivedDateTime:"2026-09-03T12:00:00Z",isDraft:false,internetMessageHeaders:[],subject:"Bestellung #NEONT9000",body:{contentType:"text",content:"Design ist freigegeben."}};
 f.data["Graph Read Prior Reminder Threads"][0].body.value.push(m);assert.equal(run("reply-decision.js",f.data).reply_evidence.replies.length,0);
 m.receivedDateTime="2026-10-15T12:00:00Z";m.body.content="Wir haben bereits bezahlt.";assert.equal(run("reply-decision.js",f.data).requires_ai,true);
});

test("regular proforma uses the verified billing address and keeps company history on the ordering company",()=>{
 const f:any=fixture();f.c.continuation=null;f.c.cycle_kind="initial";f.c.intake_evidence={};f.c.stage=1;f.c.previous_stage_sent_at=null;
 f.c.original_shopify_email="buyer@example.com";f.o.email="buyer@example.com";f.c.billing_recipient_source="easybill_customer_snapshot";f.c.mirror_email="billing@example.com";f.d.customer_snapshot={emails:["billing@example.com"]};f.c.company_history_query_value="buyer@example.com";
 f.d.due_date=null;f.d.due_in_days=0;f.d.document_date="2026-09-01";f.d.text="Zahlbar sofort.";f.c.easybill_due_date="2026-09-01";
 const r=run("live-send-gate.js",f.data);assert.deepEqual(r.reasons,[]);assert.equal(r.recipient,"billing@example.com");
 f.d.customer_snapshot.emails=["changed@example.com"];assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});
test("regular proforma still rejects ambiguous documents and changed payment terms",()=>{
 const f:any=fixture();f.c.continuation=null;f.c.cycle_kind="initial";f.c.intake_evidence={};f.c.stage=1;
 f.data["Easybill Customer Documents"][0].body.push({...f.d,id:790});assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
 f.data["Easybill Customer Documents"][0].body.pop();f.d.due_date="2026-11-01";assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});


test("reply analysis includes later invoice delivery, fields and a changed context invalidates a cached decision",()=>{
 const f:any=fixture();f.d.customer_snapshot={emails:["test@example.com"]};f.d.text_prefix="Projekt ID: J800-J8001";f.d.updated_at="2026-09-16 09:34:29";
 const messages=f.data["Graph Read Prior Reminder Threads"][0].body.value;
 messages.push({id:"request",internetMessageId:"<request>",conversationId:"billing",from:{emailAddress:{address:"test@example.com"}},receivedDateTime:"2026-09-16T07:04:00Z",isDraft:false,internetMessageHeaders:[],subject:"Rechnung #NEONT9000",body:{contentType:"text",content:"Bitte die Rechnung an test@example.com und mit Projekt-ID senden."}});
 messages.push({id:"invoice",internetMessageId:"<invoice>",conversationId:"invoice-thread",from:{emailAddress:{address:"support@neontrip.de"}},sentDateTime:"2026-09-16T07:34:34Z",isDraft:false,hasAttachments:true,attachments:[{name:"Rechnung-PF-NEONT9000.pdf",contentType:"application/pdf",isInline:false}],toRecipients:[{emailAddress:{address:"test@example.com"}}],subject:"Kunde | PF-NEONT9000 | DARA NOVA GmbH",body:{contentType:"text",content:"Ihre Rechnung im Anhang."}});
 f.data["Read Sender Evidence Audits"][0].body.push({action:"customer_reply_decision",status:"success",metadata:{schema:"t268.reply-decision.v1",reply_message_id:"request",decision:"uncertain",validation_error:"invalid_json"}});
 const r=run("reply-decision.js",f.data);assert.equal(r.requires_ai,true);assert.equal(r.invoice_delivery.message_id,"invoice");assert.equal(r.resolved_document_request_evidence,true);assert.match(r.prompt_user,/J800-J8001/);assert.equal(r.invoice_delivery.attachments[0].content_type,"application/pdf");
 const saved=messages.at(-1).attachments;delete messages.at(-1).attachments;assert.equal(run("reply-decision.js",f.data).resolved_document_request_evidence,false);messages.at(-1).attachments=saved;
 messages.at(-1).subject="Rechnung PF-NEONT90000";assert.equal(run("reply-decision.js",f.data).invoice_delivery,null);
});
test("a newer complaint and undelivered invoice cannot be dismissed by old invoice evidence",()=>{
 const f:any=fixture();f.data["Graph Read Prior Reminder Threads"][0].body.value.push({id:"complaint",internetMessageId:"<c>",conversationId:"thread1",from:{emailAddress:{address:"test@example.com"}},receivedDateTime:"2026-10-19T12:00:00Z",isDraft:false,internetMessageHeaders:[],subject:"#NEONT9000",body:{contentType:"text",content:"Das Schild ist beschädigt. Bitte klären."}});
 const r=run("reply-decision.js",f.data);assert.equal(r.requires_ai,true);assert.equal(r.resolved_document_request_evidence,false);
});

test("original proforma delivery uses exact attached invoice even when subject contains only order number",()=>{
 const f:any=fixture();f.c.mirror_email="billing@gmail.com";f.c.shopify_email_hint="billing@gmail.com";
 const m:any={id:"invoice4711",internetMessageId:"<invoice4711>",conversationId:"invoice-thread",from:{emailAddress:{address:"support@neontrip.de"}},sentDateTime:"2026-09-01T09:01:00Z",isDraft:false,hasAttachments:true,attachments:[{name:"Proforma-Rechnung-PF-NEONT9000-NT-NEONT9000.pdf",contentType:"application/pdf",isInline:false}],toRecipients:[{emailAddress:{address:"billing@gmail.com"}}],subject:"Auftragsbestätigung und Rechnung #NEONT9000"};
 delete f.c.easybill_document_created_at; // The production selector omits this snapshot field.
 f.data["Graph Read Prior Reminder Threads"][0].body.value.push(m);
 assert.equal(run("reply-decision.js",f.data).invoice_delivery?.message_id,"invoice4711");
 for(const change of [
 ()=>{m.attachments[0].name="PF-NEONT90000.pdf";},
 ()=>{m.attachments[0].name="PF-NEONT9000-1.pdf";},
 ()=>{m.attachments[0].name="PF-NEONT9000.pdf";m["attachments@odata.nextLink"]="more";},
 ()=>{delete m["attachments@odata.nextLink"];m.sentDateTime="2026-08-01T09:00:00Z";}
 ]){change();assert.equal(run("reply-decision.js",f.data).invoice_delivery,null);}
});
test("same payer and amount on an explicitly different invoice does not block this invoice",()=>{
 const f:any=fixture();f.o.billingAddress.company="Bodystreet GmbH";
 const bank:any={id:"other-invoice",side:"credit",status:"completed",currency:"EUR",amount:"100.00",counterparty_name:"Bodystreet GmbH",reference:"RNr. NEONT3690 RDat. 16.09.2025"};
 f.data["Normalize Qonto Live Gate"][0].transactions=[bank];
 assert.equal(run("live-send-gate.js",f.data).send_allowed,true);
 bank.reference="NEONT90000";assert.equal(run("live-send-gate.js",f.data).send_allowed,true);
 bank.reference="NEONT3690 / NEONT9000";assert.ok(run("live-send-gate.js",f.data).reasons.includes("QONTO_UNREFLECTED_PAYMENT_PRESENT"));
 bank.reference="Rechnung";assert.ok(run("live-send-gate.js",f.data).reasons.includes("QONTO_AMBIGUOUS_POSSIBLE_PAYMENT"));
 bank.reference="NEONT9000";assert.ok(run("live-send-gate.js",f.data).reasons.includes("QONTO_UNREFLECTED_PAYMENT_PRESENT"));
});

test("live gate rechecks authoritative current proforma revision and rejects later revision changes",()=>{
 const f:any=fixture();const old={...f.d,id:789,number:"PF-NEONT9000-OLD"};
 f.data["Easybill Customer Documents"][0].body.push(old);
 const c:any={shopify_order_id:"123",shopify_order_name:"#NEONT9000",current_revision:1,status:"PAYMENT_PENDING",currency:"EUR",total_gross_cents:10000,
 billing_documents:[{document_type:"PROFORMA",revision:0,document_number:old.number,easybill_document_id:"789",amount_cents:10000,currency:"EUR",status:"SENT",sent_at:"2026-08-31T09:00:00Z"},{document_type:"PROFORMA",revision:1,document_number:f.d.number,easybill_document_id:"456",amount_cents:10000,currency:"EUR",status:"SENT",sent_at:"2026-09-01T09:00:00Z"}]};
 f.data["Read Billing Revisions"]=[{statusCode:200,headers:{"content-range":"0-0/1"},body:[c]}];
 assert.equal(run("live-send-gate.js",f.data).send_allowed,true);
 c.current_revision=2;assert.ok(run("live-send-gate.js",f.data).reasons.includes("EASYBILL_PROFORMA_NOT_UNIQUE"));
 c.current_revision=1;c.paid_at="2026-10-19T09:00:00Z";assert.equal(run("live-send-gate.js",f.data).send_allowed,false);
});

test("historic CC recipients are verified exactly but never copied to a new reminder",()=>{
 const f:any=fixture();f.c.continuation.anchor.evidence="outlook_legacy";f.c.continuation.anchor.cc_emails=["colleague@example.com"];
 f.data["Graph Read Prior Reminder Threads"][0].body.value[0].ccRecipients=[{emailAddress:{address:"colleague@example.com"}}];
 assert.equal(run("live-send-gate.js",f.data).send_allowed,true);
 f.data["Graph Read Prior Reminder Threads"][0].body.value[0].ccRecipients.push({emailAddress:{address:"unverified@example.net"}});
 assert.ok(run("live-send-gate.js",f.data).reasons.includes("HISTORICAL_ANCHOR_NOT_LIVE_VERIFIED"));
});
test("all three billing revision consumers embed the same tested resolver",()=>{
 const resolver=readFileSync("workflows/dunning/billing-revision.js","utf8").trim();
 for(const file of ["intake.js","live-send-gate.js","daily-35-day-reconciliation.js"])
   assert.ok(readFileSync("workflows/dunning/"+file,"utf8").includes(resolver),file);
 const contract=readFileSync("workflows/dunning/historical-continuation.js","utf8").trim();
 assert.ok(readFileSync("workflows/dunning/daily-35-day-reconciliation.js","utf8").includes(contract));
});
