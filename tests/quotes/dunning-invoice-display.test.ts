import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
function evidence(docs: unknown[]) {
 const source=readFileSync("workflows/dunning/daily-35-day-reconciliation.js","utf8");
 const start=source.indexOf("function buildInvoiceDisplayEvidence(");
 assert.ok(start>=0,"independent display evidence builder required");
 const end=source.indexOf("\nconst invoiceDisplayEvidence",start);
 return vm.runInNewContext(source.slice(start,end)+"; JSON.stringify(buildInvoiceDisplayEvidence(documents))",{documents:docs});
}
const invoice={id:123,order_number:"2188",type:"INVOICE",number:"R2188",document_date:"2024-05-18",due_date:"2024-06-01",is_draft:false,cancel_id:null};
test("invoice display evidence includes old held/end-stage invoices independently of eligibility",()=>{
 const data=JSON.parse(evidence([invoice]));assert.equal(data.rows[0].due_date,"2024-06-01");assert.equal(data.rows[0].order,"#NEONT2188");
});
test("ambiguous, draft, cancelled and missing dates are never invented",()=>{
 for(const docs of [[invoice,{...invoice,id:124}],[{...invoice,is_draft:true}],[{...invoice,cancel_id:1}],[{...invoice,due_date:null}]]) assert.equal(JSON.parse(evidence(docs)).rows.length,0);
});
test("final invoice takes precedence over proforma, explicit immediate proforma is supported",()=>{
 const pro={...invoice,id:99,type:"PROFORMA_INVOICE",due_date:null,due_in_days:0,text:"Zahlbar sofort."};
 assert.equal(JSON.parse(evidence([pro])).rows[0].due_date,"2024-05-18");
 assert.equal(JSON.parse(evidence([pro,invoice])).rows[0].document_id,"123");
});
