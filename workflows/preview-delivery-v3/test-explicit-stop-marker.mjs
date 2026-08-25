import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(
  here,
  "source",
  "S4gjf0YeZjP0pqFR.active.ed3b1567-98e7-48b8-8cec-b90cbe6a5498.json"
);
const patchPath = join(here, "explicit-stop-marker-patch.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const manifest = JSON.parse(readFileSync(patchPath, "utf8"));
const operation = manifest.operations[0];
const node = source.nodes.find((candidate) => candidate.name === operation.nodeName);

assert.ok(node, `missing source node: ${operation.nodeName}`);
assert.equal(operation.fieldPath, "parameters.jsonBody");

let body = node.parameters.jsonBody;
for (const patch of operation.patches) {
  assert.equal(
    body.split(patch.find).length - 1,
    1,
    `${operation.nodeName} patch must match exactly once`
  );
  body = body.replace(patch.find, patch.replace);
}

const match = body.match(/const stopRequested = (\/.+\/[a-z]*).test\(title\);/);
assert.ok(match, "patched stop marker expression must remain present");
const stopMarker = Function(`return ${match[1]}`)();

for (const title of [
  "[STOP] Interner Versandhalt",
  "[STOPP] Interner Versandhalt",
  "  [stop] Interner Versandhalt",
  "[STOP]"
]) {
  assert.equal(stopMarker.test(title), true, `explicit marker must pause: ${title}`);
}

for (const title of [
  "Design: #stop med fakes",
  "#stop med fakes",
  "Stop Med Fakes",
  "Kundentext [STOP]",
  "[STOP]Design",
  "LED Neon Flex"
]) {
  assert.equal(stopMarker.test(title), false, `customer text must not pause: ${title}`);
}

console.log("explicit stop marker tests passed");
