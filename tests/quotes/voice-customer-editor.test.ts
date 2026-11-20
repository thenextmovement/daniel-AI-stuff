import test from "node:test";
import assert from "node:assert/strict";
import {validateCustomerEditor,readCustomerEditor,saveCustomerEditor} from "../../src/lib/ops/voice-customer-editor";
const input=()=>({firstName:"Rahim",lastName:"Test",email:"MAIN@example.test",phone:"015904209999",emails:[],phones:[],organizationId:null,newOrganizationName:"",expectedUpdatedAt:"2026-11-20T10:00:00Z"});
test("normalizes primary contacts and accepts ten additional addresses",()=>{
 const result=validateCustomerEditor({...input(),emails:Array.from({length:10},(_,i)=>'alias'+i+'@example.test')});
 assert.equal(result.email,"main@example.test");assert.equal(result.phone,"+4915904209999");assert.equal(result.emails.length,10);
});
test("rejects eleven contacts, duplicates and primary duplicates",()=>{
 assert.throws(()=>validateCustomerEditor({...input(),emails:Array.from({length:11},(_,i)=>'alias'+i+'@example.test')}));
 assert.throws(()=>validateCustomerEditor({...input(),emails:["A@example.test","a@example.test"]}));
 assert.throws(()=>validateCustomerEditor({...input(),phones:["+4915904209999"]}));
 assert.throws(()=>validateCustomerEditor({...input(),emails:["main@example.test"]}));
});
test("rejects invalid address, phone, organization and stale form shape",()=>{
 for(const patch of [{email:"invalid"},{phone:"123"},{organizationId:"invalid"},{expectedUpdatedAt:"never"},{firstName:"a\nb"},{emails:[42]}])assert.throws(()=>validateCustomerEditor({...input(),...patch}));
});
test("allows empty phone and international numbers",()=>{
 const result=validateCustomerEditor({...input(),phone:"",phones:["+442079460018"]});
 assert.equal(result.phone,null);assert.deepEqual(result.phones,["+442079460018"]);
});

test("reads tenant-scoped contacts and saves atomically with server-owned tenant and actor",async()=>{
 const original=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://example.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
 const id="10000000-0000-0000-0000-000000000001",tenant="a0000000-0000-0000-0000-000000000001";
 let rpc:any,reads=0;
 globalThis.fetch=async(url,init)=>{
  const u=new URL(String(url));let data:any=[];
  if(u.pathname.endsWith("/crm_organizations")){assert.equal(u.searchParams.get("slug"),"eq.neontrip");data=[{id:tenant}];}
  else if(u.pathname.endsWith("/master_customers")){assert.equal(u.searchParams.get("organization_id"),"eq."+tenant);reads++;data=[{id,organization_id:tenant,email:rpc?rpc.p_email:"old@example.test",phone:null,updated_at:"2026-11-20T10:00:00Z"}];}
  else if(u.pathname.endsWith("/customer_contact_points"))data=[{kind:"email",value:"extra@example.test"},{kind:"phone",value:"+442079460018"}];
  else if(u.pathname.endsWith("/voice_customer_phone_numbers"))data=[{phone:"+442079460018"}];
  else if(u.pathname.endsWith("/customer_manual_contact_fields"))data=[{fields:["customer_organization_id"]}];
  else if(u.pathname.endsWith("/save_voice_customer_v1")){rpc=JSON.parse(String(init?.body));data={customerId:id};}
  else assert.ok(u.pathname.endsWith("/customer_organizations"),u.pathname);
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  const initial=await readCustomerEditor(id);assert.deepEqual(initial.phones,["+442079460018"]);assert.equal(initial.organizationManuallySet,true);
  const result=await saveCustomerEditor(id,{...input(),tenantId:"untrusted"},"actor-id");
  assert.equal(rpc.p_tenant_id,tenant);assert.equal(rpc.p_actor,"actor-id");assert.equal(rpc.p_customer_id,id);assert.equal(result.customer.email,"old@example.test");assert.equal(rpc.p_phone,null);assert.equal(reads,3);
 }finally{globalThis.fetch=original;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});

 test("preserves server primary contacts even with manipulated input and legacy phone",()=>{
 const result=validateCustomerEditor({...input(),email:"replacement@example.test",phone:"+442079460018",phones:[{phone:"020 7946 0018",country:"GB"}]},{email:"old@example.test",phone:"legacy number"});
 assert.equal(result.email,"old@example.test");assert.equal(result.phone,"legacy number");assert.deepEqual(result.phones,["+442079460018"]);
 });
 test("country selection normalizes local phone and rejects primary alias",()=>{
 assert.deepEqual(validateCustomerEditor({...input(),phones:[{phone:"015904208888",country:"DE"}]}).phones,["+4915904208888"]);
 assert.throws(()=>validateCustomerEditor({...input(),phones:[{phone:"015904209999",country:"DE"}]},{email:"old@example.test",phone:"015904209999"}));
 });
