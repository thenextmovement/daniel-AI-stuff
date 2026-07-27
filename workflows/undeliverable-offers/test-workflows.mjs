import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
for (const file of ["undeliverable-offer-intake-v1.json", "undeliverable-offer-executor-v1.json"]) {
  const workflow = JSON.parse(readFileSync(resolve(root, "generated", file), "utf8"));
  assert.equal(workflow.active, false, `${file} must be imported disabled`);
  assert.ok(workflow.nodes.length <= 30, `${file} exceeds node cap`);
  assert.equal(workflow.nodes.filter((node) => /Trigger$/.test(node.type)).length, 1, `${file} must have one trigger`);
  assert.ok(workflow.nodes.every((node) => node.continueOnFail !== true), `${file} cannot continueOnFail`);
  assert.ok(!JSON.stringify(workflow).match(/(?:gho_|service_role|eyJ[A-Za-z0-9_-]{20})/), `${file} contains a credential`);
}
const executor = JSON.parse(readFileSync(resolve(root, "generated", "undeliverable-offer-executor-v1.json"), "utf8"));
assert.match(JSON.stringify(executor), /execute-one/);
assert.match(JSON.stringify(executor), /OPS_INTERNAL_API_KEY/);
console.log("undeliverable offer workflows valid");
