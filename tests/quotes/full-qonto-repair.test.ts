import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("two full Qonto payments: strict admission, receipt proof and no-email routing", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap",
    "workflows/billing-v2/full-qonto-repair/payment-recovery.test.mjs"], {
    cwd: process.cwd(), encoding: "utf8", env, timeout: 15_000,
  });
  assert.match(output, /# tests 33\b/);
  assert.match(output, /# pass 33\b/);
  assert.match(output, /# fail 0\b/);
});
