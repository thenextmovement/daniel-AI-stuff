import assert from "node:assert/strict";
import test from "node:test";
import flow from "../../n8n/workflows/voice-placetel-dial-v1.json";

const claim = {session_id: "fake", target_id: "100", employee_id: "123", extension: "11", phone: "+492210000000"};
const target = { id:100, webuser_id:123, did:11, sipuid:"operator@example.invalid", domain:"example.invalid", callerid:"02210000001" };

function evaluate(name: string, json: object) {
  const node = flow.nodes.find(row => row.name === name);
  assert.ok(node?.parameters.jsCode);
  return new Function("$input", "$", node.parameters.jsCode)(
    { first: () => ({json}) }, () => ({first: () => ({json: claim})})
  )[0].json;
}

test("Placetel dispatch requires the reserved staff target, employee, extension, domain, and caller ID", () => {
  const checked = evaluate("Verify personal SIP identity", {statusCode:200,body:target});
  assert.equal(checked.verified,true);
  assert.equal(checked.source,"+492210000001");
  for (const partial of [{id:101},{webuser_id:124},{did:12},{domain:"other.invalid"},{callerid:""}]) {
    const rejected = evaluate("Verify personal SIP identity",{statusCode:200,body:{...target,...partial}});
    assert.equal(rejected.verified,false);
    assert.equal(rejected.sipuid,null);
  }
});

test("an uncertain provider reply never retries the outbound dial", () => {
  for (const statusCode of [0,200,202,500,503]) {
    assert.equal(evaluate("Classify provider response",{statusCode}).outcome,"uncertain");
  }
  assert.deepEqual(evaluate("Classify provider response",{statusCode:201,body:{id:123}}),{outcome:"accepted",providerId:"123"});
  assert.equal(evaluate("Classify provider response",{statusCode:403}).outcome,"rejected");
  const dial = flow.nodes.find(n => n.name === "Dial once");
  assert.ok(dial && !("retryOnFail" in dial && dial.retryOnFail));
  assert.equal(dial.parameters.url,"https://api.placetel.de/v2/calls");
  assert.deepEqual(flow.connections["Identity verified"].main.map(outputs=>outputs[0].node),["Softphone handoff","Refuse wrong target"]);
});

test("a public webhook cannot provide a phone, staff identity or SIP target", () => {
  for (const dispatchKey of [undefined,null,"customer-phone","00000000-0000-0000-0000-000000000000"]) {
    assert.deepEqual(evaluate("Accept key only",{body:{dispatchKey,phone:claim.phone,sipuid:target.sipuid}}),{key:null});
  }
  assert.deepEqual(flow.connections["Valid key"].main.map(outputs=>outputs[0].node),["Claim once","No dialing"]);
  assert.deepEqual(flow.connections["Reserved by OPS"].main.map(outputs=>outputs[0].node),["Read personal Placetel target","No dialing"]);
});

test("direct softphone calls verify the source and enter post-processing without requesting an office callback", () => {
  const connections = flow.connections;
  assert.deepEqual(connections["Softphone handoff"].main.map(branch => branch[0].node), ["Prepare softphone", "Dial once"]);
  assert.deepEqual(evaluate("Prepare softphone", {}), {outcome:"accepted", providerId:null});
  assert.equal(connections["Prepare softphone"].main[0][0].node, "Record dispatch outcome");
  assert.match(flow.nodes.find(n => n.name === "Claim once")!.parameters.url!, /claim_voice_placetel_dial_mode$/);
});
