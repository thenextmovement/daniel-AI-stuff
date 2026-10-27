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
 assert.ok(JSON.stringify(OPS_OPERATIONS.find(x=>x.id==="tasks_post")?.inputContracts).includes("title?"));
 assert.equal(OPS_OPERATIONS.some(x=>x.id==="customer_records_offers_offerId_admin_get"),false);
 assert.equal(OPS_COVERAGE.find(x=>x.source.endsWith("voice-phone/team/route.ts"))?.coverage,"ops_catalog");
});
