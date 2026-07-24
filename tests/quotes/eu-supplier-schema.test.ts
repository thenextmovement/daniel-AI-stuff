import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../..");
const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260724193000_create_eu_supplier_quotes.sql"),"utf8");
const claims=fs.readFileSync(path.join(root,"supabase/migrations/20260724193200_create_eu_supplier_claims.sql"),"utf8");
const contracts=JSON.parse(fs.readFileSync(path.join(root,"workflows/eu-supplier/contracts.json"),"utf8"));
test("schema has durable unique delivery, reply and alert identities",()=>{
 assert.match(migration,/idempotency_key text not null unique/);
 assert.match(migration,/internet_message_id text not null unique/);
 assert.match(migration,/alert_idempotency_key text unique/);
 assert.match(migration,/enable row level security/g);
 assert.match(migration,/revoke all .* from anon,authenticated/);
 assert.match(claims,/for update skip locked/g);
 assert.match(claims,/auth\.role\(\).*service_role/);
 assert.match(claims,/alert_status='sending'/);
});
test("workflow contracts have one trigger, bounded nodes and safe alerts",()=>{
 assert.equal(contracts.workflows.length,3);
 for(const workflow of contracts.workflows){assert.equal(typeof workflow.trigger,"string");assert.ok(workflow.nodes.length<=30);assert.equal(workflow.active,false);}
 const dispatch=contracts.workflows.find((item:{trigger:string})=>item.trigger==="trello_move");
 assert.equal(dispatch.terminalFailure.maxAttempts,2);
 assert.equal(dispatch.terminalFailure.alertSubject,"EU Supplier Mail fehlgeschlagen");
 const alert=contracts.workflows.find((item:{trigger:string})=>item.trigger==="schedule_2_minutes");
 assert.equal(alert.recipientSource,"fixed_configuration");
 assert.equal(alert.terminalFailure.maxAttempts,1);
 assert.ok(!alert.nodes.includes("RetryAlert"));
});
