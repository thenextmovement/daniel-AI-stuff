import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/internal/billing/email-agent/route';
const key='synthetic-billing-test-credential-not-production';
const request=(body: unknown, token=key)=>new NextRequest('http://localhost/api/internal/billing/email-agent', {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
test('billing email API denies missing configuration, wrong authentication and unknown operations', async()=>{
 const previous=process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256;
 try {
  delete process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256;
  assert.equal((await POST(request({operation:'lookup',customerEmail:'a@example.com'}))).status,503);
  process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256=createHash('sha256').update(key).digest('hex');
  assert.equal((await POST(request({operation:'lookup',customerEmail:'a@example.com'},'wrong'))).status,401);
  for (const body of [{operation:'MARK_PAID'},{operation:'execute',customerConfirmed:false},{operation:'lookup',customerEmail:'x',price:3}]) assert.equal((await POST(request(body))).status,422);
 } finally {if(previous===undefined)delete process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256;else process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256=previous;}
});

test('billing email API binds a proposal to its customer, thread and unchanged data; only confirmed metadata reaches RPC', async()=>{
 const saved={secret:process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256,url:process.env.SUPABASE_URL,role:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
 const current={id:'11111111-1111-4111-8111-111111111111',customer_email:'a@example.com',shopify_order_name:'#NEONT123',billing_address:{company:'Test GmbH',street:'Testweg 1',zip:'12345',city:'Teststadt',country:'DE'},delivery_address:{country:'DE'},vat_id:null,current_revision:2,updated_at:'2026-11-25T10:00:00Z',status:'PAYMENT_PENDING',tax_review_status:'NOT_REQUIRED',final_invoice_at:null,invoice_requested_at:null};
 let rows:unknown[]=[current];let rpcCalls:Record<string,unknown>[]=[];let rpcStatus=200;
 try{
  process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256=createHash('sha256').update(key).digest('hex');
  process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  globalThis.fetch=async(input,init)=>{
   const u=new URL(String(input));assert.equal(u.host,'synthetic.invalid');
   if(u.pathname.endsWith('/billing_cases')){assert.equal(u.searchParams.get('customer_email'),'eq.a@example.com');return Response.json(rows);}
   assert.equal(u.pathname,'/rest/v1/rpc/billing_email_apply_confirmed');rpcCalls.push(JSON.parse(String(init?.body)));
   return Response.json(rpcStatus===200?{stage:'pending'}:{message:'BILLING_EMAIL_STALE'},{status:rpcStatus});
  };
  const prep={operation:'prepare',customerEmail:'a@example.com',caseId:current.id,conversationId:'thread-1',requestMessageId:'request-1',action:'change',changes:{billingAddress:{street:'Neuer Weg 2'}}};
  const response=await POST(request(prep));assert.equal(response.status,200);const proposal=await response.json();
  assert.equal(proposal.billingAddress.street,'Neuer Weg 2');assert.equal(proposal.billingAddress.company,'Test GmbH');assert.equal(rpcCalls.length,0);
  const execution={operation:'execute',customerEmail:'a@example.com',conversationId:'thread-1',confirmationMessageId:'reply-2',customerConfirmed:true,confirmationToken:proposal.confirmationToken};
  for(const patch of [{customerConfirmed:false},{conversationId:'other'},{customerEmail:'other@example.com'},{confirmationMessageId:'request-1'},{confirmationToken:proposal.confirmationToken+'x'}])assert.equal((await POST(request({...execution,...patch}))).status,422);
  assert.equal(rpcCalls.length,0);
  assert.equal((await POST(request(execution))).status,200);assert.deepEqual(rpcCalls[0].p_changes,prep.changes);assert.equal(rpcCalls[0].p_convert,false);
  assert.equal(rpcCalls[0].p_revision,2);assert.equal(rpcCalls[0].p_confirmation_message_id,'reply-2');
  rpcStatus=409;assert.equal((await POST(request(execution))).status,409);
  for(const patch of [{changes:{prices:1}},{action:'convert',changes:{deliveryAddress:{city:'Other'}}}])assert.equal((await POST(request({...prep,...patch}))).status,422);
  rows=[{...current,final_invoice_at:'2026-11-25T10:01:00Z'}];assert.equal((await POST(request(prep))).status,409);
  rows=[];assert.equal((await POST(request(prep))).status,409);
  rows=[current,current];const lookup=await (await POST(request({operation:'lookup',customerEmail:'a@example.com'}))).json();assert.equal(lookup.ambiguous,true);
 }finally{
  globalThis.fetch=saved.fetch;
  for(const [name,value] of Object.entries({BILLING_EMAIL_AUTOMATION_TOKEN_SHA256:saved.secret,SUPABASE_URL:saved.url,SUPABASE_SERVICE_ROLE_KEY:saved.role})){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});
