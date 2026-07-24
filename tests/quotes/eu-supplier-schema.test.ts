import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root=path.resolve(import.meta.dirname,"../..");
const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260724193000_create_eu_supplier_quotes.sql"),"utf8");
const claims=fs.readFileSync(path.join(root,"supabase/migrations/20260724193200_create_eu_supplier_claims.sql"),"utf8");
const contracts=JSON.parse(fs.readFileSync(path.join(root,"workflows/eu-supplier/contracts.json"),"utf8"));
const generatedDir=path.join(root,"workflows/eu-supplier/generated");
test("schema has durable unique delivery, reply and alert identities",()=>{
 assert.match(migration,/idempotency_key text not null unique/);
 assert.match(migration,/internet_message_id text not null unique/);
 assert.match(migration,/alert_idempotency_key text unique/);
 assert.match(migration,/enable row level security/g);
 assert.match(migration,/revoke all .* from anon,authenticated/);
 assert.match(claims,/for update skip locked/g);
 assert.match(claims,/auth\.role\(\).*service_role/);
 assert.equal((claims.match(/attempt_count<2/g)||[]).length,2);
 assert.match(claims,/alert_status='sending'/);
 assert.match(claims,/status='failed' and alert_status='pending'/);
 assert.doesNotMatch(claims,/alert_status in \('pending','failed'\)/);
});
test("workflow contracts have one trigger, bounded nodes and safe alerts",()=>{
 assert.equal(contracts.workflows.length,4);
 for(const workflow of contracts.workflows){assert.equal(typeof workflow.trigger,"string");assert.ok(workflow.nodes.length<=30);assert.equal(workflow.active,false);}
 const dispatch=contracts.workflows.find((item:{trigger:string})=>item.trigger==="trello_move");
 assert.equal(dispatch.terminalFailure.maxAttempts,2);
 assert.equal(dispatch.terminalFailure.alertSubject,"EU Supplier Mail fehlgeschlagen");
 const alert=contracts.workflows.find((item:{trigger:string})=>item.trigger==="schedule_2_minutes");
 assert.equal(alert.recipientSource,"fixed_configuration");
 assert.equal(alert.terminalFailure.maxAttempts,1);
 assert.ok(!alert.nodes.includes("RetryAlert"));
});
test("generated n8n workflows are importable, inactive and bounded",()=>{
 const files=fs.readdirSync(generatedDir).filter((name)=>name.endsWith(".json"));
 assert.deepEqual(files.sort(),["delivery-worker-v1.json","failure-alert-v1.json","reply-intake-v1.json","trello-intake-v1.json"]);
 for(const filename of files){
  const workflow=JSON.parse(fs.readFileSync(path.join(generatedDir,filename),"utf8"));
  assert.equal(workflow.active,false);
  assert.ok(Array.isArray(workflow.nodes));
  assert.ok(workflow.nodes.length<30);
  assert.equal(workflow.nodes.filter((item:{type:string})=>item.type.endsWith("Trigger")||item.type.endsWith("webhook")).length,1);
  assert.ok(workflow.nodes.every((item:{continueOnFail?:boolean})=>item.continueOnFail!==true));
 }
 const delivery=JSON.parse(fs.readFileSync(path.join(generatedDir,"delivery-worker-v1.json"),"utf8"));
 assert.equal(delivery.nodes.find((item:{name:string})=>item.name==="Send Graph Draft").retryOnFail,undefined);
 const alert=JSON.parse(fs.readFileSync(path.join(generatedDir,"failure-alert-v1.json"),"utf8"));
 assert.equal(alert.nodes.find((item:{name:string})=>item.name==="Send Alert Exactly Once").retryOnFail,false);
});
