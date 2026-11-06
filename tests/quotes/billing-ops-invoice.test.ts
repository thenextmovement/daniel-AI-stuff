import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ops/billing/[caseId]/invoice/route";
const caseId="10000000-0000-4000-8000-000000000001";
const body={expectedRevision:0,expectedUpdatedAt:"2026-11-06T10:00:00.123456Z",customerRequestConfirmed:true,customerRequestRef:"outlook:synthetic-test",actor:"hermes-klara@neontrip",idempotencyKey:"synthetic-invoice-key"};
const request=(input:unknown,host="localhost")=>new NextRequest(`http://${host}/api/ops/billing/${caseId}/invoice`,{method:"POST",headers:{host,"content-type":"application/json"},body:JSON.stringify(input)});
test("invoice endpoint validates exact inputs and binds audit to authenticated actor",async()=>{
 const original=globalThis.fetch,before={...process.env};let calls=0;let fail=false;
 try{
  Object.assign(process.env,{NODE_ENV:"development",SUPABASE_URL:"https://invoice-test.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-only"});
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   calls++;assert.equal(String(input),"https://invoice-test.invalid/rest/v1/rpc/billing_ops_request_invoice");assert.equal(init?.method,"POST");
   const args=JSON.parse(String(init?.body));assert.equal(args.p_case_id,caseId);assert.equal(args.p_updated_at,body.expectedUpdatedAt);
   assert.match(args.p_actor,/local-ops/);assert.match(args.p_actor,/hermes-klara@neontrip/);
   assert.equal(args.p_customer_request_ref,body.customerRequestRef);assert.equal(args.p_revision,0);
   return fail?Response.json({message:"BILLING_INVOICE_STALE"},{status:400}):Response.json({id:caseId,status:"INVOICE_PENDING",duplicate:false});
  }) as typeof fetch;
  for(const patch of [{customerRequestConfirmed:false},{customerRequestRef:""},{expectedRevision:-1},{expectedUpdatedAt:"wrong"},{action:"MARK_PAID"},{totalGrossCents:1}]){
   assert.equal((await POST(request({...body,...patch}),{params:Promise.resolve({caseId})})).status,422);
  }
  assert.equal(calls,0);
  const ok=await POST(request(body),{params:Promise.resolve({caseId})});assert.equal(ok.status,200);assert.equal(calls,1);
  fail=true;assert.equal((await POST(request(body),{params:Promise.resolve({caseId})})).status,409);
  Object.assign(process.env,{NODE_ENV:"production"});
  const denied=await POST(request(body,"untrusted.invalid"),{params:Promise.resolve({caseId})});assert.ok([401,503].includes(denied.status));assert.equal(calls,2);
 }finally{globalThis.fetch=original;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
