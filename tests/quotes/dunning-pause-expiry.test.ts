import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const patch = JSON.parse(readFileSync(new URL("../../n8n/dunning-managed-pause-expiry.patch.json", import.meta.url), "utf8"));
const nodes = patch.operations.filter((op: any) => op.type === "addNode").map((op: any) => op.node);
const find = new Function("$", "$now", nodes.find((n: any) => n.name === "Find All Due Managed Pauses").parameters.jsCode);
const verify = new Function("$input", nodes.find((n: any) => n.name === "Verify Managed Pause Expiry").parameters.jsCode);
const row = { shopify_order_number: "#NEONT5000", mahnstufe: 6, paused: true, pause_mode: "until_date", pause_until: "2026-10-20T10:00:00Z", pause_reason: "Rückruf vereinbart", paused_by: "operator@example.test", pause_version: 2, updated_at: "2026-10-13T10:00:00Z" };
const run = (rows: any[], range?: string) => find(() => ({all: () => [{json: {statusCode: 200, body: rows, headers: {"content-range": range ?? (rows.length ? `0-${rows.length-1}/${rows.length}` : "*/0")}}}]}), {toMillis: () => Date.parse("2026-10-20T10:00:00Z")});
test("timed pauses expire at final stage without requiring another email", () => {
 assert.equal(run([row])[0].json.resume_due, true);
 assert.equal(run([row])[0].json.mahnstufe, 6);
 for (const change of [{paused:false}, {pause_mode:"manual"}, {pause_until:"2026-10-21T10:00:00Z"}]) assert.equal(run([{...row,...change}])[0].json.resume_due,false);
 assert.equal(run([])[0].json.resume_due,false);
});
test("partial snapshots, duplicate holds and malformed managed holds stop the run", () => {
 assert.throws(() => run([row], "0-0/2"), /INCOMPLETE/);
 assert.throws(() => run([row,row]), /DUPLICATE/);
 assert.throws(() => run([{...row,pause_version:0}]), /INVALID/);
});
test("resumption requires a confirmed RPC event and unpaused result", () => {
 const response = {statusCode:200,body:[{event_id:"event",result_paused:false,result_pause_version:3}]};
 const input = (r: any) => ({all: () => [{json:r}]});
 assert.deepEqual(verify(input(response)),[{json:{resumed:1}}]);
 for (const r of [{...response,statusCode:503},{...response,body:[]},{...response,body:[{...response.body[0],result_paused:true}]}]) assert.throws(() => verify(input(r)),/UNCONFIRMED/);
});
test("pause expiry uses the existing versioned RPC and does not advance stages or send", () => {
 const rpc = nodes.find((n: any) => n.name === "Expire All Due Managed Pauses");
 assert.match(rpc.parameters.url,/rpc\/apply_dunning_pause_action$/);
 const payload = new Function("$json", "return " + rpc.parameters.jsonBody.slice(3,-3)) (row);
 const parsed = JSON.parse(payload);
 assert.equal(parsed.p_action,"auto_resume"); assert.equal(parsed.p_expected_pause_version,2);
 assert.equal(parsed.p_current_stage,6); assert.match(parsed.p_idempotency_key,/:v2:auto$/);
 assert.ok(!patch.operations.some((op: any) => /Live Gate|Message|Send/.test(op.nodeName || "")));
});
