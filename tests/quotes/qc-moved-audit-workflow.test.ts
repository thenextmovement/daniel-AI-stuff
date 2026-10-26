import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("QC moved-card guard, terminal receipt and internal alert routing", () => {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test",
    "workflows/quote-ready-qc/test-moved-card-audit.mjs",
    "workflows/quote-ready-qc/test-alert-recipient.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnv,
    timeout: 15_000,
  });
  assert.match(output, /# tests 13\b/);
  assert.match(output, /# pass 13\b/);
  assert.match(output, /# fail 0\b/);
});
