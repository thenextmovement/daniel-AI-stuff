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
const patchPath = join(here, "runtime-poll-timeout-patch.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const manifest = JSON.parse(readFileSync(patchPath, "utf8"));

for (const operation of manifest.operations) {
  const node = source.nodes.find((candidate) => candidate.name === operation.nodeName);
  assert.ok(node, `missing source node: ${operation.nodeName}`);

  let value = operation.fieldPath
    .split(".")
    .reduce((current, segment) => current?.[segment], node);
  assert.equal(typeof value, "string", `${operation.nodeName} patch field must be text`);

  for (const patch of operation.patches) {
    assert.equal(
      value.split(patch.find).length - 1,
      1,
      `${operation.nodeName} patch must match exactly once`
    );
    value = value.replace(patch.find, patch.replace);
  }

  node.parameters.jsCode = value;
}

const saveRequestCode = source.nodes.find(
  (node) => node.name === "Save Request ID"
).parameters.jsCode;
const isDoneCode = source.nodes.find(
  (node) => node.name === "Is Done?"
).parameters.jsCode;

assert.match(saveRequestCode, /pollStartedAt: new Date\(\)\.toISOString\(\)/);
assert.match(isDoneCode, /pollElapsedMs >= 9 \* 60 \* 1000/);
assert.doesNotMatch(isDoneCode, /if \(attempts >= 40\) \{/);

function runIsDone({ status, pollStartedAt, runIndex = 0 }) {
  const input = { first: () => ({ json: status }) };
  const nodeLookup = (name) => {
    assert.equal(name, "Save Request ID");
    return {
      first: () => ({
        json: {
          requestId: "provider-request-canary",
          cardId: "0123456789abcdef01234567",
          pollStartedAt
        }
      })
    };
  };
  return Function("$input", "$", "$runIndex", isDoneCode)(
    input,
    nodeLookup,
    runIndex
  );
}

const timedOut = runIsDone({
  status: { status: "pending" },
  pollStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
})[0].json;
assert.equal(timedOut.done, false);
assert.equal(timedOut.transientVideoProviderFailure, true);
assert.equal(timedOut.errorCode, "video_provider_timeout");

const stillPolling = runIsDone({
  status: { status: "pending" },
  pollStartedAt: new Date().toISOString()
})[0].json;
assert.equal(stillPolling.done, false);
assert.equal(stillPolling.transientVideoProviderFailure, undefined);

const completed = runIsDone({
  status: { status: "completed", video: { url: "https://example.test/video.mp4" } },
  pollStartedAt: new Date().toISOString()
})[0].json;
assert.equal(completed.done, true);
assert.equal(completed.videoUrl, "https://example.test/video.mp4");

console.log("preview delivery runtime poll timeout tests passed");
