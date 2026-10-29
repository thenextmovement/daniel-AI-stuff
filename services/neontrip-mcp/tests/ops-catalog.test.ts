import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { OPS_COVERAGE, OPS_CONTRACT_DEPENDENCIES, OPS_OPERATIONS, opsRequest } from "../src/ops-catalog.js";

test("every Ops route is accounted for and catalog review fails on source drift", () => {
 const root=resolve(import.meta.dirname,"../../..");
 function routes(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?routes(dir+"/"+e.name):e.name==="route.ts"?[dir+"/"+e.name]:[]);}
 assert.deepEqual(routes(root+"/src/app/api/ops").map(p=>p.slice(root.length+1)).sort(),OPS_COVERAGE.map(x=>x.source).sort());
 for(const entry of [...OPS_COVERAGE,...OPS_CONTRACT_DEPENDENCIES])assert.equal(createHash("sha256").update(readFileSync(root+"/"+entry.source)).digest("hex"),entry.sha256,"Review changed route: "+entry.source);
 assert.equal(new Set(OPS_OPERATIONS.map(x=>x.id)).size,OPS_OPERATIONS.length);
});
test("Ops target cannot be changed with paths, unknown query keys or arbitrary operations",()=>{
 const op=OPS_OPERATIONS.find(x=>x.pathParameters.length)!;
 for(const value of ["..","a/b","a\\b","\u0000"])assert.throws(()=>opsRequest(op.id,{[op.pathParameters[0]!]:value}));
 assert.throws(()=>opsRequest("https://attacker.example"));
 assert.throws(()=>opsRequest("customer_records_get",{}, {apiKey:"secret"}));
});

test("Ops catalog preserves side effects and documents imported task inputs",()=>{
 assert.equal(OPS_OPERATIONS.find(x=>x.id==="company_brain_resolve_get")?.readOnly,false);
 assert.ok(JSON.stringify(OPS_OPERATIONS.find(x=>x.id==="company_brain_actions_post")).includes("guarded_offer_resend"));
 assert.ok(JSON.stringify(OPS_OPERATIONS.find(x=>x.id==="supplier_sales_post")).includes("send_order_confirmation_email"));
 assert.ok(JSON.stringify(OPS_OPERATIONS.find(x=>x.id==="tasks_post")?.inputContracts).includes("title?"));
 assert.equal(OPS_OPERATIONS.some(x=>x.id==="customer_records_offers_offerId_admin_get"),false);
 assert.equal(OPS_COVERAGE.find(x=>x.source.endsWith("voice-phone/team/route.ts"))?.coverage,"ops_catalog");
});

test("browser transcript writes are explicit exclusions while stored history remains available",()=>{
 assert.ok(OPS_OPERATIONS.some(x=>x.id==="voice_copilot_transcript_get"));
 assert.equal(OPS_OPERATIONS.some(x=>x.id==="voice_copilot_transcript_post"),false);
 assert.equal(OPS_OPERATIONS.some(x=>x.id==="voice_copilot_session_post"),false);
 assert.match(JSON.stringify(OPS_COVERAGE.find(x=>x.source.endsWith("voice-copilot/transcript/route.ts"))),/x-voice-session-token/);
 assert.match(JSON.stringify(OPS_COVERAGE.find(x=>x.source.endsWith("voice-copilot/session/route.ts"))),/connected Voice Copilot UI/);
});

test("phone management and decision workflows expose usable fields and action contracts",()=>{
 const phone=OPS_OPERATIONS.find(x=>x.id==="voice_phone_team_post")!;
 assert.deepEqual(phone.actionValues,["create","update","issue_invite","revoke_invite","revoke_device"]);
 for(const key of ["staffId","values","revision","relatedId"])assert.ok(phone.bodyFields.includes(key));
 assert.match(JSON.stringify(phone),/can_manage_phone/);
 const draft=OPS_OPERATIONS.find(x=>x.id==="company_brain_decisions_post")!;
 for(const key of ["decisionKey","options","reviewAt","scopeType"])assert.ok(draft.bodyFields.includes(key));
 assert.deepEqual(OPS_OPERATIONS.find(x=>x.id==="company_brain_decisions_decisionId_review_post")?.actionValues,["submit","approve","request_changes"]);
 assert.ok(OPS_OPERATIONS.find(x=>x.id==="company_brain_decisions_decisionId_outcomes_post")?.bodyFields.includes("evaluationEnd"));
 assert.ok(OPS_CONTRACT_DEPENDENCIES.some(x=>x.source==="src/lib/ops/voice-phone-management-contract.ts"));
 assert.ok(OPS_CONTRACT_DEPENDENCIES.some(x=>x.source==="supabase/migrations/20261027010000_voice_management_service_actors.sql"));
});

test("supplier worker actions are not advertised as operator actions",()=>{
 const operation=OPS_OPERATIONS.find(x=>x.id==="eu_supplier_quotes_post")!;
 assert.deepEqual(operation.actionValues,["select_organization"]);
 assert.match(JSON.stringify(operation),/excludedActions/);
 assert.match(JSON.stringify(operation),/x-neontrip-signature/);
});

test("resolved business enum values and bounded-list semantics are discoverable",()=>{
 const supplier=OPS_OPERATIONS.find(x=>x.id==="supplier_sales_post")!;
 const description=JSON.parse(JSON.stringify(supplier));
 const enumType=description.inputTypes.find((entry:{name:string})=>entry.name==="SupplierSaleSupplier");
 assert.match(enumType.resolvedType,/quentin/);
 assert.equal(enumType.resolvedType,'"quentin" | "said" | "special"');
 assert.doesNotMatch(JSON.stringify(OPS_OPERATIONS),/\/home\/rahim\/worktrees\//);
 for(const id of ["supplier_sales_get","tasks_get","company_brain_decisions_get","voice_copilot_candidates_get","voice_copilot_knowledge_get","eu_supplier_quotes_get","design_jobs_get"]) {
  const request=opsRequest(id,{}, {offset:200,limit:2});
  assert.match(request.path,/offset=200/);
 }
 assert.match(opsRequest("voice_copilot_candidates_get",{}, {status:"approved",offset:100}).path,/status=approved/);
 assert.match(opsRequest("design_jobs_jobId_get",{jobId:"test-job"},{assetOffset:20,assetLimit:20}).path,/assetOffset=20/);
 assert.match(opsRequest("company_brain_decisions_decisionId_outcomes_get",{decisionId:"test-decision"},{offset:100,status:"met"}).path,/offset=100/);
});

test("customer and voice history alternatives expose every pagination/filter key",()=>{
 const requests=opsRequest("customer_records_get",{}, {mode:"requests",customerId:"test",requestId:"external",query:"test",status:"all",limit:2,offset:100});
 assert.match(requests.path,/offset=100/);
 assert.match(opsRequest("customer_records_get",{}, {mode:"history",requestId:"external",source:"quote_version_images",offset:80}).path,/source=quote_version_images/);
 const customer=OPS_OPERATIONS.find(x=>x.id==="customer_records_get")!;
 assert.match(JSON.stringify(customer),/schema_unavailable/);
 assert.match(JSON.stringify(customer),/outlook_organization/);
 for(const key of ["collection","limit","offset","id","status","mode","lifecycle","evalStatus","enabled","campaignId","requestId","offerId","consentId","targetId","attemptId","modelReleaseId","promptVersionId","outcomeCode","phone"]) {
  assert.ok(OPS_OPERATIONS.find(x=>x.id==="voice_platform_get")!.queryParameters.includes(key),key);
 }
});
