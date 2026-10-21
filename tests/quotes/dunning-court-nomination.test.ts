import assert from "node:assert/strict";
import test from "node:test";
import { pendingCourtNomination, nominationBlockers } from "../../src/lib/ops/dunning-court-nomination";

test("nomination is persistent until an application is actually created", () => {
  const rows = [{id:"one",created_at:"2026-10-20T12:00:00Z",metadata:{order_number:"#NEONT5000",actor:"Fabienne"}}];
  assert.deepEqual(pendingCourtNomination("#NEONT5000", rows, []), {id:"one",at:"2026-10-20T12:00:00Z",actor:"Fabienne"});
  assert.equal(pendingCourtNomination("#NEONT5001", rows, []), null);
  assert.equal(pendingCourtNomination("#NEONT5000", rows, [{eventType:"application_draft_created"}]), null);
});
test("paid and locked cases cannot be nominated", () => {
  const open = { amountCents:10000, financialStatus:"pending", state:"action_required", paused:false,stopTag:false,paymentException:false,courtEvents:[] };
  assert.deepEqual(nominationBlockers(open), []);
  for (const overrides of [{amountCents:0},{financialStatus:"paid"},{paused:true},{stopTag:true},{paymentException:true}]) {
    assert.ok(nominationBlockers({...open,...overrides}).length);
  }
});

import { recordDunningCourtNomination } from "../../src/lib/ops/dunning";
test("nomination writes only an idempotent audit record, never a document or send job", async () => {
  const originalFetch = globalThis.fetch;
  const env = {url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL="https://database.example.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test";
  const requests: {url:string;init:RequestInit}[]=[];
  globalThis.fetch = async (url, init) => {
    requests.push({url:String(url),init:init!});
    if (init?.method === "GET") {
      const saved = JSON.parse(String(requests[0].init.body));
      return Response.json([{id:saved.id,created_at:"2026-10-21T12:00:00Z",metadata:saved.metadata}]);
    }
    return new Response(null,{status:204});
  };
  try {
    const id="12345678-1234-4234-8234-123456789abc";
    const saved = await recordDunningCourtNomination({id,orderNumber:"#NEONT5000",actor:"Fabienne"});
    assert.equal(saved.at, "2026-10-21T12:00:00Z");
    assert.equal(saved.id, id);
    assert.equal(requests[1].init.method, "GET");
    assert.equal(requests.length,2);
    assert.match(requests[0].url,/workflow_audit_log\?on_conflict=id$/);
    const body=JSON.parse(String(requests[0].init.body));
    assert.equal(body.action,"ops_dunning_court_nomination");assert.equal(body.id,id);
    assert.equal(body.metadata.actor,"Fabienne");assert.equal(body.metadata.order_number,"#NEONT5000");
    await assert.rejects(recordDunningCourtNomination({id,orderNumber:"#NEONT5000",actor:""}));
    assert.equal(requests.length,2);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries({SUPABASE_URL:env.url,SUPABASE_SERVICE_ROLE_KEY:env.key})) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
