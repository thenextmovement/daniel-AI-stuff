import assert from "node:assert/strict";
import test from "node:test";
import { listCompanyBrainTrelloAliasRepairs, repairCompanyBrainTrelloAlias } from "@/lib/ops/company-brain-alias-repair";

// Real production schema: contact fields belong to master_customers, not master_requests.
test("alias inbox and repair load contact labels from the customer relation", async () => {
  const originalFetch=globalThis.fetch, previous={...process.env};
  process.env.SUPABASE_URL="https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="local-test-key";
  const alias={id:"alias-1",request_id:"REQ-SCHEMA-1",alias_trello_card_id:"G6Clgcsz",canonical_trello_card_id:null};
  const calls:string[]=[];
  let requestReads=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),table=url.pathname.split("/").pop();
    const method=init?.method||"GET";calls.push(`${method} ${table}`);
    if(table==="master_requests"){
      requestReads++;
      const select=url.searchParams.get("select")||"";
      const rootFields=select.replace(/[^,]+\([^)]*\)/g,"").split(",");
      if(rootFields.some(f=>["email","company","company_name","first_name","last_name"].includes(f)))
        return Response.json({code:"42703",message:"column master_requests.email does not exist"},{status:400});
      assert.match(select,/master_customers(?:![^(,]+)?\(/);
      return Response.json([{id:"request-row-1",request_id:"REQ-SCHEMA-1",trello_card_id:"canonical-card-1",title:null,
        customer:{company_name:"Schema Test Company",email:"schema@example.invalid"}}]);
    }
    if(table==="trello_card_aliases"&&method==="GET")return Response.json([alias]);
    if(table==="trello_card_aliases"&&method==="PATCH")return Response.json([{...alias,...JSON.parse(String(init?.body))}]);
    if(table==="workflow_audit_log")return Response.json(method==="GET"?[]:[{id:"audit-test"}]);
    throw Error(`Unexpected ${method} ${table}`);
  };
  try{
    const items=await listCompanyBrainTrelloAliasRepairs(2);
    assert.equal(items[0]?.candidates[0]?.title,"Schema Test Company");
    assert.equal(items[0]?.candidates[0]?.requestId,"REQ-SCHEMA-1");
    assert.equal(items[0]?.safeFixAvailable,true);
    assert.equal(calls.some(x=>!x.startsWith("GET ")),false);
    const result=await repairCompanyBrainTrelloAlias({aliasId:"alias-1",requestId:"REQ-SCHEMA-1",operatorName:"test"});
    assert.equal(result.row.canonical_trello_card_id,"canonical-card-1");
    assert.equal(requestReads,2);
    assert.ok(calls.includes("PATCH trello_card_aliases"));
  }finally{globalThis.fetch=originalFetch;process.env=previous;}
});
