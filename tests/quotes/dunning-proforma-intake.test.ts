import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
const {DateTime}=createRequire(import.meta.url)("luxon");
function run(file:string,data:any,input:any={},now="2026-10-19T11:00:00Z"){
 return new Function("$","$input","$now","DateTime","$execution",readFileSync("workflows/dunning/"+file,"utf8"))(
 (name:string)=>({first:()=>({json:data[name][0]}),all:()=>data[name].map((json:any)=>({json}))}),
 {first:()=>({json:input})},DateTime.fromISO(now),DateTime,{id:"test"});
}
function fixture(){
 const o:any={id:123,name:"#NEONT9000",created_at:"2026-10-01T09:00:00Z",updated_at:"2026-10-01T09:00:00Z",financial_status:"pending",total_price:"100.00",current_total_price:"100.00",total_outstanding:"100.00",currency:"EUR",tags:"",email:"buyer@example.com",billing_address:{company:"Example GmbH"}};
 const d:any={id:456,type:"PROFORMA_INVOICE",order_number:"#NEONT9000",number:"PF-NEONT9000",created_at:"2026-10-01 11:00:00",amount:10000,paid_amount:0,paid_at:null,is_draft:false,cancel_id:null,currency:"EUR",customer_id:789,due_date:null,due_in_days:0,document_date:"2026-10-01",text:"Zahlbar sofort. Produktion beginnt bereits.",customer_snapshot:{emails:["billing@example.com"]}};
 const page=(items:any[])=>({statusCode:200,body:{items,page:1,pages:items.length?1:0,total:items.length,limit:100}});
 const data:any={"Shopify Read-All Scope Check":[{statusCode:200,body:{access_scopes:[{handle:"read_orders"},{handle:"read_all_orders"}]}}],"Read All Live Pending Shopify Orders":[{statusCode:200,headers:{"x-shopify-api-version":"2026-07"},body:{orders:[o]}}],"Read All Live Open Easybill Invoices":[page([])],"Read All Live Open Easybill Proformas":[page([d])]};
 return {o,d,data,page};
}
test("regular intake includes a completed due proforma younger than 35 days with its real billing recipient",()=>{
 const f=fixture(),r=run("intake.js",f.data)[0].json;
 assert.equal(r.status,"success");assert.equal(r.metadata.candidates.length,1);
 const c=r.metadata.candidates[0];assert.equal(c.easybill_document_type,"PROFORMA_INVOICE");assert.equal(c.easybill_due_date,"2026-10-01");assert.equal(c.shopify_email_hint,"billing@example.com");assert.equal(c.original_shopify_email,"buyer@example.com");assert.equal(c.easybill_document_created_at,"2026-10-01T09:00:00.000Z");
});
test("intake rejects paid, cancelled, test, held, draft, mismatched and ambiguous proformas",()=>{
 for(const mutate of [
 (f:any)=>{f.o.financial_status="paid";f.o.total_outstanding="0.00";},
 (f:any)=>{f.o.cancelled_at="2026-10-02T00:00:00Z";},
 (f:any)=>{f.o.tags="keine Zahlungserinnerung";},
 (f:any)=>{f.o.tags="E2E";},
 (f:any)=>{f.d.is_draft=true;},
 (f:any)=>{f.d.amount=10001;},
 (f:any)=>{f.d.text="Zahlung nach Vereinbarung";},
 (f:any)=>{f.data["Read All Live Open Easybill Proformas"]=[f.page([f.d,{...f.d,id:457,number:"PF-NEONT9000-1"}])];}
 ]){const f=fixture();mutate(f);assert.equal(run("intake.js",f.data)[0].json.metadata.candidates.length,0);}
});
test("incomplete proforma pages fail the whole intake instead of silently omitting cases",()=>{
 const f=fixture();f.data["Read All Live Open Easybill Proformas"][0].body.total=101;
 const r=run("intake.js",f.data)[0].json;assert.equal(r.status,"blocked");assert.equal(r.metadata.source_complete,false);assert.equal(r.metadata.candidates.length,0);
});
test("one unpaid final invoice supersedes its associated proforma without duplicate enrollment",()=>{
 const f=fixture(),invoice={...f.d,id:999,type:"INVOICE",number:"#NEONT9000",due_date:"2026-10-15"};
 f.data["Read All Live Open Easybill Invoices"]=[f.page([invoice])];const c=run("intake.js",f.data)[0].json.metadata.candidates;
 assert.equal(c.length,1);assert.equal(c[0].easybill_document_id,"999");assert.equal(c[0].easybill_document_type,"INVOICE");
});
test("technical classifier failure is an execution failure, never a customer decision or permanent pause",()=>{
 const data={"Build T268 Reply Decision Request":[{requires_ai:true,latest_reply:{body_text:"Bitte Rechnung schicken."}}]};
 assert.throws(()=>run("validate-reply-decision.js",data,{error:"Your credit balance is too low"}),/CLASSIFIER_TECHNICAL_FAILURE/);
 assert.throws(()=>run("validate-reply-decision.js",data,{text:"not JSON"}),/CLASSIFIER_TECHNICAL_FAILURE/);
});


test("project references before explicit immediate terms do not exclude valid proformas",()=>{
 const f=fixture();f.d.text="Projektnummer: Neon Schild CF Rottweil\n\nZahlbar sofort. Produktion beginnt.";
 assert.equal(run("intake.js",f.data)[0].json.metadata.candidates.length,1);
});

test("a continue decision with an unresolved payment risk is rejected",()=>{
 const code=readFileSync(new URL("../../workflows/dunning/validate-reply-decision.js",import.meta.url),"utf8");
 const meta={requires_ai:true,latest_reply:{body_text:"Ich habe bezahlt."},resolved_document_request_evidence:true};
 const answer={decision:"continue_dunning",confidence:.99,summary:"Widersprüchlich",reason_codes:["document_request_fulfilled"],risk_flags:["payment_claim"],evidence_quote:"Ich habe bezahlt.",requires_human_review:false};
 assert.throws(()=>new Function("$","$input",code)(()=>({first:()=>({json:meta})}),{first:()=>({json:{text:JSON.stringify(answer)}})}),/CLASSIFIER_TECHNICAL_FAILURE/);
});
